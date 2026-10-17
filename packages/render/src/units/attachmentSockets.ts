// Where a loadout's attachments (weapon, tool, back gear, head gear, armor) sit on the animated skeleton. Pure data and
// matrices, no GPU: unit tests cover the slot table and the transforms (attachmentSockets.test.ts).
//
// An attachment is a static prop GLB (asset-cli kind 'prop', conventions in tools/asset-cli/README.md, Raiders chapter)
// with an anchor that says where its origin lies. It is skinned to ONE bone of the body: its vertices are moved once,
// at load, into the body's bind space (the rest pose the baked bone matrices are relative to), and skinned with weight 1
// on that bone. The vertex shader then needs nothing new: the skin matrix of the bone, sampled from the same baked
// texture and blended between the same two frames as the body, carries the attachment along (attachmentGeometry.ts).
//
//   anchor  slot                 bone        origin and axes (bind space)
//   grip    weapon, tool         RightHand   at the hand socket, turned by GRIP_ROTATION (see below); barrel or head +Z
//   back    gear_back            Spine2      at the back socket, no rotation
//   head    gear_head            Head        at the head socket, no rotation
//   body    armor                Spine2      no offset: the model is authored in the body's space
import { Matrix4, Quaternion, Vector3 } from 'three/webgpu';

export const ATTACHMENT_SLOTS = ['weapon', 'tool', 'gear_back', 'gear_head', 'armor'] as const;
export type AttachmentSlot = (typeof ATTACHMENT_SLOTS)[number];

export type AttachmentAnchor = 'grip' | 'back' | 'head' | 'body';

/** The socket names of a manifest entry (AssetSockets): rest-pose positions in model space. */
export interface BodySockets {
  hand?: readonly number[] | undefined;
  back?: readonly number[] | undefined;
  head?: readonly number[] | undefined;
}

export interface SlotSpec {
  anchor: AttachmentAnchor;
  /** Mixamo name of the bone the attachment is skinned to (the asset-cli conforms every character to these names). */
  bone: string;
  /** The manifest socket that holds the anchor's origin; null: the body space itself. */
  socket: keyof BodySockets | null;
}

export const SLOT_SPECS: Readonly<Record<AttachmentSlot, SlotSpec>> = {
  weapon: { anchor: 'grip', bone: 'RightHand', socket: 'hand' },
  tool: { anchor: 'grip', bone: 'RightHand', socket: 'hand' },
  gear_back: { anchor: 'back', bone: 'Spine2', socket: 'back' },
  gear_head: { anchor: 'head', bone: 'Head', socket: 'head' },
  armor: { anchor: 'body', bone: 'Spine2', socket: null },
};

/**
 * Turn that brings a grip-anchored prop (barrel or head toward +Z, top +Y) from the rest pose into the hand's frame.
 * The hand bone points along -x in the T-pose; in the animations the arm hangs at the side, so the bone's own axes
 * are far from the world's. This is the inverse of the mean skin rotation of RightHand over the `idle` clip of the
 * Quaternius rig (xyzw), so that a prop at rest in the hand stands upright and points forward in idle, and swings with
 * the arm in walk, run and attack. attachmentSockets.test.ts re-derives it from the baked texture of assets/dist.
 */
export const GRIP_ROTATION: readonly [number, number, number, number] = [
  0.18, -0.197, -0.624, 0.734,
];

/**
 * Where the fist closes, relative to the hand socket in the hand's rest axes (m): the socket is the wrist bone, the
 * grip is a hand's width further along the hand (-x in the T-pose, toward the fingertips).
 */
export const GRIP_OFFSET: readonly [number, number, number] = [-0.05, 0, 0];

/** The attachment slots a loadout's `visuals.meshSlots` fills (the body slot is the body, not an attachment), in table order. */
export function attachmentsOfLoadout(
  meshSlots: Readonly<Record<string, string>>,
): { slot: AttachmentSlot; assetId: string }[] {
  const out: { slot: AttachmentSlot; assetId: string }[] = [];
  for (const slot of ATTACHMENT_SLOTS) {
    const assetId = meshSlots[slot];
    if (assetId) out.push({ slot, assetId });
  }
  return out;
}

/**
 * The matrix that carries a prop from its own space into the body's bind space for a slot, or null when the body lacks
 * the socket the slot needs (no hand socket: no weapon; the attachment is then skipped, not misplaced).
 */
export function attachmentMatrix(
  slot: AttachmentSlot,
  sockets: BodySockets,
  out: Matrix4 = new Matrix4(),
): Matrix4 | null {
  const spec = SLOT_SPECS[slot];
  if (spec.socket === null) return out.identity();
  const p = sockets[spec.socket];
  if (!p || p.length < 3) return null;
  const at = new Vector3(p[0], p[1], p[2]);
  if (spec.anchor === 'grip') {
    const turn = new Quaternion(...GRIP_ROTATION);
    // The grip offset is along the hand's rest axes, not the prop's: it moves the origin, the turn does not.
    at.add(new Vector3(...GRIP_OFFSET));
    return out.compose(at, turn, new Vector3(1, 1, 1));
  }
  return out.makeTranslation(at.x, at.y, at.z);
}

/** Index of a bone in the baked order, or -1. */
export function boneIndexOf(boneNames: readonly string[], bone: string): number {
  return boneNames.indexOf(bone);
}
