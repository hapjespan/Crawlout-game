import { h, render } from 'preact';
import { HudController } from './controller.js';
import { installHudStyles, installSkin, setSkinAttribute } from './install.js';
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
  RaiderCage,
  RaiderGuardGroup,
  RaiderKind,
  RaiderStats,
  RosterGroup,
  RosterUnit,
  SelectedEntity,
  TargetingKind,
  TargetPoint,
  TargetEnemy,
  TargetNode,
  TargetOwn,
  TargetClaim,
  TargetResult,
  UnitActivity,
  UnitState,
} from './types.js';
export { CARD_ICON_IDS } from './types.js';
export type { MinimapZone, SurvivalRank, SurvivalView } from './survival.js';
export type { MinimapProjectPart, ProjectHold, ProjectKindView, ProjectView } from './project.js';
export { ACTIONS, HudController, unitStateOf } from './controller.js';
export { hudSkinCss, menuSkinCss, skinComplete } from './skin.js';
export type { HudSkin, HudSkinFrame, HudSkinManifest, HudSkinTile } from './skin.js';
export { setSkinAttribute } from './install.js';
export { mountMenu } from './menu/mount.js';
export { mountMatchEnd } from './menu/end.js';
export type { MatchEndOptions } from './menu/end.js';
export type { MenuMount, MenuMountOptions } from './menu/mount.js';
export type {
  LobbyRequest,
  MenuContent,
  MenuDeps,
  MenuFaction,
  MenuHandle,
  MenuHero,
  MenuMapInfo,
} from './menu/types.js';
export type {
  AiMatchConfig,
  GameTypeId,
  MenuScreen,
  PvpConnectConfig,
  PvpForm,
} from './menu/flow.js';
export { DEFAULT_HERO, defaultRelayUrl, RANDOM_FACTION } from './menu/flow.js';
export { identifyYou } from './menu/lobbyModel.js';
export {
  DEFAULT_SETTINGS,
  effectiveParams,
  hudScaleFromParams,
  loadSettings,
  saveSettings,
  HUD_SCALE_VALUE,
} from './menu/settings.js';
export type { MenuSettings, SettingsStorage } from './menu/settings.js';

export interface HudMountOptions {
  /** Dev-only bitmap skin laid over the CSS look; absent (production, CI) means the CSS-only look. */
  skin?: HudSkin;
  /** With a skin: start with it on (default) or off (the "HUD-uiterlijk" setting); `setSkinAttribute` toggles it live. */
  skinOn?: boolean;
  /**
   * Demo-only (the HUD demo page's mid-game preset, for the design review image): keep the build menu open while a
   * building is being placed, so the menu, the placement strip and the card window show at once. The game never sets it.
   */
  keepBuildMenuWhilePlacing?: boolean;
}

/** Monteert de HUD als overlay in `el`. `el` moet zelf gepositioneerd zijn (relative of absolute). */
export function mountHud(el: HTMLElement, deps: HudDeps, options: HudMountOptions = {}): HudHandle {
  const doc = el.ownerDocument;
  installHudStyles(doc);
  // The bitmap skin is optional and only ever handed over in dev; an incomplete skin leaves the CSS look as it is.
  if (installSkin(doc, options.skin, false)) setSkinAttribute(el, options.skinOn ?? true);
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
      setSkinAttribute(el, false);
      ctl.unmount();
      render(null, el);
    },
  };
}
