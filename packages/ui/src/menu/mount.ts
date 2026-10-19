import { h, render } from 'preact';
import { installHudStyles, installSkin, setSkinAttribute } from '../install.js';
import type { HudSkin } from '../skin.js';
import { MenuController } from './controller.js';
import type { MenuScreen } from './flow.js';
import { MENU_CSS } from './styles.js';
import type { MenuContent, MenuDeps, MenuHandle } from './types.js';
import { MenuApp } from './view.js';

const MENU_STYLE_ID = 'co-menu-style';

/** The menu stylesheet, once per page (after the HUD stylesheet it builds on). */
export function ensureMenuStyles(doc: Document): void {
  if (doc.getElementById(MENU_STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = MENU_STYLE_ID;
  style.textContent = MENU_CSS;
  doc.head.appendChild(style);
}

export interface MenuMountOptions {
  /** Dev-only bitmap skin, laid over the CSS look (see skin.ts); absent in production. */
  skin?: HudSkin;
  /** The skin starts on (the "HUD-uiterlijk" setting); `handle.setSkin` toggles it live. Default true when a skin is given. */
  skinOn?: boolean;
}

export interface MenuMount extends MenuHandle {
  setSkin(on: boolean): void;
  /** Hands over the factions and the map once the data is loaded. */
  setContent(content: MenuContent): void;
  readonly controller: MenuController;
}

/**
 * Mounts the pre-match screens in `el` (a positioned element that covers the page). The menu shares the HUD's tokens and
 * stylesheet, so it looks like the same game; while it is visible it takes the keyboard (arrow keys must not move the
 * camera behind it) and hands it back on `hide()`.
 */
export function mountMenu(
  el: HTMLElement,
  deps: MenuDeps,
  options: MenuMountOptions = {},
): MenuMount {
  const doc = el.ownerDocument;
  installHudStyles(doc);
  ensureMenuStyles(doc);
  const skinUsable = installSkin(doc, options.skin, true);
  const setSkin = (on: boolean): void => setSkinAttribute(el, skinUsable && on);
  setSkin(options.skinOn ?? true);

  const ctl = new MenuController(deps);
  const redraw = (): void => render(h(MenuApp, { ctl }), el);
  ctl.subscribe(redraw);
  redraw();

  // Whatever the menu does not use must not reach the camera and the game behind it either.
  const onKeyDown = (e: KeyboardEvent): void => {
    if (!ctl.visible) return;
    if (ctl.handleKey(e, el)) e.preventDefault();
    e.stopPropagation();
  };
  const onKeyUp = (e: KeyboardEvent): void => {
    if (ctl.visible) e.stopPropagation();
  };
  doc.addEventListener('keydown', onKeyDown);
  doc.addEventListener('keyup', onKeyUp);

  return {
    controller: ctl,
    setSkin,
    setContent: (content) => ctl.setContent(content),
    setProgress: (value, label) =>
      ctl.dispatch({ type: 'progress', value, ...(label ? { label } : {}) }),
    setLoaded: () => ctl.dispatch({ type: 'loaded' }),
    setLink: (status) => ctl.dispatch({ type: 'pvp/link', status }),
    setLobby: (roomId, map, players, you, mode) =>
      ctl.dispatch({ type: 'pvp/lobby', roomId, map, players, you, mode }),
    setError: (message) => ctl.dispatch({ type: 'pvp/error', message }),
    hide: () => ctl.setVisible(false),
    show: (screen?: MenuScreen) => (screen ? ctl.showScreen(screen) : ctl.setVisible(true)),
    isVisible: () => ctl.visible,
    screen: () => ctl.state.screen,
    unmount: () => {
      doc.removeEventListener('keydown', onKeyDown);
      doc.removeEventListener('keyup', onKeyUp);
      render(null, el);
    },
  };
}
