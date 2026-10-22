// Foundations (visual review, buildings on slopes): the drawn terrain is levelled under every building and building
// site. Each footprint gets a platform: the ground inside it (plus a small margin) is set to the footprint's mean
// ground height, and a soft falloff blends back into the real ground, wider where the slope is steeper (a cut into the
// uphill side, a fill on the downhill side). Render only: the sim and the map's heights are untouched. The result is
// baked into the terrain field (terrainField.ts), so height lookups, units walking past, props, decals and the chunk
// meshes all see the same ground; the building stands at the platform height.
//
// Every sample is a pure function of the ground heights and the platforms around it (applied in id order), so a
// platform can come and go without leaving anything behind: the affected region is restored to the ground and the
// platforms over it applied again.
import type { FieldRegion, TerrainField } from './terrainField.js';

/** A building footprint on the ground: center and half extents in meters (axis aligned, as buildings are). */
export interface PlatformSpec {
  id: number;
  x: number;
  z: number;
  hx: number;
  hz: number;
}

/** What a platform does to the ground: the height of its flat top and the width of its soft border (m). */
export interface PlatformShape {
  target: number;
  falloff: number;
}

/** The flat top extends this far beyond the footprint, so walls and trim do not stand on the sloping border. */
export const PLATFORM_MARGIN = 0.45;
/** Width of the soft border: this plus FALLOFF_PER_M per meter the ground deviates from the platform, within the clamp. */
export const FALLOFF_MIN = 1.8;
export const FALLOFF_PER_M = 1.7;
export const FALLOFF_MAX = 9;
/** Everything a platform can touch lies within this distance (m) of its footprint. */
export const PLATFORM_REACH = PLATFORM_MARGIN + FALLOFF_MAX;

/** Inclusive sample bounds in a field. */
export type SampleRegion = FieldRegion;

/** The field samples (clamped to the field) within `reach` meters of the footprint. */
export function platformRegion(
  field: TerrainField,
  p: PlatformSpec,
  reach = PLATFORM_REACH,
): SampleRegion | null {
  const i0 = Math.max(0, Math.floor((p.x - p.hx - reach - field.minX) / field.step));
  const i1 = Math.min(field.nx - 1, Math.ceil((p.x + p.hx + reach - field.minX) / field.step));
  const j0 = Math.max(0, Math.floor((p.z - p.hz - reach - field.minZ) / field.step));
  const j1 = Math.min(field.nz - 1, Math.ceil((p.z + p.hz + reach - field.minZ) / field.step));
  return i0 > i1 || j0 > j1 ? null : { i0, j0, i1, j1 };
}

/** Union of two regions (either may be null). */
export function unionRegion(a: SampleRegion | null, b: SampleRegion | null): SampleRegion | null {
  if (!a) return b;
  if (!b) return a;
  return {
    i0: Math.min(a.i0, b.i0),
    j0: Math.min(a.j0, b.j0),
    i1: Math.max(a.i1, b.i1),
    j1: Math.max(a.j1, b.j1),
  };
}

export function regionsOverlap(a: SampleRegion, b: SampleRegion): boolean {
  return a.i0 <= b.i1 && b.i0 <= a.i1 && a.j0 <= b.j1 && b.j0 <= a.j1;
}

/** Mean ground height over the footprint (with its margin) and the border width that its deviation asks for. */
export function shapePlatform(
  field: TerrainField,
  ground: Float32Array,
  p: PlatformSpec,
): PlatformShape {
  const r = platformRegion(field, p, PLATFORM_MARGIN);
  if (!r) return { target: 0, falloff: FALLOFF_MIN };
  let sum = 0;
  let n = 0;
  for (let j = r.j0; j <= r.j1; j++)
    for (let i = r.i0; i <= r.i1; i++) {
      sum += ground[j * field.nx + i]!;
      n++;
    }
  const target = n > 0 ? sum / n : 0;
  let dev = 0;
  for (let j = r.j0; j <= r.j1; j++)
    for (let i = r.i0; i <= r.i1; i++)
      dev = Math.max(dev, Math.abs(ground[j * field.nx + i]! - target));
  return {
    target,
    falloff: Math.min(FALLOFF_MAX, Math.max(FALLOFF_MIN, FALLOFF_MIN + dev * FALLOFF_PER_M)),
  };
}

/** Weight 0..1 of a platform at (x, z): 1 on the flat top, easing to 0 over the falloff beyond it. */
export function platformWeight(
  p: PlatformSpec,
  shape: PlatformShape,
  x: number,
  z: number,
): number {
  const dx = Math.max(Math.abs(x - p.x) - (p.hx + PLATFORM_MARGIN), 0);
  const dz = Math.max(Math.abs(z - p.z) - (p.hz + PLATFORM_MARGIN), 0);
  const d = Math.hypot(dx, dz);
  if (d <= 0) return 1;
  if (d >= shape.falloff) return 0;
  const t = d / shape.falloff;
  return 1 - t * t * (3 - 2 * t);
}

/** Pulls the samples of `region` (clamped to the platform's own reach) towards the platform: heights[k] to the target by its weight. */
export function applyPlatform(
  field: TerrainField,
  heights: Float32Array,
  p: PlatformSpec,
  shape: PlatformShape,
  region: SampleRegion,
): void {
  const own = platformRegion(field, p, PLATFORM_MARGIN + shape.falloff);
  if (!own) return;
  const i0 = Math.max(own.i0, region.i0);
  const i1 = Math.min(own.i1, region.i1);
  const j0 = Math.max(own.j0, region.j0);
  const j1 = Math.min(own.j1, region.j1);
  for (let j = j0; j <= j1; j++) {
    const z = field.minZ + j * field.step;
    for (let i = i0; i <= i1; i++) {
      const w = platformWeight(p, shape, field.minX + i * field.step, z);
      if (w <= 0) continue;
      const k = j * field.nx + i;
      heights[k] = w >= 1 ? shape.target : heights[k]! + (shape.target - heights[k]!) * w;
    }
  }
}
