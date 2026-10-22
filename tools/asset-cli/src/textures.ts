// Texture-stappen voor karakterbronnen die niet volgens de brief geleverd zijn: een emissive-only kleurtextuur als
// diffuse gebruiken, alle diffuse textures samenvoegen tot één atlas (render tekent één atlas per draw), en het
// teammasker als apart materiaal (naam met "team", wat render als masker leest) afsplitsen op textuurkleur.
// Beeldbewerking via sharp, alleen geladen als een van deze stappen in de config staat.

export { emissiveAsBaseColor, packSquares, triangleTile, buildAtlas } from './textures.part1.js';
export type { AtlasInfo } from './textures.part1.js';
export { inTeamRange, boneRegion, applyTeamMaskAlpha } from './textures.part2.js';
export type { TeamMaskRule, TeamMaskInfo } from './textures.part2.js';
