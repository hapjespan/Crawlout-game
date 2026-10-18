// Split from creeps.ts to stay under the 5,000-token file limit; creeps.ts re-exports the public surface.
// Holds: CAMP_IDLE, CAMP_FIGHT, CAMP_RETURN, CAMP_CLEARED, CAMP_TAKEN, RETURN_LIMIT_TICKS, +20 more.
import {
  MAX_CREEP_CAMPS,
  MAX_CREEPS_PER_CAMP,
  type SimCreepTier,
  type SimCreepTakeover,
} from '../config.js';
import {
  type SimContext,
  nthFreeCellAround,
  cellCenterOf,
  face,
  stopMoving,
  withinReach,
  steerChase,
  steerToPoint,
} from './common.js';
import { createUnit } from '../entities.js';
import { OWNER_NEUTRAL, MAX_PLAYERS } from '@crawlout/protocol';
import { C, SLAVE_SLAVE, SLAVE_CAPTIVE, NO_ENTITY } from '../ecs/world.js';
import { applyStats } from '../effects.js';
import { heroIndex, grantXp } from './hero.js';
import { imod } from '../math/int.js';

// Creep camps (sim 0.20.0, data 0.25.0, phase 2 round 2; bevestigd in fase-0 sectie 23 besluit 5). Bandit nests of
// the map (SimMap.creepCamps, Spelfundament 3.2: "bandietennesten als creeps met loot en held-XP", Warcraft 3). All
// numbers come from data/creeps.json (SimConfig.creepTiers) and ai/*.json (SimAiScript.creeps).
//
//  - Start: after the start setup, every camp of the map spawns the bandits of its tier (neutral units, owner
//    OWNER_NEUTRAL, World.creepCamp = camp + 1), one per free cell around the centre (nthFreeCellAround, mirror-equal),
//    that cell its home (World.creepHome). A bandit has no orders component: this module drives it.
//  - System 2 (creepSystem, after the unit orders), per camp in index order:
//      idle: a player unit (not a slave or captive, not a corpse) within aggroRadius of the centre, or a bandit hit since
//      the last tick (World.lastHit, cleared here), wakes the whole camp (fight). An idle bandit off its home walks back.
//      fight: every bandit keeps its target while that is a living player unit within leashRadius of the centre, else
//      takes the nearest such unit (tiebreak lowest id); it never targets a building. When a bandit stands beyond
//      leashRadius of the centre, or no bandit has a target left, the camp goes home (return).
//      return: no targets; every bandit walks to its home; once all are home (or stopped) they heal to full and the
//      camp is idle again. Hits while returning are ignored (the classic leash: kiting a camp out does not pay).
//      cleared: with respawnTicks > 0 the timer runs down and the camp comes back full once no player unit is within
//      aggroRadius; with 0 it stays empty.
//  - Players: a bandit is an enemy of every player (common.ts isEnemy, when visible); his units and turrets acquire
//    one by themselves only while its camp fights (creepAwake), an explicit Attack always. A bandit is no slave target.
//  - System 8 (creepDeath, from cleanup before the plunder): when the last living bandit of a camp dies, the owner of
//    its killing blow (World.lastHit, as plunder) gets lootScrap, and his living hero within heroXpRadius of the
//    centre heroXp; the camp is cleared (clearedBy, clearedAt). Kill and assist xp per bandit come from combat.
//  - AI (aiCreepRun, from both scripted AIs before they rally): see the function.
//  - Takeover (sim 0.22.0, data 0.27.0, SimConfig.creepTakeover; voorstel, ter bevestiging door de architect): a
//    faction with a takeover rule for the camp's tier (the Raiders: "plunderen en werven") takes a camp over instead of
//    clearing it. A fighting camp surrenders (system 2, before its bandits pick targets) when the units within its leash
//    circle are all of one player, at least minUnits of them, his faction has a rule for the tier, and the living
//    bandits are down to surrenderPermille of their summed max hp: every living bandit joins that player (owner, an
//    Orders component, no camp; hp as it is), he gets lootScrap and heroXp as for a clear, and the camp is taken
//    (CAMP_TAKEN, clearedBy = the player + 1). The killing blow on the last bandit takes it over as well (creepDeath).
//    A taken camp is an outpost: every yieldTicks it yields one bandit of the tier (in tier order, new, owned by the
//    taker) on a free cell at its centre, at most yieldMax in all (CreepCamps.yields), while its owner still plays, is
//    below popCapMax and no unit of another player stands within aggroRadius of the centre (then it waits). A taken
//    camp never respawns. A faction without a rule clears camps as before.

export const CAMP_IDLE = 0;

export const CAMP_FIGHT = 1;

export const CAMP_RETURN = 2;

export const CAMP_CLEARED = 3;

/** Taken over (sim 0.22.0): an outpost of player clearedBy - 1. */
export const CAMP_TAKEN = 4;

/** Geometry: a returning camp counts as home after this long at most (60 s), even if a bandit is still blocked. */
export const RETURN_LIMIT_TICKS = 1200;

/** Per camp state (serialize and hash, state.ts) plus derived per-tick member lists. */
export class CreepCamps {
  /** CAMP_* per camp index. */
  readonly state = new Uint8Array(MAX_CREEP_CAMPS);
  /** Cleared: ticks left until the respawn (0 = none pending). Return: ticks on the way home so far. */
  readonly timer = new Int32Array(MAX_CREEP_CAMPS);
  /** Player + 1 that cleared or took the camp last (0 = never). Taken: the owner of the outpost. */
  readonly clearedBy = new Uint8Array(MAX_CREEP_CAMPS);
  /** Frame + 1 in which the camp was cleared or taken last (0 = never). */
  readonly clearedAt = new Int32Array(MAX_CREEP_CAMPS);
  /** Taken (sim 0.22.0): bandits the outpost has yielded so far. */
  readonly yields = new Uint8Array(MAX_CREEP_CAMPS);
  // derived (not state): the living bandits per camp this tick, ascending index
  readonly members = new Int32Array(MAX_CREEP_CAMPS * MAX_CREEPS_PER_CAMP);
  readonly count = new Uint8Array(MAX_CREEP_CAMPS);
}

/** The tier data of camp k of the map, or undefined. */
export function campTier(ctx: SimContext, k: number): SimCreepTier | undefined {
  const camp = ctx.map.creepCamps?.[k];
  if (camp === undefined) return undefined;
  for (const t of ctx.config.creepTiers ?? []) if (t.tier === camp.tier) return t;
  return undefined;
}

/** The takeover rule of player p's faction for camp tier `tier` (data 0.27.0), or undefined: he clears it. */
export function takeoverRule(
  ctx: SimContext,
  p: number,
  tier: number,
): SimCreepTakeover['tiers'][number] | undefined {
  if (p < 0 || p >= ctx.playerCount) return undefined;
  const f = ctx.players[p]!.factionId;
  for (const r of ctx.config.creepTakeover ?? []) {
    if (r.factionId !== f) continue;
    for (const t of r.tiers) if (t.tier === tier) return t;
  }
  return undefined;
}

/** Start setup: the bandits of every camp of the map (after the players' start units). */
export function spawnCreepCamps(ctx: SimContext): void {
  const camps = ctx.map.creepCamps ?? [];
  for (let k = 0; k < camps.length; k++) {
    const t = campTier(ctx, k);
    if (t === undefined) {
      ctx.creeps.state[k] = CAMP_CLEARED;
      continue;
    }
    spawnCamp(ctx, k, t);
  }
}

export function spawnCamp(ctx: SimContext, k: number, t: SimCreepTier): void {
  const camp = ctx.map.creepCamps![k]!;
  const w = ctx.world;
  const cx = camp.x >> 8;
  const cy = camp.y >> 8;
  const midX = ctx.map.w << 7;
  const midY = ctx.map.h << 7;
  for (let n = 0; n < t.typeIds.length; n++) {
    const ut = ctx.unitType(t.typeIds[n]!);
    const c = nthFreeCellAround(ctx, cx, cy, 1, 1, n);
    if (ut === undefined || c < 0) continue;
    const at = cellCenterOf(ctx.map, c);
    const i = createUnit(ctx, ut, OWNER_NEUTRAL, at.x, at.y, 0);
    if (i < 0) return;
    w.mask[i] = w.mask[i]! & ~C.orders;
    w.creepCamp[i] = k + 1;
    w.creepHome[i] = c;
    face(w, i, midX, midY);
  }
  ctx.creeps.state[k] = CAMP_IDLE;
  ctx.creeps.timer[k] = 0;
}

/** Whether bandit j's camp is fighting (then player units and turrets acquire it by themselves). */
export function creepAwake(ctx: SimContext, j: number): boolean {
  const k = ctx.world.creepCamp[j]! - 1;
  return k >= 0 && ctx.creeps.state[k] === CAMP_FIGHT;
}

/** A player unit a bandit may fight or that wakes a camp: living, not a corpse, not a slave or captive. */
function playerUnit(ctx: SimContext, j: number): boolean {
  const w = ctx.world;
  if (!w.has(j, C.unit | C.health) || w.hp[j]! <= 0) return false;
  if (w.owner[j]! >= ctx.playerCount) return false;
  const st = w.slaveState[j]!;
  return st !== SLAVE_SLAVE && st !== SLAVE_CAPTIVE;
}

const within = (x: number, y: number, cx: number, cy: number, r: number): boolean => {
  const dx = x - cx;
  const dy = y - cy;
  return dx <= r && -dx <= r && dy <= r && -dy <= r && dx * dx + dy * dy <= r * r;
};

/** Whether any player unit stands within r of (cx, cy). */
export function playerNear(ctx: SimContext, cx: number, cy: number, r: number): boolean {
  const w = ctx.world;
  for (let j = 0; j < w.highWater; j++)
    if (playerUnit(ctx, j) && within(w.x[j]!, w.y[j]!, cx, cy, r)) return true;
  return false;
}

/** Units per player within the leash circle (derived scratch of surrenderTo). */
const nearCount = new Int32Array(MAX_PLAYERS);

/**
 * The player fighting camp k who takes it over now (see the top of this file), or -1: all units within its leash circle
 * are his (at least minUnits), his faction has a rule for the tier, and the bandits are down to surrenderPermille.
 */
export function surrenderTo(ctx: SimContext, k: number, t: SimCreepTier): number {
  if (ctx.config.creepTakeover === undefined || ctx.config.creepTakeover.length === 0) return -1;
  const w = ctx.world;
  const cc = ctx.creeps;
  const camp = ctx.map.creepCamps![k]!;
  const n = cc.count[k]!;
  if (n === 0) return -1;
  nearCount.fill(0);
  let owners = 0;
  for (let j = 0; j < w.highWater; j++) {
    if (!playerUnit(ctx, j) || !within(w.x[j]!, w.y[j]!, camp.x, camp.y, t.leashRadius)) continue;
    const o = w.owner[j]!;
    owners |= 1 << o;
    nearCount[o] = nearCount[o]! + 1;
  }
  // exactly one player in the circle (a power of two)
  if (owners === 0 || (owners & (owners - 1)) !== 0) return -1;
  const p = 31 - Math.clz32(owners);
  const rule = takeoverRule(ctx, p, t.tier);
  if (rule === undefined || nearCount[p]! < rule.minUnits) return -1;
  let hp = 0;
  let max = 0;
  const base = k * MAX_CREEPS_PER_CAMP;
  for (let m = 0; m < n; m++) {
    const i = cc.members[base + m]!;
    hp += w.hp[i]!;
    max += w.maxHp[i]!;
  }
  return hp * 1000 <= rule.surrenderPermille * max ? p : -1;
}

/** Bandit i joins player p (a takeover): his unit with orders, no camp, its hp as it is. */
export function join(ctx: SimContext, i: number, p: number): void {
  const w = ctx.world;
  w.owner[i] = p;
  w.creepCamp[i] = 0;
  w.creepHome[i] = 0;
  w.target[i] = NO_ENTITY;
  w.lastHit[i] = 0;
  if (w.mvOn[i] === 1) stopMoving(ctx, i);
  w.mask[i] = w.mask[i]! | C.orders;
  w.clearOrders(i);
  applyStats(ctx, i, false);
}

/** Camp k is taken by player p: the outpost (timer to the first yield), and the loot and xp of a clear. */
export function taken(ctx: SimContext, k: number, t: SimCreepTier, p: number): void {
  const cc = ctx.creeps;
  cc.state[k] = CAMP_TAKEN;
  cc.clearedBy[k] = p + 1;
  cc.clearedAt[k] = ctx.frame + 1;
  cc.timer[k] = takeoverRule(ctx, p, t.tier)?.yieldTicks ?? 0;
  cc.yields[k] = 0;
  loot(ctx, k, t, p);
}

/** The loot of camp k for player p: lootScrap, and heroXp for his living hero within heroXpRadius of the centre. */
export function loot(ctx: SimContext, k: number, t: SimCreepTier, p: number): void {
  if (ctx.ps.defeated[p] !== 0) return;
  ctx.ps.scrap[p] = ctx.ps.scrap[p]! + t.lootScrap;
  const w = ctx.world;
  const h = heroIndex(ctx, p);
  const camp = ctx.map.creepCamps![k]!;
  if (h >= 0 && within(w.x[h]!, w.y[h]!, camp.x, camp.y, t.heroXpRadius)) grantXp(ctx, p, t.heroXp);
}

/** A taken camp k yields a bandit for its owner (see the top of this file). */
export function outpost(ctx: SimContext, k: number, t: SimCreepTier): void {
  const cc = ctx.creeps;
  const p = cc.clearedBy[k]! - 1;
  if (p < 0 || p >= ctx.playerCount || ctx.ps.defeated[p] !== 0) return;
  const rule = takeoverRule(ctx, p, t.tier);
  if (rule === undefined || rule.yieldTicks <= 0 || cc.yields[k]! >= rule.yieldMax) return;
  if (cc.timer[k]! > 0) {
    cc.timer[k] = cc.timer[k]! - 1;
    if (cc.timer[k]! > 0) return;
  }
  // due: it waits while another player is at the camp or p is at popCapMax
  const camp = ctx.map.creepCamps![k]!;
  if (otherNear(ctx, p, camp.x, camp.y, t.aggroRadius) || popOf(ctx, p) >= ctx.config.popCapMax)
    return;
  const y = cc.yields[k]!;
  const ut = ctx.unitType(t.typeIds[imod(y, t.typeIds.length)]!);
  const c = nthFreeCellAround(ctx, camp.x >> 8, camp.y >> 8, 1, 1, 0);
  if (ut === undefined || c < 0) return;
  const at = cellCenterOf(ctx.map, c);
  const i = createUnit(ctx, ut, p, at.x, at.y, 0);
  if (i < 0) return;
  face(ctx.world, i, ctx.map.w << 7, ctx.map.h << 7);
  cc.yields[k] = y + 1;
  cc.timer[k] = rule.yieldTicks;
}

/** Whether a unit of a player other than p (not a slave or captive) stands within r of (cx, cy). */
function otherNear(ctx: SimContext, p: number, cx: number, cy: number, r: number): boolean {
  const w = ctx.world;
  for (let j = 0; j < w.highWater; j++)
    if (playerUnit(ctx, j) && w.owner[j] !== p && within(w.x[j]!, w.y[j]!, cx, cy, r)) return true;
  return false;
}

/** The pop of player p's living units (the hero excluded), as Census counts it; for the outpost's popCapMax. */
function popOf(ctx: SimContext, p: number): number {
  const w = ctx.world;
  let pop = 0;
  for (let j = 0; j < w.highWater; j++) {
    if (w.alive[j] !== 1 || w.owner[j] !== p) continue;
    if ((w.mask[j]! & (C.unit | C.health | C.hero)) !== (C.unit | C.health)) continue;
    pop += ctx.unitType(w.typeId[j]!)?.popCost ?? 0;
  }
  return pop;
}

/** Camp k fights: targets and movement for its bandits. False when it must go home (leash or nobody left). */
export function fight(ctx: SimContext, k: number, t: SimCreepTier): boolean {
  const w = ctx.world;
  const cc = ctx.creeps;
  const camp = ctx.map.creepCamps![k]!;
  const n = cc.count[k]!;
  const base = k * MAX_CREEPS_PER_CAMP;
  const leash = t.leashRadius;
  for (let m = 0; m < n; m++) {
    const i = cc.members[base + m]!;
    if (!within(w.x[i]!, w.y[i]!, camp.x, camp.y, leash)) return false;
  }
  let any = false;
  for (let m = 0; m < n; m++) {
    const i = cc.members[base + m]!;
    let tgt = w.target[i] === NO_ENTITY ? -1 : w.resolve(w.target[i]!);
    if (tgt >= 0 && !(playerUnit(ctx, tgt) && within(w.x[tgt]!, w.y[tgt]!, camp.x, camp.y, leash)))
      tgt = -1;
    if (tgt < 0) tgt = nearestPlayerUnit(ctx, i, camp.x, camp.y, leash);
    if (tgt < 0) {
      w.target[i] = NO_ENTITY;
      continue;
    }
    any = true;
    w.target[i] = w.idOf(tgt);
    if (withinReach(w, i, tgt, w.range[i]!)) {
      if (w.mvOn[i] === 1) stopMoving(ctx, i);
      face(w, i, w.x[tgt]!, w.y[tgt]!);
    } else steerChase(ctx, i, w.x[tgt]!, w.y[tgt]!);
  }
  return any;
}

/** The player unit nearest to bandit i within r of the camp centre (cx, cy); tiebreak lowest index. -1 if none. */
function nearestPlayerUnit(ctx: SimContext, i: number, cx: number, cy: number, r: number): number {
  const w = ctx.world;
  let best = -1;
  let bestD = 0;
  for (let j = 0; j < w.highWater; j++) {
    if (!playerUnit(ctx, j) || !within(w.x[j]!, w.y[j]!, cx, cy, r)) continue;
    const dx = w.x[j]! - w.x[i]!;
    const dy = w.y[j]! - w.y[i]!;
    const d = dx * dx + dy * dy;
    if (best < 0 || d < bestD) {
      best = j;
      bestD = d;
    }
  }
  return best;
}

/** Bandit i walks to its home cell; true once it is there (or stopped: blocked by another unit at the spot). */
export function goHome(ctx: SimContext, i: number): boolean {
  const w = ctx.world;
  const home = cellCenterOf(ctx.map, w.creepHome[i]!);
  const arrive = ctx.config.arriveRadius;
  const dx = home.x - w.x[i]!;
  const dy = home.y - w.y[i]!;
  w.target[i] = NO_ENTITY;
  // half a cell: the separation of the units around the camp may keep a bandit a little off its cell centre
  if (dx * dx + dy * dy <= 128 * 128) {
    if (w.mvOn[i] === 1) stopMoving(ctx, i);
    return true;
  }
  if (w.mvOn[i] === 1 && w.goalX[i] === home.x && w.goalY[i] === home.y) return false;
  if (w.mvOn[i] === 0 && w.goalX[i] === home.x && w.goalY[i] === home.y) return true;
  steerToPoint(ctx, i, home.x, home.y, arrive, 0);
  return false;
}
