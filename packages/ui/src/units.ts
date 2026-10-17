/**
 * The HUD is laid out in units of the 1024x572 mockup, then scaled down by `HUD_SCALE`, so the whole interface keeps its
 * proportions at any window size and takes a fixed, small share of the screen: the tallest bottom panel (the unit bar,
 * 134 units) is 134 * 0.64 / 572 = 15% of the window height on a 16:9 screen. `--u` (one unit, in px) is set on
 * `.co-hud` (styles.ts) as `min(100vh / 572, 100vw / 1024) * HUD_SCALE`.
 */
export const HUD_SCALE = 0.64;

/** The CSS value of `--u`: one layout unit in px. */
export const UNIT_CSS = `calc(min(calc(100vh / 572), calc(100vw / 1024)) * ${HUD_SCALE})`;

/**
 * The unit of the top-left brass bar (and what hangs under it): never under 1.2 px, so its 11 px labels fit their windows
 * on small screens (at 1280x720 the plain unit is 0.8 px and "Schroot" would be cut). From about 1080p up it equals `--u`.
 */
export const BAR_UNIT_CSS = 'max(var(--u), 1.2px)';

export const u = (n: number): string => `calc(var(--u) * ${n})`;

/** A font size that follows the unit but never drops under 11 px, so text stays readable on small windows. */
export const font = (n: number): string => `max(11px, ${u(n)})`;

/** Old HUD pixels (as drawn at 1280x720, where one unit was 1.25 px) turned into units, so they scale with the rest. */
const PX_TO_UNITS = 0.8;
const round = (n: number): number => Math.round(n * 100) / 100;

/** A length that used to be fixed `n` px, now in units. */
export const px = (n: number): string => u(round(n * PX_TO_UNITS));

/** A font size that used to be fixed `n` px, now in units (still never under 11 px). */
export const fpx = (n: number): string => font(round(n * PX_TO_UNITS));
