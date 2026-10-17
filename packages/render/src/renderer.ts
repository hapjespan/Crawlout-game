// Public entry point: createRenderer({ canvas }). The renderer reads snapshots only, never sim state (contract 1).
import type { GameData } from '@crawlout/data';
import {
  MAX_ENTITIES,
  TICK_MS,
  UNITS_PER_METER,
  type ClaimPointStatus,
  type FogMask,
} from '@crawlout/protocol';
import { claimRingArcs } from './claims/claimRing.js';
import { stampInspected } from './entities/inspected.js';
import {
  Matrix4,
  PCFShadowMap,
  DataTexture,
  LinearFilter,
  PerspectiveCamera,
  Plane,
  RGBAFormat,
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
import { ScreenLod, type ScreenLodThresholds } from './lod/screenLod.js';
import { PerfMeter, PerfOverlay, type FrameStats } from './perf/perfOverlay.js';
import { FrameProfiler, type FrameTimings } from './perf/frameProfile.js';
import { forceDrawable } from './perf/warmDraw.js';
import { triangleBreakdown, type TriangleBreakdown } from './perf/triangleBreakdown.js';
import {
  pickEntity,
  pickNearestOnScreen,
  selectInRect,
  type BoxSelectOptions,
  type PickShape,
  type ScreenRect,
} from './picking/selection.js';
import { createFogOfWar, markMapKnowledge } from './fog/fogOfWar.js';
import { createAtmosphere } from './lighting/atmosphere.js';
import { SUN_DIR, TONE_EXPOSURE, TONE_MAPPING } from './lighting/lightRig.js';
import { defaultShadowQuality, SunShadow, type ShadowQuality } from './shadows/sunShadow.js';
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
import { propCategoryOf } from './props/propCategory.js';
import { buildGrassMask } from './terrain/grassMask.js';
import { PropLayer, type PropLayerOptions, type RenderProp } from './props/propLayer.js';
import { windOf } from './props/propWind.js';
import {
  buildingMeshes,
  loadBuildingAssets,
  type BuildingAssetStatus,
  type BuildingVisual,
} from './structures/buildingAssets.js';
import { surfaceKindOfCategory } from './look/surfaces.js';
import { createPropMaterial } from './structures/propMaterial.js';
import { DEFAULT_LAYER_SIZE } from './structures/textureArray.js';
import { StructureLayer } from './structures/structureLayer.js';
import type { TerrainAlbedoLayout } from './terrain/albedoLayout.js';
import { createGridTerrain, type TerrainGeometry } from './terrain/heightField.js';
import type { TerrainChunkOptions } from './terrain/terrainChunks.js';
import { TerrainLayer } from './terrain/terrainLayer.js';
import type { PlatformSpec } from './terrain/terrainPlatforms.js';
import { TerrainSkirt } from './terrain/terrainSkirt.js';
import type { TerrainDetailOptions } from './terrain/terrainRefine.js';
import {
  loadTerrainTextures,
  type TerrainTextureOptions,
  type TerrainTextureStatus,
} from './terrain/terrainTextures.js';
import { bakeAnimations } from './units/bake.js';
import { ALBEDO_GAIN_RANGE } from '@crawlout/asset-cli/manifest';
import { resolveManifestPath, UnitAssetLoader, createGltfIO } from './units/unitAssetLoader.js';
import {
  UnitAssetRegistry,
  type UnitAssetConfig,
  type UnitAssetOptions,
  type UnitAssetStatus,
} from './units/unitAssets.js';
import { DEFAULT_LIGHT_DIR, UnitLayer } from './units/unitLayer.js';
import { AttachmentRegistry, type AttachmentStatus } from './units/attachmentAssets.js';
import { RigidUnitRegistry, type RigidUnitStatus } from './units/rigidUnitAssets.js';
import { RigidUnitLayer, type RigidUnitSource } from './units/rigidUnitLayer.js';
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
  /**
   * The sun's real shadow (shadows/sunShadow.ts): buildings, units, trees and props cast it onto everything. 'high':
   * 4096 map, small props cast too; 'low': 2048 map, shorter shadow distance, only trees, buildings and units; false:
   * off (blob decals only). true or absent (default): the backend's choice (defaultShadowQuality): 'high' on WebGPU,
   * 'low' on the WebGL2 fallback, where the shadow pass costs the most.
   */
  shadows?: boolean | ShadowQuality;
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
  /**
   * Screen-size LOD thresholds (lod/screenLod.ts: projected height in device px under which LOD 1 and LOD 2 draw) per
   * layer, for tuning and measuring; absent keeps the layer's default.
   */
  lodPixels?: {
    units?: ScreenLodThresholds;
    buildings?: ScreenLodThresholds;
    props?: ScreenLodThresholds;
    trees?: ScreenLodThresholds;
  };
  /** Levels, bed and flow of the water (water/waterMask.ts). */
  water?: WaterOptions;
  /**
   * Prop budget: most props drawn at once (default 3000), full density within thinDistance (default 160 m), at least
   * minDensity of a far chunk before the cap (default 0.15), most blob shadows (default 768).
   */
  props?: Pick<PropLayerOptions, 'maxVisible' | 'thinDistance' | 'minDensity' | 'maxBlobs'> & {
    /**
     * Light wind sway of foliage (trees with leaves, grass, plants; props/propWind.ts). Default true; false holds
     * them still. Can be switched at runtime with `setPropWind`.
     */
    wind?: boolean;
  };
  /**
   * Building assets (kind 'building') from the `assets` manifest for the building types whose visuals.mesh it has,
   * loaded by setGameData. Default true; false keeps the placeholder blocks.
   */
  buildingAssets?: boolean;
  /**
   * One warm draw of every mesh once loading settles (perf/warmDraw.ts), so the first sight of a hero, unit LOD or prop
   * variant does not hitch. Default true; false only to measure what it saves.
   */
  warmDraw?: boolean;
  /**
   * Brightness factor on the albedo per asset id (units, buildings and props from the manifest), for art that reads
   * too dark or too light under the toon ramp next to the rest. 1 (or absent) keeps the art as it is; values are
   * clamped to ALBEDO_GAIN_RANGE. Per asset on purpose: a dark, muddy character that is meant to be so stays so.
   */
  albedoGain?: Readonly<Record<string, number>>;
}

/** Allowed albedoGain values (the manifest field has the same range). */
export { ALBEDO_GAIN_RANGE };

export interface SetTerrainOptions {
  /**
   * How the map was composed from the source heightfield (tiles, orientations, point mirror, blended borders), so the
   * albedo of terrain.json is sampled as the real color of each point (terrain/albedoLayout.ts). Without it the
   * albedo is tiled mirrored over the terrain's bounds.
   */
  albedoLayout?: TerrainAlbedoLayout | null;
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
  /** Weapon, tool and gear instances drawn on units (one instanced draw per prop and LOD, however many units). */
  attachmentInstances: number;
  /** Rigid units (robots) drawn and in the frame, and the draw calls they took. */
  rigidVisible: number;
  rigidTotal: number;
  rigidDraws: number;
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
  setTerrain(geometry: TerrainGeometry, opts?: SetTerrainOptions): void;
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
   * Status of the attachments of the loadouts (meshSlots other than body: weapon, tool, gear_back, gear_head, armor):
   * ready (drawn on the animated skeleton), skipped (the manifest has no such prop, the unit is drawn without it) or
   * failed (with the reason). Empty until setGameData has loadouts and their body assets are loaded.
   */
  attachmentAssets(): AttachmentStatus[];
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
  /** Turns the wind sway of foliage (trees with leaves, grass, plants) on or off; no recompile. */
  setPropWind(enabled: boolean): void;
  /** Shows a ghost footprint at a sim position, or hides it with null. */
  setPlacementPreview(preview: PlacementPreview | null): void;
  /**
   * Claim states (PlayerStatus.claimPoints): draws a progress arc on the claim ring while a hero claims a point, a
   * pulsing arc in the attacker's colour while a beacon is being taken over, and a striped one while both sides are in
   * the circle. Pass the latest list on every status; an empty list or undefined clears the arcs.
   */
  setClaimStates(states: readonly ClaimPointStatus[] | undefined): void;
  /**
   * Fog of war: this player's mask on the vision grid (protocol FogMask, the sim's `fog` answer). Darkens and desaturates
   * what is explored but not in view, and turns what is unexplored near-black, in the terrain, water, skirt, props,
   * buildings, units and decals (one texture sampled in the existing materials: no draw calls). New masks fade in over
   * a quarter second; an identical mask costs a compare. null switches it off. Claim points and scrap heaps (map
   * knowledge) stay readable in the dark.
   */
  setFog(mask: FogMask | null): void;
  /** Entities the player inspects but does not own (enemy units and buildings): they get a red ring instead of the green selection ring. */
  setInspectedIds(ids: Iterable<number>): void;
  /** What lies under canvas-local CSS pixel (x, y). Units, buildings, scrap nodes and claim points can be hit. */
  pickAt(x: number, y: number): PickResult;
  /** Entity ids inside a canvas-local CSS pixel rectangle; units only unless opts.includeStructures. */
  boxSelect(rect: ScreenRect, opts?: BoxSelectOptions): number[];
  /** Centers the camera on a sim position (sim units). */
  focus(x: number, y: number): void;
  /** Latest measured frame stats. */
  stats(): FrameStats;
  /**
   * Loads a rigid unit asset (a robot: manifest entry with `rigid: true`, rigidUnitManifest.ts) and draws the unit types
   * whose loadout names it (meshSlots.body, or `assets.bind`) with it. setGameData does this for every rigid body in
   * the loadouts; call it for an asset that has no loadout, with the unit `typeIds` to draw with it. Resolves with the status, never rejects: on failure the
   * unit types stay on the humanoid.
   */
  loadRigidUnit(
    manifestUrl: string,
    assetId: string,
    typeIds?: readonly number[],
  ): Promise<RigidUnitStatus>;
  /**
   * Draws unit typeIds with a rigid asset that is already in memory (synthetic robots of the demo, tests). Same layer as
   * the manifest assets: one draw per asset per LOD, procedural animation from the snapshot's anim fields.
   */
  addRigidUnit(source: RigidUnitSource, typeIds: readonly number[]): RigidUnitStatus;
  /** Status of every rigid unit asset requested so far. */
  rigidUnitAssets(): RigidUnitStatus[];
  /** Triangles and draws per layer in the last frame. */
  layerStats(): LayerStats;
  /** Triangles of the last frame per layer, main pass and shadow pass (perf/triangleBreakdown.ts); walks the scene, for the bench. */
  triangleBreakdown(): TriangleBreakdown;
  /** JavaScript time per phase of the last finished frame (perf/frameProfile.ts). */
  frameTimings(): FrameTimings;
  /** The slowest frame (by JavaScript time) since the previous call, or null; for the bench's hitch report. */
  takeSlowestFrame(): FrameTimings | null;
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

/** Most milliseconds of a frame the foundations may take (terrain.setPlatforms); the rest waits for the next frame. */
const PLATFORM_BUDGET_MS = 3;

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

  const shadowQuality: ShadowQuality | null =
    opts.shadows === false
      ? null
      : opts.shadows === 'low' || opts.shadows === 'high'
        ? opts.shadows
        : defaultShadowQuality(backend);
  const shadowsOn = shadowQuality !== null;
  gpu.shadowMap.enabled = shadowsOn;
  // r186: PCF is the soft one (Vogel disk + noise over hardware compares; PCFSoftShadowMap was folded into it).
  gpu.shadowMap.type = PCFShadowMap;
  // One tone mapping for everything, applied in the output pass (lighting/lightRig.ts).
  gpu.toneMapping = TONE_MAPPING;
  gpu.toneMappingExposure = TONE_EXPOSURE;

  const scene = new Scene();
  // Gradient sky and a fog of its horizon colour (lighting/atmosphere.ts).
  // The fog of war rides in the atmosphere's fog node: every material gets it without a draw call of its own.
  const fogOfWar = createFogOfWar();
  const atmosphere = createAtmosphere(fogOfWar);
  scene.backgroundNode = atmosphere.backgroundNode;
  scene.fogNode = atmosphere.fogNode;
  const camera = new PerspectiveCamera(45, 1, 0.5, 800);
  let inspectedIds: ReadonlySet<number> = new Set();
  const time = uniform(0);
  const clockStart = performance.now();
  const clock = (now: number): number => (now - clockStart) / 1000;

  const sun = shadowQuality ? new SunShadow(scene, DEFAULT_LIGHT_DIR, shadowQuality) : null;
  const terrain = new TerrainLayer(scene, DEFAULT_LIGHT_DIR, {
    shadow: sun,
    precision,
    ...(opts.terrainDetail ? { detail: opts.terrainDetail } : {}),
    ...(opts.terrainChunks ? { chunks: opts.terrainChunks } : {}),
  });
  const water = new WaterLayer(scene, { lightDir: DEFAULT_LIGHT_DIR, time, shadow: sun?.factor });
  const skirt = new TerrainSkirt(scene, terrain.material);
  /** The terrain's height range: the slab the shadow camera is fitted over. */
  let groundLo = 0;
  let groundHi = 0;
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
    if (status.tileSize) terrain.setAlbedoTileSize(status.tileSize);
    terrain.setAlbedo(texture);
    terrainTexture?.dispose();
    terrainTexture = texture;
    if (status.state === 'failed') console.warn(`[render] terrain textures: ${status.reason}`);
    return status;
  };
  if (opts.terrainTextures) void setTerrainTextures(opts.terrainTextures);
  const propBlobs = opts.props?.maxBlobs ?? PROP_BLOBS;
  const decals = new DecalLayer(scene, capacity + 64 + propBlobs);
  // Screen-size LOD shared by units, buildings and props: the drawing buffer height and the camera's fov.
  const screen = new ScreenLod();
  const units = new UnitLayer(scene, {
    capacity,
    lightDir: DEFAULT_LIGHT_DIR,
    precision,
    anims,
    screen,
    shadow: sun,
    ...(opts.lodPixels?.units ? { lodPixels: opts.lodPixels.units } : {}),
  });
  const rigid = new RigidUnitLayer(scene, {
    capacity,
    lightDir: DEFAULT_LIGHT_DIR,
    screen,
    shadow: sun,
    ...(opts.lodPixels?.units ? { lodPixels: opts.lodPixels.units } : {}),
  });
  units.setSkip((typeId) => rigid.owns(typeId)); // the robots are the rigid layer's
  const assetConfig = opts.assets;
  const gltfIO = createGltfIO();
  const resolveAssetPath = (manifestUrl: string, path: string): string =>
    assetConfig?.resolveUrl && manifestUrl === assetConfig.manifestUrl
      ? assetConfig.resolveUrl(path)
      : resolveManifestPath(manifestUrl, path);
  const loader = new UnitAssetLoader(gltfIO, resolveAssetPath);
  const gainOf = (assetId: string): number | undefined => {
    const g = opts.albedoGain?.[assetId];
    return g === undefined || !Number.isFinite(g)
      ? undefined
      : Math.min(ALBEDO_GAIN_RANGE[1], Math.max(ALBEDO_GAIN_RANGE[0], g));
  };
  const attachments = new AttachmentRegistry(
    units,
    {
      manifest: (url) => loader.manifest(url),
      fetchBytes: (url) => gltfIO.fetchBytes(url),
      parseGltf: (bytes, url) => gltfIO.parseGltf(bytes, url),
    },
    {
      manifestUrl: assetConfig?.manifestUrl,
      resolveUrl: resolveAssetPath,
      warn: (message) => console.warn(`[render] ${message}`),
    },
  );
  const unitAssets = new UnitAssetRegistry(units, loader, {
    config: assetConfig,
    maxTextureSize: caps.maxTextureSize,
    warn: (message) => console.warn(`[render] ${message}`),
    albedoGain: gainOf,
    rigidIds: (url) => rigidUnits.rigidIds(url),
    onRigLoaded: (info) => attachments.rigLoaded(info),
  });
  const rigidUnits = new RigidUnitRegistry(rigid, loader, {
    config: assetConfig,
    maxTextureSize: caps.maxTextureSize,
    warn: (message) => console.warn(`[render] ${message}`),
    albedoGain: gainOf,
  });
  // Everything in the scene, also what is hidden or off screen now, is made ready once loading settles; otherwise the
  // first sight of a building type on the far side of a large map, a unit LOD, a hero or a prop variant costs a frame
  // of 50 to 250 ms. Two steps: compileAsync links the programs (it walks the scene synchronously when called, so the
  // flip is undone before the next frame renders), then one warm draw (perf/warmDraw.ts) of everything with an instance
  // each, run inside the next frame just before its real draw, so the driver builds its pipeline states, vertex arrays,
  // texture uploads and the shadow-depth programs now. It is not presented: the real draw follows in the same task.
  let warmTimer: ReturnType<typeof setTimeout> | undefined;
  let warmDrawPending = false;
  let warmDraws = 0;
  const warmUp = async (): Promise<void> => {
    const restore = forceDrawable(scene);
    const done = gpu.compileAsync(scene, camera);
    restore();
    await done;
    warmDrawPending = opts.warmDraw !== false;
  };
  const scheduleWarmUp = (): void => {
    clearTimeout(warmTimer);
    warmTimer = setTimeout(() => {
      warmUp().catch((err: unknown) => console.warn('[render] pipeline warm-up failed', err));
    }, 250);
  };
  void Promise.all([unitAssets.start(), rigidUnits.start()]).then(scheduleWarmUp);
  const footprints = new FootprintTable(opts.buildingFootprint ?? null);
  const structures = new StructureLayer(scene, {
    capacity,
    footprints,
    heightAt: (x, z) => terrain.heightAt(x, z),
    castShadows: shadowsOn,
    screen,
    ...(opts.lodPixels?.buildings ? { lodPixels: opts.lodPixels.buildings } : {}),
    materials: {
      building: createPropMaterial({
        lightDir: DEFAULT_LIGHT_DIR,
        name: 'crawlout-building-toon',
        shadow: sun,
      }),
      // Scrap heaps and claim points are map knowledge: they keep the explored look in the unexplored dark.
      scrap: markMapKnowledge(
        createPropMaterial({
          lightDir: DEFAULT_LIGHT_DIR,
          name: 'crawlout-scrap-toon',
          surface: 'rustMetal',
          shadow: sun,
        }),
      ),
      claim: markMapKnowledge(
        createPropMaterial({
          lightDir: DEFAULT_LIGHT_DIR,
          name: 'crawlout-claim-toon',
          time,
          surface: 'paintedMetal',
          shadow: sun,
        }),
      ),
    },
  });
  const windStrength = uniform(opts.props?.wind === false ? 0 : 1);
  const props = new PropLayer(scene, {
    ...opts.props,
    maxBlobs: propBlobs,
    screen,
    ...(opts.lodPixels?.props ? { lodPixels: opts.lodPixels.props } : {}),
    ...(opts.lodPixels?.trees ? { treeLodPixels: opts.lodPixels.trees } : {}),
    shadow: sun ? { smallProps: sun.settings.smallProps, sunDir: SUN_DIR } : null,
    heightAt: (x, z) => terrain.heightAt(x, z),
    material: ({ map, layers, mask, category, height }) => {
      const wind = windOf(category);
      return createPropMaterial({
        lightDir: DEFAULT_LIGHT_DIR,
        name: mask ? 'crawlout-prop-toon-mask' : 'crawlout-prop-toon',
        shadow: sun,
        map,
        layers,
        surface: surfaceKindOfCategory(category),
        alphaMask: mask,
        ...(wind && height > 1e-4
          ? { wind: { ...wind, height, time, strength: windStrength } }
          : {}),
      });
    },
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
    for (const v of set.visuals.values()) {
      const g = gainOf(v.assetId);
      if (g !== undefined) v.gain = g;
    }
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
            shadow: sun,
            layers: set.layers,
            layerLuma: set.layerLuma,
            layerKinds: set.layerKinds,
            reveal: true,
          }),
    );
    disposeSet(); // the structure layer drew its own copies
    scheduleWarmUp();
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
    const hf = terrain.heightField;
    if (hf) [groundLo, groundHi] = hf.heightRange();
  };
  // Grass density mask over the terrain, from the grass and plant props (terrain/grassMask.ts).
  let grassTexture: DataTexture | null = null;
  let grassProps: readonly RenderProp[] = [];
  const applyGrassMask = (): void => {
    const hf = terrain.heightField;
    const mask = hf
      ? buildGrassMask(
          grassProps.map((p) => ({ asset: p.asset, x: p.x, y: p.y })),
          (asset) => props.categoryOf(asset) ?? propCategoryOf(asset),
          hf,
        )
      : null;
    grassTexture?.dispose();
    grassTexture = null;
    if (!mask) {
      terrain.setGrassMask(null);
      return;
    }
    const rgba = new Uint8Array(mask.w * mask.h * 4);
    for (let i = 0; i < mask.data.length; i++) rgba.fill(mask.data[i]!, i * 4, i * 4 + 4);
    grassTexture = new DataTexture(rgba, mask.w, mask.h, RGBAFormat);
    grassTexture.minFilter = grassTexture.magFilter = LinearFilter;
    grassTexture.needsUpdate = true;
    terrain.setGrassMask(grassTexture, mask);
  };
  const setTerrain = (geometry: TerrainGeometry, terrainOpts: SetTerrainOptions = {}): void => {
    terrain.set(geometry, terrainOpts.albedoLayout ?? null);
    if (waterMask) applyWater();
    if (grassProps.length > 0) applyGrassMask();
    afterHeights();
    scheduleWarmUp();
    const hf = terrain.heightField;
    const bounds = hf ? { minX: hf.minX, maxX: hf.maxX, minZ: hf.minZ, maxZ: hf.maxZ } : null;
    atmosphere.setBounds(bounds);
    skirt.set(bounds, (x, z) => terrain.heightAt(x, z));
    if (hf) {
      controls.bounds = { minX: hf.minX, maxX: hf.maxX, minZ: hf.minZ, maxZ: hf.maxZ };
      controls.focus(controls.target.x, controls.target.z);
      // The furthest zoom of a large map looks across it: keep its far corner inside the far plane.
      camera.far = Math.max(800, controls.maxDistance * 2.6);
      camera.updateProjectionMatrix();
    }
  };
  setTerrain(createGridTerrain(128, 128, 4));

  const platformList: PlatformSpec[] = [];
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
  const profiler = new FrameProfiler();

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
    profiler.begin();
    const dt = (now - last) / 1000;
    last = now;
    const t = clock(now);
    time.value = t;
    controls.update(dt);
    camera.updateMatrixWorld();
    screen.setViewport(canvas.height);
    screen.update(camera);
    profiler.mark('camera');
    const builds = terrain.leafBuilds;
    terrain.update(camera);
    profiler.count('leafBuilds', terrain.leafBuilds - builds);
    profiler.mark('terrain');
    interp.sample(now, frame);
    stampInspected(frame.id, frame.flags, frame.count, inspectedIds);
    // Foundations first: buildings level the ground under them, and everything below reads the levelled ground.
    profiler.mark('interpolate');
    const relayout = terrain.setPlatforms(
      structures.platforms(frame, platformList),
      PLATFORM_BUDGET_MS,
    );
    profiler.count('platformRelayout', relayout ? 1 : 0);
    profiler.count('warmDraws', warmDraws);
    if (relayout) props.relayout();
    profiler.mark('platforms');
    for (let i = 0; i < frame.count; i++) frame.y[i] = terrain.heightAt(frame.x[i]!, frame.z[i]!);
    profiler.mark('heights');
    decals.begin();
    zones.draw(t, decals); // first, so blobs and selection rings draw over the zone
    units.update(frame, camera, decals);
    rigid.update(frame, camera, decals, t);
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
    profiler.mark('entities');
    props.update(camera, decals); // last: when the decal batch is full, prop blobs are what drops
    profiler.mark('props');
    decals.end();
    additive.commit();
    smoke.commit();
    atmosphere.update(controls.distance);
    fogOfWar.update(dt);
    profiler.mark('effects');
    sun?.update(camera, groundLo, groundHi);
    profiler.mark('shadowFit');
    if (warmDrawPending) {
      warmDrawPending = false;
      const restore = forceDrawable(scene);
      gpu.render(scene, camera);
      restore();
      gpu.info.reset(); // the stats are the real draw's
      warmDraws++;
      profiler.mark('warmDraw');
    }
    gpu.render(scene, camera);
    profiler.mark('submit');
    profiler.end();
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
  const rigidShape = (i: number, out: PickShape): PickShape | null =>
    rigid.pickShape(frame.typeId[i]!, out);
  const pickShape = (i: number, out: PickShape): PickShape | null =>
    rigidShape(i, out) ?? structures.pickShape(frame.typeId[i]!, out);

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
      scheduleWarmUp();
      return waterInfo ? { ...waterInfo } : null;
    },
    setTerrainTextures,
    setGameData(data) {
      footprints.setLookup(footprintsFromGameData(data));
      abilities = data.heroes ? abilitiesFromGameData({ heroes: data.heroes }) : null;
      if (data.loadouts) {
        attachments.setLoadouts(data.loadouts);
        void Promise.all([
          unitAssets.setLoadouts(data.loadouts),
          rigidUnits.setLoadouts(data.loadouts),
        ])
          .then(() => attachments.settled())
          .then(scheduleWarmUp);
      }
      void loadBuildings(data.buildings);
    },
    loadUnitAsset: (manifestUrl, assetId, assetOpts) =>
      unitAssets.load(manifestUrl, assetId, assetOpts).finally(scheduleWarmUp),
    unitAssets: () => unitAssets.statuses(),
    attachmentAssets: () => attachments.statuses(),
    loadRigidUnit: (manifestUrl, assetId, typeIds) =>
      rigidUnits.load(manifestUrl, assetId, typeIds).finally(scheduleWarmUp),
    addRigidUnit(source, typeIds) {
      const status = rigidUnits.addLoaded(source.name, source, typeIds);
      scheduleWarmUp();
      return status;
    },
    rigidUnitAssets: () => rigidUnits.statuses(),
    buildingAssets: () =>
      buildingStatuses.map((st) => ({ ...st, buildingIds: [...st.buildingIds] })),
    async setProps(list, source = {}) {
      const generation = ++propGeneration;
      props.setProps(list);
      grassProps = list;
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
        categories: source.categories,
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
          const g = gainOf(assetId);
          props.setVisual(
            assetId,
            r.visual && g !== undefined ? { ...r.visual, gain: g } : r.visual,
          );
          const status = current.get(assetId)!;
          status.state = 'ready';
          status.origin = r.origin;
          if (r.reasons.length > 0) status.reason = r.reasons.join('; ');
          if (r.triangles) status.triangles = r.triangles;
          if (r.visual?.category) status.category = r.visual.category;
          if (r.visual?.mask) status.mask = true;
          if (r.visual) status.height = Math.round(r.visual.height * r.visual.fit * 100) / 100;
          if (r.origin !== 'manifest' && r.reasons.some((m) => !m.startsWith('not in')))
            console.warn(`[render] prop "${assetId}": ${status.reason}`);
        }),
      );
      if (generation === propGeneration) applyGrassMask();
      scheduleWarmUp();
      return [...current.values()].map((st) => ({ ...st }));
    },
    propAssets: () => [...propStatuses.values()].map((st) => ({ ...st })),
    setPropWind(enabled) {
      windStrength.value = enabled ? 1 : 0;
    },
    setInspectedIds(ids) {
      inspectedIds = new Set(ids);
    },
    setFog(mask) {
      fogOfWar.setMask(mask);
    },
    setClaimStates(states) {
      structures.setClaimArcs(claimRingArcs(states ?? []));
    },
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
          undefined,
          rigidShape,
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
      return selectInRect(frame, viewProj.elements, canvas.clientWidth, canvas.clientHeight, rect, {
        shape: rigidShape,
        ...selectOpts,
      });
    },
    focus(x, y) {
      controls.focus(x / UNITS_PER_METER, y / UNITS_PER_METER);
    },
    stats: () => ({ ...meter.stats }),
    triangleBreakdown: () => triangleBreakdown(scene, (id) => props.categoryOf(id)),
    frameTimings: () => profiler.last,
    takeSlowestFrame: () => profiler.takeSlowest(),
    layerStats: () => ({
      terrainTriangles: terrain.triangles,
      terrainDraws: terrain.drawCount,
      propsVisible: props.visibleCount,
      propsTotal: props.totalCount,
      waterTriangles: water.triangles,
      attachmentInstances: units.attachmentInstances,
      rigidVisible: rigid.visibleCount,
      rigidTotal: rigid.totalCount,
      rigidDraws: rigid.drawCount,
    }),
    dispose() {
      clearTimeout(warmTimer);
      void gpu.setAnimationLoop(null);
      resizeObserver.disconnect();
      controls.dispose();
      unitAssets.dispose();
      attachments.dispose();
      overlay?.dispose();
      units.dispose();
      rigidUnits.dispose();
      rigid.dispose();
      buildingGeneration++;
      structures.dispose();
      buildingLayers?.dispose();
      props.dispose();
      propRegistry.dispose();
      decals.dispose();
      additive.dispose();
      smoke.dispose();
      sun?.dispose();
      fogOfWar.dispose();
      skirt.dispose();
      terrainGeneration++;
      terrain.dispose();
      water.dispose();
      terrainTexture?.dispose();
      grassTexture?.dispose();
      interp.clear();
      zones.clear();
      gpu.dispose();
    },
  };
}
