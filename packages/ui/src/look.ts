import { HUD_LOOK_CONSOLE_CSS } from './look.console.js';
import { HUD_LOOK_PANELS_CSS } from './look.panels.js';

/**
 * "Roest en Fosfor": the committed, bitmap-free look of the HUD. Plates are dark and riveted, text on a screen is
 * phosphor green (data) or amber (action), the screens carry scanlines and a vignette. Layout stays in styles.ts;
 * this file only changes colour, type and surface, so it is safe to swap or drop. The dev-only bitmap skin (skin.ts)
 * builds on the same tokens and class names, and lays the designer's console art over exactly these boxes.
 *
 * Readability rules from the design sheets: text 11px or larger, text never directly on a texture (always on a plate
 * colour or a glass), nothing blinks faster than 3 Hz (the only animations are the perk badge, 0.6 Hz, and the terminal
 * cursor, 1 Hz).
 */

/** Colour and type tokens. Values follow the token sheet; phosphor is the designer's #8dff6f. */
export const HUD_TOKENS_CSS = `
.co-hud{
--plate-900:#0b0d0a;--plate-800:#14170f;--plate-700:#1e2218;--plate-600:#2b3022;--edge-dark:#46493a;--edge-light:#6b6e58;
--ink:#e8e4d4;--act-dim:#c3bfac;--danger-text:#ff8f85;--locked-text:#a9a795;--paper:#d9cfae;--paper-ink:#1c1810;
--phos-500:#8dff6f;--phos-700:#2fa84a;--phos-glow:rgba(90,255,90,.55);--glass-top:#0f2412;--glass-bottom:#07120a;
--amber-700:#ffd27a;--amber-500:#f4a62a;--amber-780:#8a6410;--amber-glow:rgba(244,166,42,.55);
--font-ui:'Barlow Condensed','Arial Narrow','Roboto Condensed',system-ui,sans-serif;
--font-term:'Courier New',ui-monospace,Menlo,Consolas,monospace;
--scanlines:repeating-linear-gradient(0deg,rgba(0,0,0,.2) 0 1px,rgba(0,0,0,0) 1px 3px);
--vignette:radial-gradient(120% 120% at 50% 45%,rgba(0,0,0,0) 55%,rgba(0,0,0,.45) 100%);
--hazard:repeating-linear-gradient(-45deg,var(--amber-500) 0 6px,#17130a 6px 12px);
--gold:#e6d48a;--brass-hi:#cdbb7a;--brass:#8a7a42;--brass-lo:#4d4322;--olive:#4b4a2b;--olive-lo:#2f2e1b;
--key-green:#2f9a33;--key-green-lo:#1c6a22;
}
`;

/** The fallback look: gradients and borders only. */
export const HUD_LOOK_CSS = HUD_LOOK_PANELS_CSS + HUD_LOOK_CONSOLE_CSS;
