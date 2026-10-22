import { HUD_CSS } from './styles.js';
import { SKIN_ATTR, SKIN_VALUE, hudSkinCss, menuSkinCss } from './skin.js';
import type { HudSkin } from './skin.js';

const STYLE_ID = 'co-hud-style';
const SKIN_STYLE_ID = 'co-hud-skin-style';
const MENU_SKIN_STYLE_ID = 'co-menu-skin-style';

/** Puts the HUD stylesheet (layout, tokens and the CSS "Roest en Fosfor" look) in the page once; the menu shares it. */
export function installHudStyles(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = HUD_CSS;
  doc.head.appendChild(style);
}

function installOnce(doc: Document, id: string, css: string): boolean {
  if (css === '') return false;
  if (!doc.getElementById(id)) {
    const style = doc.createElement('style');
    style.id = id;
    style.textContent = css;
    doc.head.appendChild(style);
  }
  return true;
}

/**
 * Installs the dev-only bitmap skin CSS (HUD, and with `menu` also the menu plates) and returns whether it is usable;
 * an incomplete skin installs nothing and leaves the CSS look.
 */
export function installSkin(doc: Document, skin: HudSkin | undefined, menu: boolean): boolean {
  if (!skin) return false;
  const ok = installOnce(doc, SKIN_STYLE_ID, hudSkinCss(skin));
  if (ok && menu) installOnce(doc, MENU_SKIN_STYLE_ID, menuSkinCss(skin));
  return ok;
}

/** Turns the bitmap skin on or off for the HUD or menu host element; its CSS only applies below this attribute. */
export function setSkinAttribute(el: HTMLElement, on: boolean): void {
  if (on) el.setAttribute(SKIN_ATTR, SKIN_VALUE);
  else el.removeAttribute(SKIN_ATTR);
}
