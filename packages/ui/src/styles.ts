import { HUD_LOOK_CSS, HUD_TOKENS_CSS } from './look.js';
import { PROJECT_CSS } from './project.js';
import { HUD_LAYOUT_CARDS_CSS } from './styles.cards.js';
import { HUD_LAYOUT_CONSOLE_CSS } from './styles.console.js';
import { HUD_LAYOUT_PANELS_CSS } from './styles.panels.js';

/** Indeling en basisstijl van de HUD. Alles onder .co-hud zodat er niets lekt; het uiterlijk (kleur, vorm) staat in look.ts. */
const HUD_LAYOUT_CSS = HUD_LAYOUT_PANELS_CSS + HUD_LAYOUT_CONSOLE_CSS + HUD_LAYOUT_CARDS_CSS;

/** Indeling plus het bitmap-vrije "Roest en Fosfor"-uiterlijk (tokens en fallback). */
export const HUD_CSS = HUD_LAYOUT_CSS + HUD_TOKENS_CSS + HUD_LOOK_CSS + PROJECT_CSS;
