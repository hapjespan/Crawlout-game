// What a building site and a scrap heap look like, as pure functions of the snapshot (contract 1, sprint 2):
// a building under construction has anim build with animT = build progress; a scrap node's hpPct is its remaining
// stock in percent of the starting stock.

/** Share of the wall height a fresh site already shows, so a just-placed building is visible inside its scaffold. */
export const SITE_MIN_HEIGHT = 0.08;

/** Fraction of the full height a building under construction shows, from build progress 0..1. */
export function constructionHeight(progress: number): number {
  const p = Math.min(1, Math.max(0, progress));
  return SITE_MIN_HEIGHT + (1 - SITE_MIN_HEIGHT) * p;
}

/** Albedo multiplier of a building site: pale raw timber and concrete, warming to the building's own tint at the end. */
const SITE_TINT: readonly [number, number, number] = [1.12, 1.06, 0.92];

export function constructionTint(
  progress: number,
  tint: readonly [number, number, number],
  out: [number, number, number],
): [number, number, number] {
  const p = Math.min(1, Math.max(0, progress));
  const k = p * p; // stays raw most of the way, then catches up
  out[0] = SITE_TINT[0] + (tint[0] - SITE_TINT[0]) * k;
  out[1] = SITE_TINT[1] + (tint[1] - SITE_TINT[1]) * k;
  out[2] = SITE_TINT[2] + (tint[2] - SITE_TINT[2]) * k;
  return out;
}

/** Scaffold around a site: a little wider than the footprint and a little taller than the finished walls. */
export const SCAFFOLD_MARGIN = 0.35; // meters on each side
export const SCAFFOLD_HEIGHT = 1.1; // times the wall height

/** Smallest heap an almost empty node shrinks to, as a share of a full one (width) and of its height. */
export const SCRAP_MIN_WIDTH = 0.45;
export const SCRAP_MIN_HEIGHT = 0.2;

/**
 * Heap scale from hpPct (remaining stock, 0..100): it narrows a little and flattens a lot as it is picked clean.
 * Writes [width, height] into `out`.
 */
export function scrapHeapScale(hpPct: number, out: [number, number]): [number, number] {
  const p = Math.min(100, Math.max(0, hpPct)) / 100;
  out[0] = SCRAP_MIN_WIDTH + (1 - SCRAP_MIN_WIDTH) * Math.sqrt(p);
  out[1] = SCRAP_MIN_HEIGHT + (1 - SCRAP_MIN_HEIGHT) * p;
  return out;
}

/**
 * A ghost (ENTITY_FLAG.ghost: an enemy building as last seen, now out of sight, protocol 0.11.0) is drawn greyed and
 * still: it takes the neutral team color, this cool dimming multiplier on its albedo (the fog of war then desaturates
 * the explored ground and everything on it), and no animation (a ghost site keeps the progress it had when last seen).
 */
export const GHOST_TINT: readonly [number, number, number] = [0.78, 0.8, 0.86];

/** `tint` times GHOST_TINT, into `out` (may be `tint` itself). */
export function ghostTint(
  tint: readonly [number, number, number],
  out: [number, number, number],
): [number, number, number] {
  out[0] = tint[0] * GHOST_TINT[0];
  out[1] = tint[1] * GHOST_TINT[1];
  out[2] = tint[2] * GHOST_TINT[2];
  return out;
}
