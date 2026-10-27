// Delivered models (assets/local/delivered.json): GLB's from a designer that are processed as they are (textures and all) into
// rigid units (robots), props (weapons, tools, gear with an anchor) or buildings, on the real scale. Used by the local
// pipeline (`pnpm assets --local`, sources in assets/local/delivered, output in assets/dist-local): most of these are
// fan models that must never be committed, so only this module and the config (node and material names, sizes, no art)
// live in git.
//
// Per asset: pick nodes of the source scene, flatten the node transforms into the vertices, turn the model to +Z forward
// (`rotate`), give it its real size (`scale` or `fit`: one axis in meters, never squashed), place its origin (`align`,
// `lift` for a hovering unit), map source materials (rename, recolour, drop the texture, two-sided) and add extra shapes
// (a team band). Per LOD the meshes per output material are simplified to the budget of the kind (meshopt, uv and normal
// weighted), several diffuse textures are merged into one atlas and the result goes through the same finishing as the
// procedural models (JPEG textures per LOD, meshopt, validation). The model is never shrunk to a footprint: a building
// whose real size differs from the data footprint gets a warning with the footprint it needs.

export {
  DELIVERED_VERSION,
  ANCHORS,
  deliveredAssetSchema,
  deliveredSchema,
  parseDelivered,
  loadDeliveredConfig,
} from './delivered.part1.js';
export type { DeliveredConfig, DeliveredAsset, PlacedModel } from './delivered.part1.js';
export { placeModel, deliveredLodTargets } from './delivered.part2.js';
export type { DeliveredDetails } from './delivered.part2.js';
export { buildDelivered } from './delivered.part3.js';
