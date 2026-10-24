// Texture-stappen voor karakterbronnen die niet volgens de brief geleverd zijn: een emissive-only kleurtextuur als
// diffuse gebruiken, alle diffuse textures samenvoegen tot één atlas (render tekent één atlas per draw), en het
// teammasker als apart materiaal (naam met "team", wat render als masker leest) afsplitsen op textuurkleur.
// Beeldbewerking via sharp, alleen geladen als een van deze stappen in de config staat.
// De code staat in drie delen: part1 de atlas-bouwstenen, part2 het teammasker en de LOD-compressie, part3 buildAtlas.

export { emissiveAsBaseColor, packSquares, triangleTile } from './textures.part1.js';
export { buildAtlas } from './textures.part3.js';
export type { AtlasInfo } from './textures.part3.js';
export { inTeamRange, boneRegion, applyTeamMaskAlpha } from './textures.part2.js';
export type { TeamMaskRule, TeamMaskInfo } from './textures.part2.js';
export { compressLodTextures } from './textures.part2.js';
export type { TextureCompressionInfo } from './textures.part2.js';
