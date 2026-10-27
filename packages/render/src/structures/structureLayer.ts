// Buildings, scrap heaps and claim points: one instanced draw call per kind per LOD, plus one for the scaffolds around
// building sites. A building type with an asset from the manifest (setBuildingAssets) is drawn with it: one instanced
// draw per asset per LOD (three LODs, identical LODs share a draw; every material of the asset sits in that one draw
// through the shared texture array); the others keep the placeholder block (two LODs). Buildings, scrap heaps and claim
// flags cast the real sun shadow (when the renderer enables it); scrap
// heaps get a blob shadow decal and claim points a ring decal in the owner's color. Everything is read from the
// interpolated frame, by typeId (entities/typeIds.ts). A site (anim build) grows with its progress in animT inside a
// scaffold (a placeholder scales up, an asset rises out of the ground: the material cuts it at the built height); a
// scrap heap shrinks with its remaining stock in hpPct (structureVisuals.ts).

export type { StructureMaterials, StructureLayerOptions } from './structureLayer.part1.js';
export { StructureLayer } from './structureLayer.part2.js';
