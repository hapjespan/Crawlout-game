// Public entry point: createRenderer({ canvas }). The renderer reads snapshots only, never sim state (contract 1).
import type { GameData } from '@crawlout/data';
import { MAX_ENTITIES, TICK_MS, UNITS_PER_METER } from '@crawlout/protocol';
import { Color, Matrix4, PCFShadowMap, PerspectiveCamera, Plane, Raycaster, Scene, Vector2, Vector3, WebGPURenderer } from 'three/webgpu';
import { uniform } from 'three/tsl';
import { RtsCameraController, type RtsCameraOptions } from './camera/rtsCamera.js';
import { DECAL_COLOR, DECAL_SHAPE, DecalLayer, type DecalStyle } from './decals/decalLayer.js';
import { FootprintTable, footprintsFromGameData, type FootprintLookup } from './entities/footprint.js';
import {
  pickDataTexturePrecision,
  probeWebGL2DataTextureCaps,
  WEBGPU_DATA_TEXTURE_CAPS,
  type DataTexturePrecision,
} from './gpu/dataTextures.js';
import { PerfMeter, PerfOverlay, type FrameStats } from './perf/perfOverlay.js';
import { pickEntity, pickNearestOnScreen, selectInRect, type BoxSelectOptions, type PickShape, type ScreenRect } from './picking/selection.js';
import { SunShadow } from './shadows/sunShadow.js';
import { createInterpolatedFrame, simYawToRender, SnapshotInterpolator } from './snapshot/interpolate.js';
import { createPropMaterial } from './structures/propMaterial.js';
import { StructureLayer } from './structures/structureLayer.js';
import { createGridTerrain, type TerrainGeometry } from './terrain/heightField.js';
import { TerrainLayer } from './terrain/terrainLayer.js';
import { bakeAnimations } from './units/bake.js';
import { resolveManifestPath, UnitAssetLoader, createGltfIO } from './units/unitAssetLoader.js';
import { UnitAssetRegistry, type UnitAssetConfig, type UnitAssetOptions, type UnitAssetStatus } from './units/unitAssets.js';
import { DEFAULT_LIGHT_DIR, UnitLayer } from './units/unitLayer.js';
import { abilitiesFromGameData, AbilityZones, type AbilityLookup } from './vfx/abilityZones.js';
import { EffectSpawner, type EffectContext } from './vfx/effects.js';
import { ParticlePool } from './vfx/particles.js';

export type RenderBackend = 'webgpu' | 'webgl2';

export interface CreateRendererOptions {
  canvas: HTMLCanvasElement;
  /** Skip WebGPU and use the WebGL2 backend. WebGL2 is also used automatically when WebGPU is unavailable. */
  forceWebGL?: boolean;
  /** Stats overlay: true mounts it in the canvas' parent, an element mounts it there, false hides it. Default true. */
  stats?: boolean | HTMLElement;
  /** Device pixel ratio cap. Default 2. */
  maxPixelRatio?: number;
  camera?: RtsCameraOptions;
  /** Entity capacity per batch. Default MAX_ENTITIES. */
  capacity?: number;
  /** Real shadows cast by buildings onto terrain and buildings. Default true. */
  shadows?: boolean;
  /** Data texture precision: 'auto' (default) probes float32 support on WebGL2 and falls back to half-float. */
  dataTextures?: 'auto' | DataTexturePrecision;
  /** Building footprint by typeId. setGameData() replaces it with the footprints from GameData. */
  buildingFootprint?: FootprintLookup;
  /**
   * Character assets from the asset-cli. With a manifest, setGameData() loads the body asset of every loadout
   * (visuals.meshSlots.body) that the manifest has; defaultUnit names the asset for all other units. Without it,
   * or when loading fails, units keep the procedural placeholder rig.
   */
  assets?: UnitAssetConfig;
}

export interface PickResult {
  /** Entity id under the cursor, or null. */
  entityId: number | null;
  /** Ground point under the cursor in sim units (1 m = 256), or null when the ray misses the ground. */
  ground: { x: number; y: number } | null;
}

/** Ghost footprint for the HUD's build placement. x, y: footprint center in sim units (1 m = 256). */
export interface PlacementPreview {
  /** Building typeId (1024 + buildingId); the footprint comes from GameData or the buildingFootprint option. */
  typeId: number;
  x: number;
  y: number;
  /** Green when true, red when false. */
  valid: boolean;
}

export interface CrawloutRenderer {
  readonly backend: RenderBackend;
  /** Precision of the bone, clip and height textures: float32, or half-float on WebGL2 drivers without float32. */
  readonly dataTexturePrecision: DataTexturePrecision;
  readonly cameraControls: RtsCameraController;
  /** Hands over one snapshot buffer (contract 1). The renderer keeps a reference: do not reuse the buffer. */
  pushSnapshot(buf: ArrayBuffer): void;
  /** Replaces the terrain. Arrays are kept, not copied. */
  setTerrain(geometry: TerrainGeometry): void;
  /**
   * Game data for visuals: building footprints by typeId, the radius and duration of hero ability zones (event
   * abilityZone), and (with `assets`) the body asset per loadout.
   */
  setGameData(data: Pick<GameData, 'buildings'> & Partial<Pick<GameData, 'loadouts' | 'heroes'>>): void;
  /**
   * Loads a character asset from an asset-cli manifest and draws the units whose loadout names it (meshSlots.body)
   * with it; `asDefault` also gives it to every unit without an asset of its own. Resolves with the status, never
   * rejects: on failure the placeholder rig stays.
   */
  loadUnitAsset(manifestUrl: string, assetId: string, opts?: UnitAssetOptions): Promise<UnitAssetStatus>;
  /** Status of every unit asset requested so far. */
  unitAssets(): UnitAssetStatus[];
  /** Shows a ghost footprint at a sim position, or hides it with null. */
  setPlacementPreview(preview: PlacementPreview | null): void;
  /** What lies under canvas-local CSS pixel (x, y). Units, buildings, scrap nodes and claim points can be hit. */
  pickAt(x: number, y: number): PickResult;
  /** Entity ids inside a canvas-local CSS pixel rectangle; units only unless opts.includeStructures. */
  boxSelect(rect: ScreenRect, opts?: BoxSelectOptions): number[];
  /** Centers the camera on a sim position (sim units). */
  focus(x: number, y: number): void;
  /** Latest measured frame stats. */
  stats(): FrameStats;
  dispose(): void;
}

function createOverlay(stats: boolean | HTMLElement, canvas: HTMLCanvasElement): PerfOverlay | null {
  if (stats === false) return null;
  const parent = stats instanceof HTMLElement ? stats : canvas.parentElement;
  return parent ? new PerfOverlay(parent) : null;
}

/** Height-texture edge the decals may need (terrain/heightTexture.ts caps at 512). */
const HEIGHT_TEXTURE_EDGE = 512;
const PARTICLES_PER_POOL = 4096;
const PREVIEW_VALID: DecalStyle = { shape: DECAL_SHAPE.rect, shadow: 0, ring: 1, ringWidth: 0.14, fill: 0.3, grid: 0.55, color: DECAL_COLOR.valid };
const PREVIEW_INVALID: DecalStyle = { ...PREVIEW_VALID, color: DECAL_COLOR.invalid };

export async function createRenderer(opts: CreateRendererOptions): Promise<CrawloutRenderer> {
  const { canvas } = opts;
  const capacity = opts.capacity ?? MAX_ENTITIES;
  const gpu = new WebGPURenderer({ canvas, antialias: true, forceWebGL: opts.forceWebGL ?? false });
  await gpu.init();
  const backend: RenderBackend = (gpu.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'webgpu' : 'webgl2';

  const anims = bakeAnimations();
  const caps: { float32: boolean; maxTextureSize: number } = backend === 'webgpu' ? WEBGPU_DATA_TEXTURE_CAPS : (probeWebGL2DataTextureCaps() ?? { float32: true, maxTextureSize: 4096 });
  const force = opts.dataTextures && opts.dataTextures !== 'auto' ? opts.dataTextures : undefined;
  const precision = pickDataTexturePrecision(caps, Math.max(anims.width, anims.height, HEIGHT_TEXTURE_EDGE), force);

  const shadowsOn = opts.shadows ?? true;
  gpu.shadowMap.enabled = shadowsOn;
  gpu.shadowMap.type = PCFShadowMap;

  const scene = new Scene();
  scene.background = new Color(0x8fa3a8);
  const camera = new PerspectiveCamera(45, 1, 0.5, 800);
  const time = uniform(0);
  const clockStart = performance.now();
  const clock = (now: number): number => (now - clockStart) / 1000;

  const sun = shadowsOn ? new SunShadow(scene, DEFAULT_LIGHT_DIR) : null;
  const terrain = new TerrainLayer(scene, DEFAULT_LIGHT_DIR, { shadow: sun?.factor, precision });
  const decals = new DecalLayer(scene, capacity + 64);
  const units = new UnitLayer(scene, { capacity, lightDir: DEFAULT_LIGHT_DIR, precision, anims });
  const assetConfig = opts.assets;
  const loader = new UnitAssetLoader(createGltfIO(), (manifestUrl, path) =>
    assetConfig?.resolveUrl && manifestUrl === assetConfig.manifestUrl ? assetConfig.resolveUrl(path) : resolveManifestPath(manifestUrl, path),
  );
  const unitAssets = new UnitAssetRegistry(units, loader, {
    config: assetConfig,
    maxTextureSize: caps.maxTextureSize,
    warn: (message) => console.warn(`[render] ${message}`),
  });
  void unitAssets.start();
  const footprints = new FootprintTable(opts.buildingFootprint ?? null);
  const structures = new StructureLayer(scene, {
    capacity,
    footprints,
    heightAt: (x, z) => terrain.heightAt(x, z),
    castShadows: shadowsOn,
    materials: {
      building: createPropMaterial({ lightDir: DEFAULT_LIGHT_DIR, name: 'crawlout-building-toon', shadow: sun?.factor }),
      scrap: createPropMaterial({ lightDir: DEFAULT_LIGHT_DIR, name: 'crawlout-scrap-toon' }),
      claim: createPropMaterial({ lightDir: DEFAULT_LIGHT_DIR, name: 'crawlout-claim-toon', time }),
    },
  });
  const additive = new ParticlePool(scene, PARTICLES_PER_POOL, time, true);
  const smoke = new ParticlePool(scene, PARTICLES_PER_POOL, time, false);
  const zones = new AbilityZones();
  const effects = new EffectSpawner(additive, smoke, Math.random, zones);
  let abilities: AbilityLookup | null = null;
  const controls = new RtsCameraController(camera, canvas, { heightAt: (x, z) => terrain.heightAt(x, z), ...opts.camera });

  const setTerrain = (geometry: TerrainGeometry): void => {
    terrain.set(geometry);
    decals.setHeights(terrain.heightTexture);
    const hf = terrain.heightField;
    if (hf) {
      controls.bounds = { minX: hf.minX, maxX: hf.maxX, minZ: hf.minZ, maxZ: hf.maxZ };
      controls.focus(controls.target.x, controls.target.z);
    }
  };
  setTerrain(createGridTerrain(128, 128, 4));

  const interp = new SnapshotInterpolator();
  const frame = createInterpolatedFrame(capacity);
  let preview: PlacementPreview | null = null;

  // Effects read entities from the latest snapshot (the one carrying the events).
  const effectContext: EffectContext = {
    entity(id, out) {
      const view = interp.latest;
      const i = id === 0 ? -1 : interp.latestIndex(id);
      if (!view || i < 0) return false;
      const e = view.entities;
      out.x = e.x[i]! / UNITS_PER_METER;
      out.z = e.y[i]! / UNITS_PER_METER;
      out.yaw = simYawToRender(e.yaw[i]!);
      out.typeId = e.typeId[i]!;
      out.owner = e.owner[i]!;
      return true;
    },
    heightAt: (x, z) => terrain.heightAt(x, z),
    footprint: (typeId) => footprints.get(typeId),
    ability: (heroId, abilityId) => abilities?.(heroId, abilityId) ?? null,
  };

  const overlay = createOverlay(opts.stats ?? true, canvas);
  const meter = new PerfMeter(backend === 'webgpu' ? 'WebGPU' : 'WebGL2');

  const maxDpr = opts.maxPixelRatio ?? 2;
  const resize = (): void => {
    const w = Math.max(1, canvas.clientWidth);
    const h = Math.max(1, canvas.clientHeight);
    gpu.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDpr));
    gpu.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);

  let last = performance.now();
  const loop = (): void => {
    const now = performance.now();
    const dt = (now - last) / 1000;
    last = now;
    const t = clock(now);
    time.value = t;
    controls.update(dt);
    camera.updateMatrixWorld();
    interp.sample(now, frame);
    for (let i = 0; i < frame.count; i++) frame.y[i] = terrain.heightAt(frame.x[i]!, frame.z[i]!);
    decals.begin();
    zones.draw(t, decals); // first, so blobs and selection rings draw over the zone
    units.update(frame, camera, decals);
    structures.update(frame, camera, decals);
    if (preview) {
      const f = footprints.get(preview.typeId);
      decals.push(preview.x / UNITS_PER_METER, preview.y / UNITS_PER_METER, f.w / 2, f.h / 2, preview.valid ? PREVIEW_VALID : PREVIEW_INVALID);
    }
    decals.end();
    additive.commit();
    smoke.commit();
    sun?.update(controls.target.x, controls.target.y, controls.target.z, controls.distance);
    gpu.render(scene, camera);
    const info = gpu.info.render;
    if (meter.frame(now, performance.now() - now, info.drawCalls, info.triangles)) overlay?.show(meter.stats);
  };
  await gpu.setAnimationLoop(loop);

  const raycaster = new Raycaster();
  const ndc = new Vector2();
  const groundPlane = new Plane(new Vector3(0, 1, 0), 0);
  const hitPoint = new Vector3();
  const viewProj = new Matrix4();
  const pickShape = (i: number, out: PickShape): PickShape | null => structures.pickShape(frame.typeId[i]!, out);

  return {
    backend,
    dataTexturePrecision: precision,
    cameraControls: controls,
    pushSnapshot(buf) {
      const now = performance.now();
      if (!interp.push(buf, now)) return;
      const view = interp.latest;
      if (!view || view.eventCount === 0) return;
      // Events belong to the newest tick, which the interpolation reaches one tick from now.
      const t0 = clock(now) + TICK_MS / 1000;
      const ev = view.events;
      for (let k = 0; k < view.eventCount; k++) effects.handle(ev.type[k]!, ev.a[k]!, ev.b[k]!, ev.x[k]!, ev.y[k]!, t0, effectContext);
    },
    setTerrain,
    setGameData(data) {
      footprints.setLookup(footprintsFromGameData(data));
      abilities = data.heroes ? abilitiesFromGameData({ heroes: data.heroes }) : null;
      if (data.loadouts) void unitAssets.setLoadouts(data.loadouts);
    },
    loadUnitAsset: (manifestUrl, assetId, assetOpts) => unitAssets.load(manifestUrl, assetId, assetOpts),
    unitAssets: () => unitAssets.statuses(),
    setPlacementPreview(p) {
      preview = p ? { ...p } : null;
    },
    pickAt(x, y) {
      ndc.set((x / Math.max(1, canvas.clientWidth)) * 2 - 1, -(y / Math.max(1, canvas.clientHeight)) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const { origin, direction } = raycaster.ray;
      let hit = pickEntity(frame, origin.x, origin.y, origin.z, direction.x, direction.y, direction.z, pickShape);
      if (hit < 0) {
        viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
        hit = pickNearestOnScreen(frame, viewProj.elements, canvas.clientWidth, canvas.clientHeight, x, y);
      }
      let ground: PickResult['ground'] = null;
      const mesh = terrain.object;
      const hits = mesh ? raycaster.intersectObject(mesh, false) : [];
      const p = hits[0]?.point ?? raycaster.ray.intersectPlane(groundPlane, hitPoint);
      if (p) ground = { x: Math.round(p.x * UNITS_PER_METER), y: Math.round(p.z * UNITS_PER_METER) };
      return { entityId: hit >= 0 ? frame.id[hit]! : null, ground };
    },
    boxSelect(rect, selectOpts) {
      viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      return selectInRect(frame, viewProj.elements, canvas.clientWidth, canvas.clientHeight, rect, selectOpts);
    },
    focus(x, y) {
      controls.focus(x / UNITS_PER_METER, y / UNITS_PER_METER);
    },
    stats: () => ({ ...meter.stats }),
    dispose() {
      void gpu.setAnimationLoop(null);
      resizeObserver.disconnect();
      controls.dispose();
      unitAssets.dispose();
      overlay?.dispose();
      units.dispose();
      structures.dispose();
      decals.dispose();
      additive.dispose();
      smoke.dispose();
      sun?.dispose();
      terrain.dispose();
      interp.clear();
      zones.clear();
      gpu.dispose();
    },
  };
}
