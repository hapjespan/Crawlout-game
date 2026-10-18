// Gebouwengenerator: bouwt uit het bron-huisje (assets/src/buildings/base_house.glb) en eenvoudige vormen de acht
// Dweller-gebouwen, volledig gestuurd door assets/src/buildings/variants.json. Per gebouw en LOD ontstaat een
// document met effen basiskleur plus diffuse textuur (geen PBR-extensies), een team-materiaal, de footprint exact in x
// en z, het midden op de oorsprong en de grond op y = 0. De LOD-GLB's krijgen meshopt-compressie zoals de rest van de buis.

export {
  transformFromMatrix4,
  loadSourceHouse,
  shapeMeshes,
  hexToLinear,
  buildingLodTargets,
  placeShape,
} from './buildings.part1.js';
export type { SourceHouse, SourceOptions, GeneratedBuilding } from './buildings.part1.js';
export {
  generateBuilding,
  finishBuildingLod,
  checkBuildingDocument,
  validateBuildingDocument,
  EMPTY_BUILDINGS,
  loadVariantsConfig,
  buildBuildings,
} from './buildings.part2.js';
export type { BuildingLod, BuildingsResult, BuildingDetails } from './buildings.part2.js';
