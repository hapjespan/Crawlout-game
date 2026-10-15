// Per-instance colour variation, so a forest does not look cloned: brightness within +-8 percent and a warm/cool tint shift
// (red and blue move in opposite directions, 8 percent apart at the extremes), for trees, grass and plants. Other props keep the small brightness variation they always had. The
// variation is a pure function of two per-instance hashes, so a prop keeps its colour while the camera moves.
import { isTree, type PropCategory } from './propCategory.js';

/** Largest deviation of the brightness from 1 for foliage; the tint moves red and blue by half of it each way. */
export const FOLIAGE_VARIATION = 0.08;

/**
 * Grass patches are dry straw-brown art on brown ground, which makes them vanish at RTS distance. Their tint is
 * freshened (greener, a bit brighter) and varies more per instance, so patches read as grass without any size change.
 */
export const GRASS_FRESH = [0.95, 1.75, 0.75] as const;
export const GRASS_VARIATION = 0.2;

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
  if (category === 'grass') {
    const b = (1.3 + GRASS_VARIATION * (2 * h1 - 1)) * gain;
    const t = GRASS_VARIATION * 0.5 * (2 * h2 - 1); // yellower (dry) to greener (fresh) from patch to patch
    out[0] = b * GRASS_FRESH[0] * (1 + t);
    out[1] = b * GRASS_FRESH[1] * (1 - t * 0.5);
    out[2] = b * GRASS_FRESH[2] * (1 - t);
  } else if (variesStrongly(category)) {
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
