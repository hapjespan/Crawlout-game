// Split from aiGarde.ts to stay under the 5,000-token file limit; aiGarde.ts re-exports the public surface.
// Holds: airlift.
import type { SimContext } from './common.js';
import type { SimRaidPlan } from '../config.js';
import type { Tally } from './aiRaiders.part1.js';
import { applyCommand } from './commands.js';
import { C, ORDER_ATTACK_MOVE, ORDER_NONE } from '../ecs/world.js';
import { ORDER_LOAD } from './garde.transport.js';
import { chunks } from './ai.geometry.js';

/**
 * How far a boarder may stray before the AI gives up on it: twice the script's `gather`. Without this valve a fighter
 * that cannot reach the transport keeps its ORDER_LOAD for the rest of the match and is lost to the army. Geometry,
 * not a game rule: the rule is `gather` and it stands in data/ai.
 */
const STRAY = 2;

/**
 * Where the wave that left this tick walks to, derived from the army itself: the AttackMove point of an own fighter
 * that lies at least `minPath` from the rally point, the farthest one (tiebreak the lowest index). The rally point
 * itself is at distance 0, so a fighter walking home never counts. Null when nobody marches that far. Derived every
 * tick, so the transport needs no memory of the order it was loaded for.
 */
function waveTarget(
  ctx: SimContext,
  p: number,
  t: Tally,
  base: { x: number; y: number },
  minPath: number,
): { x: number; y: number } | null {
  const w = ctx.world;
  let best: { x: number; y: number } | null = null;
  let bestD = (minPath - 1) * (minPath - 1);
  for (const fid of t.army) {
    const i = w.resolve(fid);
    if (i < 0 || w.owner[i] !== p) continue;
    const o = w.currentOrder(i);
    if (o < 0 || w.ordType[o] !== ORDER_ATTACK_MOVE) continue;
    const x = w.ordX[o]!;
    const y = w.ordY[o]!;
    const dx = x - base.x;
    const dy = y - base.y;
    const d = dx * dx + dy * dy;
    if (d <= bestD) continue;
    best = { x, y };
    bestD = d;
  }
  return best;
}

/**
 * The airlift of the Garde (sim 0.34.0, data 0.43.0, raidPlan airlift; protocol 0.18.0 Load and Unload; proposal for
 * the architect, docs/garde.md item 5). One transport, one run per push:
 *
 *  1. it has an order of its own (flying out, flying back): leave it alone;
 *  2. it carries passengers and nobody is still boarding (or it is full): Unload at `drop`, the push target. The
 *     ORDER_UNLOAD flies it there over any terrain and sets them down on arrival, where they fight on like a wave
 *     member that walked (an AttackMove pops on arrival too);
 *  3. somebody is boarding: wait, unless one strayed beyond STRAY * gather (then Stop them all and try next tick);
 *  4. empty, free, healthy (above minHpPermille), standing within `gather` of `base` and asked for a crew: up to its
 *     capacity of `crew` within `gather` of it board instead of walking, at least minLoad. They leave `crew`, so the
 *     wave order of this tick does not overwrite their ORDER_LOAD;
 *  5. empty and away from `base`: fly back (Move, not AttackMove: a lorry, not a gunship).
 *
 * `base` is the rally point, where the army gathers and the wave leaves from; `drop` the enemy spawn, where the push
 * goes; `path` the distance between the two over land. Below `minPath` the wave simply walks.
 *
 * Why the wave and not a shuttle between the headquarters and the front: measured on Rustbelt the Garde has nought to
 * two free fighters at home late in a match (everything is at the rally point or on a mission), so a shuttle at home
 * never found a load. The wave is where the fighters stand. The price is that the four who fly land before the rest
 * walks in: that is the risk the script weighs with `capacity` (four of a wave of at least five), `minHpPct` (a damaged
 * Vertibird stays on the ground) and `minPathM` (a near target is not worth the flight). A loaded transport that is
 * shot down takes its cargo with it (systems/garde.transport.ts cargoLost), so it never carries more than that.
 */
export function airlift(
  ctx: SimContext,
  p: number,
  plan: SimRaidPlan,
  t: Tally,
  crew: number[] | null,
  base: { x: number; y: number },
  drop: { x: number; y: number },
  path: number,
): void {
  const al = plan.airlift;
  if (al === null || t.transports.length === 0) return;
  const w = ctx.world;
  const tr = w.resolve(t.transports[0]!); // the lowest index: one shuttle, and always the same one
  if (tr < 0) return;
  const cap = ctx.unitType(w.typeId[tr]!)?.transport?.capacity ?? 0;
  if (cap === 0 || w.orderType(tr) !== ORDER_NONE) return;

  // who is walking to this transport right now (ORDER_LOAD on it), and did one of them stray
  const id = w.idOf(tr);
  const boarding: number[] = [];
  let stray = false;
  const far = al.gather * STRAY;
  for (let i = 0; i < w.highWater; i++) {
    if (w.alive[i] !== 1 || w.owner[i] !== p || !w.has(i, C.orders)) continue;
    if (w.orderType(i) !== ORDER_LOAD || w.resolve(w.ordT[w.currentOrder(i)]!) !== tr) continue;
    boarding.push(w.idOf(i));
    const dx = w.x[i]! - w.x[tr]!;
    const dy = w.y[i]! - w.y[tr]!;
    if (dx * dx + dy * dy > far * far) stray = true;
  }

  const n = ctx.garde.cargoN[tr]!;
  if (n > 0) {
    if (boarding.length > 0 && n < cap) return; // still filling
    // set them down where the rest of the wave walks to, so both halves end up in the same fight; `drop` (the enemy
    // spawn) only when no fighter is marching anywhere far
    const at = waveTarget(ctx, p, t, base, al.minPath) ?? drop;
    applyCommand(ctx, {
      playerId: p,
      seq: 0,
      type: 'Unload',
      payload: { ids: [id], x: at.x, y: at.y },
    });
    return;
  }
  if (boarding.length > 0) {
    if (stray)
      for (const part of chunks(boarding))
        applyCommand(ctx, { playerId: p, seq: 0, type: 'Stop', payload: { ids: part } });
    return;
  }

  // empty and free: board a crew at the rally point, or fly back to it
  const dx = w.x[tr]! - base.x;
  const dy = w.y[tr]! - base.y;
  const atBase = dx * dx + dy * dy <= al.gather * al.gather;
  if (
    atBase &&
    crew !== null &&
    ctx.frame >= al.fromTicks &&
    path >= al.minPath &&
    w.hp[tr]! * 1000 >= w.maxHp[tr]! * al.minHpPermille
  ) {
    const board: number[] = [];
    for (const fid of crew) {
      if (board.length >= cap) break;
      const i = w.resolve(fid);
      if (i < 0) continue;
      const ex = w.x[i]! - w.x[tr]!;
      const ey = w.y[i]! - w.y[tr]!;
      if (ex * ex + ey * ey <= al.gather * al.gather) board.push(fid);
    }
    if (
      board.length >= al.minLoad &&
      applyCommand(ctx, {
        playerId: p,
        seq: 0,
        type: 'Load',
        payload: { ids: board, transportId: id },
      })
    ) {
      for (const fid of board) {
        const k = crew.indexOf(fid);
        if (k >= 0) crew.splice(k, 1);
      }
      return;
    }
  }
  if (!atBase)
    applyCommand(ctx, {
      playerId: p,
      seq: 0,
      type: 'Move',
      payload: { ids: [id], x: base.x, y: base.y },
    });
}
