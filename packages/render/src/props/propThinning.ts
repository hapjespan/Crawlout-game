// Distance thinning of props, per category. A far chunk draws only part of its props (propLayer.ts), and over all
// chunks at most `maxVisible` props are drawn. Which props give way first depends on the category: ground cover
// (grass, plants, debris) first, then rocks and containers, trees and structures last, so a forest keeps its shape
// while the undergrowth is already gone.
import type { PropCategory } from './propCategory.js';

export const THIN_TIERS = 3;

/** 0 thins first (ground cover), 2 last (trees, structures). */
export type ThinTier = 0 | 1 | 2;

export function thinTier(category: PropCategory): ThinTier {
  switch (category) {
    case 'grass':
    case 'plant':
    case 'debris':
      return 0;
    case 'rock':
    case 'crate':
    case 'chest':
    case 'barrel':
      return 1;
    default:
      return 2; // tree-leafy, tree-bare, structure
  }
}

/** Per tier, the share of `thinDistance` at which thinning starts: ground cover thins from 65 percent of the distance (it is small, so it is the first to vanish into the ground). */
export const TIER_THIN_SCALE: readonly [number, number, number] = [0.65, 0.8, 1];
/** Per tier, the share of `minDensity` a far chunk keeps at the least. */
export const TIER_MIN_DENSITY_SCALE: readonly [number, number, number] = [0.5, 0.7, 1];

/** Share of a chunk's props of `tier` drawn at distance `d` before the budget cap: 1 up to the tier's thin distance. */
export function tierDensity(
  tier: ThinTier,
  d: number,
  thinDistance: number,
  minDensity: number,
): number {
  const start = thinDistance * TIER_THIN_SCALE[tier];
  if (d < start) return 1;
  return Math.max(minDensity * TIER_MIN_DENSITY_SCALE[tier], start / d);
}

export interface ShedPlan {
  /** Multiplier per tier on the density of chunks within the tier's thin distance. */
  near: [number, number, number];
  /** Multiplier per tier on the density of the thinned chunks beyond it. */
  far: [number, number, number];
}

/**
 * Applies the budget: `near` and `far` are the props each tier would draw (the sum over chunks of its total times its
 * density). Over `maxVisible`, the lowest tier gives way first, within a tier the far chunks before the near ones, and
 * only when a tier is gone altogether does the next one lose any.
 */
export function shedPlan(
  near: readonly number[],
  far: readonly number[],
  maxVisible: number,
): ShedPlan {
  const plan: ShedPlan = { near: [1, 1, 1], far: [1, 1, 1] };
  let excess = -maxVisible;
  for (let t = 0; t < THIN_TIERS; t++) excess += (near[t] ?? 0) + (far[t] ?? 0);
  for (let t = 0; t < THIN_TIERS && excess > 0; t++) {
    const f = far[t] ?? 0;
    const n = near[t] ?? 0;
    const cutFar = Math.min(excess, f);
    if (f > 0) plan.far[t] = 1 - cutFar / f;
    excess -= cutFar;
    const cutNear = Math.min(excess, n);
    if (n > 0) plan.near[t] = 1 - cutNear / n;
    excess -= cutNear;
  }
  return plan;
}
