// Units on screen: one instanced draw call per rig per LOD. Blob shadows and selection rings go to the shared DecalLayer.
// Only typeIds classified as units (or unknown) are drawn here; buildings, scrap nodes and claims have their own layer.
// Rig 0 is the procedural placeholder (bake.ts, humanoidGeometry.ts); loaded assets add rigs (addRig) and take over
// unit typeIds (assignRig) or every unit without its own rig (setDefaultRig). A hero (typeId 1000 + heroId) uses the
// default rig with a hero flag per instance: bigger, and on the placeholder with cap, collar and pauldrons.
// Unit typeIds that the rigid layer owns (robots, rigidUnitLayer.ts) are skipped here: setSkip().
// Attachments (weapon, tool, gear, armor; attachmentSockets.ts) are extra instanced meshes of a rig, skinned to one bone
// of the body and drawn with the same bone texture and per-instance pose and anim as the body: one draw per attachment
// asset (both LODs in one mesh, the instance says which: attachmentGeometry.ts mergeAttachmentLods), whatever the
// number of units that carry it. addAttachment registers one, assignAttachments gives it to unit typeIds. The nearest
// ATTACHMENT_LODS unit LODs show them; the far LOD does not.

export {
  ATTACHMENT_LODS,
  UNIT_ATLAS_ANISOTROPY,
  BLOB_WITH_SHADOW,
  PLACEHOLDER_RIG,
} from './unitLayer.part1.js';
export type { UnitLayerOptions, UnitRigSource, AttachmentSource } from './unitLayer.part1.js';
export { UnitLayer, DEFAULT_LIGHT_DIR } from './unitLayer.part2.js';
