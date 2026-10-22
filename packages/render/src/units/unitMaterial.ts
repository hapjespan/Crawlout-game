// Instanced-skinning toon material (TSL). Review gate: architect review before merge (render-pipeline brief).
//
// Per instance the GPU only gets two vec4 attributes:
//   iPose: world x, y, z (meters) and yaw (radians)
//   iAnim: clip index, clip progress 0..1, team index (palette below), flags
// Everything else comes from two textures shared by all instances: the bone-matrix texture and the clip table
// (layout in bake.ts), plus the team palette as a uniform array (palette.ts; slot MAX_PLAYERS is neutral).
// The textures are float32, or half-float where the WebGL2 driver refuses float32 (gpu/dataTextures.ts).
// Vertex buffers stay at 7 of WebGPU's limit of 8: position, normal, color (rgb + team mask in alpha),
// skinIndex, skinWeight, iPose, iAnim. A textured asset adds uv (8, the limit): albedo = color * diffuse atlas, with
// the team mask from the color alpha or, for 'diffuseAlpha' assets, from the atlas alpha; uv = (-1, -1) marks a
// primitive without the atlas (reads white). Vertex skinning reads 4 influences, blends two adjacent frames, then
// rotates by yaw.
// Shading: 3-step toon ramp (soft band edges) plus a small sky fill, rimlight on the screen silhouette, team color
// through the team mask (vertex alpha or, per texel, the atlas alpha) relative to the albedo's mean under the mask.
// No PBR. The base is clothing (cloth surface of look/surfaces.ts): grain and dust at the boots from the shared
// weathering, then the shared world grade (look/grade.ts), the team color itself only lightly graded so it stays the
// one saturated accent on a dusty unit.
// Hero (typeId 1000 + heroId): the unit layer adds HERO_INSTANCE_FLAG to the flags in iAnim.w. A hero is drawn
// HERO_SCALE times bigger, and only a hero shows the hero parts of the placeholder (color alpha >= HERO_PART_ALPHA,
// humanoidGeometry.ts); for other instances those vertices collapse onto their bone and rasterize nothing.

export {
  HERO_INSTANCE_FLAG,
  HERO_SCALE,
  TEAM_SLOTS,
  ATTACHMENT_LOD_STEP,
  VARIATION,
  TOON_BANDS,
  TOON_EDGE_SOFT,
  toonRamp,
  toonLight,
  AMBIENT_BAND,
  RIM,
  silhouetteEdge,
  rimLight,
  TEAM,
  teamShade,
  teamAlbedo,
  SKY_FILL,
  skyFillAt,
  skyFill,
} from './unitMaterial.part1.js';
export type {
  ToonLighting,
  UnitAlbedo,
  UnitMaterialOptions,
  UnitMaterialBundle,
} from './unitMaterial.part1.js';
export { createUnitMaterial } from './unitMaterial.part2.js';
