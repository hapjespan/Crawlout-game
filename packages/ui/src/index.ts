import { h, render } from 'preact';
import { HudController } from './controller.js';
import { HUD_CSS } from './styles.js';
import { Hud } from './view.js';
import type { HudDeps, HudHandle } from './types.js';

export type {
  AlertKind,
  BuildOption,
  BuildingButton,
  BuildingSite,
  BuildingCard,
  CardIconId,
  CardKind,
  CardState,
  CraftOption,
  DominanceView,
  HeroAbilityOption,
  RecruitOption,
  ResearchOption,
  HudAlert,
  HudDeps,
  HudHandle,
  LobbyPlayerView,
  LobbyView,
  MinimapBlip,
  MinimapClaim,
  MinimapData,
  NetworkState,
  PerkOption,
  RosterGroup,
  RosterUnit,
  SelectedEntity,
  TargetingKind,
  TargetPoint,
  TargetEnemy,
  TargetNode,
  TargetResult,
  UnitActivity,
} from './types.js';
export { CARD_ICON_IDS } from './types.js';
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
    completePlacement: (p) => ctl.completePlacement(p),
    cancelPlacement: () => ctl.cancelPlacement(),
    setPlacementHint: (r) => ctl.setPlacementHint(r),
    showHint: (t) => ctl.showHint(t),
    completeTargeting: (t) => ctl.completeTargeting(t),
    cancelTargeting: () => ctl.cancelTargeting(),
    targetingActive: () => ctl.targetingActive(),
    placementActive: () => ctl.placementActive(),
    refresh: () => ctl.refresh(),
    unmount: () => {
      doc.removeEventListener('keydown', onKey);
      ctl.unmount();
      render(null, el);
    },
  };
}
