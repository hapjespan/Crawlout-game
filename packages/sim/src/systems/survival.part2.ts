// Survival co-op, part 2: the hostile behaviour, the kill reward, win and loss, and the build zones. survival.ts
// re-exports the public surface.
// Holds: survivalSystem, survivalDeath, survivalOutcome, survivalZoneReason, waveAlive, HORDE_WINNER, WIN_*.
import type { SimBuildingType } from '../config.js';
import { C, CREEP_SURVIVAL, NO_ENTITY } from '../ecs/world.js';
import { PROVIDES_CLAIM } from '../fromData.part1.js';
import {
  type SimContext,
  NO_WINNER,
  face,
  isEnemy,
  steerChase,
  steerToEntity,
  stopMoving,
  withinReach,
} from './common.js';
import { grantXp } from './hero.js';
import { PLACE_OK, PLACE_ZONE } from './placement.part1.js';
import { hqOf, spawnWaves, survivalOf } from './survival.part1.js';

// Survival co-op (sim 0.27.0; see survival.part1.ts for the waves and the target).
//
//  - Behaviour (system 2, after the spawner), per wave unit in index order: no leash and no home. It keeps its target
//    while that is still an enemy within aggroRange (or its weapon range); else it takes the nearest enemy unit within
//    aggroRange, else the nearest enemy building within aggroRange (walls, turrets, sites: what blocks it), else the
//    nearest player entity that is shooting at it (it was hit: World.lastHit, cleared here); else it marches on the HQ
//    of its wave's target (lowest index; a wave without a target goes for the nearest HQ). It attacks in reach and
//    walks otherwise. Players' units and turrets acquire wave units by themselves (creepAwake).
//  - Kill reward (system 8, creepDeath): the owner of the killing blow (World.lastHit), while he still plays, gets the
//    unit's lootScrap and his hero its heroXp (grantXp; no radius), on top of the kill and assist xp of combat.
//  - Win and loss (system 7, instead of the win routes A, B and C): when no player has an HQ left, the horde wins
//    (winner HORDE_WINNER, WIN_OVERRUN). When the win wave has spawned all its batches and (requireAllWaveUnitsDead) no
//    unit of it lives while a player still has an HQ, the players win (winner the lowest playerId still playing,
//    WIN_SURVIVED: a team win). Sim.winner() stays null for both; Sim.survivalStatus().result reports them.
//  - Build zones: a player builds (Build, also the AI) only with the footprint centre within the radius of the zone of
//    his slot; claim buildings (provides claim) anywhere (PLACE_ZONE otherwise).

/** Winner of a run the horde won (globals.winner; no player, not NO_WINNER). */
export const HORDE_WINNER = -1;

/** Survival (sim 0.27.0): the players survived the win wave (a team win). */
export const WIN_SURVIVED = 5;

/** Survival (sim 0.27.0): every HQ is gone; the horde won. */
export const WIN_OVERRUN = 6;

/** System 2: the waves and the behaviour of their units (see the top of this file). */
export function survivalSystem(ctx: SimContext): void {
  const s = survivalOf(ctx);
  const sm = ctx.map.survival;
  if (s === undefined || sm === undefined) return;
  if (ctx.globals.winner === NO_WINNER) spawnWaves(ctx, s, sm);
  const w = ctx.world;
  const aggro = ctx.config.aggroRange;
  for (let i = 0; i < w.highWater; i++) {
    if (w.alive[i] !== 1 || w.creepCamp[i] !== CREEP_SURVIVAL) continue;
    if (!w.has(i, C.unit | C.health) || w.hp[i]! <= 0) continue;
    const reach = w.range[i]! > aggro ? w.range[i]! : aggro;
    const cur = w.target[i] === NO_ENTITY ? -1 : w.resolve(w.target[i]!);
    let t = cur >= 0 && isEnemy(w, i, cur) && withinReach(w, i, cur, reach) ? cur : -1;
    if (t < 0) t = nearestEnemy(ctx, i, aggro);
    if (t < 0 && w.lastHit[i] !== 0) t = attackerOf(ctx, i);
    w.lastHit[i] = 0;
    if (t < 0) t = marchGoal(ctx, i);
    if (t < 0) {
      w.target[i] = NO_ENTITY;
      if (w.mvOn[i] === 1) stopMoving(ctx, i);
      continue;
    }
    w.target[i] = w.idOf(t);
    if (withinReach(w, i, t, w.range[i]!)) {
      if (w.mvOn[i] === 1) stopMoving(ctx, i);
      face(w, i, w.x[t]!, w.y[t]!);
    } else if ((w.mask[t]! & C.building) !== 0) steerToEntity(ctx, i, t);
    else steerChase(ctx, i, w.x[t]!, w.y[t]!);
  }
}

/** The nearest enemy unit of wave unit i within r, else the nearest enemy building within r; lowest index on a tie. */
function nearestEnemy(ctx: SimContext, i: number, r: number): number {
  const w = ctx.world;
  let bestU = -1;
  let bestUD = 0;
  let bestB = -1;
  let bestBD = 0;
  for (let j = 0; j < w.highWater; j++) {
    // the distance first: it is cheap and rejects nearly every entity before isEnemy (same result, both are pure)
    if (w.alive[j] !== 1 || !withinReach(w, i, j, r) || !isEnemy(w, i, j)) continue;
    const dx = w.x[j]! - w.x[i]!;
    const dy = w.y[j]! - w.y[i]!;
    const d = dx * dx + dy * dy;
    if ((w.mask[j]! & C.building) === 0) {
      if (bestU < 0 || d < bestUD) {
        bestU = j;
        bestUD = d;
      }
    } else if (bestB < 0 || d < bestBD) {
      bestB = j;
      bestBD = d;
    }
  }
  return bestU >= 0 ? bestU : bestB;
}

/** The nearest player entity whose target is wave unit i (who hits it), or -1. */
function attackerOf(ctx: SimContext, i: number): number {
  const w = ctx.world;
  const id = w.idOf(i);
  let best = -1;
  let bestD = 0;
  for (let j = 0; j < w.highWater; j++) {
    if (w.alive[j] !== 1 || w.target[j] !== id || !isEnemy(w, i, j)) continue;
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

/** The HQ wave unit i marches on: its wave's target's, else the nearest HQ of any player; -1 when none is left. */
function marchGoal(ctx: SimContext, i: number): number {
  const w = ctx.world;
  const t = ctx.survival.target[w.creepHome[i]!]! - 1;
  const own = t >= 0 ? hqOf(ctx, t) : -1;
  if (own >= 0) return own;
  let best = -1;
  let bestD = 0;
  for (let p = 0; p < ctx.playerCount; p++) {
    const hq = hqOf(ctx, p);
    if (hq < 0) continue;
    const dx = w.x[hq]! - w.x[i]!;
    const dy = w.y[hq]! - w.y[i]!;
    const d = dx * dx + dy * dy;
    if (best < 0 || d < bestD) {
      best = hq;
      bestD = d;
    }
  }
  return best;
}

/** System 8 (from creepDeath): wave unit i died; the kill reward (see the top of this file). */
export function survivalDeath(ctx: SimContext, i: number): void {
  const s = survivalOf(ctx);
  if (s === undefined) return;
  const w = ctx.world;
  const by = w.lastHit[i]! - 1;
  if (by < 0 || by >= ctx.playerCount || ctx.ps.defeated[by] !== 0) return;
  const u = s.typeIds.indexOf(w.typeId[i]!);
  if (u < 0) return;
  ctx.ps.scrap[by] = ctx.ps.scrap[by]! + s.lootScrap[u]!;
  grantXp(ctx, by, s.heroXp[u]!);
}

/** Living units of wave index k. */
export function waveAlive(ctx: SimContext, k: number): number {
  const w = ctx.world;
  let n = 0;
  for (let i = 0; i < w.highWater; i++) {
    if (w.alive[i] !== 1 || w.creepCamp[i] !== CREEP_SURVIVAL || w.creepHome[i] !== k) continue;
    if (w.has(i, C.unit | C.health) && w.hp[i]! > 0) n++;
  }
  return n;
}

/**
 * System 7 (claims winRoutes, after the defeats): the outcome of a survival run (see the top of this file). True in
 * the game type Survival: then the win routes A, B and C do not apply.
 */
export function survivalOutcome(
  ctx: SimContext,
  declare: (p: number, reason: number) => void,
): boolean {
  const s = survivalOf(ctx);
  if (s === undefined) return false;
  if (ctx.globals.winner !== NO_WINNER) return true;
  let alive = -1;
  for (let p = ctx.playerCount - 1; p >= 0; p--)
    if (ctx.ps.defeated[p] === 0 && hqOf(ctx, p) >= 0) alive = p;
  if (alive < 0) {
    declare(HORDE_WINNER, WIN_OVERRUN);
    return true;
  }
  const k = s.winWave - 1;
  const spawned = ctx.survival.batches[k]! >= s.waves[k]!.batches;
  if (spawned && (!s.requireAllWaveUnitsDead || waveAlive(ctx, k) === 0))
    declare(alive, WIN_SURVIVED);
  return true;
}

/**
 * Build zone (placementReasonAt): PLACE_ZONE when player p places bt at footprint origin (fx, fy) outside the zone
 * of his slot in the game type Survival; 0 (PLACE_OK) otherwise. Claim buildings may stand anywhere.
 */
export function survivalZoneReason(
  ctx: SimContext,
  bt: SimBuildingType,
  fx: number,
  fy: number,
  p: number,
): number {
  const sm = ctx.map.survival;
  if (sm === undefined || p < 0 || (bt.provides & PROVIDES_CLAIM) !== 0) return PLACE_OK;
  const z = sm.zones[p];
  if (z === undefined) return PLACE_ZONE;
  const dx = (fx << 8) + (bt.footprintW << 7) - z.x;
  const dy = (fy << 8) + (bt.footprintH << 7) - z.y;
  return dx * dx + dy * dy <= z.radius * z.radius ? PLACE_OK : PLACE_ZONE;
}

/** What the HUD needs of a survival run (Sim.survivalStatus; sim API, no protocol type yet: contractvoorstel). */
export interface SurvivalStatus {
  /** Waves that have started (0 before wave 1), and the total. */
  readonly wavesStarted: number;
  readonly waves: number;
  /** The next wave: its number, start frame and rank (RANK_*: the highest of its units); null after the last. */
  readonly next: { readonly wave: number; readonly atFrame: number; readonly rank: number } | null;
  /** Per started wave (index = wave - 1): its target player (-1 none) and its living units. */
  readonly active: readonly { readonly target: number; readonly alive: number }[];
  /**
   * The end of the run, null while it runs: 'survived' is a team win (every player), 'overrun' the horde's (every
   * player lost); frame as SimWinner.frame. Sim.winner() stays null in Survival (WinReason has no team outcome).
   */
  readonly result: { readonly outcome: 'survived' | 'overrun'; readonly frame: number } | null;
}

function resultOf(ctx: SimContext): SurvivalStatus['result'] {
  const g = ctx.globals;
  if (g.winner === NO_WINNER) return null;
  if (g.reason === WIN_SURVIVED) return { outcome: 'survived', frame: g.frame };
  return g.reason === WIN_OVERRUN ? { outcome: 'overrun', frame: g.frame } : null;
}

export function survivalStatusOf(ctx: SimContext): SurvivalStatus | null {
  const s = survivalOf(ctx);
  if (s === undefined) return null;
  const st = ctx.survival;
  let started = 0;
  while (started < s.waves.length && st.batches[started]! > 0) started++;
  const nw = s.waves[started];
  let rank = 0;
  for (const e of nw?.spawns ?? []) {
    const r = s.ranks[s.typeIds.indexOf(e.typeId)] ?? 0;
    if (r > rank) rank = r;
  }
  const active: { target: number; alive: number }[] = [];
  for (let k = 0; k < started; k++)
    active.push({ target: st.target[k]! - 1, alive: waveAlive(ctx, k) });
  return {
    wavesStarted: started,
    waves: s.waves.length,
    next: nw === undefined ? null : { wave: started + 1, atFrame: nw.atTicks, rank },
    active,
    result: resultOf(ctx),
  };
}
