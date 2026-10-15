// Werkstroom map. Valt onder de determinisme-lint: passability en mapdata voor de sim zijn integers.
export type {
  MapPoint,
  ScrapNode,
  ClaimPoint,
  CreepCamp,
  MapGrid,
  Heightmap,
  MapAssets,
} from './types.js';
export { loadMap, loadHeightmap, loadWater } from './loader.js';
export { inBounds, isPassable, floodReachable, allConnected } from './grid.js';
export { encodeGrid, decodeGrid, GRID_FORMAT } from './grid-format.js';
export type { GridType, GridFile } from './grid-format.js';
export {
  greyboxMesh,
  terrainTile,
  TILE_GROUND,
  TILE_RUIN,
  TILE_CLIFF,
  CLIFF_MIN_STEP,
  ROCK_RGB,
  MARK_SCRAP_RGB,
  MARK_CLAIM_RGB,
} from './greybox.js';
export type { GreyboxMesh, TerrainTile } from './greybox.js';
// Generatoren (build-tijd, voor data/maps/*): zie src/gen en test/gen.test.ts voor regenereren.
export { generateMap, padClearings } from './gen/builder.js';
export type {
  MapSpec,
  GeneratedMap,
  GenIo,
  TerrainSpec,
  TileSpec,
  RiverSpec,
  RiverPoint,
  RiverCrossing,
  ForestSpec,
  GroveSpec,
} from './gen/builder.js';
export { WATER_NONE, WATER_DEEP, WATER_SHALLOW, WATER_LEVEL_CM } from './gen/river.js';
export { FOREST_NONE, FOREST_BORDER, FOREST_GROVE } from './gen/forest.js';
export { generateRustbelt, RUSTBELT_SPEC } from './gen/rustbelt.js';
export { generateTestmap, TESTMAP_SPEC } from './gen/testmap.js';
// Decoratieve props (puur visueel, buiten de sim en de envHash): loader voor de renderer en de scatter-generator.
export {
  loadProps,
  parseProps,
  encodeProps,
  scatterProps,
  pathCorridor,
  PROPS_FORMAT,
  PROP_KINDS,
  PROP_CLEARANCE_M,
  PROP_SCALE_MIN,
  PROP_SCALE_MAX,
} from './props.js';
export type {
  PropInstance,
  PropRecord,
  PropsFile,
  PropsSpec,
  PropQuota,
  PropKind,
  PropPlacement,
  ForestPropsSpec,
  WeightedAsset,
  ScatterLayers,
} from './props.js';
export { createRng } from './rng.js';
export type { Rng } from './rng.js';
