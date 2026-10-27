import { MENU_CONTROLS_CSS } from './styles.controls.js';
import { MENU_SCREEN_CSS } from './styles.screen.js';

/**
 * The look of the screens before the match: the committed, bitmap-free "Roest en Fosfor" (riveted rusty plates, a CRT
 * console with phosphor text, amber for action, scanlines and a vignette) built on the HUD tokens (look.ts), so the menu
 * and the HUD cannot drift apart. The dev-only bitmap skin lays the designer's art over the same class names
 * (`menuSkinCss` in skin.ts).
 *
 * Everything is sized in `--m`, one pixel of a 1280x720 window, growing with the window up to 4K (and never below 0.8,
 * so text stays readable on small windows: every font size here is `max(11px, ...)`). Nothing blinks faster than 3 Hz:
 * the flicker is a faint overlay with two short dips every 3.7 s, the cursor blinks at 1 Hz, and
 * `prefers-reduced-motion` turns the motion off.
 */

export { m, mf } from './units.js';

export const MENU_CSS = MENU_SCREEN_CSS + MENU_CONTROLS_CSS;
