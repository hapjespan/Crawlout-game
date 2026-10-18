// Split from formation.ts to stay under the 5,000-token file limit; formation.ts re-exports the public surface.
// Holds: resolvePendingSlots, formationSlots, gatherSlot.
import { type SimContext, componentAt, scanRing } from './common.js';
import { idiv } from '../math/int.js';
import { isqrt } from '../math/sqrt.js';
import { C, ORDER_GATHER, ORDER_MOVE, ORDER_ATTACK_MOVE } from '../ecs/world.js';
import { cosA, sinA, TRIG_ONE } from '../math/trig.js';
import { NO_COMPONENT } from '../pathdist.js';
import {
  DIR_ONE,
  SLOT_PENDING,
  SPOT_PENDING,
  TWO_PI_PERMILLE,
  clampCell,
  fitsOffset,
  latticePoint,
  lineClear,
  nearestWalkable,
  offBorder,
  packOffset,
  steerToSlot,
  walkPoint,
} from './formation.part1.js';
import type { Member } from './formation.part1.js';

/**
 * Chooses the slots of all Move, AttackMove and Gather orders given this tick (systems 1 and 2a) and starts the units
 * walking. One formation per (owner, order type, point): the units of one command (two commands of one player to the
 * same point in the same tick form one group). Workers pick their ring spot nearest first, so the ones already close
 * to the node keep the near side.
 */
export function resolvePendingSlots(ctx: SimContext): void {
  const w = ctx.world;
  const moves: number[] = [];
  const gathers: number[] = [];
  for (let i = 0; i < w.highWater; i++) {
    if (!w.has(i, C.unit | C.orders)) continue;
    const o = w.currentOrder(i);
    if (o < 0) continue;
    const t = w.ordType[o]!;
    if ((t === ORDER_MOVE || t === ORDER_ATTACK_MOVE) && w.ordT[o] === SLOT_PENDING) moves.push(i);
    else if (t === ORDER_GATHER && w.ordX[o] === SPOT_PENDING) gathers.push(i);
  }
  if (moves.length > 0) {
    const key = (i: number): number[] => {
      const o = w.currentOrder(i);
      return [w.owner[i]!, w.ordType[o]!, w.ordX[o]!, w.ordY[o]!];
    };
    moves.sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      return ka[0]! - kb[0]! || ka[1]! - kb[1]! || ka[2]! - kb[2]! || ka[3]! - kb[3]! || a - b;
    });
    for (let start = 0; start < moves.length;) {
      const k0 = key(moves[start]!);
      let end = start + 1;
      while (end < moves.length) {
        const k = key(moves[end]!);
        if (k[0] !== k0[0] || k[1] !== k0[1] || k[2] !== k0[2] || k[3] !== k0[3]) break;
        end++;
      }
      const group = moves.slice(start, end);
      const slots = formationSlots(ctx, group, k0[2]!, k0[3]!, k0[1] === ORDER_ATTACK_MOVE);
      for (let g = 0; g < group.length; g++) {
        const i = group[g]!;
        w.ordT[w.currentOrder(i)] = slots[g]!;
        steerToSlot(ctx, i, k0[2]!, k0[3]!, slots[g]!);
      }
      start = end;
    }
  }
  if (gathers.length > 0) {
    const nodeOf = (i: number): number => w.resolve(w.ordT[w.currentOrder(i)]!);
    const d2 = (i: number): number => {
      const n = nodeOf(i);
      if (n < 0) return 0;
      const dx = w.x[i]! - w.x[n]!;
      const dy = w.y[i]! - w.y[n]!;
      return dx * dx + dy * dy;
    };
    gathers.sort((a, b) => d2(a) - d2(b) || a - b);
    const pending = new Set(gathers);
    for (const i of gathers) {
      pending.delete(i);
      const o = w.currentOrder(i);
      const node = nodeOf(i);
      const spot = node >= 0 && w.has(node, C.resource) ? gatherSlot(ctx, i, node, pending) : null;
      w.ordX[o] = spot?.x ?? 0;
      w.ordY[o] = spot?.y ?? 0;
    }
  }
}

/**
 * Formation slots for a group order to (px, py), one per unit, in the order of `units`, as packed offsets from
 * (px, py) (packOffset). A single unit is a group of one: it stands on the anchor, at most one cell per axis from the
 * clicked point (without the lattice, the AI's single units at the off-centre middle claim point broke the mirror
 * as soon as the middle was taken).
 *
 * 0. An AttackMove onto a building of somebody else gets no formation: offset 0 for everybody, they walk at the
 *    building and fight it. Any other point that is not walkable (Move or AttackMove into an own or neutral building,
 *    water) resolves to the nearest reachable free point (sim 0.23.0, playtest H1: before, the group walked at a point
 *    inside a footprint and stood at its edge in the walk animation for good).
 * 1. Anchor: the lattice point nearest to the clicked point (latticePoint); if that is not walkable (the edge of a
 *    building next to the point, or the point lies inside a footprint), the nearest walkable cell centre around it in
 *    the group's own piece of terrain, ring by ring.
 * 2. Direction: from the centre of the group to the anchor. A group that already stands on it (centre within one slot
 *    spacing) keeps a fixed orientation instead, facing the map centre, so a repeated order does not reshuffle it.
 * 3. Ranks across the direction, front rank first: about sqrt(n * width) columns, slots `spacing` apart (twice the
 *    largest unit radius plus the gap), centred on the anchor; the last rank holds the rest, centred as well.
 * 4. Assignment without crossing: the units furthest along the direction take the front rank, and within a rank the
 *    leftmost unit takes the leftmost slot (ties: the other key, then the entity index).
 * 5. Walkable: a slot that is not walkable, or not in a straight walkable line from the anchor, moves to the nearest
 *    cell centre (ring by ring, at most directRange) that is, keeping one spacing from every other slot; if there is
 *    none, the unit walks to the anchor itself (the contact rule stops it at the group).
 * All keys and tiebreaks are distances and sides relative to the direction, which the mirror leaves unchanged.
 */
export function formationSlots(
  ctx: SimContext,
  units: readonly number[],
  px: number,
  py: number,
  attack = false,
): number[] {
  const w = ctx.world;
  const map = ctx.map;
  const f = ctx.config.formation;
  const n = units.length;
  const out: number[] = [];
  // An AttackMove onto a building of somebody else: no formation, everybody walks at the point as before. It keeps
  // going (it never arrives while the building stands) instead of forming up beside it, arriving, and being called
  // back by the AI as an idle army. Ownership only, not visibility: a building in the fog is still attacked.
  const pc = (py >> 8) * map.w + (px >> 8);
  if (attack && ctx.terrain.walk[pc] !== 1) {
    const b = ctx.terrain.occ[pc]! - 1;
    if (b >= 0 && w.owner[b] !== w.owner[units[0]!]) {
      for (let k = 0; k < n; k++) out.push(0);
      return out;
    }
  }
  const q = latticePoint(ctx, px, py);
  let maxR = 0;
  let sumX = 0;
  let sumY = 0;
  for (const i of units) {
    if (w.radius[i]! > maxR) maxR = w.radius[i]!;
    sumX += w.x[i]!;
    sumY += w.y[i]!;
  }
  const s = 2 * maxR + f.gap;

  // 2. direction (odd under the mirror: a difference of positions, truncated toward zero)
  let dx = idiv(n * q.x - sumX, n);
  let dy = idiv(n * q.y - sumY, n);
  if (dx * dx + dy * dy <= s * s) {
    dx = (map.w << 8) - 2 * q.x;
    dy = (map.h << 8) - 2 * q.y;
  }
  if (dx === 0 && dy === 0) dy = 1;
  const len = isqrt(dx * dx + dy * dy);
  const ux = idiv(dx * DIR_ONE, len);
  const uy = idiv(dy * DIR_ONE, len);

  // 1. anchor
  const home = componentAt(ctx, w.x[units[0]!]!, w.y[units[0]!]!);
  const a = walkPoint(ctx, q.x, q.y)
    ? q
    : nearestWalkable(ctx, q.x, q.y, n, sumX, sumY, ux, uy, home);

  // 3. shape
  const want = n * f.widthPermille;
  let cols = isqrt(idiv(want, 1000));
  while (cols * cols * 1000 < want) cols++;
  if (cols < 1) cols = 1;
  if (cols > n) cols = n;
  const rows = idiv(n + cols - 1, cols);

  // 4. assignment: front rank first, then left to right within each rank
  const members: Member[] = [];
  for (let pos = 0; pos < n; pos++) {
    const i = units[pos]!;
    const vx = w.x[i]! - a.x;
    const vy = w.y[i]! - a.y;
    members.push({ i, pos, fwd: vx * ux + vy * uy, lat: uy * -vx + ux * vy });
  }
  members.sort((p, q) => q.fwd - p.fwd || p.lat - q.lat || p.i - q.i);
  const slotOf: number[] = new Array<number>(n).fill(0); // position in `units` -> slot number
  const slotX: number[] = [];
  const slotY: number[] = [];
  const ok: boolean[] = [];
  for (let r = 0; r < rows; r++) {
    const m = r < rows - 1 ? cols : n - cols * (rows - 1);
    const rank = members.slice(r * cols, r * cols + m);
    rank.sort((p, q) => p.lat - q.lat || q.fwd - p.fwd || p.i - q.i);
    const fwd = idiv((rows - 1 - 2 * r) * s, 2);
    for (let k = 0; k < m; k++) {
      const lat = idiv((2 * k - (m - 1)) * s, 2);
      const x = a.x + idiv(fwd * ux - lat * uy, DIR_ONE);
      const y = a.y + idiv(fwd * uy + lat * ux, DIR_ONE);
      slotOf[rank[k]!.pos] = slotX.length;
      slotX.push(x);
      slotY.push(y);
      ok.push(walkPoint(ctx, x, y) && lineClear(ctx, a.x, a.y, x, y));
    }
  }

  // 5. blocked slots: the nearest free cell centre in sight of the anchor, in slot order
  const s2 = s * s;
  const farFromSlots = (x: number, y: number): boolean => {
    for (let k = 0; k < slotX.length; k++) {
      if (!ok[k]) continue;
      const ex = slotX[k]! - x;
      const ey = slotY[k]! - y;
      if (ex * ex + ey * ey < s2) return false;
    }
    return true;
  };
  const maxRing = f.directRange >> 8;
  for (let k = 0; k < slotX.length; k++) {
    if (ok[k]) continue;
    const ix = slotX[k]!;
    const iy = slotY[k]!;
    const icx = clampCell(ix >> 8, map.w);
    const icy = clampCell(iy >> 8, map.h);
    let best = -1;
    let bestD = 0;
    let bestL = 0;
    let bestF = 0;
    const consider = (cx: number, cy: number): boolean => {
      if (ctx.terrain.walk[cy * map.w + cx] !== 1) return false;
      const x = (cx << 8) + 128;
      const y = (cy << 8) + 128;
      if (!farFromSlots(x, y) || !lineClear(ctx, a.x, a.y, x, y)) return false;
      const ex = x - ix;
      const ey = y - iy;
      const dd = ex * ex + ey * ey;
      const lat = uy * -ex + ux * ey;
      const fwd = ex * ux + ey * uy;
      if (
        best < 0 ||
        dd < bestD ||
        (dd === bestD && (lat < bestL || (lat === bestL && fwd > bestF)))
      ) {
        best = cy * map.w + cx;
        bestD = dd;
        bestL = lat;
        bestF = fwd;
      }
      return false;
    };
    consider(icx, icy);
    for (let d = 1; d <= maxRing && best < 0; d++) scanRing(map, icx, icy, 1, 1, d, consider);
    if (best >= 0) {
      const cy = idiv(best, map.w);
      slotX[k] = ((best - cy * map.w) << 8) + 128;
      slotY[k] = (cy << 8) + 128;
    } else {
      slotX[k] = a.x;
      slotY[k] = a.y;
    }
    ok[k] = true;
  }

  const sp = map.spawns[w.owner[units[0]!]!];
  for (let pos = 0; pos < n; pos++) {
    const k = slotOf[pos]!;
    const ox = offBorder(slotX[k]!, a.x, map.w << 7, sp === undefined ? 0 : sp.x) - px;
    const oy = offBorder(slotY[k]!, a.y, map.h << 7, sp === undefined ? 0 : sp.y) - py;
    out.push(fitsOffset(ox, oy) ? packOffset(ox, oy) : 0);
  }
  return out;
}

/**
 * Ring slot for a worker at scrap node `node`, as an offset from the node (packOffset halves), or null: the free
 * walkable spot on a ring of radius gatherRing around the node that is closest to the worker. Spots are spaced twice
 * the worker's radius plus the gap, starting toward the map centre (so mirrored nodes get mirrored rings); a spot is
 * taken when another unit's current gather order on this node holds it. No ring if a worker on the ring (plus the
 * arrival slack) would be out of interactRange of the node, or all spots are taken.
 */
export function gatherSlot(
  ctx: SimContext,
  i: number,
  node: number,
  skip: ReadonlySet<number>,
): { x: number; y: number } | null {
  const w = ctx.world;
  const map = ctx.map;
  const f = ctx.config.formation;
  const rho = f.gatherRing;
  if (rho <= 0 || rho + f.slack > ctx.config.interactRange + w.radius[node]!) return null;
  const s = 2 * w.radius[i]! + f.gap;
  const count = s <= 0 ? 0 : idiv(rho * TWO_PI_PERMILLE, s * 1000);
  if (count < 1) return null;
  const nx = w.x[node]!;
  const ny = w.y[node]!;
  // only spots in the worker's own piece of terrain (a spot across water next to the node is walkable but not reachable)
  const home = componentAt(ctx, w.x[i]!, w.y[i]!);
  const bx = (map.w << 8) - 2 * nx;
  let by = (map.h << 8) - 2 * ny;
  if (bx === 0 && by === 0) by = 1;
  const len = isqrt(bx * bx + by * by);
  const ux = idiv(bx * DIR_ONE, len);
  const uy = idiv(by * DIR_ONE, len);
  // spots already held by other gatherers of this node
  const nodeId = w.idOf(node);
  const held: number[] = [];
  for (let j = 0; j < w.highWater; j++) {
    if (j === i || skip.has(j) || !w.has(j, C.unit | C.orders)) continue;
    const o = w.currentOrder(j);
    if (o < 0 || w.ordType[o] !== ORDER_GATHER || w.ordT[o] !== nodeId) continue;
    if (w.ordX[o] !== 0 || w.ordY[o] !== 0) held.push(w.ordX[o]!, w.ordY[o]!);
  }
  let best: { x: number; y: number } | null = null;
  let bestD = 0;
  for (let k = 0; k < count; k++) {
    const t = idiv(k * 65536, count);
    const c = cosA(t);
    const sn = sinA(t);
    const rx = idiv(ux * c - uy * sn, TRIG_ONE);
    const ry = idiv(ux * sn + uy * c, TRIG_ONE);
    const ox = offBorder(nx + idiv(rx * rho, DIR_ONE), nx, map.w << 7, 0) - nx;
    const oy = offBorder(ny + idiv(ry * rho, DIR_ONE), ny, map.h << 7, 0) - ny;
    if ((ox === 0 && oy === 0) || !walkPoint(ctx, nx + ox, ny + oy)) continue;
    if (home !== NO_COMPONENT && componentAt(ctx, nx + ox, ny + oy) !== home) continue;
    let taken = false;
    for (let h = 0; h < held.length && !taken; h += 2) taken = held[h] === ox && held[h + 1] === oy;
    if (taken) continue;
    const ex = nx + ox - w.x[i]!;
    const ey = ny + oy - w.y[i]!;
    const dd = ex * ex + ey * ey;
    if (best === null || dd < bestD) {
      best = { x: ox, y: oy };
      bestD = dd;
    }
  }
  return best;
}
