import { MAX_PLAYERS } from '@crawlout/protocol';
import { BSTATE_DONE, C, JOB_PRODUCE } from '../ecs/world.js';
import { PROVIDES_HQ } from '../fromData.js';
import type { SimContext } from './common.js';

/**
 * Telling per speler: units, pop, bedden en hoofdgebouwen. Afgeleid, elke keer opnieuw berekend.
 * Pop (data 0.15.0): bewoners (units die geen robot zijn, zonder de held) tellen voor de bedden; robots (een type met
 * producedAtTypeId) tellen niet voor de bedden, maar bewoners plus robots plus de robots in productie blijven binnen
 * popCapMax.
 */
export class Census {
  /** Levende bewoners (geen held, geen robots). */
  readonly settlers = new Int32Array(MAX_PLAYERS);
  /** Pop van de bewoners. */
  readonly pop = new Int32Array(MAX_PLAYERS);
  /** Levende robots en hun pop. */
  readonly robots = new Int32Array(MAX_PLAYERS);
  readonly robotPop = new Int32Array(MAX_PLAYERS);
  /** Pop van de robots in productie (betaald, nog niet af): gereserveerd binnen popCapMax. */
  readonly reservedPop = new Int32Array(MAX_PLAYERS);
  readonly beds = new Int32Array(MAX_PLAYERS);
  /** Hoofdgebouwen (af of in aanbouw). */
  readonly hqCount = new Int32Array(MAX_PLAYERS);
  /** Index van het eerste voltooide hoofdgebouw, of -1. */
  readonly hq = new Int32Array(MAX_PLAYERS);

  /** Ruimte voor de pop van bewoners: de bedden, en popCapMax min de pop van de robots (ook in productie). */
  popCap(ctx: SimContext, p: number): number {
    const b = this.beds[p]!;
    const max = ctx.config.popCapMax - this.robotPop[p]! - this.reservedPop[p]!;
    return b < max ? b : max;
  }

  /** Totale pop: bewoners, robots en robots in productie (binnen popCapMax). */
  totalPop(p: number): number {
    return this.pop[p]! + this.robotPop[p]! + this.reservedPop[p]!;
  }
}

/** Of unit i een robot is (zijn type wordt nieuw gebouwd, data 0.15.0). De held is nooit een robot. */
export function isRobot(ctx: SimContext, i: number): boolean {
  const t = ctx.unitType(ctx.world.typeId[i]!);
  return t !== undefined && t.producedAtTypeId !== 0;
}

export function takeCensus(ctx: SimContext, c: Census): void {
  const w = ctx.world;
  c.settlers.fill(0);
  c.pop.fill(0);
  c.robots.fill(0);
  c.robotPop.fill(0);
  c.reservedPop.fill(0);
  c.beds.fill(0);
  c.hqCount.fill(0);
  c.hq.fill(-1);
  for (let i = 0; i < w.highWater; i++) {
    if (w.alive[i] !== 1) continue;
    const o = w.owner[i]!;
    if (o >= MAX_PLAYERS) continue;
    const m = w.mask[i]!;
    if ((m & (C.unit | C.health | C.hero)) === (C.unit | C.health)) {
      // de held is geen bewoner: hij telt niet voor settlers en pop
      const t = ctx.unitType(w.typeId[i]!);
      const cost = t?.popCost ?? 0;
      if (t !== undefined && t.producedAtTypeId !== 0) {
        c.robots[o] = c.robots[o]! + 1;
        c.robotPop[o] = c.robotPop[o]! + cost;
      } else {
        c.settlers[o] = c.settlers[o]! + 1;
        c.pop[o] = c.pop[o]! + cost;
      }
    } else if ((m & C.building) !== 0) {
      const bt = ctx.buildingType(w.typeId[i]!);
      if (bt === undefined) continue;
      if ((bt.provides & PROVIDES_HQ) !== 0) {
        c.hqCount[o] = c.hqCount[o]! + 1;
        if (c.hq[o]! < 0 && w.bstate[i] === BSTATE_DONE) c.hq[o] = i;
      }
      if (w.bstate[i] === BSTATE_DONE) c.beds[o] = c.beds[o]! + bt.beds;
      if (w.jobKind[i] === JOB_PRODUCE && w.job[i] !== 0) {
        const t = ctx.unitType(w.job[i]!); // job = loadoutId + 1 = unitTypeId(loadoutId)
        c.reservedPop[o] = c.reservedPop[o]! + (t?.popCost ?? 0);
      }
    }
  }
}
