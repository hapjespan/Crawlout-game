import { h, render } from 'preact';
import { HudController } from './controller.js';
import { HUD_CSS } from './styles.js';
import { SKIN_ATTR, SKIN_VALUE, hudSkinCss } from './skin.js';
import type { HudSkin } from './skin.js';
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
  MinimapFog,
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
  UnitState,
} from './types.js';
export { CARD_ICON_IDS } from './types.js';
export { ACTIONS, HudController, unitStateOf } from './controller.js';
export { hudSkinCss, skinComplete } from './skin.js';
export type { HudSkin, HudSkinFrame, HudSkinManifest, HudSkinTile } from './skin.js';

const STYLE_ID = 'co-hud-style';
const SKIN_STYLE_ID = 'co-hud-skin-style';

export interface HudMountOptions {
  /** Dev-only bitmap skin laid over the CSS look; absent (production, CI) means the CSS-only look. */
  skin?: HudSkin;
  /**
   * Demo-only (the HUD demo page's mid-game preset, for the design review image): keep the build menu open while a
   * building is being placed, so the menu, the placement strip and the card window show at once. The game never sets it.
   */
  keepBuildMenuWhilePlacing?: boolean;
}

/** Monteert de HUD als overlay in `el`. `el` moet zelf gepositioneerd zijn (relative of absolute). */
export function mountHud(el: HTMLElement, deps: HudDeps, options: HudMountOptions = {}): HudHandle {
  const doc = el.ownerDocument;
  if (!doc.getElementById(STYLE_ID)) {
    const style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = HUD_CSS;
    doc.head.appendChild(style);
  }
  // The bitmap skin is optional and only ever handed over in dev; an incomplete skin leaves the CSS look as it is.
  const skinCss = options.skin ? hudSkinCss(options.skin) : '';
  if (skinCss) {
    if (!doc.getElementById(SKIN_STYLE_ID)) {
      const style = doc.createElement('style');
      style.id = SKIN_STYLE_ID;
      style.textContent = skinCss;
      doc.head.appendChild(style);
    }
    el.setAttribute(SKIN_ATTR, SKIN_VALUE);
  }
  const ctl = new HudController(deps, options.keepBuildMenuWhilePlacing === true);
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
      el.removeAttribute(SKIN_ATTR);
      ctl.unmount();
      render(null, el);
    },
  };
}
