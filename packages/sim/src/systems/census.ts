import { MAX_PLAYERS } from '@crawlout/protocol';
import { BSTATE_DONE, C } from '../ecs/world.js';
import { PROVIDES_HQ } from '../fromData.js';
import type { SimContext } from './common.js';

/** Telling per speler: units, pop, bedden en hoofdgebouwen. Afgeleid, elke keer opnieuw berekend. */
export class Census {
  readonly settlers = new Int32Array(MAX_PLAYERS);
  readonly pop = new Int32Array(MAX_PLAYERS);
  readonly beds = new Int32Array(MAX_PLAYERS);
  /** Hoofdgebouwen (af of in aanbouw). */
  readonly hqCount = new Int32Array(MAX_PLAYERS);
  /** Index van het eerste voltooide hoofdgebouw, of -1. */
  readonly hq = new Int32Array(MAX_PLAYERS);

  popCap(ctx: SimContext, p: number): number {
    const b = this.beds[p]!;
    return b < ctx.config.popCapMax ? b : ctx.config.popCapMax;
  }
}

export function takeCensus(ctx: SimContext, c: Census): void {
  const w = ctx.world;
  c.settlers.fill(0);
  c.pop.fill(0);
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
      c.settlers[o] = c.settlers[o]! + 1;
      c.pop[o] = c.pop[o]! + (ctx.unitType(w.typeId[i]!)?.popCost ?? 0);
    } else if ((m & C.building) !== 0) {
      const bt = ctx.buildingType(w.typeId[i]!);
      if (bt === undefined) continue;
      if ((bt.provides & PROVIDES_HQ) !== 0) {
        c.hqCount[o] = c.hqCount[o]! + 1;
        if (c.hq[o]! < 0 && w.bstate[i] === BSTATE_DONE) c.hq[o] = i;
      }
      if (w.bstate[i] === BSTATE_DONE) c.beds[o] = c.beds[o]! + bt.beds;
    }
  }
}
