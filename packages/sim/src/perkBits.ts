// The chosen perks of a player's hero as a bitset of PERK_WORDS uint32 words in PlayerState.heroPerks (sim 0.33.0:
// MAX_PERKS 64). Word w of player p is at w * MAX_PLAYERS + p, so word 0 keeps the layout of the old uint32 per player.
// Only shifts and masks, no `/` or `%`.
import { MAX_PLAYERS } from '@crawlout/protocol';
import { PERK_WORDS } from './config.limits.js';

/** The bitset words of all players; PlayerState.heroPerks. */
export interface PerkBitsHolder {
  readonly heroPerks: Uint32Array;
}

/** Whether the hero of player p has perk k. */
export function hasPerk(ps: PerkBitsHolder, p: number, k: number): boolean {
  return ((ps.heroPerks[(k >>> 5) * MAX_PLAYERS + p]! >>> (k & 31)) & 1) !== 0;
}

/** Marks perk k as chosen for the hero of player p. */
export function grantPerk(ps: PerkBitsHolder, p: number, k: number): void {
  const i = (k >>> 5) * MAX_PLAYERS + p;
  ps.heroPerks[i] = (ps.heroPerks[i]! | (1 << (k & 31))) >>> 0;
}

/** Whether the hero of player p has any perk at all. */
export function anyPerk(ps: PerkBitsHolder, p: number): boolean {
  for (let w = 0; w < PERK_WORDS; w++) if (ps.heroPerks[w * MAX_PLAYERS + p] !== 0) return true;
  return false;
}
