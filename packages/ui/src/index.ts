import { h, render } from 'preact';
import { HudController } from './controller.js';
import { HUD_CSS } from './styles.js';
import { Hud } from './view.js';
import type { HudDeps, HudHandle } from './types.js';

export type { HudDeps, HudHandle, NetworkState, SelectedEntity, TargetingKind, TargetPoint, TargetNode, TargetResult } from './types.js';
export { ACTIONS, HudController } from './controller.js';

const STYLE_ID = 'co-hud-style';

/** Monteert de HUD als overlay in `el`. `el` moet zelf gepositioneerd zijn (relative of absolute). */
export function mountHud(el: HTMLElement, deps: HudDeps): HudHandle {
  const doc = el.ownerDocument;
  if (!doc.getElementById(STYLE_ID)) {
    const style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = HUD_CSS;
    doc.head.appendChild(style);
  }
  const ctl = new HudController(deps);
  const onKey = (e: KeyboardEvent): void => {
    if (ctl.handleKeyDown(e)) e.preventDefault();
  };
  doc.addEventListener('keydown', onKey);
  ctl.start();
  render(h(Hud, { ctl }), el);
  return {
    completeTargeting: (t) => ctl.completeTargeting(t),
    cancelTargeting: () => ctl.cancelTargeting(),
    refresh: () => ctl.refresh(),
    unmount: () => {
      doc.removeEventListener('keydown', onKey);
      ctl.unmount();
      render(null, el);
    },
  };
}
