import { MAX_ENTITIES } from '@crawlout/protocol';
import { ROLES } from '@crawlout/data';
import {
  BSTATE_SITE,
  C,
  NO_ENTITY,
  ORDER_ATTACK,
  ORDER_ATTACK_MOVE,
  ORDER_BUILD,
  ORDER_CLAIM,
  ORDER_CRAFT,
  ORDER_GATHER,
  ORDER_MOVE,
  ORDER_NONE,
  PHASE_GO,
  PHASE_RETURN,
  PHASE_WORK,
} from '../ecs/world.js';
import { PROVIDES_HQ, PROVIDES_WORKSHOP } from '../fromData.js';
import { idiv } from '../math/int.js';
import type { SimContext } from './common.js';
import {
  dist2,
  distToRect2,
  face,
  isEnemy,
  nearestNode,
  nearestOwnBuilding,
  steerChase,
  steerToEntity,
  steerToPoint,
  stopMoving,
  withinReach,
} from './common.js';

// Systeem 2 (unit-deel): per unit de huidige order uitvoeren in oplopende id-volgorde. Bepaalt waar een unit naartoe
// loopt (steerTo, uitgevoerd door systeem 4) en welk doel hij heeft (gevecht in systeem 5). Het werk zelf
// (verzamelen, bouwen, omscholen) gebeurt in systeem 6; claimen in systeem 7.

export const ROLE_MILITIA = ROLES.indexOf('militia');

/** Depots voor scrap: hoofdgebouw en werkplaats. */
export const DEPOT_MASK = PROVIDES_HQ | PROVIDES_WORKSHOP;

export class OrdersScratch {
  /** Indices van alle entities met Health en een eigenaar (units en gebouwen), oplopend. */
  readonly targets = new Int32Array(MAX_ENTITIES);
  targetCount = 0;
}

function collectTargets(ctx: SimContext, s: OrdersScratch): void {
  const w = ctx.world;
  let k = 0;
  for (let j = 0; j < w.highWater; j++) if (w.has(j, C.health) && w.hp[j]! > 0) s.targets[k++] = j;
  s.targetCount = k;
}

/**
 * Dichtstbijzijnde vijand binnen aggroRange: units gaan voor gebouwen; bij gelijke afstand de laagste id.
 * Afstand tot een gebouw is tot de rand van de footprint.
 */
function acquire(ctx: SimContext, s: OrdersScratch, i: number): number {
  const w = ctx.world;
  const r = ctx.config.aggroRange;
  const r2 = r * r;
  const x = w.x[i]!;
  const y = w.y[i]!;
  let bestU = -1;
  let bestUD = 0;
  let bestB = -1;
  let bestBD = 0;
  for (let k = 0; k < s.targetCount; k++) {
    const j = s.targets[k]!;
    if (!isEnemy(w, i, j)) continue;
    if ((w.mask[j]! & C.building) !== 0) {
      if (bestU >= 0) continue;
      const d = distToRect2(x, y, w.fx[j]!, w.fy[j]!, w.fw[j]!, w.fh[j]!);
      if (d <= r2 && (bestB < 0 || d < bestBD)) {
        bestB = j;
        bestBD = d;
      }
    } else {
      const dx = w.x[j]! - x;
      const dy = w.y[j]! - y;
      if (dx > r || -dx > r || dy > r || -dy > r) continue;
      const d = dx * dx + dy * dy;
      if (d <= r2 && (bestU < 0 || d < bestUD)) {
        bestU = j;
        bestUD = d;
      }
    }
  }
  return bestU >= 0 ? bestU : bestB;
}

/** Huidig doel van i als het nog een geldige vijand is (en, met leash, binnen aggroRange plus wapenbereik), anders -1. */
function currentTarget(ctx: SimContext, i: number, leash: boolean): number {
  const w = ctx.world;
  const id = w.target[i]!;
  if (id === NO_ENTITY) return -1;
  const t = w.resolve(id);
  if (t < 0 || !isEnemy(w, i, t)) return -1;
  if (leash && !withinReach(w, i, t, ctx.config.aggroRange + w.range[i]!)) return -1;
  return t;
}

/** Op doel t af: in bereik stilstaan en richten, anders erheen lopen. */
function engage(ctx: SimContext, i: number, t: number): void {
  const w = ctx.world;
  w.target[i] = w.idOf(t);
  if (withinReach(w, i, t, w.range[i]!)) {
    if (w.mvOn[i] === 1) stopMoving(ctx, i);
    face(w, i, w.x[t]!, w.y[t]!);
  } else if ((w.mask[t]! & C.building) !== 0) {
    steerToEntity(ctx, i, t);
  } else {
    steerChase(ctx, i, w.x[t]!, w.y[t]!);
  }
}

/** Zelf een doel zoeken (of houden) en erop af; geeft true als de unit vecht. */
function autoEngage(ctx: SimContext, s: OrdersScratch, i: number): boolean {
  const w = ctx.world;
  if (w.damage[i]! <= 0) return false;
  let t = currentTarget(ctx, i, true);
  if (t < 0) t = acquire(ctx, s, i);
  if (t < 0) {
    w.target[i] = NO_ENTITY;
    return false;
  }
  engage(ctx, i, t);
  return true;
}

function idle(ctx: SimContext, s: OrdersScratch, i: number): void {
  const w = ctx.world;
  if (w.role[i] === ROLE_MILITIA && autoEngage(ctx, s, i)) return;
  w.target[i] = NO_ENTITY;
  if (w.mvOn[i] === 1) stopMoving(ctx, i); // zonder order loopt een unit alleen achter een doel aan
}

function attackMove(ctx: SimContext, s: OrdersScratch, i: number, o: number): void {
  const w = ctx.world;
  if (autoEngage(ctx, s, i)) {
    w.phase[i] = PHASE_GO;
    return;
  }
  const x = w.ordX[o]!;
  const y = w.ordY[o]!;
  if (w.phase[i] === PHASE_WORK) {
    if (w.mvOn[i] === 0) w.popOrder(i); // aangekomen
    return;
  }
  steerToPoint(ctx, i, x, y, ctx.config.arriveRadius, w.ordT[o]!);
  w.phase[i] = PHASE_WORK;
}

function attack(ctx: SimContext, i: number, o: number): void {
  const w = ctx.world;
  w.target[i] = w.ordT[o]!;
  const t = currentTarget(ctx, i, false);
  if (t < 0) {
    w.target[i] = NO_ENTITY;
    w.popOrder(i);
    stopMoving(ctx, i);
    return;
  }
  engage(ctx, i, t);
}

function gather(ctx: SimContext, i: number, o: number): void {
  const w = ctx.world;
  const type = ctx.unitType(w.typeId[i]!);
  if (type === undefined || type.gatherAmount <= 0) {
    w.popOrder(i);
    stopMoving(ctx, i);
    return;
  }
  let node = w.resolve(w.ordT[o]!);
  if (node >= 0 && !w.has(node, C.resource)) node = -1;
  const reach = ctx.config.interactRange;
  if (w.phase[i] === PHASE_WORK && (node < 0 || !withinReach(w, i, node, reach))) w.phase[i] = PHASE_GO;
  if (w.phase[i] === PHASE_GO && w.carry[i]! >= type.gatherAmount) w.phase[i] = PHASE_RETURN;
  if (w.phase[i] === PHASE_GO) {
    if (node < 0) {
      node = nearestNode(w, w.x[i]!, w.y[i]!);
      if (node < 0) {
        if (w.carry[i]! > 0) w.phase[i] = PHASE_RETURN;
        else {
          w.popOrder(i);
          stopMoving(ctx, i);
          return;
        }
      } else w.ordT[o] = w.idOf(node);
    }
    if (w.phase[i] === PHASE_GO) {
      if (withinReach(w, i, node, reach)) {
        stopMoving(ctx, i);
        face(w, i, w.x[node]!, w.y[node]!);
        w.phase[i] = PHASE_WORK;
        w.work[i] = 0;
      } else {
        steerToEntity(ctx, i, node);
      }
      return;
    }
  }
  if (w.phase[i] === PHASE_RETURN) {
    const dep = nearestOwnBuilding(ctx, w.owner[i]!, w.x[i]!, w.y[i]!, DEPOT_MASK);
    if (dep < 0) {
      if (w.mvOn[i] === 1) stopMoving(ctx, i); // geen depot: wachten
    } else if (withinReach(w, i, dep, reach)) {
      if (w.mvOn[i] === 1) stopMoving(ctx, i); // afleveren in systeem 6
    } else {
      steerToEntity(ctx, i, dep);
    }
  }
}

function build(ctx: SimContext, i: number, o: number): void {
  const w = ctx.world;
  const b = w.resolve(w.ordT[o]!);
  if (b < 0 || !w.has(b, C.building) || w.bstate[b] !== BSTATE_SITE) {
    w.popOrder(i);
    stopMoving(ctx, i);
    return;
  }
  if (withinReach(w, i, b, ctx.config.interactRange)) {
    if (w.mvOn[i] === 1) stopMoving(ctx, i);
    face(w, i, w.x[b]!, w.y[b]!);
    w.phase[i] = PHASE_WORK;
  } else {
    w.phase[i] = PHASE_GO;
    steerToEntity(ctx, i, b);
  }
}

function claim(ctx: SimContext, i: number, o: number): void {
  const w = ctx.world;
  const pt = w.resolve(w.ordT[o]!);
  if (pt < 0 || !w.has(pt, C.claim)) {
    w.popOrder(i);
    stopMoving(ctx, i);
    return;
  }
  const r = ctx.config.claimRadius;
  const inside = dist2(w, i, pt) <= r * r;
  if (w.phase[i] === PHASE_WORK) {
    if (w.mvOn[i] === 0 && !inside) w.phase[i] = PHASE_GO; // weggeduwd: opnieuw
    return;
  }
  // Tot op de halve straal lopen, dan wachten tot systeem 7 het punt geeft.
  steerToPoint(ctx, i, w.x[pt]!, w.y[pt]!, idiv(r, 2), 0);
  w.phase[i] = PHASE_WORK;
}

function craft(ctx: SimContext, i: number): void {
  const w = ctx.world;
  if (w.phase[i] !== PHASE_GO) return; // betalen en omscholen in systeem 6
  const ws = nearestOwnBuilding(ctx, w.owner[i]!, w.x[i]!, w.y[i]!, PROVIDES_WORKSHOP);
  if (ws < 0) {
    if (w.mvOn[i] === 1) stopMoving(ctx, i); // geen werkplaats: wachten
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
  collectTargets(ctx, s);
  const need = C.unit | C.orders;
  for (let i = 0; i < w.highWater; i++) {
    if (!w.has(i, need)) continue;
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
      case ORDER_CLAIM:
        w.target[i] = NO_ENTITY;
        claim(ctx, i, o);
        break;
      case ORDER_CRAFT:
        w.target[i] = NO_ENTITY;
        craft(ctx, i);
        break;
      default:
        w.popOrder(i);
    }
  }
}
