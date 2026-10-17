import { MAX_ENTITIES_PER_COMMAND, OWNER_NEUTRAL } from '@crawlout/protocol';
import type { SimAiScript, SimCreepTier } from '../config.js';
import { MAX_CREEP_CAMPS, MAX_CREEPS_PER_CAMP } from '../config.js';
import { C, NO_ENTITY, SLAVE_CAPTIVE, SLAVE_SLAVE } from '../ecs/world.js';
import { createUnit } from '../entities.js';
import { TERRAIN_UNREACHABLE } from '../pathdist.js';
import type { SimContext } from './common.js';
import {
  cellCenterOf,
  face,
  nthFreeCellAround,
  steerChase,
  steerToPoint,
  stopMoving,
  withinReach,
} from './common.js';
import { applyCommand } from './commands.js';
import { grantXp, heroIndex } from './hero.js';

// Creep camps (sim 0.19.0, data 0.24.0, phase 2 round 2; voorstel, ter bevestiging door de architect). Bandit nests of
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

export const CAMP_IDLE = 0;
export const CAMP_FIGHT = 1;
export const CAMP_RETURN = 2;
export const CAMP_CLEARED = 3;

/** Geometry: a returning camp counts as home after this long at most (60 s), even if a bandit is still blocked. */
const RETURN_LIMIT_TICKS = 1200;

/** Per camp state (serialize and hash, state.ts) plus derived per-tick member lists. */
export class CreepCamps {
  /** CAMP_* per camp index. */
  readonly state = new Uint8Array(MAX_CREEP_CAMPS);
  /** Cleared: ticks left until the respawn (0 = none pending). Return: ticks on the way home so far. */
  readonly timer = new Int32Array(MAX_CREEP_CAMPS);
  /** Player + 1 that cleared the camp last (0 = never). */
  readonly clearedBy = new Uint8Array(MAX_CREEP_CAMPS);
  /** Frame + 1 in which the camp was cleared last (0 = never). */
  readonly clearedAt = new Int32Array(MAX_CREEP_CAMPS);
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

function spawnCamp(ctx: SimContext, k: number, t: SimCreepTier): void {
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
function playerNear(ctx: SimContext, cx: number, cy: number, r: number): boolean {
  const w = ctx.world;
  for (let j = 0; j < w.highWater; j++)
    if (playerUnit(ctx, j) && within(w.x[j]!, w.y[j]!, cx, cy, r)) return true;
  return false;
}

/** System 2: the bandits of every camp (see the top of this file). */
export function creepSystem(ctx: SimContext): void {
  const camps = ctx.map.creepCamps;
  if (camps === undefined || camps.length === 0) return;
  const w = ctx.world;
  const cc = ctx.creeps;
  cc.count.fill(0);
  for (let i = 0; i < w.highWater; i++) {
    const k = w.creepCamp[i]! - 1;
    if (k < 0 || w.alive[i] !== 1 || !w.has(i, C.unit | C.health) || w.hp[i]! <= 0) continue;
    const n = cc.count[k]!;
    if (n >= MAX_CREEPS_PER_CAMP) continue;
    cc.members[k * MAX_CREEPS_PER_CAMP + n] = i;
    cc.count[k] = n + 1;
  }
  for (let k = 0; k < camps.length; k++) {
    const t = campTier(ctx, k);
    if (t === undefined) continue;
    const camp = camps[k]!;
    if (cc.state[k] === CAMP_CLEARED) {
      if (t.respawnTicks <= 0 || cc.timer[k]! <= 0) continue;
      if (cc.timer[k]! > 1) cc.timer[k] = cc.timer[k]! - 1;
      else if (!playerNear(ctx, camp.x, camp.y, t.aggroRadius)) spawnCamp(ctx, k, t);
      continue;
    }
    const n = cc.count[k]!;
    const base = k * MAX_CREEPS_PER_CAMP;
    let hit = false;
    for (let m = 0; m < n; m++) {
      const i = cc.members[base + m]!;
      if (w.lastHit[i] !== 0) hit = true;
      w.lastHit[i] = 0;
    }
    if (cc.state[k] === CAMP_IDLE) {
      if (hit || playerNear(ctx, camp.x, camp.y, t.aggroRadius)) cc.state[k] = CAMP_FIGHT;
      else {
        for (let m = 0; m < n; m++) goHome(ctx, cc.members[base + m]!);
        continue;
      }
    }
    if (cc.state[k] === CAMP_FIGHT && !fight(ctx, k, t)) {
      cc.state[k] = CAMP_RETURN;
      cc.timer[k] = 0;
      for (let m = 0; m < n; m++) w.target[cc.members[base + m]!] = NO_ENTITY;
    }
    if (cc.state[k] === CAMP_RETURN) {
      let home = true;
      for (let m = 0; m < n; m++) if (!goHome(ctx, cc.members[base + m]!)) home = false;
      // a bandit that cannot reach its cell (pushed into a crowd) does not keep the camp from resetting forever
      cc.timer[k] = cc.timer[k]! + 1;
      if (home || cc.timer[k]! >= RETURN_LIMIT_TICKS) {
        cc.timer[k] = 0;
        for (let m = 0; m < n; m++) {
          const i = cc.members[base + m]!;
          w.hp[i] = w.maxHp[i]!;
        }
        cc.state[k] = CAMP_IDLE;
      }
    }
  }
}

/** Camp k fights: targets and movement for its bandits. False when it must go home (leash or nobody left). */
function fight(ctx: SimContext, k: number, t: SimCreepTier): boolean {
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
function goHome(ctx: SimContext, i: number): boolean {
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

/**
 * System 8 (cleanupSystem, before the plunder): bandit i has hp <= 0. When it was the last living bandit of its camp,
 * the camp is cleared and the owner of the killing blow gets the loot (see the top of this file).
 */
export function creepDeath(ctx: SimContext, i: number): void {
  const w = ctx.world;
  const k = w.creepCamp[i]! - 1;
  if (k < 0) return;
  for (let j = 0; j < w.highWater; j++) {
    if (j === i || w.creepCamp[j] !== k + 1 || w.alive[j] !== 1) continue;
    if (w.has(j, C.unit | C.health) && w.hp[j]! > 0) return;
  }
  const cc = ctx.creeps;
  const t = campTier(ctx, k);
  cc.state[k] = CAMP_CLEARED;
  cc.timer[k] = t === undefined ? 0 : t.respawnTicks;
  cc.clearedAt[k] = ctx.frame + 1;
  const by = w.lastHit[i]! - 1;
  cc.clearedBy[k] = by >= 0 && by < ctx.playerCount ? by + 1 : 0;
  if (t === undefined || by < 0 || by >= ctx.playerCount || ctx.ps.defeated[by] !== 0) return;
  ctx.ps.scrap[by] = ctx.ps.scrap[by]! + t.lootScrap;
  const h = heroIndex(ctx, by);
  const camp = ctx.map.creepCamps![k]!;
  if (h >= 0 && within(w.x[h]!, w.y[h]!, camp.x, camp.y, t.heroXpRadius))
    grantXp(ctx, by, t.heroXp);
}

/** Camp index whose centre is exactly (x, y) (an AttackMove of a creep run keeps that point in ordX/ordY), or -1. */
export function campAt(ctx: SimContext, x: number, y: number): number {
  const camps = ctx.map.creepCamps;
  if (camps === undefined) return -1;
  for (let k = 0; k < camps.length; k++) if (camps[k]!.x === x && camps[k]!.y === y) return k;
  return -1;
}

/** Whether camp k still has bandits (not cleared). */
export function campAlive(ctx: SimContext, k: number): boolean {
  return ctx.creeps.state[k] !== CAMP_CLEARED;
}

/**
 * A creep run of a scripted AI (ai/*.json creeps; both AIs call this before they rally their idle army): from fromTicks,
 * with no threat (the caller), the nearest living camp (path distance over land from the headquarters, at most maxPath;
 * tiebreak lowest camp index) whose tier has an entry with minArmy <= the idle army gets that army and the idle hero as
 * an AttackMove to its centre. The AI then sees them as busy (ai.ts raidOver, aiRaiders.ts onMission) until the camp
 * is cleared. True when it sent them.
 */
export function aiCreepRun(
  ctx: SimContext,
  p: number,
  script: SimAiScript,
  home: Uint16Array,
  army: readonly number[],
  heroId: number,
): boolean {
  const cr = script.creeps;
  const camps = ctx.map.creepCamps;
  if (cr === undefined || cr === null || camps === undefined || ctx.frame < cr.fromTicks)
    return false;
  if (army.length === 0) return false;
  let best = -1;
  let bestD = 0;
  for (let k = 0; k < camps.length; k++) {
    if (!campAlive(ctx, k)) continue;
    const camp = camps[k]!;
    let need = 0;
    for (const e of cr.tiers) if (e.tier === camp.tier) need = e.minArmy;
    if (need === 0 || army.length < need) continue;
    const d = ctx.terrainDist.at(home, camp.x, camp.y);
    if (d === TERRAIN_UNREACHABLE || d * 256 > cr.maxPath) continue;
    if (best < 0 || d < bestD) {
      best = k;
      bestD = d;
    }
  }
  if (best < 0) return false;
  const camp = camps[best]!;
  const send = [...army];
  if (heroId >= 0) send.push(heroId);
  for (let s = 0; s < send.length; s += MAX_ENTITIES_PER_COMMAND)
    applyCommand(ctx, {
      playerId: p,
      seq: 0,
      type: 'AttackMove',
      payload: { ids: send.slice(s, s + MAX_ENTITIES_PER_COMMAND), x: camp.x, y: camp.y },
    });
  return true;
}
