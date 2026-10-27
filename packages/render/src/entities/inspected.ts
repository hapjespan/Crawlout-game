// Render-only flag bit on InterpolatedFrame.flags (the protocol uses bits 0 to 3): an enemy the player inspects (the HUD
// selects it for its info panel) gets a red ring instead of the green own-selection ring.
export const INSPECTED_FLAG = 1 << 4;

/** Sets INSPECTED_FLAG on the entries of `ids` (frame.id, frame.flags, count entries); a no-op for an empty set. */
export function stampInspected(
  ids: Uint32Array,
  flags: Uint8Array,
  count: number,
  inspected: ReadonlySet<number>,
): void {
  if (inspected.size === 0) return;
  for (let i = 0; i < count; i++) if (inspected.has(ids[i]!)) flags[i] = flags[i]! | INSPECTED_FLAG;
}
