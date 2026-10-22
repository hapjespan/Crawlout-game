// Prop-packs (Sketchfab-FBX-exports van DJMaesen, CC-BY-4.0): elk pack-GLB wordt volgens assets/src/packs.json in losse
// props gesplitst, op echte schaal gebracht (meters, poppetje 1,8 m, voet op y=0, gecentreerd op x en z), tot een atlas
// samengevoegd, met alfa-test (MASK) voor bladeren en gras, en tot drie LOD's gereduceerd. Alles wat Martien wil
// bijsturen (splitsregel, categorie, maat, budgetten) staat in packs.json, niet in code.
//
// Uitvoer per prop: <id>/lod0..2.glb (meshopt, JPEG-atlas of WebP-atlas met alfa) plus een manifest-entry `kind: 'prop'`
// met `category` en `alpha`. De bronnen (assets/src/packs, 80 MB) staan niet in git: ontbreekt een bron, dan blijft de
// gecommitte uitvoer van de props uit die bron staan (`preserved`), zodat `pnpm assets` in CI groen blijft.

export {
  PACKS_VERSION,
  categorySchema,
  propSchema,
  sourceSchema,
  packsSchema,
  parsePacksConfig,
  loadPacksConfig,
  listConfiguredProps,
  resolveProp,
  loadPackSource,
} from './packs.part1.js';
export type { PacksConfig, PackProp, PackCategory, PackSource } from './packs.part1.js';
export {
  readPrimitive,
  classifyFoliage,
  reduceMesh,
  reduceFoliageMesh,
  prepareProp,
} from './packs.part2.js';
export type { PropAlpha, Prepared, PropLod } from './packs.part2.js';
export { checkPropDocument, EMPTY_PACKS, findPacksDir, buildPacks } from './packs.part3.js';
export type { PackPropDetails, PacksResult } from './packs.part3.js';
