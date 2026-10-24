// Generated tiling surface maps for the procedural geometry (buildings, rigid units, attachments): a normal map, a
// metallic-roughness map and a low-contrast weathering map per surface kind, keyed on the material name the way
// render keys its surface recipe. Colour identity stays in the glTF baseColorFactor, which comes from the faction
// palettes in assets/src; these maps only add relief, wear and material separation on top of it.
//
// Honest about what this is: placeholder detail. It makes a procedural box read as painted steel or as canvas
// instead of as flat colour. It does not make a mannequin a character.
export {
  SURFACE_KINDS,
  surfaceKindOfName,
  encodePng,
  fbm,
  valueNoise,
  hash2,
} from './surfaceTex.part1.js';
export type { SurfaceKind } from './surfaceTex.part1.js';
export { surfaceMaps } from './surfaceTex.part2.js';
export type { SurfaceMaps } from './surfaceTex.part2.js';
