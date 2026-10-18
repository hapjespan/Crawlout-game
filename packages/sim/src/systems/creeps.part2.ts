// Split from creeps.ts to stay under the 5,000-token file limit; creeps.ts re-exports the public surface.
// Holds: creepSystem, creepDeath, campAt, campStatus, campAlive, aiCreepRun.
import type { SimContext } from './common.js';
import { C, NO_ENTITY } from '../ecs/world.js';
import { MAX_CREEPS_PER_CAMP, type SimAiScript } from '../config.js';
import { type CreepCampStatus, OWNER_NEUTRAL, MAX_ENTITIES_PER_COMMAND } from '@crawlout/protocol';
import { TERRAIN_UNREACHABLE } from '../pathdist.js';
import { applyCommand } from './commands.js';
import {
  CAMP_CLEARED,
  CAMP_FIGHT,
  CAMP_IDLE,
  CAMP_RETURN,
  CAMP_TAKEN,
  RETURN_LIMIT_TICKS,
  campTier,
  fight,
  goHome,
  join,
  loot,
  outpost,
  playerNear,
  spawnCamp,
  surrenderTo,
  taken,
  takeoverRule,
} from './creeps.part1.js';

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
    if (cc.state[k] === CAMP_TAKEN) {
      outpost(ctx, k, t);
      continue;
    }
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
    if (cc.state[k] === CAMP_FIGHT) {
      const by = surrenderTo(ctx, k, t);
      if (by >= 0) {
        for (let m = 0; m < n; m++) join(ctx, cc.members[base + m]!, by);
        taken(ctx, k, t, by);
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

/**
 * System 8 (cleanupSystem, before the plunder): bandit i has hp <= 0. When it was the last living bandit of its camp,
 * the camp is cleared and the owner of the killing blow gets the loot (see the top of this file).
 */
export function creepDeath(ctx: SimContext, i: number): void {
  const w = ctx.world;
  const k = w.creepCamp[i]! - 1;
  if (k < 0) return;
  const cc = ctx.creeps;
  // two last bandits dying in the same tick: the first one (lowest index) ends the camp, once
  if (cc.state[k] === CAMP_CLEARED || cc.state[k] === CAMP_TAKEN) return;
  for (let j = 0; j < w.highWater; j++) {
    if (j === i || w.creepCamp[j] !== k + 1 || w.alive[j] !== 1) continue;
    if (w.has(j, C.unit | C.health) && w.hp[j]! > 0) return;
  }
  const t = campTier(ctx, k);
  const by = w.lastHit[i]! - 1;
  const player = by >= 0 && by < ctx.playerCount;
  // takeover (sim 0.22.0): the killing blow of a faction with a rule for the tier takes the camp over
  if (t !== undefined && player && takeoverRule(ctx, by, t.tier) !== undefined) {
    taken(ctx, k, t, by);
    return;
  }
  cc.state[k] = CAMP_CLEARED;
  cc.timer[k] = t === undefined ? 0 : t.respawnTicks;
  cc.clearedAt[k] = ctx.frame + 1;
  cc.clearedBy[k] = player ? by + 1 : 0;
  if (t === undefined || !player) return;
  loot(ctx, k, t, by);
}

/** Camp index whose centre is exactly (x, y) (an AttackMove of a creep run keeps that point in ordX/ordY), or -1. */
export function campAt(ctx: SimContext, x: number, y: number): number {
  const camps = ctx.map.creepCamps;
  if (camps === undefined) return -1;
  for (let k = 0; k < camps.length; k++) if (camps[k]!.x === x && camps[k]!.y === y) return k;
  return -1;
}

/**
 * Every camp of the map for player `viewer`'s HUD (PlayerStatus.camps, protocol 0.14.0; voorstel, ter bevestiging door
 * de architect), on camp index. Reads state only.
 */
export function campStatus(ctx: SimContext, viewer: number): CreepCampStatus[] {
  const camps = ctx.map.creepCamps ?? [];
  const cc = ctx.creeps;
  return camps.map((c, k) => {
    const st = cc.state[k]!;
    const taken = st === CAMP_TAKEN;
    return {
      camp: k,
      x: c.x,
      y: c.y,
      tier: c.tier,
      state: taken ? 'taken' : st === CAMP_CLEARED ? 'cleared' : 'bandits',
      owner: taken ? cc.clearedBy[k]! - 1 : OWNER_NEUTRAL,
      takeover: takeoverRule(ctx, viewer, c.tier) !== undefined,
    };
  });
}

/** Whether camp k still has bandits (not cleared, not taken). */
export function campAlive(ctx: SimContext, k: number): boolean {
  return ctx.creeps.state[k]! < CAMP_CLEARED;
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
