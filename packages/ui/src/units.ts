/**
 * One layout unit: a 1024x572 pixel of the mockup. The whole HUD is laid out in these, so it keeps the proportions of the
 * design at any window size (1280x720 is 1.25 per unit, 1920x1080 is 1.875) and the bottom consoles stay near a fifth
 * of the height. `--u` is set on `.co-hud` (styles.ts).
 */
export const u = (n: number): string => `calc(var(--u) * ${n})`;

/** A font size that follows the unit but never drops under 11 px, so text stays readable on small windows. */
export const font = (n: number): string => `max(11px, ${u(n)})`;
