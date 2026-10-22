// Split from formation.ts to stay under the 5,000-token file limit; formation.ts re-exports the public surface.
// Holds: DIR_ONE, LINE_STEP_SHIFT, OFF_MAX, TWO_PI_PERMILLE, packOffset, offsetX, +14 more.
import {
  type SimContext,
  inMap,
  steerToPoint,
  steerTo,
  MAX_FREE_RING,
  scanRing,
} from './common.js';
import { idiv } from '../math/int.js';
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
export const DIR_ONE = 1024;

/** Geometry: samples along a line-of-walk test are at most a quarter cell apart. */
const LINE_STEP_SHIFT = 6;

/** Geometry: an offset is packed as two int16 halves into a Uint32 order field. */
const OFF_MAX = 32767;

/** Geometry: 2 * pi in permille, for the number of worker slots that fit on a ring. */
export const TWO_PI_PERMILLE = 6283;

/** Packs a slot offset into a Uint32 order field; 0 means no slot (the unit walks to the order point itself). */
export const packOffset = (dx: number, dy: number): number =>
  (((dx & 0xffff) << 16) | (dy & 0xffff)) >>> 0;

export const offsetX = (t: number): number => t >> 16;

export const offsetY = (t: number): number => (t << 16) >> 16;

export const fitsOffset = (dx: number, dy: number): boolean =>
  dx >= -OFF_MAX && dx <= OFF_MAX && dy >= -OFF_MAX && dy <= OFF_MAX;

/** ordT of a Move or AttackMove whose slot is not chosen yet: offset (-32768, -32768), which packOffset never makes. */
export const SLOT_PENDING = 0x80008000;

/** ordX and ordY of a gather order whose ring spot is not chosen yet (an offset is at most OFF_MAX). */
export const SPOT_PENDING = -32768;

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
export function latticePoint(ctx: SimContext, px: number, py: number): { x: number; y: number } {
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
export interface Member {
  readonly i: number;
  /** Position in the `units` argument. */
  readonly pos: number;
  readonly fwd: number;
  readonly lat: number;
}

/**
 * Never exactly on a cell border (like offGrid in movement.ts): a goal coordinate v = 256k belongs to cell k, its mirror
 * image to cell W - k instead of the mirrored W - 1 - k, and every `>> 8` on the goal (the cell a unit walks to) would
 * differ from the mirror. A slot on a border moves one unit toward its anchor (`to`); on the anchor's own line toward
 * the map centre (`mid`), and on the centre line itself toward the owner's spawn.
 */
export function offBorder(v: number, to: number, mid: number, spawn: number): number {
  if ((v & 255) !== 0) return v;
  if (v !== to) return v < to ? v + 1 : v - 1;
  if (v !== mid) return v < mid ? v + 1 : v - 1;
  return spawn > mid ? v + 1 : v - 1;
}

export const clampCell = (c: number, size: number): number =>
  c < 0 ? 0 : c >= size ? size - 1 : c;

/**
 * The anchor of a group whose lattice point (x, y) is not walkable (a building, water): ring by ring around its
 * cell(s) (both cells for a point on a border), and in the first ring with walkable cells of the group's own piece of
 * terrain (`home`; NO_COMPONENT: any) the one nearest to the centre of the group (sumX / n, sumY / n), so the group
 * forms up on its own side of a building; equal distance: left of the direction (ux, uy) first, then further along
 * it. (x, y) itself if there is none within MAX_FREE_RING.
 */
export function nearestWalkable(
  ctx: SimContext,
  x: number,
  y: number,
  n: number,
  sumX: number,
  sumY: number,
  ux: number,
  uy: number,
  home: number,
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
      const c = ry * map.w + rx;
      if (ctx.terrain.walk[c] !== 1) return false;
      if (home !== NO_COMPONENT && ctx.terrainDist.component(c) !== home) return false;
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
