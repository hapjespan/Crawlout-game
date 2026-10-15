// Per-instance colour variation, so a forest does not look cloned: brightness within +-8 percent and a warm/cool tint shift
// (red and blue move in opposite directions, 8 percent apart at the extremes), for trees, grass and plants. Other props keep the small brightness variation they always had. The
// variation is a pure function of two per-instance hashes, so a prop keeps its colour while the camera moves.
import { isTree, type PropCategory } from './propCategory.js';

/** Largest deviation of the brightness from 1 for foliage; the tint moves red and blue by half of it each way. */
export const FOLIAGE_VARIATION = 0.08;

export function variesStrongly(category: PropCategory): boolean {
  return isTree(category) || category === 'grass' || category === 'plant';
}

/**
 * Writes the rgb multiplier on the albedo into `out`. `h1` and `h2` are per-instance hashes in 0..1: `h1` the
 * brightness, `h2` the tint, which pushes red up and blue down (or the reverse) by the same amount (at most FOLIAGE_VARIATION / 2). `gain` is the
 * per-asset albedo gain.
 */
export function instanceTint(
  category: PropCategory,
  h1: number,
  h2: number,
  gain: number,
  out: [number, number, number],
): void {
  if (variesStrongly(category)) {
    const b = 1 + FOLIAGE_VARIATION * (2 * h1 - 1);
    const t = (FOLIAGE_VARIATION / 2) * (2 * h2 - 1);
    out[0] = b * (1 + t) * gain;
    out[1] = b * gain;
    out[2] = b * (1 - t) * gain;
  } else {
    const b = (0.92 + 0.14 * h1) * gain;
    out[0] = out[1] = out[2] = b;
  }
}
