import { EVENT_TYPE, MAX_PLAYERS, OWNER_NEUTRAL } from '@crawlout/protocol';
import type { ProjectPartState, ProjectStatus } from '@crawlout/protocol';
import type { SimBuildingType, SimEffect, SimProjectPart } from '../config.js';
import { EFFECT_TARGET_ALL, EFFECT_TARGET_HERO, MAX_PROJECT_SITES } from '../config.js';
import { BSTATE_DONE, BSTATE_SITE, C, NO_ENTITY } from '../ecs/world.js';
import { PROGRESS_ONE, createBuilding, footprintOrigin } from '../entities.js';
import { applyStats, refreshPlayer } from '../effects.js';
import { clampI, idiv } from '../math/int.js';
import type { SimContext } from './common.js';

// Win route C, Bouwproject (sim 0.25.0, data 0.31.0; voorstel, ter bevestiging door de architect; ontwerp in
// docs/winroute-c-winkelcentrum.md). An old strip mall: its parts (data/project.json parts, the kinds) stand as
// neutral ruins on the map (SimMap.projectSites, only in the game type Bouwproject).
//
// A part is one building entity for the whole match, created in start() after the creep camps, in map order; it is
// never freed, so the part index k (ctx.projectParts[k], derived) is stable. Its typeId tells its state:
//  - ruin: the ruin type of its kind, owner OWNER_NEUTRAL, done, full hp. Nobody's enemy (isEnemy), no vision, no beds.
//  - restoring: the restored type, owner p, a building site of p (BSTATE_SITE): Build on the ruin by p's builders paid
//    the restore (scrapCost of the restored type) at once; the builders build it up like any site (buildTicks, hp from
//    1 to max, help, resume, auto-help).
//  - restored: the restored type, owner p, done: p's building (target, territory, vision, beds) and p gets the effects
//    of its kind (effectSum, once per kind, like a researched tech).
// At 0 hp a restoring or restored part falls back to a ruin (cleanup, event death); Cancel on an own restoring part does
// too, with the refund. A ruin is restored again by whoever comes (also the enemy).
//
// The countdown (step 7, before the win routes): a player who holds a restored part of every kind adds one tick to
// PlayerState.projTicks, unless one of his restored parts took damage within the last pauseTicks (the sabotage pause:
// ProjectState.hit, from the hp drop since the last tick); a player who lacks a kind is back at 0. At countdownTicks he
// wins (WIN_PROJECT). Two players can run their countdowns at once (two wings): the first to finish wins.

/** Win route C state per part index (in serialize and hash after the creep camps). */
export class ProjectState {
  /** Ticks left of the sabotage pause: the part took damage within pauseTicks. */
  readonly hit = new Int32Array(MAX_PROJECT_SITES);
  /** hp at the end of the last tick, to see damage without touching combat. */
  readonly lastHp = new Int32Array(MAX_PROJECT_SITES);
}

/** Kind (index in config.project.parts) of a project building type, ruin or restored, else -1. */
export function projectKindOf(ctx: SimContext, typeId: number): number {
  const parts = ctx.config.project?.parts;
  if (parts === undefined) return -1;
  for (let k = 0; k < parts.length; k++) {
    const pt = parts[k]!;
    if (pt.restoredTypeId === typeId || pt.ruinTypeId === typeId) return k;
  }
  return -1;
}

/** Part index of entity i (its position in ctx.projectParts), else -1. */
export function projectPartIndex(ctx: SimContext, i: number): number {
  const parts = ctx.projectParts;
  for (let k = 0; k < parts.length; k++) if (parts[k] === i) return k;
  return -1;
}

/** Whether entity i is a part of the Bouwproject (in any state). */
export const isProjectPart = (ctx: SimContext, i: number): boolean =>
  ctx.projectParts.length > 0 && projectPartIndex(ctx, i) >= 0;

const partOf = (ctx: SimContext, i: number): SimProjectPart | undefined => {
  const kind = projectKindOf(ctx, ctx.world.typeId[i]!);
  return kind < 0 ? undefined : ctx.config.project!.parts[kind];
};

/** Start setup (after the creep camps): every site of the map as a ruin, in map order. */
export function spawnProjectSites(ctx: SimContext, out: number[]): void {
  out.length = 0;
  const sites = ctx.map.projectSites ?? [];
  const pr = ctx.config.project;
  if (pr === undefined) return;
  for (const site of sites) {
    const bt = ctx.buildingType(pr.parts[site.kind]!.ruinTypeId)!;
    const { fx, fy } = footprintOrigin(site.x, site.y, bt.footprintW, bt.footprintH);
    const i = createBuilding(ctx, bt, OWNER_NEUTRAL, fx, fy, true);
    if (i < 0) return;
    ctx.project.lastHp[out.length] = ctx.world.hp[i]!;
    out.push(i);
  }
}

/** After a load: the part indices from the world (buildings of a project type, ascending index = map order). */
export function indexProjectParts(ctx: SimContext, out: number[]): void {
  out.length = 0;
  if ((ctx.map.projectSites ?? []).length === 0) return;
  const w = ctx.world;
  for (let i = 0; i < w.highWater; i++)
    if (w.has(i, C.building) && projectKindOf(ctx, w.typeId[i]!) >= 0) out.push(i);
}

/**
 * Build on a ruin (commands.ts applyBuild): if bt is a project type and the footprint at (fx, fy) is a ruin of its kind,
 * player p restores it when he can pay: the part becomes his building site of the restored type (hp 1, progress 0) and
 * the restore is paid. Returns the part index of the world, or -1 (not a ruin here, or not affordable).
 */
export function restoreRuinAt(
  ctx: SimContext,
  p: number,
  bt: SimBuildingType,
  fx: number,
  fy: number,
): number {
  const kind = projectKindOf(ctx, bt.typeId);
  if (kind < 0 || fx < 0 || fy < 0 || fx >= ctx.map.w || fy >= ctx.map.h) return -1;
  const w = ctx.world;
  const i = ctx.terrain.occ[fy * ctx.map.w + fx]! - 1;
  const pt = ctx.config.project!.parts[kind]!;
  if (
    i < 0 ||
    w.fx[i] !== fx ||
    w.fy[i] !== fy ||
    w.typeId[i] !== pt.ruinTypeId ||
    w.owner[i] !== OWNER_NEUTRAL ||
    !isProjectPart(ctx, i)
  )
    return -1;
  const rt = ctx.buildingType(pt.restoredTypeId)!;
  if (ctx.ps.scrap[p]! < rt.scrapCost) return -1;
  ctx.ps.scrap[p] = ctx.ps.scrap[p]! - rt.scrapCost;
  w.typeId[i] = rt.typeId;
  w.owner[i] = p;
  w.armorType[i] = rt.armorType;
  w.damageType[i] = rt.damageType;
  applyStats(ctx, i, false);
  w.bstate[i] = BSTATE_SITE;
  w.progress[i] = 0;
  w.hp[i] = 1;
  w.lastHit[i] = 0;
  const k = projectPartIndex(ctx, i);
  ctx.project.lastHp[k] = 1;
  ctx.project.hit[k] = 0;
  ctx.events.push(EVENT_TYPE.buildingPlaced, w.idOf(i), rt.typeId, w.x[i]!, w.y[i]!);
  return i;
}

/**
 * A restoring or restored part falls back to a ruin (0 hp in cleanup, or Cancel by its owner): the ruin type, neutral,
 * done, full hp. A restored part takes its effects from its former owner (his stats again).
 */
export function revertToRuin(ctx: SimContext, i: number): void {
  const w = ctx.world;
  const pt = partOf(ctx, i);
  if (pt === undefined) return;
  const owner = w.owner[i]!;
  const wasDone = w.bstate[i] === BSTATE_DONE;
  const ruin = ctx.buildingType(pt.ruinTypeId)!;
  w.typeId[i] = ruin.typeId;
  w.owner[i] = OWNER_NEUTRAL;
  w.armorType[i] = ruin.armorType;
  w.damageType[i] = ruin.damageType;
  w.maxHp[i] = ruin.maxHp;
  w.hp[i] = ruin.maxHp;
  w.bstate[i] = BSTATE_DONE;
  w.progress[i] = ruin.buildTicks * PROGRESS_ONE;
  w.target[i] = NO_ENTITY;
  w.lastHit[i] = 0;
  const k = projectPartIndex(ctx, i);
  if (k >= 0) {
    ctx.project.lastHp[k] = ruin.maxHp;
    ctx.project.hit[k] = 0;
  }
  if (wasDone && owner < MAX_PLAYERS) refreshPlayer(ctx, owner);
}

/** A part was restored (economy: completeBuilding): its owner gets the effects of its kind. */
export function partRestored(ctx: SimContext, i: number): void {
  const o = ctx.world.owner[i]!;
  if (o < MAX_PLAYERS && isProjectPart(ctx, i)) refreshPlayer(ctx, o);
}

/** Bitset of the kinds of which player p holds a restored part. */
export function kindsHeld(ctx: SimContext, p: number): number {
  const w = ctx.world;
  const parts = ctx.projectParts;
  let bits = 0;
  for (let k = 0; k < parts.length; k++) {
    const i = parts[k]!;
    // a part at 0 hp falls back to a ruin in this tick's cleanup: it counts no more
    if (w.owner[i] !== p || w.bstate[i] !== BSTATE_DONE || w.hp[i]! <= 0) continue;
    const kind = projectKindOf(ctx, w.typeId[i]!);
    if (kind >= 0) bits |= 1 << kind;
  }
  return bits;
}

const bitCount = (m: number): number => {
  let n = 0;
  for (let b = m; b !== 0; b &= b - 1) n++;
  return n;
};

const matches = (e: SimEffect, stat: number, typeId: number, isHero: boolean): boolean =>
  e.stat === stat &&
  (e.target === EFFECT_TARGET_ALL ||
    (e.target === EFFECT_TARGET_HERO ? isHero : e.typeId === typeId));

/** Sum of the effects of the kinds player p holds a restored part of, on `stat` for type typeId (effects.ts effectSum). */
export function projectEffectSum(
  ctx: SimContext,
  p: number,
  stat: number,
  typeId: number,
  isHero: boolean,
): number {
  if (ctx.projectParts.length === 0 || p >= MAX_PLAYERS) return 0;
  const held = kindsHeld(ctx, p);
  if (held === 0) return 0;
  const kinds = ctx.config.project!.parts;
  let sum = 0;
  for (let k = 0; k < kinds.length; k++) {
    if (((held >>> k) & 1) === 0) continue;
    for (const e of kinds[k]!.effects) if (matches(e, stat, typeId, isHero)) sum += e.delta;
  }
  return sum;
}

/** Whether one of p's restored parts is in its sabotage pause. */
function pausedFor(ctx: SimContext, p: number): boolean {
  const w = ctx.world;
  const parts = ctx.projectParts;
  for (let k = 0; k < parts.length; k++) {
    const i = parts[k]!;
    if (w.owner[i] === p && w.bstate[i] === BSTATE_DONE && ctx.project.hit[k]! > 0) return true;
  }
  return false;
}

/**
 * Step 7 (claims and win routes, before the win check): the sabotage pause per part from its hp drop, then the countdown
 * per player. Returns the first player (in playerId order) whose countdown completes this tick, else -1.
 */
export function projectSystem(ctx: SimContext): number {
  const parts = ctx.projectParts;
  const pr = ctx.config.project;
  if (parts.length === 0 || pr === undefined) return -1;
  const w = ctx.world;
  const st = ctx.project;
  for (let k = 0; k < parts.length; k++) {
    const i = parts[k]!;
    const hp = w.hp[i]!;
    if (w.owner[i]! < MAX_PLAYERS && hp < st.lastHp[k]!) st.hit[k] = pr.pauseTicks;
    else if (st.hit[k]! > 0) st.hit[k] = st.hit[k]! - 1;
    st.lastHp[k] = hp;
  }
  const all = (1 << pr.parts.length) - 1;
  let done = -1;
  for (let p = 0; p < ctx.playerCount; p++) {
    if (ctx.ps.defeated[p] !== 0 || kindsHeld(ctx, p) !== all) {
      ctx.ps.projTicks[p] = 0;
      continue;
    }
    if (pausedFor(ctx, p)) continue;
    ctx.ps.projTicks[p] = ctx.ps.projTicks[p]! + 1;
    if (done < 0 && ctx.ps.projTicks[p]! >= pr.countdownTicks) done = p;
  }
  return done;
}

const permille = (a: number, b: number): number =>
  b <= 0 ? 1000 : clampI(idiv(a * 1000, b), 0, 1000);

/** The Bouwproject for the HUD (PlayerStatus.project, protocol 0.16.0), or null without project sites. Only reads state. */
export function projectStatus(ctx: SimContext): ProjectStatus | null {
  const parts = ctx.projectParts;
  const pr = ctx.config.project;
  if (parts.length === 0 || pr === undefined) return null;
  const w = ctx.world;
  const out: ProjectStatus = {
    kinds: pr.parts.length,
    ticksRequired: pr.countdownTicks,
    parts: [],
    players: [],
  };
  for (let k = 0; k < parts.length; k++) {
    const i = parts[k]!;
    const kind = projectKindOf(ctx, w.typeId[i]!);
    const bt = ctx.buildingType(w.typeId[i]!)!;
    const ruin = w.owner[i] === OWNER_NEUTRAL;
    const state: ProjectPartState = ruin
      ? 'ruin'
      : w.bstate[i] === BSTATE_SITE
        ? 'restoring'
        : 'restored';
    out.parts.push({
      partId: w.idOf(i),
      kind,
      x: w.x[i]!,
      y: w.y[i]!,
      state,
      owner: w.owner[i]!,
      progressPermille:
        state === 'ruin' ? 0 : permille(w.progress[i]!, bt.buildTicks * PROGRESS_ONE),
      hpPermille: permille(w.hp[i]!, w.maxHp[i]!),
      underAttack: !ruin && ctx.project.hit[k]! > 0,
    });
  }
  for (let p = 0; p < ctx.playerCount; p++) {
    if (ctx.ps.defeated[p] !== 0) continue;
    const held = kindsHeld(ctx, p);
    out.players.push({
      playerId: p,
      kindsHeld: bitCount(held),
      ticksHeld: ctx.ps.projTicks[p]!,
      paused: held === (1 << pr.parts.length) - 1 && pausedFor(ctx, p),
    });
  }
  return out;
}
