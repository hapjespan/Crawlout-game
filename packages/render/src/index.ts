// @crawlout/render: three.js WebGPURenderer (WebGL2 fallback). Reads snapshots only, via @crawlout/protocol.
export {
  createRenderer,
  type CreateRendererOptions,
  type CrawloutRenderer,
  type PickResult,
  type PlacementPreview,
  type RenderBackend,
  type WaterInfo,
  type LayerStats,
  type SetTerrainOptions,
  ALBEDO_GAIN_RANGE,
} from './renderer.js';
export { type ShadowQuality } from './shadows/sunShadow.js';
export {
  albedoUv,
  mirroredAlbedoLayout,
  validateAlbedoLayout,
  AlbedoLayoutError,
  MAX_ALBEDO_TILES,
  type AlbedoSeam,
  type AlbedoTap,
  type TerrainAlbedoLayout,
  type TerrainAlbedoTile,
} from './terrain/albedoLayout.js';
export {
  parseWaterMask,
  WaterMaskError,
  WATER_CELL,
  type WaterMask,
  type WaterMaskInput,
  type WaterOptions,
} from './water/waterMask.js';
export { type TerrainChunkOptions } from './terrain/terrainChunks.js';
export {
  parseSnapshot,
  SnapshotParseError,
  type SnapshotView,
  type SnapshotEntities,
  type SnapshotEvents,
} from './snapshot/parse.js';
export {
  SnapshotInterpolator,
  createInterpolatedFrame,
  interpolateInto,
  lerpAngle,
  lerpAnimT,
  simYawToRender,
  type InterpolatedFrame,
} from './snapshot/interpolate.js';
export {
  TerrainHeightField,
  createGridTerrain,
  type TerrainGeometry,
  type TerrainHit,
} from './terrain/heightField.js';
export {
  refineTerrain,
  heightFieldNormals,
  type TerrainDetailOptions,
} from './terrain/terrainRefine.js';
export {
  type TerrainTextureOptions,
  type TerrainTextureStatus,
} from './terrain/terrainTextures.js';
export { type BuildingAssetStatus } from './structures/buildingAssets.js';
export {
  selectInRect,
  pickEntity,
  type ScreenRect,
  type BoxSelectOptions,
  type PickShape,
} from './picking/selection.js';
export {
  RtsCameraController,
  DEFAULT_PAN_KEYS,
  BASE_MAX_DISTANCE,
  maxDistanceFor,
  type RtsCameraOptions,
  type RtsCameraBounds,
  type PanDirection,
} from './camera/rtsCamera.js';
export { type FrameStats } from './perf/perfOverlay.js';
export { type RenderProp } from './props/propLayer.js';
export {
  PROP_CATEGORIES,
  parsePropCategory,
  propCategoryOf,
  type PropCategory,
} from './props/propCategory.js';
export { thinTier, type ThinTier } from './props/propThinning.js';
export { windOf, type WindSpec } from './props/propWind.js';
export {
  type PropSourceOptions,
  type PropAssetStatus,
  type PropOrigin,
} from './props/propAssets.js';
export {
  PROP_TARGET_HEIGHT,
  PROP_KIND_HEIGHT,
  propKindOf,
  propTargetHeight,
  type PropKind,
} from './props/propFit.js';
export { CLIPS, BONES } from './units/rig.js';
export {
  BODY_SLOT,
  type UnitAssetConfig,
  type UnitAssetOptions,
  type UnitAssetStatus,
} from './units/unitAssets.js';
export { type TeamMaskSource } from './units/gltfUnitGeometry.js';
export { TEAM_COLORS, NEUTRAL_COLOR, teamIndex } from './palette.js';
export {
  classifyTypeId,
  drawsAsUnit,
  buildingIdOf,
  buildingTypeId,
  loadoutIdOf,
  ENTITY_KIND,
  TYPE_ID_UNIT_FIRST,
  TYPE_ID_BUILDING_FIRST,
  TYPE_ID_SCRAP_NODE,
  TYPE_ID_CLAIM,
  type EntityKind,
} from './entities/typeIds.js';
export {
  FootprintTable,
  footprintsFromGameData,
  snapFootprintCenter,
  DEFAULT_FOOTPRINT,
  type Footprint,
  type FootprintLookup,
} from './entities/footprint.js';
export { type DataTexturePrecision } from './gpu/dataTextures.js';
