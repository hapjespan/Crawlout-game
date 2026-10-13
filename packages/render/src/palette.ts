// Visual-only colors. The sim never sees them.
import { MAX_PLAYERS } from '@crawlout/protocol';
import { Color, Vector3 } from 'three/webgpu';

/** Team colors per owner (sRGB), one per player slot. */
export const TEAM_COLORS: readonly number[] = [0x2f7fe0, 0xd8402f, 0x3fae4a, 0xe0b52a, 0x9b4fd0, 0x2fc2c2, 0xe07a2a, 0xd0d0d0];
/** Owners at or above MAX_PLAYERS (unowned scrap nodes, neutral claim points) use this slot. */
export const NEUTRAL_COLOR = 0x9a948a;
/** Palette slot for neutral owners. */
export const NEUTRAL_TEAM = MAX_PLAYERS;

/** Palette slot for an owner: players keep their own slot, everything at or above MAX_PLAYERS clamps to neutral. */
export function teamIndex(owner: number): number {
  return owner < NEUTRAL_TEAM ? owner : NEUTRAL_TEAM;
}

/** Team palette in the linear working space: MAX_PLAYERS team colors, then neutral. Index with teamIndex(). */
export function teamPalette(): Vector3[] {
  const c = new Color();
  const out: Vector3[] = [];
  for (let i = 0; i < MAX_PLAYERS; i++) {
    c.setHex(TEAM_COLORS[i] ?? NEUTRAL_COLOR);
    out.push(new Vector3(c.r, c.g, c.b));
  }
  c.setHex(NEUTRAL_COLOR);
  out.push(new Vector3(c.r, c.g, c.b));
  return out;
}
