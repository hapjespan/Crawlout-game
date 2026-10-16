import { C, ORDER_ATTACK_MOVE, ORDER_GATHER, ORDER_MOVE } from '../ecs/world.js';
import { idiv } from '../math/int.js';
import { isqrt } from '../math/sqrt.js';
import { TRIG_ONE, cosA, sinA } from '../math/trig.js';
import type { SimContext } from './common.js';
import { MAX_FREE_RING, componentAt, inMap, scanRing, steerTo, steerToPoint } from './common.js';
import { NO_COMPONENT } from '../pathdist.js';

// Group-order spreading (visual review 15 October, item 5): a group Move or AttackMove gives every unit its own slot in
// a compact formation around the clicked point, and workers ordered to a scrap node each get their own spot on a ring
// around it, instead of everybody walking to the same point and clumping there.
//
// Everything here is integer-only and exactly symmetric under the 180-degree mirror of a point-symmetric map (the
// fairness test compares player 0 with the mirror image of player 1 every tick): directions are differences of
// positions, divisions truncate toward zero (odd functions), and ties are broken by keys that are themselves invariant
// under the mirror (distance, then the side relative to the move direction) before any fixed order.
//
// The slot itself is not new state: the order keeps the clicked point in ordX/ordY (the scripted AI compares it with
// claim points) and the slot as an offset from that point, packed into ordT (Move and AttackMove used ordT for the
// group radius before). A gather order keeps its ring offset in ordX/ordY, which a gather order did not use.
//
// Slots are chosen once per tick for all orders of that tick together (resolvePendingSlots, at the start of the unit
// part of system 2), not while a command is applied: the AIs think one after the other within a tick, and a claim
// site one of them places would otherwise change the walkable slots of the other's group in the same tick.

/** Geometry: fixed-point scale of unit direction vectors. */
const DIR_ONE = 1024;
/** Geometry: samples along a line-of-walk test are at most a quarter cell apart. */
const LINE_STEP_SHIFT = 6;
/** Geometry: an offset is packed as two int16 halves into a Uint32 order field. */
const OFF_MAX = 32767;
/** Geometry: 2 * pi in permille, for the number of worker slots that fit on a ring. */
const TWO_PI_PERMILLE = 6283;

/** Packs a slot offset into a Uint32 order field; 0 means no slot (the unit walks to the order point itself). */
export const packOffset = (dx: number, dy: number): number =>
  (((dx & 0xffff) << 16) | (dy & 0xffff)) >>> 0;
export const offsetX = (t: number): number => t >> 16;
export const offsetY = (t: number): number => (t << 16) >> 16;
const fitsOffset = (dx: number, dy: number): boolean =>
  dx >= -OFF_MAX && dx <= OFF_MAX && dy >= -OFF_MAX && dy <= OFF_MAX;

/** ordT of a Move or AttackMove whose slot is not chosen yet: offset (-32768, -32768), which packOffset never makes. */
export const SLOT_PENDING = 0x80008000;
/** ordX and ordY of a gather order whose ring spot is not chosen yet (an offset is at most OFF_MAX). */
export const SPOT_PENDING = -32768;

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
      const slots = formationSlots(ctx, group, k0[2]!, k0[3]!);
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
 * Whether a point is walkable. A point exactly on a cell border belongs to both cells on either side (both must be
 * walkable), so the answer for a point and for its mirror image is the same.
 */
export function walkPoint(ctx: SimContext, x: number, y: number): boolean {
  const map = ctx.map;
  if (!inMap(map, x, y)) return false;
  const walk = ctx.terrain.walk;
  const cx = x >> 8;
  const cy = y >> 8;
  const x0 = (x & 255) === 0 && cx > 0 ? cx - 1 : cx;
  const y0 = (y & 255) === 0 && cy > 0 ? cy - 1 : cy;
  for (let yy = y0; yy <= cy; yy++) {
    for (let xx = x0; xx <= cx; xx++) if (walk[yy * map.w + xx] !== 1) return false;
  }
  return true;
}

/**
 * Whether the straight segment from (x0, y0) to (x1, y1) stays on walkable cells, sampled at most a quarter cell
 * apart. The start point is not tested (the caller stands there).
 */
export function lineClear(
  ctx: SimContext,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): boolean {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const adx = dx < 0 ? -dx : dx;
  const ady = dy < 0 ? -dy : dy;
  const steps = ((adx > ady ? adx : ady) >> LINE_STEP_SHIFT) + 1;
  for (let k = 1; k <= steps; k++) {
    if (!walkPoint(ctx, x0 + idiv(dx * k, steps), y0 + idiv(dy * k, steps))) return false;
  }
  return true;
}

/**
 * Geometry: a group's formation is centred on a lattice point, 2 cells apart and centred on the map centre, nearest to
 * the clicked point. Under the mirror a lattice point maps onto a lattice point, and a target that is itself slightly
 * off the symmetry (the claim point in the middle of Rustbelt lies half a cell off the map centre, and the AI escorts
 * it from either side) still gives both players the same, mirrored formation.
 */
const ANCHOR_LATTICE = 512;

function snapAxis(v: number, mid: number): number {
  const d = v - mid;
  const h = ANCHOR_LATTICE >> 1;
  const k = d >= 0 ? idiv(d + h, ANCHOR_LATTICE) : -idiv(h - d, ANCHOR_LATTICE);
  return mid + k * ANCHOR_LATTICE;
}

/** The lattice point of a group order to (px, py), or the point itself near the edge of the map. */
function latticePoint(ctx: SimContext, px: number, py: number): { x: number; y: number } {
  const map = ctx.map;
  const x = snapAxis(px, map.w << 7);
  const y = snapAxis(py, map.h << 7);
  return inMap(map, x, y) ? { x, y } : { x: px, y: py };
}

/**
 * Lets unit i walk to its slot of a Move or AttackMove to (px, py), `off` being the packed offset of the slot from the
 * point (formationSlots). The flow field leads to a cell at the group's lattice point (shared by the whole group: one
 * field per group order), the goal is the slot; movement leaves the field for a straight line once the slot is in
 * sight (systems/movement.ts). Offset 0: the unit walks to the point itself, as steerToPoint.
 *
 * A lattice point usually lies on a cell corner, between two or four cells. The field leads to the one of those
 * closest to the unit's own spawn: the same choice, mirrored, for the other player (a field to an even-sized target
 * rectangle is not exactly mirror-symmetric once buildings stand, and a fixed pick of one corner cell would not be).
 */
export function steerToSlot(ctx: SimContext, i: number, px: number, py: number, off: number): void {
  const cfg = ctx.config;
  const gx = px + offsetX(off);
  const gy = py + offsetY(off);
  if (off === 0) {
    steerToPoint(ctx, i, gx, gy, cfg.arriveRadius, cfg.formation.slack);
    return;
  }
  const map = ctx.map;
  const q = latticePoint(ctx, px, py);
  const sp = map.spawns[ctx.world.owner[i]!];
  const x1 = q.x >> 8;
  const y1 = q.y >> 8;
  const x0 = (q.x & 255) === 0 && x1 > 0 ? x1 - 1 : x1;
  const y0 = (q.y & 255) === 0 && y1 > 0 ? y1 - 1 : y1;
  let bx = x0;
  let by = y0;
  let bestD = -1;
  for (let cy = y0; cy <= y1; cy++) {
    for (let cx = x0; cx <= x1; cx++) {
      const ex = sp === undefined ? 0 : (cx << 8) + 128 - sp.x;
      const ey = sp === undefined ? 0 : (cy << 8) + 128 - sp.y;
      const d = ex * ex + ey * ey;
      if (bestD < 0 || d < bestD) {
        bx = cx;
        by = cy;
        bestD = d;
      }
    }
  }
  const c = by * map.w + bx;
  const b = ctx.terrain.occ[c]! - 1;
  const w = ctx.world;
  if (ctx.terrain.walk[c] === 1)
    steerTo(ctx, i, gx, gy, bx, by, 1, 1, cfg.arriveRadius, cfg.formation.slack);
  else if (b >= 0)
    // a building: its footprint (odd, so mirror-symmetric) is the target
    steerTo(
      ctx,
      i,
      gx,
      gy,
      w.fx[b]!,
      w.fy[b]!,
      w.fw[b]!,
      w.fh[b]!,
      cfg.arriveRadius,
      cfg.formation.slack,
    );
  else steerToPoint(ctx, i, gx, gy, cfg.arriveRadius, cfg.formation.slack); // water and the like: the slot's cell
}

/** Sort keys of one unit relative to the anchor and the move direction. */
interface Member {
  readonly i: number;
  /** Position in the `units` argument. */
  readonly pos: number;
  readonly fwd: number;
  readonly lat: number;
}

/**
 * Formation slots for a group order to (px, py), one per unit, in the order of `units`, as packed offsets from
 * (px, py) (packOffset). A single unit is a group of one: it stands on the anchor, at most one cell per axis from the
 * clicked point (without the lattice, the AI's single units at the off-centre middle claim point broke the mirror
 * as soon as the middle was taken).
 *
 * 0. A clicked point that is not walkable (in a building, in water) gets no formation: offset 0 for everybody.
 * 1. Anchor: the lattice point nearest to the clicked point (latticePoint); if that is not walkable (the edge of a
 *    building next to the point), the nearest walkable cell centre around it, ring by ring.
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
): number[] {
  const w = ctx.world;
  const map = ctx.map;
  const f = ctx.config.formation;
  const n = units.length;
  const out: number[] = [];
  // A point that is itself not walkable (a building, water): no formation, everybody walks at the point as before. An
  // AttackMove onto an enemy headquarters keeps going (it never arrives while the building stands) instead of
  // forming up beside it, arriving, and being called back by the AI as an idle army.
  if (ctx.terrain.walk[(py >> 8) * map.w + (px >> 8)] !== 1) {
    for (let k = 0; k < n; k++) out.push(0);
    return out;
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
  const a = walkPoint(ctx, q.x, q.y) ? q : nearestWalkable(ctx, q.x, q.y, n, sumX, sumY, ux, uy);

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
 * Never exactly on a cell border (like offGrid in movement.ts): a goal coordinate v = 256k belongs to cell k, its mirror
 * image to cell W - k instead of the mirrored W - 1 - k, and every `>> 8` on the goal (the cell a unit walks to) would
 * differ from the mirror. A slot on a border moves one unit toward its anchor (`to`); on the anchor's own line toward
 * the map centre (`mid`), and on the centre line itself toward the owner's spawn.
 */
function offBorder(v: number, to: number, mid: number, spawn: number): number {
  if ((v & 255) !== 0) return v;
  if (v !== to) return v < to ? v + 1 : v - 1;
  if (v !== mid) return v < mid ? v + 1 : v - 1;
  return spawn > mid ? v + 1 : v - 1;
}

const clampCell = (c: number, size: number): number => (c < 0 ? 0 : c >= size ? size - 1 : c);

/**
 * The anchor of a group whose lattice point (x, y) is not walkable (a building, water): ring by ring around its
 * cell(s) (both cells for a point on a border), and in the first ring with walkable cells the one nearest to the
 * centre of the group (sumX / n, sumY / n), so the group forms up on its own side of a building; equal distance: left
 * of the direction (ux, uy) first, then further along it. (x, y) itself if there is none within MAX_FREE_RING.
 */
function nearestWalkable(
  ctx: SimContext,
  x: number,
  y: number,
  n: number,
  sumX: number,
  sumY: number,
  ux: number,
  uy: number,
): { x: number; y: number } {
  const map = ctx.map;
  const cx = x >> 8;
  const cy = y >> 8;
  const fx = (x & 255) === 0 && cx > 0 ? cx - 1 : cx;
  const fy = (y & 255) === 0 && cy > 0 ? cy - 1 : cy;
  for (let d = 1; d <= MAX_FREE_RING; d++) {
    let best = -1;
    let bestD = 0;
    let bestL = 0;
    let bestF = 0;
    scanRing(map, fx, fy, cx - fx + 1, cy - fy + 1, d, (rx, ry) => {
      if (ctx.terrain.walk[ry * map.w + rx] !== 1) return false;
      const px = (rx << 8) + 128;
      const py = (ry << 8) + 128;
      // distance to the group centre, times n (no division)
      const gx = n * px - sumX;
      const gy = n * py - sumY;
      const dd = gx * gx + gy * gy;
      const ex = px - x;
      const ey = py - y;
      const lat = uy * -ex + ux * ey;
      const fwd = ex * ux + ey * uy;
      if (
        best < 0 ||
        dd < bestD ||
        (dd === bestD && (lat < bestL || (lat === bestL && fwd > bestF)))
      ) {
        best = ry * map.w + rx;
        bestD = dd;
        bestL = lat;
        bestF = fwd;
      }
      return false;
    });
    if (best >= 0) {
      const by = idiv(best, map.w);
      return { x: ((best - by * map.w) << 8) + 128, y: (by << 8) + 128 };
    }
  }
  return { x, y };
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
