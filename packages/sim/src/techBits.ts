// The researched techs of a player as a bitset of TECH_WORDS uint32 words in PlayerState.tech (sim 0.31.0: MAX_TECHS
// 64, word p * TECH_WORDS + (techId >>> 5), bit techId & 31). Only shifts and masks, no `/` or `%`.
import { TECH_WORDS } from './config.js';

/** The bitset words of all players; PlayerState.tech. */
export interface TechBitsHolder {
  readonly tech: Uint32Array;
}

/** Whether player p has researched techId t. */
export function hasTech(ps: TechBitsHolder, p: number, t: number): boolean {
  return ((ps.tech[p * TECH_WORDS + (t >>> 5)]! >>> (t & 31)) & 1) !== 0;
}

/** Marks techId t as researched for player p. */
export function grantTech(ps: TechBitsHolder, p: number, t: number): void {
  const k = p * TECH_WORDS + (t >>> 5);
  ps.tech[k] = (ps.tech[k]! | (1 << (t & 31))) >>> 0;
}

/** Whether player p has researched any tech at all. */
export function anyTech(ps: TechBitsHolder, p: number): boolean {
  for (let k = 0; k < TECH_WORDS; k++) if (ps.tech[p * TECH_WORDS + k] !== 0) return true;
  return false;
}
