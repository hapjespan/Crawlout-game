// Split from orders.ts to stay under the 5,000-token file limit; orders.ts re-exports the public surface.
// Holds: ROLE_MILITIA, ROLE_ROBOT, DEPOT_MASK, OrdersScratch, collectTargets, acquire, +17 more.
import { ROLES } from '@crawlout/data';
import { PROVIDES_HQ, PROVIDES_WORKSHOP, PROVIDES_DEPOT } from '../fromData.js';
import { MAX_ENTITIES } from '@crawlout/protocol';
import {
  type SimContext,
  isEnemy,
  distToRect2,
  withinReach,
  stopMoving,
  face,
  steerToEntity,
  steerChase,
  nearestNode,
  steerVia,
  nodeAllowed,
  nodeReachable,
  nearestReachableBuilding,
} from './common.js';
import {
  C,
  BSTATE_SITE,
  NO_ENTITY,
  PHASE_GO,
  PHASE_WORK,
  ORDER_GATHER,
  PHASE_RETURN,
  ORDER_BUILD,
} from '../ecs/world.js';
import {
  wandererFor,
  mayBuild,
  liberatable,
  isGuardPost,
  workReach,
  reachesPoint,
} from './slaves.js';
import { creepAwake } from './creeps.js';
import { steerToSlot, SPOT_PENDING, walkPoint, gatherSlot } from './formation.js';
import { gatherAmountOf } from '../effects.js';

// Systeem 2 (unit-deel): per unit de huidige order uitvoeren in oplopende id-volgorde. Bepaalt waar een unit naartoe
// loopt (steerTo, uitgevoerd door systeem 4) en welk doel hij heeft (gevecht in systeem 5). Het werk zelf
// (verzamelen, bouwen, omscholen) gebeurt in systeem 6.

export const ROLE_MILITIA = ROLES.indexOf('militia');

/** Robots (data 0.16.0): vechten zelf zoals militie, een robot met reparatie repareert zonder order. */
export const ROLE_ROBOT = ROLES.indexOf('robot');

/** Depots voor scrap: hoofdgebouw en werkplaats, en (Raiders, data 0.21.0) de plundermarkt (provides depot). */
export const DEPOT_MASK = PROVIDES_HQ | PROVIDES_WORKSHOP | PROVIDES_DEPOT;

export class OrdersScratch {
  /** Indices van alle entities met Health en een eigenaar (units en gebouwen), oplopend. */
  readonly targets = new Int32Array(MAX_ENTITIES);
  targetCount = 0;
  /** Indices van alle bouwplaatsen (in aanbouw), oplopend, voor bouwers zonder taak. */
  readonly sites = new Int32Array(MAX_ENTITIES);
  siteCount = 0;
}

export function collectTargets(ctx: SimContext, s: OrdersScratch): void {
  const w = ctx.world;
  let k = 0;
  let n = 0;
  for (let j = 0; j < w.highWater; j++) {
    if (w.has(j, C.health) && w.hp[j]! > 0) s.targets[k++] = j;
    if (w.bstate[j] === BSTATE_SITE && w.has(j, C.building)) s.sites[n++] = j;
  }
  s.targetCount = k;
  s.siteCount = n;
}

/**
 * Dichtstbijzijnde vijand binnen aggroRange: units gaan voor gebouwen; bij gelijke afstand de laagste id.
 * Afstand tot een gebouw is tot de rand van de footprint.
 */
function acquire(ctx: SimContext, s: OrdersScratch, i: number): number {
  const w = ctx.world;
  // belegering (data 0.16.0): zoekt binnen zijn eigen bereik als dat verder is, en met buildingsFirst gebouwen eerst
  const siege = (w.mask[i]! & C.hero) === 0 ? ctx.unitType(w.typeId[i]!)?.siege : undefined;
  const buildingsFirst = siege !== undefined && siege !== null && siege.buildingsFirst;
  const r =
    siege !== undefined && siege !== null && w.range[i]! > ctx.config.aggroRange
      ? w.range[i]!
      : ctx.config.aggroRange;
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
    // a bandit only while its camp fights (sim 0.20.0): units walking past a sleeping camp leave it alone
    if (w.creepCamp[j] !== 0 && !creepAwake(ctx, j)) continue;
    if ((w.mask[j]! & C.building) !== 0) {
      if (bestU >= 0 && !buildingsFirst) continue;
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
  if (buildingsFirst) return bestB >= 0 ? bestB : bestU;
  if (bestU < 0 && bestB < 0) return acquireWanderer(ctx, s, i, r2);
  return bestU >= 0 ? bestU : bestB;
}

/** A Slaver without an enemy in aggro range takes the nearest neutral wanderer it can catch (data 0.21.0), or -1. */
function acquireWanderer(ctx: SimContext, s: OrdersScratch, i: number, r2: number): number {
  const w = ctx.world;
  if (ctx.unitType(w.typeId[i]!)?.capture == null || (w.mask[i]! & C.hero) !== 0) return -1;
  let best = -1;
  let bestD = 0;
  for (let k = 0; k < s.targetCount; k++) {
    const j = s.targets[k]!;
    if (!wandererFor(ctx, i, j)) continue;
    const dx = w.x[j]! - w.x[i]!;
    const dy = w.y[j]! - w.y[i]!;
    const d = dx * dx + dy * dy;
    if (d <= r2 && (best < 0 || d < bestD)) {
      best = j;
      bestD = d;
    }
  }
  return best;
}

/** Huidig doel van i als het nog een geldige vijand is (en, met leash, binnen aggroRange plus wapenbereik), anders -1. */
function currentTarget(ctx: SimContext, i: number, leash: boolean): number {
  const w = ctx.world;
  const id = w.target[i]!;
  if (id === NO_ENTITY) return -1;
  const t = w.resolve(id);
  if (t < 0 || !(isEnemy(w, i, t) || wandererFor(ctx, i, t))) return -1;
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
export function autoEngage(ctx: SimContext, s: OrdersScratch, i: number): boolean {
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

/** Index van de eigen bouwplaats (in aanbouw) met deze id, of -1. */
function ownSite(ctx: SimContext, i: number, id: number): number {
  const w = ctx.world;
  if (id === NO_ENTITY) return -1;
  const b = w.resolve(id);
  return b >= 0 && w.has(b, C.building) && w.bstate[b] === BSTATE_SITE && w.owner[b] === w.owner[i]
    ? b
    : -1;
}

/**
 * Bouwer zonder taak (speltest Martien):
 *  1. hervatten: bestaat zijn onthouden bouwplaats (`resumeSite`) nog en is ze onaf, dan loopt hij erheen en bouwt
 *     verder, waar hij ook is. Dat geldt na elk ander bevel (Move, AttackMove, Attack); Stop wist het geheugen en een
 *     nieuw bouwbevel overschrijft het;
 *  2. helpen: anders (en niet net met Stop stilgezet) pakt hij de dichtstbijzijnde eigen bouwplaats binnen
 *     builderAutoHelpRadius op, gemeten tot de rand van de footprint, tiebreak laagste id.
 * Geeft true als hij een bouworder kreeg.
 */
export function builderIdle(ctx: SimContext, s: OrdersScratch, i: number): boolean {
  const w = ctx.world;
  let b = ownSite(ctx, i, w.resumeSite[i]!);
  if (b >= 0 && !mayBuild(ctx, i, b)) b = -1;
  if (b < 0) {
    w.resumeSite[i] = NO_ENTITY;
    if (w.buildHold[i] !== 0) return false;
    b = nearestOwnSite(ctx, s, i, ctx.config.builderAutoHelpRadius);
    if (b < 0) return false;
  }
  const id = w.idOf(b);
  w.pushOrder(i, ORDER_BUILD, 0, 0, id);
  w.resumeSite[i] = id;
  build(ctx, i, w.currentOrder(i));
  return true;
}

/** Dichtstbijzijnde eigen bouwplaats binnen r (tot de rand van de footprint); bij gelijke afstand de laagste id. */
function nearestOwnSite(ctx: SimContext, s: OrdersScratch, i: number, r: number): number {
  const w = ctx.world;
  const p = w.owner[i]!;
  const x = w.x[i]!;
  const y = w.y[i]!;
  const r2 = r * r;
  let best = -1;
  let bestD = 0;
  for (let k = 0; k < s.siteCount; k++) {
    const b = s.sites[k]!;
    if (w.owner[b] !== p || !mayBuild(ctx, i, b)) continue;
    const d = distToRect2(x, y, w.fx[b]!, w.fy[b]!, w.fw[b]!, w.fh[b]!);
    if (d <= r2 && (best < 0 || d < bestD)) {
      best = b;
      bestD = d;
    }
  }
  return best;
}

export function attackMove(ctx: SimContext, s: OrdersScratch, i: number, o: number): void {
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
  steerToSlot(ctx, i, x, y, w.ordT[o]!); // own formation slot (systems/formation.ts)
  w.phase[i] = PHASE_WORK;
}

export function attack(ctx: SimContext, i: number, o: number): void {
  const w = ctx.world;
  w.target[i] = w.ordT[o]!;
  // an enemy slave or captive (data 0.21.0): no shot, it is freed by touch (systems/slaves.ts): walk up to it
  const b = w.resolve(w.ordT[o]!);
  if (b >= 0 && liberatable(ctx, i, b)) {
    if (withinReach(w, i, b, 0)) {
      if (w.mvOn[i] === 1) stopMoving(ctx, i);
      face(w, i, w.x[b]!, w.y[b]!);
    } else steerChase(ctx, i, w.x[b]!, w.y[b]!);
    return;
  }
  const t = currentTarget(ctx, i, false);
  if (t < 0) {
    w.target[i] = NO_ENTITY;
    w.popOrder(i);
    stopMoving(ctx, i);
    return;
  }
  engage(ctx, i, t);
}

/**
 * The target of a Guard order of unit i (ordT `id`) while it can still be guarded: a node with scrap or an own
 * completed guard post (provides kooi, claim or turret; sim 0.24.0, widened in sim 0.38.0, fase-0 sectie 27); else -1.
 * A post that changes owner or is razed ends the order, so the same check runs every tick, not only on the command.
 */
export function guardPost(ctx: SimContext, i: number, id: number): number {
  const w = ctx.world;
  const t = id === NO_ENTITY ? -1 : w.resolve(id);
  if (t < 0) return -1;
  if (w.has(t, C.resource)) return w.amount[t]! > 0 ? t : -1;
  return isGuardPost(ctx, w.owner[i]!, t) ? t : -1;
}

/** Distance squared from (x, y) to post t: to the footprint edge of a building, to the centre of a node. */
function postDist2(ctx: SimContext, t: number, x: number, y: number): number {
  const w = ctx.world;
  if ((w.mask[t]! & C.building) !== 0)
    return distToRect2(x, y, w.fx[t]!, w.fy[t]!, w.fw[t]!, w.fh[t]!);
  const dx = w.x[t]! - x;
  const dy = w.y[t]! - y;
  return dx * dx + dy * dy;
}

/**
 * Guard mode (sim 0.24.0, protocol 0.15.0 Guard; voorstel, ter bevestiging door de architect): the unit holds its post
 * (an own Kooi or a scrap node, ordT). Within sim.json guard.leash of the post it fights an enemy it acquires as long as
 * that enemy stays within leash plus its weapon range of the post; else it walks back until it is within guard.stand
 * and waits there. A post that is gone (razed, empty) ends the order. For the Raiders the unit counts as a guard of the
 * slaves there (systems/slaves.ts guardGroups).
 */
export function guard(ctx: SimContext, s: OrdersScratch, i: number, o: number): void {
  const w = ctx.world;
  const t = guardPost(ctx, i, w.ordT[o]!);
  if (t < 0) {
    w.target[i] = NO_ENTITY;
    w.popOrder(i);
    stopMoving(ctx, i);
    return;
  }
  const { stand, leash } = ctx.config.guard;
  const d2 = postDist2(ctx, t, w.x[i]!, w.y[i]!);
  if (d2 <= leash * leash && autoEngage(ctx, s, i)) {
    const e = w.resolve(w.target[i]!);
    const r = leash + w.range[i]!;
    if (e >= 0 && postDist2(ctx, t, w.x[e]!, w.y[e]!) <= r * r) {
      w.phase[i] = PHASE_GO;
      return;
    }
  }
  w.target[i] = NO_ENTITY;
  if (d2 <= stand * stand) {
    if (w.mvOn[i] === 1) stopMoving(ctx, i);
    w.phase[i] = PHASE_WORK;
    return;
  }
  w.phase[i] = PHASE_GO;
  steerToEntity(ctx, i, t);
}

export function gather(ctx: SimContext, i: number, o: number): void {
  const w = ctx.world;
  const type = ctx.unitType(w.typeId[i]!);
  if (type === undefined || type.gatherAmount <= 0) {
    w.popOrder(i);
    stopMoving(ctx, i);
    return;
  }
  let node = w.resolve(w.ordT[o]!);
  // a slave gathers only within the work radius of its cage (data 0.21.0)
  const work = workReach(ctx, i);
  // Een node die (inmiddels) exclusief van een ander is, telt als weg: zoek een andere (Spelfundament 3.1).
  if (
    node >= 0 &&
    (!w.has(node, C.resource) ||
      !nodeAllowed(ctx, node, w.owner[i]!) ||
      !reachesPoint(work, w.x[node]!, w.y[node]!))
  )
    node = -1;
  const reach = ctx.config.interactRange;
  if (w.phase[i] === PHASE_WORK && (node < 0 || !withinReach(w, i, node, reach)))
    w.phase[i] = PHASE_GO;
  if (w.phase[i] === PHASE_GO && w.carry[i]! >= gatherAmountOf(ctx, i)) w.phase[i] = PHASE_RETURN;
  if (w.phase[i] === PHASE_GO) {
    // a node it cannot walk to (under a building, another piece of terrain) counts as gone: never walk on the spot
    if (node >= 0 && !nodeReachable(ctx, w.x[i]!, w.y[i]!, node)) node = -1;
    if (node < 0) {
      node = nearestNode(ctx, w.owner[i]!, w.x[i]!, w.y[i]!, work);
      if (node < 0) {
        if (w.carry[i]! > 0) w.phase[i] = PHASE_RETURN;
        else {
          w.popOrder(i);
          stopMoving(ctx, i);
          return;
        }
      } else {
        // another node: a spot on its ring instead of the old one
        w.ordT[o] = w.idOf(node);
        const slot = gatherSlot(ctx, i, node, NO_SKIP);
        w.ordX[o] = slot?.x ?? 0;
        w.ordY[o] = slot?.y ?? 0;
      }
    }
    if (w.phase[i] === PHASE_GO) {
      approachNode(ctx, i, o, node, reach);
      return;
    }
  }
  if (w.phase[i] === PHASE_RETURN) {
    const dep = nearestReachableBuilding(ctx, w.owner[i]!, w.x[i]!, w.y[i]!, DEPOT_MASK);
    if (dep < 0) {
      if (w.mvOn[i] === 1) stopMoving(ctx, i); // geen bereikbaar depot: wachten
    } else if (withinReach(w, i, dep, reach)) {
      if (w.mvOn[i] === 1) stopMoving(ctx, i); // afleveren in systeem 6
    } else {
      steerToEntity(ctx, i, dep);
    }
  }
}

const NO_SKIP: ReadonlySet<number> = new Set<number>();

/**
 * A new settler (housing growth, safety net; data 0.18.0) of a human player that can gather starts gathering at the
 * nearest node it can reach (nearestNode) within autoGatherRadius of where it arrives, instead of standing idle. Its
 * ring spot follows at the start of the unit part of system 2 (formation.ts), as for a Gather command. The scripted AI
 * spreads its own settlers over the nodes (ai/*.json scavengersPerNode), so its settlers are left to it.
 */
export function autoGather(ctx: SimContext, i: number): void {
  const r = ctx.config.autoGatherRadius;
  const w = ctx.world;
  const p = w.owner[i]!;
  if (r <= 0 || ctx.players[p] === undefined || ctx.players[p].ai) return;
  const type = ctx.unitType(w.typeId[i]!);
  if (type === undefined || type.gatherAmount <= 0) return;
  const node = nearestNode(ctx, p, w.x[i]!, w.y[i]!, workReach(ctx, i));
  if (node < 0) return;
  const dx = w.x[node]! - w.x[i]!;
  const dy = w.y[node]! - w.y[i]!;
  if (dx * dx + dy * dy > r * r) return;
  w.pushOrder(i, ORDER_GATHER, SPOT_PENDING, SPOT_PENDING, w.idOf(node));
}

/**
 * Worker on its way to a node. With a ring spot (ordX/ordY, systems/formation.ts) it walks to that spot and starts
 * once it is within reach and at the spot (or stopped). Within formation slack of the spot, or stopped short of it by
 * another unit in the way (the contact rule of movement), it walks straight at the node for the last bit, so a
 * blocked spot never keeps it out of reach. Without a spot (or one that is no longer walkable) it walks to the node
 * and starts as soon as it is within reach, as before.
 */
function approachNode(ctx: SimContext, i: number, o: number, node: number, reach: number): void {
  const w = ctx.world;
  const ox = w.ordX[o]!;
  const oy = w.ordY[o]!;
  const sx = w.x[node]! + ox;
  const sy = w.y[node]! + oy;
  const slack = ctx.config.formation.slack;
  const hasSpot = (ox !== 0 || oy !== 0) && walkPoint(ctx, sx, sy);
  const dx = sx - w.x[i]!;
  const dy = sy - w.y[i]!;
  const near = dx * dx + dy * dy <= slack * slack;
  if ((!hasSpot || near || w.mvOn[i] === 0) && withinReach(w, i, node, reach)) {
    stopMoving(ctx, i);
    face(w, i, w.x[node]!, w.y[node]!);
    w.phase[i] = PHASE_WORK;
    w.work[i] = 0;
  } else if (hasSpot && !near && !(w.mvOn[i] === 0 && w.goalX[i] === sx && w.goalY[i] === sy)) {
    // contact rule within reach of the spot: a stopped worker standing closer to the spot stops this one
    steerVia(ctx, i, w.x[node]!, w.y[node]!, sx, sy, ctx.config.arriveRadius, reach);
  } else {
    // at the spot, or stopped short of it by another unit: the last bit straight at the node
    steerToEntity(ctx, i, node);
  }
}

export function build(ctx: SimContext, i: number, o: number): void {
  const w = ctx.world;
  const b = w.resolve(w.ordT[o]!);
  if (b < 0 || !w.has(b, C.building) || w.bstate[b] !== BSTATE_SITE || !mayBuild(ctx, i, b)) {
    if (w.resumeSite[i] === w.ordT[o]) w.resumeSite[i] = NO_ENTITY; // af of weg: niets meer te hervatten
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
