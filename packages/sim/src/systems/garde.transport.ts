import type { CommandPayload } from '@crawlout/protocol';
import { MAX_ABILITIES, MAX_CARGO } from '../config.limits.js';
import { C, NO_ENTITY, ORDER_CAST, SLAVE_NONE } from '../ecs/world.js';
import { applyStats } from '../effects.js';
import { createUnit } from '../entities.js';
import { BODY_HUMAN } from '../fromData.js';
import { isInt } from '../math/int.js';
import type { Census } from './census.js';
import { replaceOrder } from './commands.part1.js';
import type { SimContext } from './common.js';
import {
  cellCenterOf,
  inMap,
  nthFreeCellAround,
  steerChase,
  steerToPoint,
  stopMoving,
  withinReach,
} from './common.js';

// The Garde, round B (sim 0.33.0, protocol 0.18.0 Load and Unload, data 0.39.0; proposal for the architect;
// docs/garde.md item 5), transport (the Vertibird, loadouts transport):
//  - Load (ids, transportId): own human units (not the hero, not a slave) get ORDER_LOAD (ordT the transport); they walk
//    to it and board within loadRange while it has room (capacity). A passenger is no entity: its type, hp, veteran rank
//    and kills go into the cargo slots of the transport (GardeState), and it counts for the pop (census.ts).
//  - Unload (ids, x?, y?): own transports set down all passengers on the free cells around them (nthFreeCellAround of
//    their cell, in slot order); with x, y they fly there first (ORDER_UNLOAD) and unload on arrival. A passenger comes
//    back as a new entity (new id) with its hp and rank. What finds no free cell stays aboard.
//  - The cargo dies with its transport (cleanup.ts cargoLost).

/** Order types after the ability slots: a passenger boards ordT; a transport unloads at (ordX, ordY). */
export const ORDER_LOAD = ORDER_CAST + MAX_ABILITIES;
export const ORDER_UNLOAD = ORDER_LOAD + 1;

/** The transport type of unit t of player p (living, own), or null. */
function transportOf(ctx: SimContext, p: number, t: number) {
  const w = ctx.world;
  if (t < 0 || w.owner[t] !== p || !w.has(t, C.unit | C.health) || w.hp[t]! <= 0) return null;
  if ((w.mask[t]! & C.hero) !== 0) return null;
  return ctx.unitType(w.typeId[t]!)?.transport ?? null;
}

/** Whether unit i of player p may board a transport: own human, not the hero, not a slave. */
function boardable(ctx: SimContext, p: number, i: number): boolean {
  const w = ctx.world;
  if (i < 0 || w.owner[i] !== p || !w.has(i, C.unit | C.orders | C.health)) return false;
  if ((w.mask[i]! & C.hero) !== 0 || w.slaveState[i] !== SLAVE_NONE || w.hp[i]! <= 0) return false;
  return ctx.unitType(w.typeId[i]!)?.bodyType === BODY_HUMAN;
}

export function applyLoad(ctx: SimContext, p: number, pl: CommandPayload<'Load'>): boolean {
  if (!ctx.garde.active) return false;
  const w = ctx.world;
  const t = isInt(pl.transportId) ? w.resolve(pl.transportId) : -1;
  if (transportOf(ctx, p, t) === null) return false;
  let any = false;
  for (const id of pl.ids) {
    const i = isInt(id) ? w.resolve(id) : -1;
    if (i === t || !boardable(ctx, p, i)) continue;
    stopMoving(ctx, i);
    replaceOrder(ctx, i, ORDER_LOAD, 0, 0, w.idOf(t)); // refunds a paid retraining, like every other order
    any = true;
  }
  return any;
}

export function applyUnload(ctx: SimContext, p: number, pl: CommandPayload<'Unload'>): boolean {
  if (!ctx.garde.active) return false;
  const w = ctx.world;
  const go = pl.x !== undefined && pl.y !== undefined && inMap(ctx.map, pl.x, pl.y);
  let any = false;
  for (const id of pl.ids) {
    const t = isInt(id) ? w.resolve(id) : -1;
    if (transportOf(ctx, p, t) === null || !w.has(t, C.orders)) continue;
    any = true;
    if (!go) {
      unloadNow(ctx, t);
      continue;
    }
    ctx.defense.mark[t] = 0;
    w.clearOrders(t);
    w.target[t] = NO_ENTITY;
    w.pushOrder(t, ORDER_UNLOAD, pl.x!, pl.y!, 0);
    steerToPoint(ctx, t, pl.x!, pl.y!, ctx.config.arriveRadius, 0);
  }
  return any;
}

/** System 2, ORDER_LOAD of unit i (order slot o): to the transport, and aboard within loadRange. */
export function loadOrder(ctx: SimContext, i: number, o: number): void {
  const w = ctx.world;
  const p = w.owner[i]!;
  const t = w.resolve(w.ordT[o]!);
  const tr = transportOf(ctx, p, t);
  if (tr === null || ctx.garde.cargoN[t]! >= tr.capacity || !boardable(ctx, p, i)) {
    stopMoving(ctx, i);
    w.popOrder(i);
    return;
  }
  if (!withinReach(w, i, t, tr.loadRange)) {
    steerChase(ctx, i, w.x[t]!, w.y[t]!);
    return;
  }
  const g = ctx.garde;
  const k = t * MAX_CARGO + g.cargoN[t]!;
  g.cargoType[k] = w.typeId[i]!;
  g.cargoHp[k] = w.hp[i]! < 0xffff ? w.hp[i]! : 0xffff;
  g.cargoRank[k] = g.rank[i]!;
  g.cargoKills[k] = g.kills[i]!;
  g.cargoN[t] = g.cargoN[t]! + 1;
  stopMoving(ctx, i);
  w.clearOrders(i);
  w.free(i);
}

/** System 2, ORDER_UNLOAD of transport t: unload once it has arrived. */
export function unloadOrder(ctx: SimContext, t: number): void {
  const w = ctx.world;
  w.target[t] = NO_ENTITY;
  if (w.mvOn[t] === 1) return;
  unloadNow(ctx, t);
  w.popOrder(t);
}

/** Sets the passengers of transport t down on the free cells around its cell, in slot order. */
export function unloadNow(ctx: SimContext, t: number): void {
  const g = ctx.garde;
  const w = ctx.world;
  const n = g.cargoN[t]!;
  const base = t * MAX_CARGO;
  let out = 0;
  for (; out < n; out++) {
    const ty = ctx.unitType(g.cargoType[base + out]!);
    const c = nthFreeCellAround(ctx, w.x[t]! >> 8, w.y[t]! >> 8, 1, 1, out);
    if (ty === undefined || c < 0) break;
    const at = cellCenterOf(ctx.map, c);
    const i = createUnit(ctx, ty, w.owner[t]!, at.x, at.y, w.yaw[t]!);
    if (i < 0) break;
    g.rank[i] = g.cargoRank[base + out]!;
    g.kills[i] = g.cargoKills[base + out]!;
    applyStats(ctx, i, false);
    const hp = g.cargoHp[base + out]!;
    w.hp[i] = hp < w.maxHp[i]! ? hp : w.maxHp[i]!;
  }
  // the rest moves down to slot 0
  for (let k = out; k < n; k++) {
    g.cargoType[base + k - out] = g.cargoType[base + k]!;
    g.cargoHp[base + k - out] = g.cargoHp[base + k]!;
    g.cargoRank[base + k - out] = g.cargoRank[base + k]!;
    g.cargoKills[base + k - out] = g.cargoKills[base + k]!;
  }
  clearSlots(ctx, t, n - out);
  g.cargoN[t] = n - out;
}

function clearSlots(ctx: SimContext, t: number, from: number): void {
  const g = ctx.garde;
  for (let k = t * MAX_CARGO + from; k < (t + 1) * MAX_CARGO; k++) {
    g.cargoType[k] = 0;
    g.cargoHp[k] = 0;
    g.cargoRank[k] = 0;
    g.cargoKills[k] = 0;
  }
}

/** System 8: transport t died, and its cargo with it. */
export function cargoLost(ctx: SimContext, t: number): void {
  if (!ctx.garde.active || ctx.garde.cargoN[t] === 0) return;
  clearSlots(ctx, t, 0);
  ctx.garde.cargoN[t] = 0;
}

/** Census: the passengers of transport i of player o count as settlers and for the pop. */
export function cargoCensus(ctx: SimContext, c: Census, i: number, o: number): void {
  const g = ctx.garde;
  const n = g.cargoN[i]!;
  for (let k = 0; k < n; k++) {
    const cost = ctx.unitType(g.cargoType[i * MAX_CARGO + k]!)?.popCost ?? 0;
    c.settlers[o] = c.settlers[o]! + 1;
    c.pop[o] = c.pop[o]! + cost;
  }
}
