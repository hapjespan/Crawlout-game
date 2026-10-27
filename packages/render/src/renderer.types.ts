// Public types of the renderer (createRenderer options and the CrawloutRenderer interface).
import type { GameData } from '@crawlout/data';
import type { ClaimPointStatus, FogMask } from '@crawlout/protocol';
import type { RtsCameraController, RtsCameraOptions } from './camera/rtsCamera.js';
import type { FootprintLookup } from './entities/footprint.js';
import type { DataTexturePrecision } from './gpu/dataTextures.js';
import type { ScreenLodThresholds } from './lod/screenLod.js';
import type { FrameStats } from './perf/perfOverlay.js';
import type { FrameTimings } from './perf/frameProfile.js';
import type { TriangleBreakdown } from './perf/triangleBreakdown.js';
import type { BoxSelectOptions, ScreenRect } from './picking/selection.js';
import type { ShadowQuality } from './shadows/sunShadow.js';
import type { PropAssetStatus, PropSourceOptions } from './props/propAssets.js';
import type { PropLayerOptions, RenderProp } from './props/propLayer.js';
import type { BuildingAssetStatus } from './structures/buildingAssets.js';
import type { TerrainAlbedoLayout } from './terrain/albedoLayout.js';
import type { TerrainGeometry } from './terrain/heightField.js';
import type { TerrainChunkOptions } from './terrain/terrainChunks.js';
import type { TerrainDetailOptions } from './terrain/terrainRefine.js';
import type { TerrainTextureOptions, TerrainTextureStatus } from './terrain/terrainTextures.js';
import type { UnitAssetConfig, UnitAssetOptions, UnitAssetStatus } from './units/unitAssets.js';
import type { AttachmentStatus } from './units/attachmentAssets.js';
import type { RigidUnitStatus } from './units/rigidUnitAssets.js';
import type { RigidUnitSource } from './units/rigidUnitLayer.js';
import type { WaterMaskInput, WaterOptions } from './water/waterMask.js';

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
   * Ground vegetation (vegetation/): grass, weeds, shrubs and reeds grown from the ground map, and groves of trees
   * along impassable ground once setVegetation gives the passability. Default true; false draws the bare ground.
   */
  vegetation?: boolean;
  /** Trees, tall shrubs and tall props dither away while they hide a unit or a claim flag (occlusion/). Default true. */
  occlusionFade?: boolean;
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
  /** Ground vegetation instances drawn now, by species (vegetation/vegetationLayer.ts). */
  vegetation: Record<string, number>;
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
  /**
   * The map's passability (1 passable, row 0 at the terrain's min z, the terrain's extent): the vegetation keeps
   * shrubs to the edges of impassable ground and grows groves of trees on it, added to the props of setProps. Render
   * only. Null drops the groves. `keepClear`: objectives (claim points; x and y in map meters, y is world z) that keep
   * a clear radius without trees or shrubs, so their flags read at every zoom.
   */
  setVegetation(
    input: {
      w: number;
      h: number;
      passable: ArrayLike<number>;
      keepClear?: readonly { x: number; y: number }[];
    } | null,
  ): void;
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
