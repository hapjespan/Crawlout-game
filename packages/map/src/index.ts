// Werkstroom map. Valt onder de determinisme-lint: passability en mapdata voor de sim zijn integers.
export type { MapPoint, ScrapNode, ClaimPoint, CreepCamp, MapGrid, Heightmap, MapAssets } from './types.js';
export { loadMap, loadHeightmap } from './loader.js';
export { inBounds, isPassable, floodReachable, allConnected } from './grid.js';
export { encodeGrid, decodeGrid, GRID_FORMAT } from './grid-format.js';
export type { GridType, GridFile } from './grid-format.js';
export { greyboxMesh, terrainTile, TILE_GROUND, TILE_RUIN, TILE_CLIFF, CLIFF_MIN_HEIGHT, MARK_SCRAP_RGB, MARK_CLAIM_RGB } from './greybox.js';
export type { GreyboxMesh, TerrainTile } from './greybox.js';
// Generatoren (build-tijd, voor data/maps/*): zie src/gen en test/gen.test.ts voor regenereren.
export { generateMap } from './gen/builder.js';
export type { MapSpec, GeneratedMap } from './gen/builder.js';
export { generateRustbelt, RUSTBELT_SPEC } from './gen/rustbelt.js';
export { generateTestmap, TESTMAP_SPEC } from './gen/testmap.js';
