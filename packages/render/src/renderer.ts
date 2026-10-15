// Public entry point: createRenderer({ canvas }). The renderer reads snapshots only, never sim state (contract 1).
import type { GameData } from '@crawlout/data';
import { MAX_ENTITIES, TICK_MS, UNITS_PER_METER } from '@crawlout/protocol';
import {
  Color,
  Matrix4,
  PCFShadowMap,
  PerspectiveCamera,
  Plane,
  SRGBColorSpace,
  Raycaster,
  Scene,
  TextureLoader,
  Vector2,
  Vector3,
  WebGPURenderer,
  type Texture,
} from 'three/webgpu';
import { uniform } from 'three/tsl';
import { RtsCameraController, type RtsCameraOptions } from './camera/rtsCamera.js';
import { DECAL_COLOR, DECAL_SHAPE, DecalLayer, type DecalStyle } from './decals/decalLayer.js';
import {
  FootprintTable,
  footprintsFromGameData,
  type FootprintLookup,
} from './entities/footprint.js';
import {
  pickDataTexturePrecision,
  probeWebGL2DataTextureCaps,
  WEBGPU_DATA_TEXTURE_CAPS,
  type DataTexturePrecision,
} from './gpu/dataTextures.js';
import { PerfMeter, PerfOverlay, type FrameStats } from './perf/perfOverlay.js';
import {
  pickEntity,
  pickNearestOnScreen,
  selectInRect,
  type BoxSelectOptions,
  type PickShape,
  type ScreenRect,
} from './picking/selection.js';
import { SunShadow } from './shadows/sunShadow.js';
import {
  createInterpolatedFrame,
  simYawToRender,
  SnapshotInterpolator,
} from './snapshot/interpolate.js';
import {
  PropAssetRegistry,
  type PropAssetStatus,
  type PropSourceOptions,
  type ResolvedSource,
} from './props/propAssets.js';
import { PropLayer, type PropLayerOptions, type RenderProp } from './props/propLayer.js';
import {
  buildingMeshes,
  loadBuildingAssets,
  type BuildingAssetStatus,
  type BuildingVisual,
} from './structures/buildingAssets.js';
import { createPropMaterial } from './structures/propMaterial.js';
import { DEFAULT_LAYER_SIZE } from './structures/textureArray.js';
import { StructureLayer } from './structures/structureLayer.js';
import { createGridTerrain, type TerrainGeometry } from './terrain/heightField.js';
import type { TerrainChunkOptions } from './terrain/terrainChunks.js';
import { TerrainLayer } from './terrain/terrainLayer.js';
import type { TerrainDetailOptions } from './terrain/terrainRefine.js';
import {
  loadTerrainTextures,
  type TerrainTextureOptions,
  type TerrainTextureStatus,
} from './terrain/terrainTextures.js';
import { bakeAnimations } from './units/bake.js';
import { resolveManifestPath, UnitAssetLoader, createGltfIO } from './units/unitAssetLoader.js';
import {
  UnitAssetRegistry,
  type UnitAssetConfig,
  type UnitAssetOptions,
  type UnitAssetStatus,
} from './units/unitAssets.js';
import { DEFAULT_LIGHT_DIR, UnitLayer } from './units/unitLayer.js';
import { abilitiesFromGameData, AbilityZones, type AbilityLookup } from './vfx/abilityZones.js';
import { EffectSpawner, type EffectContext } from './vfx/effects.js';
import { ParticlePool } from './vfx/particles.js';
import { WaterLayer } from './water/waterLayer.js';
import {
  analyzeWater,
  parseWaterMask,
  type WaterMask,
  type WaterMaskInput,
  type WaterOptions,
} from './water/waterMask.js';

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
  /**
   * Detail texture and tints of the terrain material: terrain.json of the asset-cli (assets/dist/terrain), or explicit
   * values. Without it the terrain uses the Rock Terrain 4 tints and no texture. setTerrainTextures() changes it later.
   */
  terrainTextures?: TerrainTextureOptions;
  /** Render-only refinement of the terrain mesh (terrain/terrainField.ts). Default { subdivide: 2, baseStep: 1 }. */
  terrainDetail?: TerrainDetailOptions;
  /**
   * Chunks and distance LOD of the terrain (terrain/terrainChunks.ts). Default 32 m chunks at the field step, 64 m at
   * twice it, 128 m roots at four times it, splitting under 40 and 100 m, roots at half resolution beyond 220 m.
   */
  terrainChunks?: TerrainChunkOptions;
  /** Levels, bed and flow of the water (water/waterMask.ts). */
  water?: WaterOptions;
  /**
   * Prop budget: most props drawn at once (default 3000), full density within thinDistance (default 160 m), at least
   * minDensity of a far chunk before the cap (default 0.15), most blob shadows (default 768).
   */
  props?: Pick<PropLayerOptions, 'maxVisible' | 'thinDistance' | 'minDensity' | 'maxBlobs'>;
  /**
   * Building assets (kind 'building') from the `assets` manifest for the building types whose visuals.mesh it has,
   * loaded by setGameData. Default true; false keeps the placeholder blocks.
   */
  buildingAssets?: boolean;
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

/** What setWater drew. */
export interface WaterInfo {
  /** Water cells (deep plus shallow) and the shallow or fordable ones among them. */
  cells: number;
  shallowCells: number;
  /** Triangles of the water surface (water plus its bank ring), one draw call. */
  triangles: number;
}

/** Per-layer numbers of the last frame, next to the totals of stats(). */
export interface LayerStats {
  terrainTriangles: number;
  terrainDraws: number;
  /** Props drawn and props in total. */
  propsVisible: number;
  propsTotal: number;
  waterTriangles: number;
}

export interface CrawloutRenderer {
  readonly backend: RenderBackend;
  /** Precision of the bone, clip and height textures: float32, or half-float on WebGL2 drivers without float32. */
  readonly dataTexturePrecision: DataTexturePrecision;
  readonly cameraControls: RtsCameraController;
  /** Hands over one snapshot buffer (contract 1). The renderer keeps a reference: do not reuse the buffer. */
  pushSnapshot(buf: ArrayBuffer): void;
  /**
   * Replaces the terrain. The mesh is resampled into a smooth grid for drawing (terrainDetail); height lookups use
   * that surface. The given arrays are not modified.
   */
  setTerrain(geometry: TerrainGeometry): void;
  /**
   * The map's water mask (MapDef water, decoded: w * h cells, 0 land, 1 water, 2 shallow or fordable), laid over the
   * terrain's bounds; null removes the water. Cuts a bed into the drawn terrain under the water (heights for units,
   * props, decals and picking follow) and draws the surface in one draw call. Kept across setTerrain. Throws
   * WaterMaskError on a mask of the wrong size or with other values. Returns what it drew (null without water).
   */
  setWater(mask: WaterMaskInput | null): WaterInfo | null;
  /**
   * Detail texture and tints of the terrain material (terrain.json or explicit values). Resolves with the status once
   * the texture is loaded; never rejects (on failure the tints that could be read still apply).
   */
  setTerrainTextures(textures: TerrainTextureOptions): Promise<TerrainTextureStatus>;
  /**
   * Game data for visuals: building footprints by typeId, the radius and duration of hero ability zones (event
   * abilityZone), and (with `assets`) the body asset per loadout.
   */
  setGameData(
    data: Pick<GameData, 'buildings'> & Partial<Pick<GameData, 'loadouts' | 'heroes'>>,
  ): void;
  /**
   * Loads a character asset from an asset-cli manifest and draws the units whose loadout names it (meshSlots.body)
   * with it; `asDefault` also gives it to every unit without an asset of its own. Resolves with the status, never
   * rejects: on failure the placeholder rig stays.
   */
  loadUnitAsset(
    manifestUrl: string,
    assetId: string,
    opts?: UnitAssetOptions,
  ): Promise<UnitAssetStatus>;
  /** Status of every unit asset requested so far. */
  unitAssets(): UnitAssetStatus[];
  /**
   * Status of the building assets of the last setGameData (one per visuals.mesh in buildings.json): loading, ready
   * (drawn with the asset) or failed (placeholder, with the reason). Empty without a manifest.
   */
  buildingAssets(): BuildingAssetStatus[];
  /**
   * Decorative props (the map's props file; PropInstance of @crawlout/map fits RenderProp). Each asset id comes from
   * the manifest (kind 'prop', three LODs), else from `source.sourceUrl` (a source GLB), else a placeholder per kind,
   * fitted to a believable height (props/propFit.ts) times the prop's scale. Height from the terrain. Props are not
   * pickable and never block a pick. `source` defaults to the renderer's `assets` manifest. Resolves with the status
   * per asset once everything is loaded; never rejects. An empty list removes all props.
   */
  setProps(props: readonly RenderProp[], source?: PropSourceOptions): Promise<PropAssetStatus[]>;
  /** Status of every prop asset of the current props. */
  propAssets(): PropAssetStatus[];
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
  /** Triangles and draws per layer in the last frame. */
  layerStats(): LayerStats;
  dispose(): void;
}

function createOverlay(
  stats: boolean | HTMLElement,
  canvas: HTMLCanvasElement,
): PerfOverlay | null {
  if (stats === false) return null;
  const parent = stats instanceof HTMLElement ? stats : canvas.parentElement;
  return parent ? new PerfOverlay(parent) : null;
}

/** Height-texture edge the decals may need (terrain/heightTexture.ts caps at 512). */
const HEIGHT_TEXTURE_EDGE = 512;
const PARTICLES_PER_POOL = 4096;
/** Default most prop blob shadows, on top of the entity decals. */
const PROP_BLOBS = 768;
/** How far prop art is pulled towards the warm wasteland grey (structures/propMaterial.ts grade). */
const PROP_GRADE = 0.22;
/** The same for building assets: lighter, their tints per building type should stay readable. */
const BUILDING_GRADE = 0.12;
const PREVIEW_VALID: DecalStyle = {
  shape: DECAL_SHAPE.rect,
  shadow: 0,
  ring: 1,
  ringWidth: 0.14,
  fill: 0.3,
  grid: 0.55,
  color: DECAL_COLOR.valid,
};
const PREVIEW_INVALID: DecalStyle = { ...PREVIEW_VALID, color: DECAL_COLOR.invalid };

export async function createRenderer(opts: CreateRendererOptions): Promise<CrawloutRenderer> {
  const { canvas } = opts;
  const capacity = opts.capacity ?? MAX_ENTITIES;
  const gpu = new WebGPURenderer({ canvas, antialias: true, forceWebGL: opts.forceWebGL ?? false });
  await gpu.init();
  const backend: RenderBackend = (gpu.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend
    ? 'webgpu'
    : 'webgl2';

  const anims = bakeAnimations();
  const caps: { float32: boolean; maxTextureSize: number } =
    backend === 'webgpu'
      ? WEBGPU_DATA_TEXTURE_CAPS
      : (probeWebGL2DataTextureCaps() ?? { float32: true, maxTextureSize: 4096 });
  const force = opts.dataTextures && opts.dataTextures !== 'auto' ? opts.dataTextures : undefined;
  const precision = pickDataTexturePrecision(
    caps,
    Math.max(anims.width, anims.height, HEIGHT_TEXTURE_EDGE),
    force,
  );

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
  const terrain = new TerrainLayer(scene, DEFAULT_LIGHT_DIR, {
    shadow: sun?.factor,
    precision,
    ...(opts.terrainDetail ? { detail: opts.terrainDetail } : {}),
    ...(opts.terrainChunks ? { chunks: opts.terrainChunks } : {}),
  });
  const water = new WaterLayer(scene, { lightDir: DEFAULT_LIGHT_DIR, time, shadow: sun?.factor });
  let terrainTexture: Texture | null = null;
  let terrainGeneration = 0;
  const setTerrainTextures = async (
    textures: TerrainTextureOptions,
  ): Promise<TerrainTextureStatus> => {
    const generation = ++terrainGeneration;
    const { texture, status } = await loadTerrainTextures(textures, {
      fetchText: async (url) => {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      },
      loadTexture: async (url) => {
        const t = await new TextureLoader().loadAsync(url);
        t.colorSpace = SRGBColorSpace;
        t.anisotropy = 8;
        return t;
      },
    });
    if (generation !== terrainGeneration) {
      texture?.dispose();
      return status;
    }
    terrain.setTints(status.rockTint, status.groundTint);
    terrain.setAlbedo(texture);
    terrainTexture?.dispose();
    terrainTexture = texture;
    if (status.state === 'failed') console.warn(`[render] terrain textures: ${status.reason}`);
    return status;
  };
  if (opts.terrainTextures) void setTerrainTextures(opts.terrainTextures);
  const propBlobs = opts.props?.maxBlobs ?? PROP_BLOBS;
  const decals = new DecalLayer(scene, capacity + 64 + propBlobs);
  const units = new UnitLayer(scene, { capacity, lightDir: DEFAULT_LIGHT_DIR, precision, anims });
  const assetConfig = opts.assets;
  const gltfIO = createGltfIO();
  const resolveAssetPath = (manifestUrl: string, path: string): string =>
    assetConfig?.resolveUrl && manifestUrl === assetConfig.manifestUrl
      ? assetConfig.resolveUrl(path)
      : resolveManifestPath(manifestUrl, path);
  const loader = new UnitAssetLoader(gltfIO, resolveAssetPath);
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
      building: createPropMaterial({
        lightDir: DEFAULT_LIGHT_DIR,
        name: 'crawlout-building-toon',
        shadow: sun?.factor,
      }),
      scrap: createPropMaterial({ lightDir: DEFAULT_LIGHT_DIR, name: 'crawlout-scrap-toon' }),
      claim: createPropMaterial({ lightDir: DEFAULT_LIGHT_DIR, name: 'crawlout-claim-toon', time }),
    },
  });
  const props = new PropLayer(scene, {
    ...opts.props,
    maxBlobs: propBlobs,
    heightAt: (x, z) => terrain.heightAt(x, z),
    material: (map) =>
      createPropMaterial({
        lightDir: DEFAULT_LIGHT_DIR,
        name: 'crawlout-prop-toon',
        shadow: sun?.factor,
        map,
        grade: PROP_GRADE,
      }),
  });
  const propRegistry = new PropAssetRegistry({
    manifest: (url) => loader.manifest(url),
    fetchBytes: (url) => gltfIO.fetchBytes(url),
    parseGltf: (bytes, url) => gltfIO.parseGltf(bytes, url),
  });
  let buildingStatuses: BuildingAssetStatus[] = [];
  let buildingGeneration = 0;
  const loadBuildings = async (buildings: Parameters<typeof buildingMeshes>[0]): Promise<void> => {
    const generation = ++buildingGeneration;
    const manifestUrl = assetConfig?.manifestUrl;
    if (!manifestUrl || opts.buildingAssets === false) {
      buildingStatuses = [];
      structures.setBuildingAssets(new Map(), null);
      return;
    }
    const meshes = buildingMeshes(buildings);
    buildingStatuses = [...new Set(meshes.values())].map((assetId) => ({
      assetId,
      buildingIds: [...meshes].filter(([, a]) => a === assetId).map(([id]) => id),
      state: 'loading',
    }));
    const set = await loadBuildingAssets(
      {
        manifest: (url) => loader.manifest(url),
        fetchBytes: (url) => gltfIO.fetchBytes(url),
        parseGltf: (bytes, url) => gltfIO.parseGltf(bytes, url),
      },
      manifestUrl,
      resolveAssetPath,
      meshes,
      { maxLayerSize: Math.min(DEFAULT_LAYER_SIZE, caps.maxTextureSize) },
    );
    const disposeSet = (): void => {
      for (const v of set.visuals.values()) for (const g of new Set(v.lods)) g.dispose();
    };
    if (generation !== buildingGeneration) {
      disposeSet();
      set.layers?.dispose();
      return;
    }
    buildingStatuses = set.statuses;
    for (const st of set.statuses)
      if (st.state === 'failed' && st.reason !== 'not in the manifest')
        console.warn(`[render] building "${st.assetId}": ${st.reason}`);
    const byBuilding = new Map<number, BuildingVisual>();
    for (const [buildingId, assetId] of meshes) {
      const v = set.visuals.get(assetId);
      if (v) byBuilding.set(buildingId, v);
    }
    buildingLayers?.dispose();
    buildingLayers = set.layers;
    structures.setBuildingAssets(
      byBuilding,
      byBuilding.size === 0
        ? null
        : createPropMaterial({
            lightDir: DEFAULT_LIGHT_DIR,
            name: 'crawlout-building-asset-toon',
            shadow: sun?.factor,
            layers: set.layers,
            reveal: true,
            grade: BUILDING_GRADE,
          }),
    );
    disposeSet(); // the structure layer drew its own copies
  };
  let buildingLayers: { dispose(): void } | null = null;
  let propStatuses = new Map<string, PropAssetStatus>();
  let propGeneration = 0;
  const additive = new ParticlePool(scene, PARTICLES_PER_POOL, time, true);
  const smoke = new ParticlePool(scene, PARTICLES_PER_POOL, time, false);
  const zones = new AbilityZones();
  const effects = new EffectSpawner(additive, smoke, Math.random, zones);
  let abilities: AbilityLookup | null = null;
  const controls = new RtsCameraController(camera, canvas, {
    heightAt: (x, z) => terrain.heightAt(x, z),
    ...opts.camera,
  });

  let waterMask: WaterMask | null = null;
  let waterInfo: WaterInfo | null = null;
  /** Lays the water mask over the current terrain: bed, surface, then everything that reads heights. */
  const applyWater = (): void => {
    const hf = terrain.heightField;
    waterInfo = null;
    if (!waterMask || !hf) {
      terrain.setBed(null);
      water.set(null, () => 0);
      return;
    }
    const cell = (hf.maxX - hf.minX) / waterMask.w;
    const cellZ = (hf.maxZ - hf.minZ) / waterMask.h;
    if (Math.abs(cell - cellZ) > 0.01 * cell)
      console.warn(
        `[render] water mask ${waterMask.w}x${waterMask.h} does not fit the terrain's aspect; cells of ${cell} m`,
      );
    const surface = analyzeWater(
      waterMask,
      (x, z) => terrain.baseHeightAt(x, z),
      { minX: hf.minX, minZ: hf.minZ, cell },
      opts.water,
    );
    terrain.setBed(surface.cells > 0 ? surface.bed : null);
    water.set(surface, (x, z) => terrain.heightAt(x, z));
    waterInfo =
      surface.cells > 0
        ? { cells: surface.cells, shallowCells: surface.shallowCells, triangles: water.triangles }
        : null;
  };
  const afterHeights = (): void => {
    decals.setHeights(terrain.heightTexture);
    props.relayout();
  };
  const setTerrain = (geometry: TerrainGeometry): void => {
    terrain.set(geometry);
    if (waterMask) applyWater();
    afterHeights();
    const hf = terrain.heightField;
    if (hf) {
      controls.bounds = { minX: hf.minX, maxX: hf.maxX, minZ: hf.minZ, maxZ: hf.maxZ };
      controls.focus(controls.target.x, controls.target.z);
      // The furthest zoom of a large map looks across it: keep its far corner inside the far plane.
      camera.far = Math.max(800, controls.maxDistance * 2.6);
      camera.updateProjectionMatrix();
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
    buildingTop: (typeId) => structures.buildingTop(typeId),
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
    terrain.update(camera);
    interp.sample(now, frame);
    for (let i = 0; i < frame.count; i++) frame.y[i] = terrain.heightAt(frame.x[i]!, frame.z[i]!);
    decals.begin();
    zones.draw(t, decals); // first, so blobs and selection rings draw over the zone
    units.update(frame, camera, decals);
    structures.update(frame, camera, decals);
    if (preview) {
      const f = footprints.get(preview.typeId);
      decals.push(
        preview.x / UNITS_PER_METER,
        preview.y / UNITS_PER_METER,
        f.w / 2,
        f.h / 2,
        preview.valid ? PREVIEW_VALID : PREVIEW_INVALID,
      );
    }
    props.update(camera, decals); // last: when the decal batch is full, prop blobs are what drops
    decals.end();
    additive.commit();
    smoke.commit();
    sun?.update(controls.target.x, controls.target.y, controls.target.z, controls.distance);
    gpu.render(scene, camera);
    const info = gpu.info.render;
    if (meter.frame(now, performance.now() - now, info.drawCalls, info.triangles))
      overlay?.show(meter.stats);
  };
  await gpu.setAnimationLoop(loop);

  const raycaster = new Raycaster();
  const ndc = new Vector2();
  const groundPlane = new Plane(new Vector3(0, 1, 0), 0);
  const hitPoint = new Vector3();
  const viewProj = new Matrix4();
  const pickShape = (i: number, out: PickShape): PickShape | null =>
    structures.pickShape(frame.typeId[i]!, out);

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
      for (let k = 0; k < view.eventCount; k++)
        effects.handle(ev.type[k]!, ev.a[k]!, ev.b[k]!, ev.x[k]!, ev.y[k]!, t0, effectContext);
    },
    setTerrain,
    setWater(mask) {
      waterMask = mask ? parseWaterMask(mask) : null;
      applyWater();
      afterHeights();
      return waterInfo ? { ...waterInfo } : null;
    },
    setTerrainTextures,
    setGameData(data) {
      footprints.setLookup(footprintsFromGameData(data));
      abilities = data.heroes ? abilitiesFromGameData({ heroes: data.heroes }) : null;
      if (data.loadouts) void unitAssets.setLoadouts(data.loadouts);
      void loadBuildings(data.buildings);
    },
    loadUnitAsset: (manifestUrl, assetId, assetOpts) =>
      unitAssets.load(manifestUrl, assetId, assetOpts),
    unitAssets: () => unitAssets.statuses(),
    buildingAssets: () =>
      buildingStatuses.map((st) => ({ ...st, buildingIds: [...st.buildingIds] })),
    async setProps(list, source = {}) {
      const generation = ++propGeneration;
      props.setProps(list);
      const src: ResolvedSource = {
        manifestUrl:
          source.manifestUrl === null
            ? undefined
            : (source.manifestUrl ?? assetConfig?.manifestUrl),
        resolveUrl: source.resolveUrl
          ? (_manifestUrl, path) => source.resolveUrl!(path)
          : resolveAssetPath,
        sourceUrl: source.sourceUrl,
        placeholders: source.placeholders ?? true,
        heights: source.heights,
      };
      propStatuses = new Map(
        props
          .assetIds()
          .map((assetId) => [
            assetId,
            { assetId, instances: props.instanceCount(assetId), state: 'loading', origin: 'none' },
          ]),
      );
      const current = propStatuses;
      await Promise.all(
        props.assetIds().map(async (assetId) => {
          const r = await propRegistry.resolve(assetId, src);
          if (generation !== propGeneration) return;
          props.setVisual(assetId, r.visual);
          const status = current.get(assetId)!;
          status.state = 'ready';
          status.origin = r.origin;
          if (r.reasons.length > 0) status.reason = r.reasons.join('; ');
          if (r.triangles) status.triangles = r.triangles;
          if (r.visual) status.height = Math.round(r.visual.height * r.visual.fit * 100) / 100;
          if (r.origin !== 'manifest' && r.reasons.some((m) => !m.startsWith('not in')))
            console.warn(`[render] prop "${assetId}": ${status.reason}`);
        }),
      );
      return [...current.values()].map((st) => ({ ...st }));
    },
    propAssets: () => [...propStatuses.values()].map((st) => ({ ...st })),
    setPlacementPreview(p) {
      preview = p ? { ...p } : null;
    },
    pickAt(x, y) {
      ndc.set(
        (x / Math.max(1, canvas.clientWidth)) * 2 - 1,
        -(y / Math.max(1, canvas.clientHeight)) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, camera);
      const { origin, direction } = raycaster.ray;
      let hit = pickEntity(
        frame,
        origin.x,
        origin.y,
        origin.z,
        direction.x,
        direction.y,
        direction.z,
        pickShape,
      );
      if (hit < 0) {
        viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
        hit = pickNearestOnScreen(
          frame,
          viewProj.elements,
          canvas.clientWidth,
          canvas.clientHeight,
          x,
          y,
        );
      }
      let ground: PickResult['ground'] = null;
      const p = terrain.raycast(origin, direction, hitPoint)
        ? hitPoint
        : raycaster.ray.intersectPlane(groundPlane, hitPoint);
      if (p)
        ground = { x: Math.round(p.x * UNITS_PER_METER), y: Math.round(p.z * UNITS_PER_METER) };
      return { entityId: hit >= 0 ? frame.id[hit]! : null, ground };
    },
    boxSelect(rect, selectOpts) {
      viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      return selectInRect(
        frame,
        viewProj.elements,
        canvas.clientWidth,
        canvas.clientHeight,
        rect,
        selectOpts,
      );
    },
    focus(x, y) {
      controls.focus(x / UNITS_PER_METER, y / UNITS_PER_METER);
    },
    stats: () => ({ ...meter.stats }),
    layerStats: () => ({
      terrainTriangles: terrain.triangles,
      terrainDraws: terrain.drawCount,
      propsVisible: props.visibleCount,
      propsTotal: props.totalCount,
      waterTriangles: water.triangles,
    }),
    dispose() {
      void gpu.setAnimationLoop(null);
      resizeObserver.disconnect();
      controls.dispose();
      unitAssets.dispose();
      overlay?.dispose();
      units.dispose();
      buildingGeneration++;
      structures.dispose();
      buildingLayers?.dispose();
      props.dispose();
      propRegistry.dispose();
      decals.dispose();
      additive.dispose();
      smoke.dispose();
      sun?.dispose();
      terrainGeneration++;
      terrain.dispose();
      water.dispose();
      terrainTexture?.dispose();
      interp.clear();
      zones.clear();
      gpu.dispose();
    },
  };
}
