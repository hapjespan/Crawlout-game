// Split from aiRaiders.ts to stay under the 5,000-token file limit; aiRaiders.ts re-exports the public surface.
// Holds: gatherIdle, raidSpot, besideNode, attackMove, homePoint, slaveRaid, +4 more.
import { type SimContext, nodeAllowed, visibleTo } from './common.js';
import {
  type SimAiScript,
  type SimSlaveRules,
  type SimRaidPlan,
  AI_SITE_FRONT,
  AI_SITE_HQ,
} from '../config.js';
import {
  type AiScratch,
  fieldOf,
  exclusiveFor,
  type Fields,
  ESCORT_OFFSET,
  chunks,
  rallyCell,
  stepAlong,
  ownClaimNear,
  heroClaimNear,
} from './ai.js';
import { TERRAIN_UNREACHABLE } from '../pathdist.js';
import { workReach } from './slaves.js';
import { applyCommand } from './commands.js';
import { PROVIDES_HQ } from '../fromData.js';
import { idiv } from '../math/int.js';
import { pointsOf } from './claims.js';
import {
  C,
  SLAVE_NONE,
  ORDER_NONE,
  ORDER_ATTACK_MOVE,
  ORDER_GUARD,
  ORDER_MOVE,
} from '../ecs/world.js';
import type { Tally } from './aiRaiders.part1.js';

/** Step 6: idle slaves to a node within their reach with room (exclusive first, then the shortest trip). */
export function gatherIdle(
  ctx: SimContext,
  p: number,
  script: SimAiScript,
  t: Tally,
  scratch: AiScratch,
): void {
  if (t.idleScavs.length === 0) return;
  const w = ctx.world;
  const idx = ctx.index;
  const load = scratch.nodeLoad;
  const cost = scratch.nodeCost;
  for (let k = 0; k < idx.nodeCount; k++) {
    const j = idx.nodes[k]!;
    let c = TERRAIN_UNREACHABLE;
    for (const dep of t.depots) {
      const d = ctx.terrainDist.at(fieldOf(ctx, dep), w.x[j]!, w.y[j]!);
      if (d < c) c = d;
    }
    cost[j] = c;
  }
  for (const id of t.idleScavs) {
    const reach = workReach(ctx, w.resolve(id));
    if (reach !== null && reach.r < 0) continue;
    let best = -1;
    let bestEx = false;
    let bestD = 0;
    let any = -1;
    let anyD = 0;
    for (let k = 0; k < idx.nodeCount; k++) {
      const j = idx.nodes[k]!;
      if (w.amount[j]! <= 0 || cost[j] === TERRAIN_UNREACHABLE || !nodeAllowed(ctx, j, p)) continue;
      if (reach !== null) {
        const dx = w.x[j]! - reach.x;
        const dy = w.y[j]! - reach.y;
        if (dx * dx + dy * dy > reach.r * reach.r) continue;
      }
      const d = cost[j]!;
      if (any < 0 || d < anyD) {
        any = j;
        anyD = d;
      }
      if (load[j]! >= script.scavengersPerNode) continue;
      const ex = exclusiveFor(ctx, j, p);
      if (best < 0 || (ex && !bestEx) || (ex === bestEx && d < bestD)) {
        best = j;
        bestEx = ex;
        bestD = d;
      }
    }
    if (best < 0) best = any;
    if (best < 0) continue;
    load[best] = load[best]! + 1;
    applyCommand(ctx, {
      playerId: p,
      seq: 0,
      type: 'Gather',
      payload: { ids: [id], nodeId: w.idOf(best) },
    });
  }
}

/**
 * Where the Raiders rob and harass, outside the enemy's base radius (minDistanceFromOwnerBase from each of his
 * headquarters) and with scrap (map knowledge): a node exclusive to him (near one of his claim points: his workers go
 * there first), else any node, each the nearest his spawn over land; -1 without one. Sim 0.19.0: nearest his spawn
 * also for his exclusive nodes (was: nearest home, which is his front claim point where his army gathers; no catch in
 * 66 matches).
 */
export function raidSpot(
  ctx: SimContext,
  enemy: number,
  rules: SimSlaveRules,
  fields: Fields,
): number {
  if (fields.enemy === null) return -1;
  const w = ctx.world;
  const idx = ctx.index;
  idx.refresh(w);
  const r = rules.minDistanceFromOwnerBase;
  let best = -1;
  let bestD = 0;
  let bestEx = false;
  for (let k = 0; k < idx.nodeCount; k++) {
    const j = idx.nodes[k]!;
    if (w.amount[j]! <= 0) continue;
    if (ctx.terrainDist.at(fields.home, w.x[j]!, w.y[j]!) === TERRAIN_UNREACHABLE) continue;
    let inBase = false;
    for (let q = 0; q < idx.buildingCount && !inBase; q++) {
      const b = idx.buildings[q]!;
      if (w.owner[b] !== enemy) continue;
      const bt = ctx.buildingType(w.typeId[b]!);
      if (bt === undefined || (bt.provides & PROVIDES_HQ) === 0) continue;
      const dx = w.x[j]! - w.x[b]!;
      const dy = w.y[j]! - w.y[b]!;
      if (dx * dx + dy * dy <= r * r) inBase = true;
    }
    if (inBase) continue;
    const ex = exclusiveFor(ctx, j, enemy);
    const d = ctx.terrainDist.at(fields.enemy, w.x[j]!, w.y[j]!);
    if (best < 0 || (ex && !bestEx) || (ex === bestEx && d < bestD)) {
      best = j;
      bestD = d;
      bestEx = ex;
    }
  }
  return best;
}

/** The point next to node j where a raid party walks (one unit off, so raidOver never takes it for a claim point). */
const besideNode = (ctx: SimContext, j: number): { x: number; y: number } => ({
  x: ctx.world.x[j]! + ESCORT_OFFSET,
  y: ctx.world.y[j]!,
});

/** AttackMove for a list of unit ids, in commands of at most the protocol's size. */
export function attackMove(
  ctx: SimContext,
  p: number,
  ids: readonly number[],
  x: number,
  y: number,
): void {
  for (const part of chunks(ids))
    applyCommand(ctx, { playerId: p, seq: 0, type: 'AttackMove', payload: { ids: part, x, y } });
}

/** Where the army gathers at home: in front of the headquarters on the way to the enemy (as the Dwellers' rally hq). */
export function homePoint(ctx: SimContext, hq: number, fields: Fields): { x: number; y: number } {
  const c = rallyCell(ctx, hq, fields);
  return c === null
    ? { x: ctx.world.x[hq]!, y: ctx.world.y[hq]! }
    : { x: (c.cx << 8) + 128, y: (c.cy << 8) + 128 };
}

/**
 * The rally point of the script with no threat and no dominance camp: its own claim point nearest home or nearest the
 * enemy (rallySite), else the home point. `rally` below and the airlift of the Garde (systems/aiGarde.ts) use the same
 * one, so the shuttle always sets its load down where the army stands.
 */
export function rallyPoint(
  ctx: SimContext,
  p: number,
  hq: number,
  script: SimAiScript,
  fields: Fields,
): { x: number; y: number } {
  const f =
    script.rallySite === AI_SITE_FRONT && fields.enemy !== null ? fields.enemy : fields.home;
  const pt = script.rallySite === AI_SITE_HQ ? -1 : ownClaimNear(ctx, p, f);
  return pt >= 0 ? { x: ctx.world.x[pt]!, y: ctx.world.y[pt]! } : homePoint(ctx, hq, fields);
}

/** Step 7: the slave raid (see the top of this file). Takes its escort out of `free`. */
export function slaveRaid(
  ctx: SimContext,
  p: number,
  plan: SimRaidPlan,
  t: Tally,
  free: number[],
  spot: number,
  hq: number,
  fields: Fields,
): void {
  const ps = ctx.ps;
  const sr = plan.slaveRaids;
  if (sr === null) return; // data 0.38.0: no slave raids (the Garde)
  const tick = ctx.frame;
  if (ps.aiRaidOut[p] === 1) {
    if (tick < ps.aiRaidAt[p]! && t.slavers.length > 0) return;
    // over: everyone on the way to the raid spot comes home
    ps.aiRaidOut[p] = 0;
    ps.aiRaidAt[p] = tick + sr.retryTicks;
    // every Slaver farther from home than the rally radius walks back (an idle one at the spot too)
    const home = homePoint(ctx, hq, fields);
    const w = ctx.world;
    const back = t.slavers.filter((id) => {
      const i = w.resolve(id);
      const dx = w.x[i]! - home.x;
      const dy = w.y[i]! - home.y;
      return dx * dx + dy * dy > ctx.config.aggroRange * ctx.config.aggroRange;
    });
    attackMove(ctx, p, back, home.x, home.y);
    return;
  }
  if (tick < sr.fromTicks || tick < ps.aiRaidAt[p]! || spot < 0 || t.idleSlavers.length === 0)
    return;
  const w = ctx.world;
  const at = besideNode(ctx, spot);
  attackMove(ctx, p, t.idleSlavers, at.x, at.y);
  // the escort screens the Slavers: it stands between the node and the enemy spawn, twice the aggro range out, so it
  // meets the defenders and leaves the workers at the node to the Slavers (an escort at the node kills them first)
  const escort = free.splice(0, sr.escort);
  if (escort.length > 0 && fields.enemy !== null) {
    const c = stepAlong(
      ctx,
      fields.enemy,
      fields.enemyCx,
      fields.enemyCy,
      w.x[spot]! >> 8,
      w.y[spot]! >> 8,
      (2 * ctx.config.aggroRange) >> 8,
    );
    attackMove(ctx, p, escort, (c.cx << 8) + 128, (c.cy << 8) + 128);
  }
  ps.aiRaidOut[p] = 1;
  // maxRaidTicks at the spot: the walk there (the slowest Slaver over land) does not count
  let speed = 0;
  for (const id of t.idleSlavers) {
    const v = w.speed[w.resolve(id)]!;
    if (speed === 0 || v < speed) speed = v;
  }
  const cells = ctx.terrainDist.at(fields.home, w.x[spot]!, w.y[spot]!);
  ps.aiRaidAt[p] = tick + sr.maxRaidTicks + (speed > 0 ? idiv(cells * 256, speed) : 0);
}

/** Step 8: healthy idle buggies to the raid spot; a hurt one on the way comes home. */
export function harass(
  ctx: SimContext,
  p: number,
  plan: SimRaidPlan,
  t: Tally,
  spot: number,
  hq: number,
  fields: Fields,
): void {
  const w = ctx.world;
  const hr = plan.harass;
  if (hr === null) return; // data 0.38.0: no harass (the Garde)
  if (ctx.frame < hr.fromTicks || t.buggies.length === 0) return;
  const hurt = (id: number): boolean => {
    const i = w.resolve(id);
    return w.hp[i]! * 1000 < w.maxHp[i]! * hr.retreatHpPermille;
  };
  // already under this order to this point: no new one every tick (it would choose the formation again)
  const headed = (id: number, type: number, x: number, y: number): boolean => {
    const o = w.currentOrder(w.resolve(id));
    return o >= 0 && w.ordType[o] === type && w.ordX[o] === x && w.ordY[o] === y;
  };
  const home = homePoint(ctx, hq, fields);
  const back = t.buggies.filter(
    (id) => !t.idleBuggies.includes(id) && hurt(id) && !headed(id, ORDER_MOVE, home.x, home.y),
  );
  if (back.length > 0)
    applyCommand(ctx, {
      playerId: p,
      seq: 0,
      type: 'Move',
      payload: { ids: back, x: home.x, y: home.y },
    });
  if (spot < 0) return;
  const at = besideNode(ctx, spot);
  // a buggy that guardPosts sent this tick (step 2) is no longer idle
  const go = t.idleBuggies.filter(
    (id) =>
      !hurt(id) &&
      w.orderType(w.resolve(id)) !== ORDER_GUARD &&
      !headed(id, ORDER_ATTACK_MOVE, at.x, at.y),
  );
  if (go.length === 0) return;
  attackMove(ctx, p, go, at.x, at.y);
}

/**
 * The claim point nearest home over land that is not p's own (neutral or the enemy's), or -1. While p holds enough
 * points for dominance, its own point nearest the enemy instead: the army holds the count there rather than storming a
 * defended enemy point (measured, data 0.24.0: the camp ran into the Dwellers' front turret at minute 14 and the Raiders
 * never rebuilt).
 */
export function dominanceTarget(ctx: SimContext, p: number, fields: Fields): number {
  const w = ctx.world;
  if (pointsOf(ctx, p) >= ctx.map.dominance.pointsRequired && fields.enemy !== null)
    return ownClaimNear(ctx, p, fields.enemy);
  let best = -1;
  let bestD = 0;
  for (const pt of ctx.claimPoints) {
    if (w.owner[pt] === p) continue;
    const d = ctx.terrainDist.at(fields.home, w.x[pt]!, w.y[pt]!);
    if (d === TERRAIN_UNREACHABLE) continue;
    if (best < 0 || d < bestD) {
      best = pt;
      bestD = d;
    }
  }
  return best;
}

/** The visible enemy unit (no slave or captive) nearest (x, y) within r, then the lowest index; -1 without one. */
function enemyNear(ctx: SimContext, p: number, x: number, y: number, r: number): number {
  const w = ctx.world;
  const r2 = r * r;
  let best = -1;
  let bestD = 0;
  for (let j = 0; j < w.highWater; j++) {
    if (!w.has(j, C.unit | C.health) || w.hp[j]! <= 0) continue;
    const o = w.owner[j]!;
    if (o === p || o >= ctx.playerCount || w.slaveState[j] !== SLAVE_NONE) continue;
    if (!visibleTo(w, j, p)) continue;
    const dx = w.x[j]! - x;
    const dy = w.y[j]! - y;
    const d = dx * dx + dy * dy;
    if (d > r2 || (best >= 0 && d >= bestD)) continue;
    best = j;
    bestD = d;
  }
  return best;
}

/**
 * Steps 9b and 10: free fighters (and the idle hero) defend against a threat, or camp at the dominance target, or
 * rally at the script's rally site (as the Dwellers).
 */
export function rally(
  ctx: SimContext,
  p: number,
  hq: number,
  script: SimAiScript,
  fields: Fields | null,
  threat: number,
  free: number[],
  heroId: number,
  hero: number,
  push = -1,
): void {
  const w = ctx.world;
  const idle = [...free];
  if (
    heroId >= 0 &&
    w.orderType(hero) === ORDER_NONE &&
    !(threat < 0 && heroClaimNear(ctx, p, hero, script))
  )
    idle.push(heroId);
  if (idle.length === 0 || fields === null) return;
  let to: { x: number; y: number };
  let r = script.rallyRadius;
  // the camp is no building, so findThreat does not cover it: an enemy the army sees within defendRadius of its camp
  // is a threat too (measured, data 0.24.0: a passing Dweller wave shot the idle camp from beyond the aggro range)
  const at =
    threat < 0 && push >= 0
      ? enemyNear(ctx, p, w.x[push]!, w.y[push]!, script.defendRadius)
      : threat;
  if (at >= 0) {
    to = { x: w.x[at]!, y: w.y[at]! };
    r = 0;
  } else if (push >= 0) {
    // camp next to the point (one unit off: raidOver must not take the march for a finished raid)
    to = { x: w.x[push]! + ESCORT_OFFSET, y: w.y[push]! };
  } else to = rallyPoint(ctx, p, hq, script, fields);
  const go: number[] = [];
  for (const id of idle) {
    const i = w.resolve(id);
    const dx = w.x[i]! - to.x;
    const dy = w.y[i]! - to.y;
    if (dx * dx + dy * dy <= r * r) continue;
    // already on its way there: no new order (a new one would choose the formation again every tick)
    const o = w.currentOrder(i);
    if (o >= 0 && w.ordType[o] === ORDER_ATTACK_MOVE && w.ordX[o] === to.x && w.ordY[o] === to.y)
      continue;
    go.push(id);
  }
  attackMove(ctx, p, go, to.x, to.y);
}
