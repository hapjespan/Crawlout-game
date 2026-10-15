// Picking and box selection on the interpolated frame: pure math, no GPU readback.
// The renderer only reports which entity ids are under the cursor or inside a rectangle;
// turning that into a selection is a command for the sim (contract 2), the snapshot echoes it in flags.
import { ENTITY_FLAG } from '@crawlout/protocol';
import { drawsAsUnit } from '../entities/typeIds.js';
import type { InterpolatedFrame } from '../snapshot/interpolate.js';

/** Height of a unit's pick center above its feet, and the pick radius around it, meters. */
export const PICK_CENTER_HEIGHT = 0.9;
export const PICK_RADIUS = 0.75;

export interface ScreenRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface BoxSelectOptions {
  /** Only entities of this owner. */
  owner?: number;
  /** Include entities flagged dead. Default false. */
  includeDead?: boolean;
  /** Also select buildings, scrap nodes and claim points. Default false: a box drag selects units. */
  includeStructures?: boolean;
  /** Pick center of entities with a shape of their own (robots: a floating drone is selected where it floats). */
  shape?: PickShapeFn;
}

/**
 * Pick shape of one entity, meters: a sphere (radius, center height above its ground point) or, when `top` > 0, a
 * box around the ground point (half sizes along x and z, from just below the ground up to `top`). Buildings use the
 * box: a sphere around their center misses the corners, walls and roof of a 21 m building at the RTS camera angle.
 */
export interface PickShape {
  radius: number;
  height: number;
  /** Half size of the box along x and z; only read when top > 0. */
  halfX?: number;
  halfZ?: number;
  /** Height of the box above the ground point; 0 or absent: use the sphere. */
  top?: number;
}

/** Box bottom below the ground point, meters: a building on a slope still has walls under its center height. */
export const BOX_SINK = 1;
/**
 * A box hit counts this much further away than it is, meters, so a unit standing at the wall or on the porch wins
 * the click over the building it stands against.
 */
export const BOX_HIT_BIAS = 1.5;

/** Writes the pick sphere of frame entity `index` into `out` and returns it, or null for the unit default. */
export type PickShapeFn = (index: number, out: PickShape) => PickShape | null;

/**
 * Ids of entities whose pick center projects inside `rect` (canvas CSS pixels, any corner order).
 * `viewProj` is projection * view, column-major (three.js Matrix4.elements).
 */
export function selectInRect(
  frame: InterpolatedFrame,
  viewProj: ArrayLike<number>,
  width: number,
  height: number,
  rect: ScreenRect,
  opts: BoxSelectOptions = {},
): number[] {
  const minX = Math.min(rect.x0, rect.x1);
  const maxX = Math.max(rect.x0, rect.x1);
  const minY = Math.min(rect.y0, rect.y1);
  const maxY = Math.max(rect.y0, rect.y1);
  const m = viewProj;
  const out: number[] = [];
  const scratch: PickShape = { radius: PICK_RADIUS, height: PICK_CENTER_HEIGHT };
  for (let i = 0; i < frame.count; i++) {
    if (opts.owner !== undefined && frame.owner[i] !== opts.owner) continue;
    if (!opts.includeDead && (frame.flags[i]! & ENTITY_FLAG.dead) !== 0) continue;
    if (!opts.includeStructures && !drawsAsUnit(frame.typeId[i]!)) continue;
    const x = frame.x[i]!;
    const y = frame.y[i]! + (opts.shape?.(i, scratch)?.height ?? PICK_CENTER_HEIGHT);
    const z = frame.z[i]!;
    const w = m[3]! * x + m[7]! * y + m[11]! * z + m[15]!;
    if (w <= 0) continue; // behind the camera
    const nx = (m[0]! * x + m[4]! * y + m[8]! * z + m[12]!) / w;
    const ny = (m[1]! * x + m[5]! * y + m[9]! * z + m[13]!) / w;
    const sx = (nx + 1) * 0.5 * width;
    const sy = (1 - ny) * 0.5 * height;
    if (sx >= minX && sx <= maxX && sy >= minY && sy <= maxY) out.push(frame.id[i]!);
  }
  return out;
}

/** Click tolerance in CSS pixels: a click this close to a unit's pick center still selects it. */
export const PICK_TOLERANCE_PX = 16;

/**
 * Index of the unit whose projected pick center is nearest to (px, py) within maxPx, or -1.
 * The fallback for clicks that just miss a unit: at RTS distance a unit is only a few pixels wide.
 */
export function pickNearestOnScreen(
  frame: InterpolatedFrame,
  viewProj: ArrayLike<number>,
  width: number,
  height: number,
  px: number,
  py: number,
  maxPx: number = PICK_TOLERANCE_PX,
  shape?: PickShapeFn,
): number {
  const m = viewProj;
  const scratch: PickShape = { radius: PICK_RADIUS, height: PICK_CENTER_HEIGHT };
  let best = -1;
  let bestD2 = maxPx * maxPx;
  for (let i = 0; i < frame.count; i++) {
    if ((frame.flags[i]! & ENTITY_FLAG.dead) !== 0 || !drawsAsUnit(frame.typeId[i]!)) continue;
    const x = frame.x[i]!;
    const y = frame.y[i]! + (shape?.(i, scratch)?.height ?? PICK_CENTER_HEIGHT);
    const z = frame.z[i]!;
    const w = m[3]! * x + m[7]! * y + m[11]! * z + m[15]!;
    if (w <= 0) continue;
    const sx = ((m[0]! * x + m[4]! * y + m[8]! * z + m[12]!) / w + 1) * 0.5 * width;
    const sy = (1 - (m[1]! * x + m[5]! * y + m[9]! * z + m[13]!) / w) * 0.5 * height;
    const d2 = (sx - px) ** 2 + (sy - py) ** 2;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = i;
    }
  }
  return best;
}

/**
 * Distance along the ray to the box x in [-hx, hx], y in [0, hy], z in [-hz, hz] (the origin is given relative to the
 * box center on x and z and to its bottom on y), or -1 on a miss. An origin inside the box counts as distance 0.
 */
export function rayBox(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  hx: number,
  hy: number,
  hz: number,
): number {
  let tMin = 0;
  let tMax = Infinity;
  const slab = (o: number, d: number, lo: number, hi: number): boolean => {
    if (Math.abs(d) < 1e-9) return o >= lo && o <= hi;
    let t0 = (lo - o) / d;
    let t1 = (hi - o) / d;
    if (t0 > t1) [t0, t1] = [t1, t0];
    tMin = Math.max(tMin, t0);
    tMax = Math.min(tMax, t1);
    return tMin <= tMax;
  };
  return slab(ox, dx, -hx, hx) && slab(oy, dy, 0, hy) && slab(oz, dz, -hz, hz) ? tMin : -1;
}

/**
 * Index of the nearest entity hit by the ray (origin o, normalized direction d), or -1.
 * Units are spheres of PICK_RADIUS around their pick center; `shape` gives other entities their own sphere.
 * Dead entities are skipped.
 */
export function pickEntity(
  frame: InterpolatedFrame,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  shape?: PickShapeFn,
): number {
  let best = -1;
  let bestT = Infinity;
  const scratch: PickShape = { radius: PICK_RADIUS, height: PICK_CENTER_HEIGHT };
  for (let i = 0; i < frame.count; i++) {
    if ((frame.flags[i]! & ENTITY_FLAG.dead) !== 0) continue;
    scratch.top = 0; // the scratch is shared: a box from the previous entity must not leak into this one
    const s = shape?.(i, scratch);
    if (s && s.top !== undefined && s.top > 0) {
      const t = rayBox(
        ox - frame.x[i]!,
        oy - (frame.y[i]! - BOX_SINK),
        oz - frame.z[i]!,
        dx,
        dy,
        dz,
        s.halfX ?? 0,
        s.top + BOX_SINK,
        s.halfZ ?? 0,
      );
      if (t >= 0 && t + BOX_HIT_BIAS < bestT) {
        bestT = t + BOX_HIT_BIAS;
        best = i;
      }
      continue;
    }
    const radius = s ? s.radius : PICK_RADIUS;
    const r2 = radius * radius;
    const cx = frame.x[i]! - ox;
    const cy = frame.y[i]! + (s ? s.height : PICK_CENTER_HEIGHT) - oy;
    const cz = frame.z[i]! - oz;
    const t = cx * dx + cy * dy + cz * dz;
    if (t <= 0) continue;
    const d2 = cx * cx + cy * cy + cz * cz - t * t;
    if (d2 > r2) continue;
    const hit = t - Math.sqrt(r2 - d2);
    if (hit < bestT) {
      bestT = hit;
      best = i;
    }
  }
  return best;
}
