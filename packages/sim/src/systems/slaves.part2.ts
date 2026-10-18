// Split from slaves.ts to stay under the 5,000-token file limit; slaves.ts re-exports the public surface.
// Holds: slaveSystem, transition, liberation, free, isOwnKooi, gatherNode, +9 more.
import {
  type SimContext,
  withinReach,
  distToRect2,
  inMap,
  walkableAt,
  steerToPoint,
} from './common.js';
import type { SimSlaveRules } from '../config.js';
import { applyUnitType } from '../entities.js';
import {
  SLAVE_SLAVE,
  NO_ENTITY,
  SLAVE_CAPTIVE,
  SLAVE_FREED,
  C,
  BSTATE_DONE,
  ORDER_GATHER,
  ORDER_GUARD,
  SLAVE_NONE,
  ORDER_MOVE,
} from '../ecs/world.js';
import { autoGather } from './orders.js';
import { applyStats } from '../effects.js';
import { OWNER_NEUTRAL, type SlaveGroupStatus } from '@crawlout/protocol';
import { PROVIDES_KOOI } from '../fromData.js';
import { idiv } from '../math/int.js';
import { isqrt } from '../math/sqrt.js';
import {
  cageIndex,
  cageType,
  freeCage,
  isBound,
  isFighter,
  rebind,
  release,
  slaveRulesOf,
} from './slaves.part1.js';

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

/** Whether building b is player p's completed Kooi (provides kooi, with cage data; the Raiderkamp too). */
export function isOwnKooi(ctx: SimContext, p: number, b: number): boolean {
  const w = ctx.world;
  if (b < 0 || w.alive[b] !== 1 || !w.has(b, C.building) || w.owner[b] !== p) return false;
  if (w.bstate[b] !== BSTATE_DONE || w.hp[b]! <= 0) return false;
  const bt = ctx.buildingType(w.typeId[b]!);
  return bt !== undefined && bt.cage !== null && (bt.provides & PROVIDES_KOOI) !== 0;
}

/** The node of unit i's current Gather order (an entity with scrap), or -1. */
function gatherNode(ctx: SimContext, i: number): number {
  const w = ctx.world;
  if (w.orderType(i) !== ORDER_GATHER) return -1;
  const n = w.resolve(w.ordT[w.currentOrder(i)]!);
  return n >= 0 && w.has(n, C.resource) ? n : -1;
}

/** Distance squared from (x, y) to the footprint of building b. */
const toFootprint2 = (ctx: SimContext, x: number, y: number, b: number): number => {
  const w = ctx.world;
  return distToRect2(x, y, w.fx[b]!, w.fy[b]!, w.fw[b]!, w.fh[b]!);
};

/** The Kooi of `kooien` nearest node j within r (node centre to footprint edge; tiebreak lowest index), or -1. */
function kooiNear(ctx: SimContext, kooien: readonly number[], j: number, r: number): number {
  const w = ctx.world;
  let best = -1;
  let bestD = 0;
  for (const b of kooien) {
    const d = toFootprint2(ctx, w.x[j]!, w.y[j]!, b);
    if (d > r * r || (best >= 0 && d >= bestD)) continue;
    best = b;
    bestD = d;
  }
  return best;
}

/** A group of slaves under the guard rule (see the top of this file). Derived per call, never state. */
export interface GuardGroup {
  /** True: the group of a Kooi (`target` is its index); false: of a node without a Kooi near. */
  readonly kooi: boolean;
  readonly target: number;
  /** The slaves of the group, ascending index. */
  readonly members: number[];
  /** The nodes where slaves of the group gather, in the order of their first slave. */
  readonly nodes: number[];
  /** Own fighters that count as guards, and how many of them are in guard mode on the group. */
  guards: number;
  guardMode: number;
  /** Guards the rule asks for now. */
  need: number;
}

/**
 * The slave groups of player p with their guards and what the guard rule asks (see the top of this file): Kooi groups
 * first, then node groups, each ascending on the index of its Kooi or node. Empty without slave rules or slaves.
 */
export function guardGroups(ctx: SimContext, p: number, roleMilitia: number): GuardGroup[] {
  const rules = slaveRulesOf(ctx, p);
  const groups: GuardGroup[] = [];
  if (rules === null) return groups;
  const w = ctx.world;
  const idx = ctx.index;
  idx.refresh(w);
  const kooien: number[] = [];
  for (let k = 0; k < idx.buildingCount; k++) {
    const b = idx.buildings[k]!;
    if (isOwnKooi(ctx, p, b)) kooien.push(b);
  }
  const find = (kooi: boolean, target: number): GuardGroup => {
    for (const g of groups) if (g.kooi === kooi && g.target === target) return g;
    const g: GuardGroup = {
      kooi,
      target,
      members: [],
      nodes: [],
      guards: 0,
      guardMode: 0,
      need: 0,
    };
    groups.push(g);
    return g;
  };
  for (let i = 0; i < w.highWater; i++) {
    if (w.alive[i] !== 1 || w.owner[i] !== p || w.slaveState[i] !== SLAVE_SLAVE) continue;
    if (!w.has(i, C.unit | C.health)) continue;
    const n = gatherNode(ctx, i);
    let g: GuardGroup;
    if (n >= 0) {
      const k = kooiNear(ctx, kooien, n, rules.cageNear);
      g = k >= 0 ? find(true, k) : find(false, n);
      if (!g.nodes.includes(n)) g.nodes.push(n);
    } else {
      const c = cageIndex(ctx, p, w.slaveCage[i]!);
      if (c < 0 || !kooien.includes(c)) continue; // without a Kooi: nobody to run from
      g = find(true, c);
    }
    g.members.push(i);
  }
  if (groups.length === 0) return groups;
  // own fighters: guard mode on the Kooi or a node of the group, or within the guard radius of either
  const r2 = rules.revoltGuardRadius * rules.revoltGuardRadius;
  for (let j = 0; j < w.highWater; j++) {
    if (w.alive[j] !== 1 || w.owner[j] !== p || !isFighter(ctx, j, roleMilitia)) continue;
    const post = w.orderType(j) === ORDER_GUARD ? w.resolve(w.ordT[w.currentOrder(j)]!) : -1;
    const x = w.x[j]!;
    const y = w.y[j]!;
    for (const g of groups) {
      const mode = post >= 0 && (post === g.target || g.nodes.includes(post));
      let near = mode || (g.kooi && toFootprint2(ctx, x, y, g.target) <= r2);
      for (let k = 0; k < g.nodes.length && !near; k++) {
        const n = g.nodes[k]!;
        const dx = w.x[n]! - x;
        const dy = w.y[n]! - y;
        if (dx * dx + dy * dy <= r2) near = true;
      }
      if (!near) continue;
      g.guards++;
      if (mode) g.guardMode++;
    }
  }
  for (const g of groups) {
    const n = g.members.length;
    if (g.kooi) g.need = rules.cageGuards;
    else if (g.guardMode > 0)
      g.need = idiv(n + rules.guardModeSlavesPerGuard - 1, rules.guardModeSlavesPerGuard);
    else g.need = idiv(n * rules.noCageGuards + rules.noCageSlaves - 1, rules.noCageSlaves);
  }
  // Kooi groups first, then node groups, each on index
  groups.sort((a, b) => (a.kooi === b.kooi ? a.target - b.target : a.kooi ? -1 : 1));
  return groups;
}

/** The revolt counter of a group: the highest of its slaves (they share it; a newcomer brings its own). */
function groupCounter(ctx: SimContext, g: GuardGroup): number {
  const w = ctx.world;
  let t = w.revolt[g.members[0]!]!;
  for (const m of g.members) if (w.revolt[m]! > t) t = w.revolt[m]!;
  return t;
}

/** Revolt of every slave group (see the top of this file). */
function revolts(ctx: SimContext, roleMilitia: number): void {
  const w = ctx.world;
  for (let p = 0; p < ctx.playerCount; p++) {
    const rules = slaveRulesOf(ctx, p);
    if (rules === null) continue;
    for (const g of guardGroups(ctx, p, roleMilitia)) {
      if (g.guards >= g.need) {
        for (const m of g.members) w.revolt[m] = 0;
        continue;
      }
      const t = groupCounter(ctx, g) + 1;
      const at = g.guards === 0 ? rules.emptyGraceTicks : rules.graceTicks;
      if (t < at) {
        for (const m of g.members) w.revolt[m] = t;
        continue;
      }
      let escape = idiv(g.members.length * rules.escapePermille, 1000);
      if (escape < 1) escape = 1;
      const ax = w.x[g.target]!;
      const ay = w.y[g.target]!;
      for (let k = 0; k < g.members.length; k++) {
        const m = g.members[k]!;
        if (k < escape) escapeFrom(ctx, m, ax, ay, rules.escapeDist);
        // the next round repeatTicks later while the deficit lasts
        else w.revolt[m] = at - rules.repeatTicks;
      }
    }
  }
}

/**
 * The slave groups of player p for his HUD (PlayerStatus.slaveGroups, protocol 0.15.0; voorstel, ter bevestiging door
 * de architect). Reads state only.
 */
export function slaveGroupStatus(
  ctx: SimContext,
  p: number,
  roleMilitia: number,
): SlaveGroupStatus[] {
  const rules = slaveRulesOf(ctx, p);
  if (rules === null) return [];
  const w = ctx.world;
  return guardGroups(ctx, p, roleMilitia).map((g): SlaveGroupStatus => {
    const short = g.guards < g.need;
    const at = g.guards === 0 ? rules.emptyGraceTicks : rules.graceTicks;
    const left = at - groupCounter(ctx, g);
    return {
      kind: g.kooi ? 'kooi' : 'node',
      targetId: w.idOf(g.target),
      x: w.x[g.target]!,
      y: w.y[g.target]!,
      slaves: g.members.length,
      guards: g.guards,
      guardsNeeded: g.need,
      guardMode: g.guardMode,
      nodeIds: g.nodes.map((n) => w.idOf(n)),
      escapeInTicks: short ? (left > 0 ? left : 0) : 0,
    };
  });
}

/** Slave j escapes: a neutral wanderer walking `dist` away from (ax, ay), its Kooi or node. */
function escapeFrom(ctx: SimContext, j: number, ax: number, ay: number, dist: number): void {
  const w = ctx.world;
  release(ctx, j);
  w.owner[j] = OWNER_NEUTRAL;
  w.slaveState[j] = SLAVE_NONE;
  w.slaveCage[j] = NO_ENTITY;
  w.slaveFrom[j] = OWNER_NEUTRAL;
  w.slaveTicks[j] = 0;
  w.revolt[j] = 0;
  let dx = w.x[j]! - ax;
  let dy = w.y[j]! - ay;
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
 * (a cage itself: the Raiderkamp), from nobody, and (a gatherer of a human player) start gathering.
 */
export function bindStartSlave(ctx: SimContext, i: number, hq: number): void {
  const w = ctx.world;
  if (ctx.unitType(w.typeId[i]!)?.slave !== true || slaveRulesOf(ctx, w.owner[i]!) === null) return;
  w.slaveState[i] = SLAVE_SLAVE;
  w.slaveFrom[i] = OWNER_NEUTRAL;
  const c = cageType(ctx, hq) !== null ? hq : freeCage(ctx, w.owner[i]!, w.x[i]!, w.y[i]!, true);
  w.slaveCage[i] = c < 0 ? NO_ENTITY : w.idOf(c);
  // a start slave of a human player goes to work at once, like a new settler (sim 0.23.0, playtest M1): the nearest
  // node within autoGatherRadius and the work radius of its cage; the scripted AI spreads its slaves itself
  autoGather(ctx, i);
}
