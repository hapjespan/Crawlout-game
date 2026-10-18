// Terrein-buis: bronmesh (GLB, bijvoorbeeld Rock Terrain 4) naar een hoogteveld en een bovenaanzicht-albedo.
// De kern (rasterizeTopSurface, heightfieldFromSurface, bakeAlbedo) werkt op platte arrays en heeft geen IO,
// zodat hij met synthetische terreinen te testen is. Alleen buildTerrain leest en schrijft bestanden.

export {
  rasterizeTopSurface,
  heightfieldFromSurface,
  linearToSrgbByte,
  hexOfLinear,
  bakeAlbedo,
  fillHolesPullPush,
  texturedOnly,
} from './terrain.part1.js';
export type {
  TerrainMaterial,
  TerrainMesh,
  SampleGrid,
  TopSurface,
  FieldOptions,
  FieldResult,
  AlbedoResult,
  FloaterOptions,
} from './terrain.part1.js';
export {
  removeFloaters,
  rotateMeshY,
  chooseCrop,
  readTerrainMesh,
  FLOATER_DEFAULTS,
  formatHeightfield,
} from './terrain.part2.js';
export type {
  FloaterResult,
  CropChoice,
  CropSearch,
  BuildTerrainOptions,
  BuildTerrainResult,
} from './terrain.part2.js';
export { buildTerrain } from './terrain.part3.js';
