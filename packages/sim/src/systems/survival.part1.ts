// Survival co-op, part 1: state, the weakest-player rule and the wave spawner. survival.ts re-exports the public surface.
// Holds: SurvivalState, survivalOf, hqOf, threatScore, weakestPlayer, waveUnits, spawnWaves.
import { OWNER_NEUTRAL } from '@crawlout/protocol';
import { ROLES } from '@crawlout/data';
import {
  MAX_SURVIVAL_WAVES,
  RANK_NORMAL,
  type SimSurvival,
  type SimSurvivalMap,
  type SimSurvivalWave,
} from '../config.js';
import { BSTATE_DONE, C, CREEP_SURVIVAL, SLAVE_NONE } from '../ecs/world.js';
import { HERO_ALIVE } from '../effects.js';
import { createUnit } from '../entities.js';
import { PROVIDES_HQ, PROVIDES_TURRET } from '../fromData.part1.js';
import { clampI, idiv, imod } from '../math/int.js';
import {
  type SimContext,
  cellAt,
  cellCenterOf,
  componentAt,
  face,
  nearestFreeCellAround,
} from './common.js';

// Survival co-op (sim 0.27.0, data 0.33.0; voorstel, ter bevestiging door de architect; docs/survival-coop.md).
// Only with SimMap.survival (MatchSettings.mode 'survival'); every number comes from data/survival (SimConfig.survival).
//
//  - Waves (system 2, after the creep camps): wave k spawns batch b in the tick of frame atTicks + b * batchIntervalTicks
//    (one batch per wave per tick). Before batch 0 the wave picks its target (weakestPlayer); before every later tick
//    of a living wave whose target lost all HQs it picks again (the retarget). The units of the wave (waveUnits: per
//    spawn entry ceil(count * countPermille / 1000), a miniboss or boss keeps its count) split in file order over the
//    batches (batch b: units floor(b * N / B) up to floor((b + 1) * N / B)); a batch splits over `edges` edges, the rest
//    to the first, starting at the target's zone edge (nearEdge) and then clockwise (SimSurvivalMap.edges order).
//  - A wave unit: neutral (OWNER_NEUTRAL), no orders, World.creepCamp CREEP_SURVIVAL and World.creepHome its wave
//    index; hp and damage times hpPermille and damagePermille of the player count. It stands on a walkable cell of the
//    edge point's terrain piece within spread of it (a point drawn with sim.rng, then the nearest walkable cell).
//  - The weakest player: every player who still plays and has an HQ scores S = unitScrapPermille x the scrapCost of
//    his living fighters (role militia, not a slave or captive, not the hero) and robots + turretScrapPermille x the
//    scrapCost of his finished turrets (provides turret) + heroScrap while his hero lives; lowest S, then lowest HQ hp
//    permille, then lowest slot (playerId).

/** Survival state (serialize and hash only in the game type Survival, after the project parts; state.ts). */
export class SurvivalState {
  /** Derived from the env (SimMap.survival), not state: whether the chunks below exist. */
  active = false;
  /** Per wave index: its target player + 1 (0 = none: not started, or no player with an HQ left). */
  readonly target = new Int32Array(MAX_SURVIVAL_WAVES);
  /** Per wave index: batches spawned so far. */
  readonly batches = new Int32Array(MAX_SURVIVAL_WAVES);
}

/** The survival rules when this is the game type Survival, else undefined. */
export function survivalOf(ctx: SimContext): SimSurvival | undefined {
  return ctx.map.survival === undefined ? undefined : ctx.config.survival;
}

const ROLE_MILITIA = ROLES.indexOf('militia');

/** Player p's HQ with the lowest index (any build state, hp above 0), or -1. */
export function hqOf(ctx: SimContext, p: number): number {
  const w = ctx.world;
  const idx = ctx.index;
  idx.refresh(w);
  let best = -1;
  for (let k = 0; k < idx.buildingCount; k++) {
    const j = idx.buildings[k]!;
    if (w.owner[j] !== p || w.hp[j]! <= 0 || (best >= 0 && j > best)) continue;
    const bt = ctx.buildingType(w.typeId[j]!);
    if (bt !== undefined && (bt.provides & PROVIDES_HQ) !== 0) best = j;
  }
  return best;
}

/** The score S of player p for the weakest-player rule (see the top of this file). */
export function threatScore(ctx: SimContext, s: SimSurvival, p: number): number {
  const w = ctx.world;
  let units = 0;
  let turrets = 0;
  for (let i = 0; i < w.highWater; i++) {
    if (w.alive[i] !== 1 || w.owner[i] !== p || !w.has(i, C.health) || w.hp[i]! <= 0) continue;
    const m = w.mask[i]!;
    if ((m & C.building) !== 0) {
      const bt = ctx.buildingType(w.typeId[i]!);
      if (bt !== undefined && (bt.provides & PROVIDES_TURRET) !== 0 && w.bstate[i] === BSTATE_DONE)
        turrets += bt.scrapCost;
      continue;
    }
    if ((m & C.unit) === 0 || (m & (C.hero | C.corpse)) !== 0) continue;
    const ut = ctx.unitType(w.typeId[i]!);
    if (ut === undefined) continue;
    const fighter = w.role[i] === ROLE_MILITIA && w.slaveState[i] === SLAVE_NONE;
    if (ut.producedAtTypeId !== 0 || fighter) units += ut.scrapCost;
  }
  const hero = ctx.ps.heroState[p] === HERO_ALIVE ? s.heroScrap : 0;
  return (
    idiv(units * s.unitScrapPermille, 1000) + idiv(turrets * s.turretScrapPermille, 1000) + hero
  );
}

/** The target of a wave: the weakest player with an HQ (see the top of this file), or -1 when nobody has one. */
export function weakestPlayer(ctx: SimContext, s: SimSurvival): number {
  const w = ctx.world;
  let best = -1;
  let bestS = 0;
  let bestHp = 0;
  for (let p = 0; p < ctx.playerCount; p++) {
    if (ctx.ps.defeated[p] !== 0) continue;
    const hq = hqOf(ctx, p);
    if (hq < 0) continue;
    const score = threatScore(ctx, s, p);
    const hp = idiv(w.hp[hq]! * 1000, w.maxHp[hq]! > 0 ? w.maxHp[hq]! : 1);
    if (best < 0 || score < bestS || (score === bestS && hp < bestHp)) {
      best = p;
      bestS = score;
      bestHp = hp;
    }
  }
  return best;
}

/** The scaling row of a player count (1 to 4). */
const scalingOf = (s: SimSurvival, players: number) =>
  s.scaling[clampI(players, 1, s.scaling.length) - 1]!;

/** The unit typeIds of a wave for `players` players, in file order (see the top of this file). */
export function waveUnits(s: SimSurvival, wave: SimSurvivalWave, players: number): number[] {
  const sc = scalingOf(s, players);
  const out: number[] = [];
  for (const e of wave.spawns) {
    const rank = s.ranks[s.typeIds.indexOf(e.typeId)];
    const n = rank === RANK_NORMAL ? idiv(e.count * sc.countPermille + 999, 1000) : e.count;
    for (let k = 0; k < n; k++) out.push(e.typeId);
  }
  return out;
}

/** System 2: retarget the living waves, then spawn every batch that is due (see the top of this file). */
export function spawnWaves(ctx: SimContext, s: SimSurvival, sm: SimSurvivalMap): void {
  const st = ctx.survival;
  for (let k = 0; k < s.waves.length; k++) {
    if (st.batches[k] === 0) continue;
    const t = st.target[k]! - 1;
    if (t < 0 || ctx.ps.defeated[t] !== 0 || hqOf(ctx, t) < 0)
      st.target[k] = weakestPlayer(ctx, s) + 1;
  }
  for (let k = 0; k < s.waves.length; k++) {
    const wave = s.waves[k]!;
    const b = st.batches[k]!;
    if (b >= wave.batches || ctx.frame < wave.atTicks + b * wave.batchIntervalTicks) continue;
    if (b === 0) st.target[k] = weakestPlayer(ctx, s) + 1;
    spawnBatch(ctx, s, sm, k, b);
    st.batches[k] = b + 1;
  }
}

function spawnBatch(
  ctx: SimContext,
  s: SimSurvival,
  sm: SimSurvivalMap,
  k: number,
  b: number,
): void {
  const wave = s.waves[k]!;
  const units = waveUnits(s, wave, ctx.playerCount);
  const lo = idiv(b * units.length, wave.batches);
  const hi = idiv((b + 1) * units.length, wave.batches);
  const t = ctx.survival.target[k]! - 1;
  const start = t >= 0 && t < sm.zones.length ? sm.zones[t]!.nearEdge : 0;
  const e = clampI(wave.edges, 1, sm.edges.length);
  const per = idiv(hi - lo, e);
  let u = lo;
  for (let j = 0; j < e; j++) {
    const edge = sm.edges[imod(start + j, sm.edges.length)]!;
    const n = j === 0 ? hi - lo - (e - 1) * per : per;
    for (let m = 0; m < n; m++) spawnOne(ctx, s, units[u++]!, k, edge, t);
  }
}

function spawnOne(
  ctx: SimContext,
  s: SimSurvival,
  typeId: number,
  k: number,
  edge: SimSurvivalMap['edges'][number],
  target: number,
): void {
  const ut = ctx.unitType(typeId);
  if (ut === undefined) return;
  const map = ctx.map;
  const r = edge.spread;
  let dx = 0;
  let dy = 0;
  if (r > 0) {
    do {
      dx = ctx.rng.nextInt(2 * r + 1) - r;
      dy = ctx.rng.nextInt(2 * r + 1) - r;
    } while (dx * dx + dy * dy > r * r);
  }
  const px = clampI(edge.x + dx, 0, (map.w << 8) - 1);
  const py = clampI(edge.y + dy, 0, (map.h << 8) - 1);
  // the drawn point counts only on the edge point's piece of terrain (the border holds walled-off pockets)
  const sameComponent = componentAt(ctx, px, py) === componentAt(ctx, edge.x, edge.y);
  const ax = sameComponent ? px : edge.x;
  const ay = sameComponent ? py : edge.y;
  let c = cellAt(map, ax, ay);
  if (ctx.terrain.walk[c] !== 1) c = nearestFreeCellAround(ctx, ax >> 8, ay >> 8, 1, 1, ax, ay);
  if (c < 0) return;
  const at = cellCenterOf(map, c);
  const w = ctx.world;
  const i = createUnit(ctx, ut, OWNER_NEUTRAL, at.x, at.y, 0);
  if (i < 0) return;
  w.mask[i] = w.mask[i]! & ~C.orders;
  w.creepCamp[i] = CREEP_SURVIVAL;
  w.creepHome[i] = k;
  const sc = scalingOf(s, ctx.playerCount);
  w.maxHp[i] = Math.max(1, idiv(w.maxHp[i]! * sc.hpPermille, 1000));
  w.hp[i] = w.maxHp[i]!;
  w.damage[i] = idiv(w.damage[i]! * sc.damagePermille, 1000);
  const hq = target >= 0 ? hqOf(ctx, target) : -1;
  if (hq >= 0) face(w, i, w.x[hq]!, w.y[hq]!);
  else face(w, i, map.w << 7, map.h << 7);
}
