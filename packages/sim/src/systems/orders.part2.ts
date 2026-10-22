// Split from orders.ts to stay under the 5,000-token file limit; orders.ts re-exports the public surface.
// Holds: idle, craftSiteMask, craft, ordersSystem.
import {
  type SimContext,
  canBuild,
  stopMoving,
  nearestReachableBuilding,
  withinReach,
  steerToEntity,
} from './common.js';
import {
  C,
  NO_ENTITY,
  PHASE_GO,
  PHASE_WORK,
  SLAVE_CAPTIVE,
  SLAVE_FREED,
  ORDER_NONE,
  ORDER_MOVE,
  ORDER_ATTACK_MOVE,
  ORDER_ATTACK,
  ORDER_GATHER,
  ORDER_BUILD,
  ORDER_CRAFT,
  ORDER_GUARD,
  ORDER_CAST,
} from '../ecs/world.js';
import { ROLES } from '@crawlout/data';
import { ORDER_LOAD, ORDER_UNLOAD, loadOrder, unloadOrder } from './garde.transport.js';

const ROLE_TECHNICIAN = ROLES.indexOf('technician');
import { repairIdle } from './robots.js';
import { PROVIDES_KOOI, PROVIDES_WORKSHOP } from '../fromData.js';
import { resolvePendingSlots } from './formation.js';
import { boundOrders } from './slaves.js';
import { MAX_ABILITIES } from '../config.js';
import { castOrder } from './hero.js';
import {
  OrdersScratch,
  ROLE_MILITIA,
  ROLE_ROBOT,
  attack,
  attackMove,
  autoEngage,
  build,
  builderIdle,
  collectTargets,
  gather,
  guard,
} from './orders.part1.js';

function idle(ctx: SimContext, s: OrdersScratch, i: number): void {
  const w = ctx.world;
  if ((w.role[i] === ROLE_MILITIA || w.role[i] === ROLE_ROBOT) && autoEngage(ctx, s, i)) return;
  // sim 0.33.0: a technician with repair (the Klerk) repairs like a support robot
  if ((w.role[i] === ROLE_ROBOT || w.role[i] === ROLE_TECHNICIAN) && (w.mask[i]! & C.hero) === 0) {
    const rep = ctx.unitType(w.typeId[i]!)?.repair;
    if (rep !== undefined && rep !== null && repairIdle(ctx, i, rep)) return;
  }
  w.target[i] = NO_ENTITY;
  // role builder, or a robot with canBuild (data 0.26.0, the bouwrobot): help at a site, resume a site
  if (canBuild(ctx, i)) {
    if (builderIdle(ctx, s, i)) return;
  } else w.resumeSite[i] = NO_ENTITY; // geen bouwer (meer): niets te onthouden
  if (w.mvOn[i] === 1) stopMoving(ctx, i); // zonder order loopt een unit alleen achter een doel aan
}

/** Where unit i retrains (SetRole, Craft) to type `typeId`: a cage for a slave loadout (data 0.21.0), else a workshop. */
export function craftSiteMask(ctx: SimContext, typeId: number): number {
  return ctx.unitType(typeId)?.slave === true ? PROVIDES_KOOI : PROVIDES_WORKSHOP;
}

function craft(ctx: SimContext, i: number): void {
  const w = ctx.world;
  if (w.phase[i] !== PHASE_GO) return; // betalen en omscholen in systeem 6
  const mask = craftSiteMask(ctx, w.ordX[w.currentOrder(i)]!);
  const ws = nearestReachableBuilding(ctx, w.owner[i]!, w.x[i]!, w.y[i]!, mask);
  if (ws < 0) {
    if (w.mvOn[i] === 1) stopMoving(ctx, i); // geen bereikbare werkplaats: wachten
    return;
  }
  if (withinReach(w, i, ws, ctx.config.interactRange)) {
    stopMoving(ctx, i);
    w.phase[i] = PHASE_WORK;
    w.work[i] = 0;
  } else {
    steerToEntity(ctx, i, ws);
  }
}

export function ordersSystem(ctx: SimContext, s: OrdersScratch): void {
  const w = ctx.world;
  resolvePendingSlots(ctx);
  collectTargets(ctx, s);
  const need = C.unit | C.orders;
  for (let i = 0; i < w.highWater; i++) {
    if (!w.has(i, need)) continue;
    // a captive or a freed unit (data 0.21.0) follows the slave rules, not orders (systems/slaves.ts)
    const st = w.slaveState[i]!;
    if (st === SLAVE_CAPTIVE || st === SLAVE_FREED) {
      boundOrders(ctx, i);
      continue;
    }
    const o = w.currentOrder(i);
    const type = o < 0 ? ORDER_NONE : w.ordType[o]!;
    switch (type) {
      case ORDER_NONE:
        idle(ctx, s, i);
        break;
      case ORDER_MOVE:
        w.target[i] = NO_ENTITY;
        if (w.mvOn[i] === 0) w.popOrder(i);
        break;
      case ORDER_ATTACK_MOVE:
        attackMove(ctx, s, i, o);
        break;
      case ORDER_ATTACK:
        attack(ctx, i, o);
        break;
      case ORDER_GATHER:
        w.target[i] = NO_ENTITY;
        gather(ctx, i, o);
        break;
      case ORDER_BUILD:
        w.target[i] = NO_ENTITY;
        build(ctx, i, o);
        break;
      case ORDER_CRAFT:
        w.target[i] = NO_ENTITY;
        craft(ctx, i);
        break;
      case ORDER_GUARD:
        guard(ctx, s, i, o);
        break;
      case ORDER_LOAD:
        w.target[i] = NO_ENTITY;
        loadOrder(ctx, i, o); // sim 0.33.0: board a transport
        break;
      case ORDER_UNLOAD:
        unloadOrder(ctx, i);
        break;
      default:
        if (type >= ORDER_CAST && type < ORDER_CAST + MAX_ABILITIES) castOrder(ctx, i, o);
        else w.popOrder(i);
    }
  }
}
