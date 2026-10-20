import { MAX_PLAYERS } from '@crawlout/protocol';
import { ROLES } from '@crawlout/data';
import {
  BSTATE_DONE,
  C,
  JOB_PRODUCE,
  SLAVE_CAPTIVE,
  SLAVE_NONE,
  SLAVE_SLAVE,
} from '../ecs/world.js';
import { BODY_ROBOT, PROVIDES_HQ } from '../fromData.js';
import type { SimContext } from './common.js';
import { cargoCensus } from './garde.transport.js';

const ROLE_MILITIA = ROLES.indexOf('militia');

/**
 * Telling per speler: units, pop, bedden en hoofdgebouwen. Afgeleid, elke keer opnieuw berekend.
 * Pop (data 0.16.0): bewoners (units die geen robot zijn, zonder de held) tellen voor de bedden; robots (bodyType
 * robot) tellen niet voor de bedden, maar bewoners plus robots plus de robots in productie blijven binnen popCapMax.
 * Raiders (sim 0.18.0): slaves and captives count as settlers and for popCapMax, but sleep in their cage, not in a bed
 * (slavePop); a fighter in production in a tent (Produce of a human loadout) reserves a bed (reservedBedPop).
 */
export class Census {
  /** Levende bewoners (geen held, geen robots); slaves and captives included. */
  readonly settlers = new Int32Array(MAX_PLAYERS);
  /** Pop van de bewoners. */
  readonly pop = new Int32Array(MAX_PLAYERS);
  /** Levende robots en hun pop. */
  readonly robots = new Int32Array(MAX_PLAYERS);
  readonly robotPop = new Int32Array(MAX_PLAYERS);
  /** Pop van alles in productie (betaald, nog niet af): gereserveerd binnen popCapMax. */
  readonly reservedPop = new Int32Array(MAX_PLAYERS);
  /** Pop in production that will need a bed (a human loadout from a tent; data 0.21.0). */
  readonly reservedBedPop = new Int32Array(MAX_PLAYERS);
  /** Pop of the slaves and captives: they need no bed (they live in the cage). */
  readonly slavePop = new Int32Array(MAX_PLAYERS);
  /**
   * Fighters (data 0.21.0, the Raider safety net and the garrison): living own units with role militia, without the
   * hero, slaves, captives and freed units.
   */
  readonly fighters = new Int32Array(MAX_PLAYERS);
  readonly beds = new Int32Array(MAX_PLAYERS);
  /** Hoofdgebouwen (af of in aanbouw). */
  readonly hqCount = new Int32Array(MAX_PLAYERS);
  /** Index van het eerste voltooide hoofdgebouw, of -1. */
  readonly hq = new Int32Array(MAX_PLAYERS);

  /**
   * Ruimte voor de pop van bewoners: de bedden (plus the slaves, who need none, minus the beds reserved by a tent), en
   * popCapMax min de pop van de robots en van alles in productie.
   */
  popCap(ctx: SimContext, p: number): number {
    const b = this.beds[p]! + this.slavePop[p]! - this.reservedBedPop[p]!;
    const max = ctx.config.popCapMax - this.robotPop[p]! - this.reservedPop[p]!;
    return b < max ? b : max;
  }

  /** Totale pop: bewoners, robots en alles in productie (binnen popCapMax). */
  totalPop(p: number): number {
    return this.pop[p]! + this.robotPop[p]! + this.reservedPop[p]!;
  }
}

/**
 * Of unit i een robot is (bodyType robot, data 0.16.0; sim 0.18.0: was "its type is produced", but a Raider fighter
 * is produced in a tent too). De held is nooit een robot.
 */
export function isRobot(ctx: SimContext, i: number): boolean {
  const t = ctx.unitType(ctx.world.typeId[i]!);
  return t !== undefined && t.bodyType === BODY_ROBOT;
}

export function takeCensus(ctx: SimContext, c: Census): void {
  const w = ctx.world;
  c.settlers.fill(0);
  c.pop.fill(0);
  c.robots.fill(0);
  c.robotPop.fill(0);
  c.reservedPop.fill(0);
  c.reservedBedPop.fill(0);
  c.slavePop.fill(0);
  c.fighters.fill(0);
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
      if (t !== undefined && t.bodyType === BODY_ROBOT) {
        c.robots[o] = c.robots[o]! + 1;
        c.robotPop[o] = c.robotPop[o]! + cost;
      } else {
        c.settlers[o] = c.settlers[o]! + 1;
        c.pop[o] = c.pop[o]! + cost;
        const st = w.slaveState[i]!;
        if (st === SLAVE_SLAVE || st === SLAVE_CAPTIVE) c.slavePop[o] = c.slavePop[o]! + cost;
        else if (st === SLAVE_NONE && w.role[i] === ROLE_MILITIA)
          c.fighters[o] = c.fighters[o]! + 1;
      }
      // sim 0.33.0: the passengers of a transport (systems/garde.transport.ts)
      if (ctx.garde.active && ctx.garde.cargoN[i] !== 0) cargoCensus(ctx, c, i, o);
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
        const cost = t?.popCost ?? 0;
        c.reservedPop[o] = c.reservedPop[o]! + cost;
        if (t !== undefined && t.bodyType !== BODY_ROBOT)
          c.reservedBedPop[o] = c.reservedBedPop[o]! + cost;
      }
    }
  }
}
