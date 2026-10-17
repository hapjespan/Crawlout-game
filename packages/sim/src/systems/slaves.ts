import { OWNER_NEUTRAL } from '@crawlout/protocol';
import type { SimCage, SimCapture, SimSlaveRules } from '../config.js';
import {
  BSTATE_DONE,
  C,
  CHEM_NONE,
  NO_ENTITY,
  ORDER_MOVE,
  SLAVE_CAPTIVE,
  SLAVE_FREED,
  SLAVE_NONE,
  SLAVE_SLAVE,
} from '../ecs/world.js';
import { applyStats, heroOf } from '../effects.js';
import { applyUnitType } from '../entities.js';
import { BODY_HUMAN, PROVIDES_CLAIM, PROVIDES_HQ, PROVIDES_KOOI } from '../fromData.js';
import { idiv } from '../math/int.js';
import { isqrt } from '../math/sqrt.js';
import type { SimContext } from './common.js';
import {
  distToRect2,
  face,
  inMap,
  nearestOwnBuilding,
  steerToEntity,
  steerToPoint,
  stopMoving,
  visibleTo,
  walkableAt,
  withinReach,
} from './common.js';
import { grantXp } from './hero.js';
import { autoGather } from './orders.js';

// Slaves of the Raiders (Spelfundament 6; data 0.21.0 factions slaves, loadouts slave and capture, buildings cage; sim
// 0.18.0). All numbers come from the data; the rules:
//
//  - Capture (system 5, combatSystem calls captureTick): a Slaver (loadouts capture) whose target is a human unit of
//    another player (not the hero, not a robot, not a slave) at or below capture.maxHpPermille of its hp, farther than
//    slaves.minDistanceFromOwnerBase from its owner's nearest headquarters (centre to centre) and visible to the
//    Slaver's owner, or a neutral wanderer (no hp condition), holds it within capture.range for captureTicks
//    uninterrupted instead of hitting it; the target stands still meanwhile (pinned, systems/hero.ts auraSystem). Then
//    the target changes owner and is a captive: it walks to the nearest own cage (provides kooi) with a free place
//    (capacity counts slaves and captives bound to it), stands there cage.transitionTicks and becomes a slave of
//    slaves.capturedTypeId bound to that cage. Without a free cage it waits where it is and is not a slave. The hero of
//    the Slaver's owner gets xpPerCapture.
//  - Slaves (loadouts slave, damage 0) never pick a target; they gather and build only within cage.workRadius of their
//    cage (centre of the cage to the node, or to the footprint of a site; a claim building is the exception: a slave
//    builder may walk out to put up a plunderpost, the Raiders' way to a claim point, data 0.21.0 vs the work radius;
//    voorstel, ter bevestiging door de architect). SetRole between the slave loadouts happens at a cage. A slave whose
//    cage is gone binds to the nearest own cage (with room if there is one).
//  - Slaves and captives are no target for shots (common.ts isEnemy): an enemy frees them by touch. Liberation: an
//    enemy unit of the owner (not neutral, not a slave) within liberation.touchRange for touchTicks uninterrupted, with
//    no own fighter (role militia, not a slave) or the owner's hero within guardRadius of the slave: the slave goes back
//    to the player it was taken from (to the liberator for a wanderer or when that player is out) as that faction's
//    settler type, and walks home to his nearest headquarters with freedSpeedPermille more speed. A faction with slaves
//    of its own (a Raider liberating) takes it as a captive instead.
//  - Revolt: per cage with slaves, the garrison is the own fighters (role militia, not the hero, not a slave) within
//    revolt.garrisonRadius of its footprint; needed max(minGuards, ceil(slaves / slavesPerGuard)). While the garrison is
//    short a counter runs; at graceTicks (emptyGraceTicks without any fighter) escapePermille of the slaves of that cage
//    (at least one, the lowest ids first) escape: they become neutral wanderers and walk away from the cage. While the
//    deficit lasts, the next round follows repeatTicks later.
// Wandering neutral settlers of the map (zwervers) do not exist yet: a wanderer is an escaped slave.

/** The slave rules of player p's faction, or null. */
export function slaveRulesOf(ctx: SimContext, p: number): SimSlaveRules | null {
  return p < ctx.playerCount ? ctx.config.factions[ctx.players[p]!.factionId]!.slaves : null;
}

/** The cage data of building b, or null. */
function cageType(ctx: SimContext, b: number): SimCage | null {
  return ctx.buildingType(ctx.world.typeId[b]!)?.cage ?? null;
}

/** Index of player p's completed cage with this id, or -1. */
export function cageIndex(ctx: SimContext, p: number, id: number): number {
  const w = ctx.world;
  if (id === NO_ENTITY) return -1;
  const b = w.resolve(id);
  if (
    b < 0 ||
    !w.has(b, C.building) ||
    w.owner[b] !== p ||
    w.bstate[b] !== BSTATE_DONE ||
    w.hp[b]! <= 0 ||
    cageType(ctx, b) === null
  )
    return -1;
  return b;
}

/** Slaves and captives of player p bound to the cage with this id. */
function cageLoad(ctx: SimContext, p: number, id: number): number {
  const w = ctx.world;
  let n = 0;
  for (let i = 0; i < w.highWater; i++) {
    if (w.alive[i] !== 1 || w.owner[i] !== p || w.slaveCage[i] !== id) continue;
    const st = w.slaveState[i]!;
    if ((st === SLAVE_SLAVE || st === SLAVE_CAPTIVE) && w.has(i, C.unit | C.health)) n++;
  }
  return n;
}

/**
 * The cage of player p nearest to (x, y) (centre distance, then lowest index) with a free place, or with
 * `anyRoom` the nearest at all; -1 without.
 */
export function freeCage(
  ctx: SimContext,
  p: number,
  x: number,
  y: number,
  anyRoom = false,
): number {
  const w = ctx.world;
  const idx = ctx.index;
  idx.refresh(w);
  let best = -1;
  let bestD = 0;
  for (let k = 0; k < idx.buildingCount; k++) {
    const b = idx.buildings[k]!;
    if (w.owner[b] !== p || w.bstate[b] !== BSTATE_DONE || w.hp[b]! <= 0) continue;
    const cage = cageType(ctx, b);
    if (cage === null) continue;
    const dx = w.x[b]! - x;
    const dy = w.y[b]! - y;
    const d = dx * dx + dy * dy;
    if (best >= 0 && d >= bestD) continue;
    if (!anyRoom && cageLoad(ctx, p, w.idOf(b)) >= cage.capacity) continue;
    best = b;
    bestD = d;
  }
  return best;
}

/** Where a unit may work: the centre of its cage and the work radius; r < 0 = nowhere (a slave without a cage). */
export interface WorkReach {
  readonly x: number;
  readonly y: number;
  readonly r: number;
}

const NOWHERE: WorkReach = { x: 0, y: 0, r: -1 };

/** The work reach of unit i: null for anything but a slave (it may work anywhere). */
export function workReach(ctx: SimContext, i: number): WorkReach | null {
  const w = ctx.world;
  if (w.slaveState[i] !== SLAVE_SLAVE) return null;
  const b = cageIndex(ctx, w.owner[i]!, w.slaveCage[i]!);
  if (b < 0) return NOWHERE;
  const cage = cageType(ctx, b)!;
  return { x: w.x[b]!, y: w.y[b]!, r: cage.workRadius };
}

/** Whether the point (x, y) lies within reach (null = no limit). */
export function reachesPoint(reach: WorkReach | null, x: number, y: number): boolean {
  if (reach === null) return true;
  if (reach.r < 0) return false;
  const dx = x - reach.x;
  const dy = y - reach.y;
  return dx * dx + dy * dy <= reach.r * reach.r;
}

/**
 * Whether unit i may build building (site) b: within the work reach of a slave builder, measured to the footprint;
 * a claim building (provides claim) anywhere (the Raiders' plunderpost, see above).
 */
export function mayBuild(ctx: SimContext, i: number, b: number): boolean {
  const w = ctx.world;
  const bt = ctx.buildingType(w.typeId[b]!);
  return mayBuildAt(ctx, i, bt?.provides ?? 0, w.fx[b]!, w.fy[b]!, w.fw[b]!, w.fh[b]!);
}

/** mayBuild for a footprint (fx, fy, fw, fh) of a building that provides `provides` (before the site exists). */
export function mayBuildAt(
  ctx: SimContext,
  i: number,
  provides: number,
  fx: number,
  fy: number,
  fw: number,
  fh: number,
): boolean {
  const reach = workReach(ctx, i);
  if (reach === null || (provides & PROVIDES_CLAIM) !== 0) return true;
  if (reach.r < 0) return false;
  return distToRect2(reach.x, reach.y, fx, fy, fw, fh) <= reach.r * reach.r;
}

/** Whether entity t is a slave or a captive (no target for shots, only freed by touch). */
export const isBound = (ctx: SimContext, t: number): boolean => {
  const st = ctx.world.slaveState[t]!;
  return st === SLAVE_SLAVE || st === SLAVE_CAPTIVE;
};

/** Whether unit i of a player could free t by touching it: t is a slave or captive of another player. */
export function liberatable(ctx: SimContext, i: number, t: number): boolean {
  const w = ctx.world;
  const o = w.owner[t]!;
  return (
    isBound(ctx, t) &&
    w.has(t, C.unit | C.health) &&
    o !== w.owner[i] &&
    o < ctx.playerCount &&
    visibleTo(w, t, w.owner[i]!)
  );
}

/** The capture data of unit i (a Slaver, not the hero), or null. */
export function captureOf(ctx: SimContext, i: number): SimCapture | null {
  const w = ctx.world;
  if ((w.mask[i]! & (C.hero | C.building)) !== 0) return null;
  return ctx.unitType(w.typeId[i]!)?.capture ?? null;
}

/** Whether a neutral wanderer t is a target for Slaver i (no hp condition; visible). */
export function wandererFor(ctx: SimContext, i: number, t: number): boolean {
  const cap = captureOf(ctx, i);
  const w = ctx.world;
  return (
    cap !== null &&
    cap.wanderers &&
    w.owner[t] === OWNER_NEUTRAL &&
    catchable(ctx, t) &&
    visibleTo(w, t, w.owner[i]!)
  );
}

/** A unit that can be caught at all: a living human, not a hero, not a corpse, not bound already. */
function catchable(ctx: SimContext, t: number): boolean {
  const w = ctx.world;
  if (!w.has(t, C.unit | C.health) || (w.mask[t]! & (C.hero | C.corpse)) !== 0 || w.hp[t]! <= 0)
    return false;
  // a bandit of a creep camp (sim 0.19.0) is no wanderer: it is fought, not caught
  if (w.creepCamp[t] !== 0) return false;
  const st = w.slaveState[t]!;
  if (st !== SLAVE_NONE && st !== SLAVE_FREED) return false;
  return ctx.unitType(w.typeId[t]!)?.bodyType === BODY_HUMAN;
}

/** Whether Slaver i (capture `cap`) can catch unit t now (all conditions but the distance). */
export function capturable(ctx: SimContext, i: number, t: number, cap: SimCapture): boolean {
  const w = ctx.world;
  const p = w.owner[i]!;
  const rules = slaveRulesOf(ctx, p);
  if (rules === null || !catchable(ctx, t)) return false;
  const o = w.owner[t]!;
  if (o === OWNER_NEUTRAL) return cap.wanderers && visibleTo(w, t, p);
  if (!cap.residents || o === p || o >= ctx.playerCount || !visibleTo(w, t, p)) return false;
  if (w.hp[t]! * 1000 > w.maxHp[t]! * cap.maxHpPermille) return false;
  // outside the base radius of its owner: farther than minDistanceFromOwnerBase from each of his headquarters
  const r = rules.minDistanceFromOwnerBase;
  const idx = ctx.index;
  idx.refresh(w);
  for (let k = 0; k < idx.buildingCount; k++) {
    const b = idx.buildings[k]!;
    if (w.owner[b] !== o) continue;
    const bt = ctx.buildingType(w.typeId[b]!);
    if (bt === undefined || (bt.provides & PROVIDES_HQ) === 0) continue;
    const dx = w.x[t]! - w.x[b]!;
    const dy = w.y[t]! - w.y[b]!;
    if (dx * dx + dy * dy <= r * r) return false;
  }
  return true;
}

/**
 * System 5, for every Slaver with a target (before the cooldown check): holds a capturable target within range one
 * tick longer and catches it after captureTicks. True when it is capturing (then it does not shoot this tick).
 */
export function captureTick(ctx: SimContext, i: number, cap: SimCapture): boolean {
  const w = ctx.world;
  const t = w.target[i] === NO_ENTITY ? -1 : w.resolve(w.target[i]!);
  if (t < 0 || !capturable(ctx, i, t, cap) || !withinReach(w, i, t, cap.range)) {
    w.capWork[i] = 0;
    return false;
  }
  w.capWork[i] = w.capWork[i]! + 1;
  if (w.capWork[i]! >= cap.captureTicks) {
    w.capWork[i] = 0;
    catchUnit(ctx, i, t);
  }
  return true;
}

/** Clears what unit t was doing (orders, walking, target, cargo, chem): it changes hands. */
function release(ctx: SimContext, t: number): void {
  const w = ctx.world;
  stopMoving(ctx, t);
  w.clearOrders(t);
  w.target[t] = NO_ENTITY;
  w.carry[t] = 0;
  w.resumeSite[t] = NO_ENTITY;
  w.buildHold[t] = 0;
  w.capWork[t] = 0;
  w.touchTicks[t] = 0;
  w.chem[t] = 0;
  w.chemPhase[t] = CHEM_NONE;
  w.chemTicks[t] = 0;
}

/** Slaver i catches unit t: t is a captive of i's owner on its way to a free cage. */
function catchUnit(ctx: SimContext, i: number, t: number): void {
  const w = ctx.world;
  const p = w.owner[i]!;
  const from = w.owner[t]!;
  release(ctx, t);
  w.owner[t] = p;
  w.slaveState[t] = SLAVE_CAPTIVE;
  w.slaveFrom[t] = from;
  w.slaveTicks[t] = 0;
  const cage = freeCage(ctx, p, w.x[t]!, w.y[t]!);
  w.slaveCage[t] = cage < 0 ? NO_ENTITY : w.idOf(cage);
  applyStats(ctx, t, false);
  w.target[i] = NO_ENTITY;
  const h = heroOf(ctx, p);
  if (h !== undefined) grantXp(ctx, p, h.xpPerCapture);
}

/**
 * System 2 (orders), for a captive or a freed unit instead of its orders: a captive walks to its cage (or a free one,
 * or waits), a freed unit walks to its owner's nearest headquarters and is an ordinary unit again once there.
 */
export function boundOrders(ctx: SimContext, i: number): void {
  const w = ctx.world;
  const p = w.owner[i]!;
  w.target[i] = NO_ENTITY;
  if (w.slaveState[i] === SLAVE_CAPTIVE) {
    let c = cageIndex(ctx, p, w.slaveCage[i]!);
    if (c < 0) {
      c = freeCage(ctx, p, w.x[i]!, w.y[i]!);
      w.slaveCage[i] = c < 0 ? NO_ENTITY : w.idOf(c);
      w.slaveTicks[i] = 0;
    }
    if (c < 0) {
      if (w.mvOn[i] === 1) stopMoving(ctx, i);
      return;
    }
    if (withinReach(w, i, c, ctx.config.interactRange)) {
      if (w.mvOn[i] === 1) stopMoving(ctx, i);
      face(w, i, w.x[c]!, w.y[c]!);
    } else steerToEntity(ctx, i, c);
    return;
  }
  // freed: home to the nearest own headquarters
  const hq = nearestOwnBuilding(ctx, p, w.x[i]!, w.y[i]!, PROVIDES_HQ);
  if (hq < 0 || withinReach(w, i, hq, ctx.config.interactRange)) {
    if (w.mvOn[i] === 1) stopMoving(ctx, i);
    w.slaveState[i] = SLAVE_NONE;
    w.slaveTicks[i] = 0;
    w.slaveFrom[i] = OWNER_NEUTRAL;
    autoGather(ctx, i);
    return;
  }
  steerToEntity(ctx, i, hq);
}

/** Whether unit j of player p is a fighter (role militia, not a slave, captive or freed unit, not the hero). */
export function isFighter(ctx: SimContext, j: number, roleMilitia: number): boolean {
  const w = ctx.world;
  return (
    w.has(j, C.unit | C.health) &&
    (w.mask[j]! & (C.hero | C.corpse)) === 0 &&
    w.hp[j]! > 0 &&
    w.role[j] === roleMilitia &&
    w.slaveState[j] === SLAVE_NONE
  );
}

/**
 * System 6: the captives' transition at the cage, slaves without a cage, liberation and revolt. Units in ascending
 * index; a freed or escaped unit changes owner at once, so a later unit of this tick sees the new owner.
 */
export function slaveSystem(ctx: SimContext, roleMilitia: number): void {
  const w = ctx.world;
  let any = false;
  for (let i = 0; i < w.highWater; i++) {
    if (w.alive[i] !== 1 || !w.has(i, C.unit | C.health)) continue;
    const st = w.slaveState[i]!;
    if (st !== SLAVE_CAPTIVE && st !== SLAVE_SLAVE) continue;
    any = true;
    const p = w.owner[i]!;
    const rules = slaveRulesOf(ctx, p);
    if (rules === null) {
      // the owner has no slave rules (cannot happen with the data; defensive): an ordinary unit
      w.slaveState[i] = SLAVE_NONE;
      continue;
    }
    if (st === SLAVE_CAPTIVE) transition(ctx, i, rules);
    else if (cageIndex(ctx, p, w.slaveCage[i]!) < 0) rebind(ctx, i);
    liberation(ctx, i, rules, roleMilitia);
  }
  if (any) revolts(ctx, roleMilitia);
}

/** Slave i lost its cage: the nearest own cage with room, else the nearest own cage at all (else none). */
function rebind(ctx: SimContext, i: number): void {
  const w = ctx.world;
  const p = w.owner[i]!;
  let c = freeCage(ctx, p, w.x[i]!, w.y[i]!);
  if (c < 0) c = freeCage(ctx, p, w.x[i]!, w.y[i]!, true);
  w.slaveCage[i] = c < 0 ? NO_ENTITY : w.idOf(c);
}

/** A captive at its cage: one tick of the transition; then a slave of the cage. */
function transition(ctx: SimContext, i: number, rules: SimSlaveRules): void {
  const w = ctx.world;
  const p = w.owner[i]!;
  const c = cageIndex(ctx, p, w.slaveCage[i]!);
  if (c < 0 || !withinReach(w, i, c, ctx.config.interactRange)) return;
  w.slaveTicks[i] = w.slaveTicks[i]! + 1;
  if (w.slaveTicks[i]! < cageType(ctx, c)!.transitionTicks) return;
  const t = ctx.unitType(rules.capturedTypeId);
  if (t === undefined) return;
  applyUnitType(ctx, i, t);
  w.slaveState[i] = SLAVE_SLAVE;
  w.slaveTicks[i] = 0;
  w.clearOrders(i);
  autoGather(ctx, i);
}

/** Liberation of slave or captive i (see the top of this file). */
function liberation(ctx: SimContext, i: number, rules: SimSlaveRules, roleMilitia: number): void {
  const w = ctx.world;
  const p = w.owner[i]!;
  const x = w.x[i]!;
  const y = w.y[i]!;
  const g = rules.guardRadius;
  const tr = rules.touchRange;
  const hero = ctx.ps.heroEnt[p]!;
  let liberator = -1;
  let guarded = false;
  const reach = (g > tr ? g : tr) + 512;
  for (let j = 0; j < w.highWater && !guarded; j++) {
    if (j === i || w.alive[j] !== 1 || !w.has(j, C.unit | C.health)) continue;
    const dx = w.x[j]! - x;
    const dy = w.y[j]! - y;
    if (dx > reach || -dx > reach || dy > reach || -dy > reach) continue;
    const o = w.owner[j]!;
    if (o === p) {
      if ((isFighter(ctx, j, roleMilitia) || w.idOf(j) === hero) && dx * dx + dy * dy <= g * g)
        guarded = true;
      continue;
    }
    if (
      liberator < 0 &&
      o < ctx.playerCount &&
      ctx.ps.defeated[o] === 0 &&
      (w.mask[j]! & C.corpse) === 0 &&
      w.hp[j]! > 0 &&
      !isBound(ctx, j) &&
      withinReach(w, j, i, tr)
    )
      liberator = j;
  }
  if (guarded || liberator < 0) {
    w.touchTicks[i] = 0;
    return;
  }
  w.touchTicks[i] = w.touchTicks[i]! + 1;
  if (w.touchTicks[i]! < rules.touchTicks) return;
  free(ctx, i, w.owner[liberator]!, rules);
}

/** Slave or captive i is free: back to the player it was taken from, else to `by` (the liberator's owner). */
function free(ctx: SimContext, i: number, by: number, rules: SimSlaveRules): void {
  const w = ctx.world;
  const from = w.slaveFrom[i]!;
  const home = from < ctx.playerCount && ctx.ps.defeated[from] === 0 ? from : by;
  release(ctx, i);
  w.owner[i] = home;
  w.slaveCage[i] = NO_ENTITY;
  if (slaveRulesOf(ctx, home) !== null) {
    // a Raider frees it: it is his captive now (on to his cage); where it came from stays as it was
    w.slaveState[i] = SLAVE_CAPTIVE;
    w.slaveTicks[i] = 0;
    const c = freeCage(ctx, home, w.x[i]!, w.y[i]!);
    w.slaveCage[i] = c < 0 ? NO_ENTITY : w.idOf(c);
    applyStats(ctx, i, false);
    return;
  }
  const f = ctx.config.factions[ctx.players[home]!.factionId]!;
  const t = f.settlerTypeId === 0 ? undefined : ctx.unitType(f.settlerTypeId);
  if (t !== undefined) applyUnitType(ctx, i, t);
  else applyStats(ctx, i, false);
  w.slaveState[i] = SLAVE_FREED;
  w.slaveFrom[i] = OWNER_NEUTRAL;
  w.slaveTicks[i] = rules.freedSpeedPermille;
}

/** Revolt at every cage with slaves (see the top of this file). */
function revolts(ctx: SimContext, roleMilitia: number): void {
  const w = ctx.world;
  const idx = ctx.index;
  idx.refresh(w);
  for (let k = 0; k < idx.buildingCount; k++) {
    const b = idx.buildings[k]!;
    if (w.alive[b] !== 1 || w.bstate[b] !== BSTATE_DONE || w.hp[b]! <= 0) continue;
    const bt = ctx.buildingType(w.typeId[b]!);
    if (bt === undefined || bt.cage === null || (bt.provides & PROVIDES_KOOI) === 0) continue;
    const p = w.owner[b]!;
    const rules = slaveRulesOf(ctx, p);
    if (rules === null) continue;
    const id = w.idOf(b);
    const gr = rules.garrisonRadius;
    let slaves = 0;
    let guards = 0;
    for (let j = 0; j < w.highWater; j++) {
      if (w.alive[j] !== 1 || w.owner[j] !== p) continue;
      if (w.slaveState[j] === SLAVE_SLAVE && w.slaveCage[j] === id && w.has(j, C.unit | C.health))
        slaves++;
      else if (
        isFighter(ctx, j, roleMilitia) &&
        distToRect2(w.x[j]!, w.y[j]!, w.fx[b]!, w.fy[b]!, w.fw[b]!, w.fh[b]!) <= gr * gr
      )
        guards++;
    }
    const need = Math.max(
      rules.minGuards,
      idiv(slaves + rules.slavesPerGuard - 1, rules.slavesPerGuard),
    );
    if (slaves === 0 || guards >= need) {
      w.revolt[b] = 0;
      continue;
    }
    w.revolt[b] = w.revolt[b]! + 1;
    const at = guards === 0 ? rules.emptyGraceTicks : rules.graceTicks;
    if (w.revolt[b]! < at) continue;
    let escape = idiv(slaves * rules.escapePermille, 1000);
    if (escape < 1) escape = 1;
    for (let j = 0; j < w.highWater && escape > 0; j++) {
      if (w.alive[j] !== 1 || w.owner[j] !== p || w.slaveState[j] !== SLAVE_SLAVE) continue;
      if (w.slaveCage[j] !== id || !w.has(j, C.unit | C.health)) continue;
      escapeFrom(ctx, j, b, gr);
      escape--;
    }
    // the next round repeatTicks later while the deficit lasts
    w.revolt[b] = at - rules.repeatTicks;
  }
}

/** Slave j escapes cage b: a neutral wanderer walking `dist` away from the cage. */
function escapeFrom(ctx: SimContext, j: number, b: number, dist: number): void {
  const w = ctx.world;
  release(ctx, j);
  w.owner[j] = OWNER_NEUTRAL;
  w.slaveState[j] = SLAVE_NONE;
  w.slaveCage[j] = NO_ENTITY;
  w.slaveFrom[j] = OWNER_NEUTRAL;
  w.slaveTicks[j] = 0;
  let dx = w.x[j]! - w.x[b]!;
  let dy = w.y[j]! - w.y[b]!;
  const len = isqrt(dx * dx + dy * dy);
  if (len === 0) {
    dx = 256;
    dy = 0;
  } else {
    dx = idiv(dx * dist, len);
    dy = idiv(dy * dist, len);
  }
  // halve the way until the point lies on walkable ground in the map
  for (let k = 0; k < 4; k++) {
    const x = w.x[j]! + dx;
    const y = w.y[j]! + dy;
    if (inMap(ctx.map, x, y) && walkableAt(ctx, x, y)) {
      w.pushOrder(j, ORDER_MOVE, x, y, 0);
      steerToPoint(ctx, j, x, y, ctx.config.arriveRadius, 0);
      return;
    }
    dx = idiv(dx, 2);
    dy = idiv(dy, 2);
  }
}

/**
 * Start setup: the start units of a faction with slave rules that are slave loadouts are slaves of the headquarters
 * (a cage itself: the Raiderkamp), from nobody.
 */
export function bindStartSlave(ctx: SimContext, i: number, hq: number): void {
  const w = ctx.world;
  if (ctx.unitType(w.typeId[i]!)?.slave !== true || slaveRulesOf(ctx, w.owner[i]!) === null) return;
  w.slaveState[i] = SLAVE_SLAVE;
  w.slaveFrom[i] = OWNER_NEUTRAL;
  const c = cageType(ctx, hq) !== null ? hq : freeCage(ctx, w.owner[i]!, w.x[i]!, w.y[i]!, true);
  w.slaveCage[i] = c < 0 ? NO_ENTITY : w.idOf(c);
}
