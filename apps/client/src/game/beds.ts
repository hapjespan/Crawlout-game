// The "no free beds" hint (playtest M5): when the population stands at a cap that the beds set (not popCapMax), nothing
// grows or comes out of a tent until the player builds more beds, and the top bar's "pop 8/8" alone did not say so.
import { PROVIDES, type GameData } from '@crawlout/data';
import type { PlayerStatus } from '@crawlout/protocol';
import { buildingName } from './cards.js';

/** At least this long between two bed hints, and while the cap holds it comes back after BEDS_REPEAT_MS. */
export const BEDS_ALERT_COOLDOWN_MS = 20000;
export const BEDS_REPEAT_MS = 90000;

/**
 * Whether the population is capped by beds: pop has reached popCap and popCap is below the hard cap that is left after
 * the no-bed pop (popCapMax - noBedPop). The sim's popCap is min(beds (+ slaves, Raiders), popCapMax - noBedPop - what is in
 * production), so below the hard cap the beds are what binds (an item in production can make this a false positive
 * for the few seconds it runs; harmless for a hint).
 */
export function cappedByBeds(data: GameData, s: PlayerStatus): boolean {
  return s.pop >= s.popCap && s.popCap < data.sim.popCapMax - s.noBedPop;
}

/**
 * The cheapest bed building of the faction that is not its headquarters (Dwellers: the woning, Raiders: the tent), in
 * Dutch, lower case; undefined if it has none.
 */
export function bedBuildingName(data: GameData, factionId: number | undefined): string | undefined {
  const hq = PROVIDES.indexOf('hq');
  const b = data.buildings
    .filter((x) => x.factionId === factionId && x.beds > 0 && !x.provides.includes(hq))
    .sort((a, c) => a.scrapCost - c.scrapCost || a.id - c.id)[0];
  return b ? buildingName(b.key).toLowerCase() : undefined;
}

/** The text of the hint: "Geen vrije bedden: bouw een woning" (Dwellers) or "…: bouw een tent" (Raiders). */
export function bedHintText(data: GameData, factionId: number | undefined): string {
  const name = bedBuildingName(data, factionId);
  return name ? `Geen vrije bedden: bouw een ${name}` : 'Geen vrije bedden';
}

/**
 * Throttle of the hint: true when it should show now. The first time the cap holds it shows at once (after at least
 * BEDS_ALERT_COOLDOWN_MS since the last one), and while it keeps holding every BEDS_REPEAT_MS.
 */
export class BedHintThrottle {
  private last = -Infinity;
  private holding = false;

  check(capped: boolean, now: number): boolean {
    if (!capped) {
      this.holding = false;
      return false;
    }
    const wait = this.holding ? BEDS_REPEAT_MS : BEDS_ALERT_COOLDOWN_MS;
    this.holding = true;
    if (now - this.last < wait) return false;
    this.last = now;
    return true;
  }
}
