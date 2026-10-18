import { UNITS_PER_METER } from '@crawlout/protocol';
import { isInt } from './math/int.js';
import type { SimMap, SimPoint } from './config.types.js';

/**
 * Geometrie: maximale mapzijde in cellen; houdt celindices en coordinaten ruim binnen int32. Nagerekend voor de grote
 * map (sim-xl): bij 1024 is een coordinaat hoogstens 1024 * 256 = 262.144 (de grote map van 384: 98.304), een celindex
 * hoogstens 2^20, een kwadraat van een afstand hoogstens 2 * 262.144^2 (ongeveer 1,4e11, ruim onder 2^53 voor isqrt en
 * de vergelijkingen), en past de lokale regio-index van de padvinding (hoogstens S*S/2) in een Uint16.
 */
export const MAX_MAP_CELLS_SIDE = 1024;
/** Geometrie: bovengrens snelheid, kleiner dan een cel, zodat een unit nooit door een muur van 1 cel tunnelt. */
export const MAX_SPEED = UNITS_PER_METER >> 1;
/** Geometrie: bovengrens unitstraal; de separatie-grid gaat uit van buckets van 2 m. */
export const MAX_RADIUS = UNITS_PER_METER;
/** Geometrie: grootste footprint-zijde in cellen (past in Uint8 en in de ringzoeker rond gebouwen). */
export const MAX_FOOTPRINT = 32;
/** Largest sight radius (fog of war): 64 m, so a stamp stays small and a radius in vision cells fits a byte. */
export const MAX_SIGHT = 64 << 8;
/** Geometrie van de state: onderzochte techs staan per speler in een uint32-bitset. */
export const MAX_TECHS = 32;
/** Geometrie van de state: gekozen perks staan per held in een uint32-bitset. */
export const MAX_PERKS = 32;
/** Geometrie van de state: abilities per held (cooldown en zone per slot). */
export const MAX_ABILITIES = 4;
/** SPECIAL heeft zeven letters. */
export const SPECIAL_COUNT = 7;
/** Aantal effect-stats (EffectStat in packages/data): hpPct .. researchTimePct, de zeven SPECIAL-letters en researchCostPct. */
export const EFFECT_STAT_COUNT = 15;
/** Geometrie van de state: getrainde punten per letter staan in een uint8 per speler en letter. */
export const MAX_TRAINED_POINTS = 255;
/** Grens voor bouw- en onderzoekstijd in ticks: voortgang telt in duizendsten van een tick (PROGRESS_ONE) in een int32. */
export const MAX_WORK_TICKS = 2_000_000;
/** Creep camps per map and bandits per camp (data 0.25.0): bounds of CreepCamps and the camp bookkeeping. */
export const MAX_CREEP_CAMPS = 16;
export const MAX_CREEPS_PER_CAMP = 16;
/** Win route C: parts of the strip mall per map (the bound of ProjectState) and kinds of part. */
export const MAX_PROJECT_SITES = 16;
export const MAX_PROJECT_KINDS = 8;
export const U16 = 0xffff;
export const I31 = 0x7fffffff;

export function req(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`SimInit ongeldig: ${msg}`);
}

export const intIn = (v: unknown, lo: number, hi: number): boolean =>
  isInt(v) && v >= lo && v <= hi;

export function checkPoint(map: SimMap, p: SimPoint, what: string): void {
  req(
    intIn(p.x, 0, (map.w << 8) - 1) && intIn(p.y, 0, (map.h << 8) - 1),
    `${what} (${p.x},${p.y}) ligt buiten de map`,
  );
}
