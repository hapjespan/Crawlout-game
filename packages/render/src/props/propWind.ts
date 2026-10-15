// Light wind sway for foliage, in the vertex shader of the prop material (structures/propMaterial.ts): a vertex moves
// along the wind by (height in the model / model height)^2 times an amplitude, so the base stays put and the top
// sways. Per instance a phase (iTint.w) plus a travelling wave over the ground, so a forest ripples instead of
// nodding in unison. Only categories that have leaves or blades sway.
import type { PropCategory } from './propCategory.js';

export interface WindSpec {
  /** Sway at the top as a share of the (instance's) height. */
  amplitude: number;
  /** Radians per second of the main wave. */
  speed: number;
}

const WIND: Partial<Record<PropCategory, WindSpec>> = {
  'tree-leafy': { amplitude: 0.02, speed: 1.1 },
  grass: { amplitude: 0.09, speed: 2.3 },
  plant: { amplitude: 0.05, speed: 1.7 },
};

/** The wind a category sways in, or null for a prop that stands still (bare trees, rocks, crates, ...). */
export function windOf(category: PropCategory): WindSpec | null {
  return WIND[category] ?? null;
}

/** Direction the wind blows towards on the ground (x, z), unit length. */
export const WIND_DIRECTION: readonly [number, number] = [0.8, 0.6];
