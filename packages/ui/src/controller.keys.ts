import {
  type QuickId,
  ACTIONS,
  PERK_KEYS,
  ABILITY_KEYS,
  HERO_KEY,
  PERK_PANEL_KEY,
  CRAFT_KEY,
  QUICK_HINT,
  TRAINING_BUILDING_KEY,
  isAlarm,
} from './controller.actions.js';
import { type HudControllerCore, hasCraftCards, setState } from './controller.core.js';

// HudController: hotkeys and the quick buttons of the consoles.

function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  return (
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT' ||
    el.isContentEditable === true
  );
}

/** HudController.handleKeyDown. */
export function handleKeyDown(core: HudControllerCore, e: KeyboardEvent): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return false;
  const key = e.key.toLowerCase();
  if (key === 'escape') {
    if (core.state.confirmSurrender) core.ctl.cancelSurrender();
    else if (core.state.targeting) core.ctl.cancelTargeting();
    else if (core.state.placement) core.ctl.cancelPlacement();
    else if (core.state.perkPanelOpen) core.ctl.closePerkPanel();
    else if (core.state.buildMenuOpen) core.ctl.closeBuildMenu();
    else if (core.state.craftMenuOpen) setState(core, { craftMenuOpen: false });
    else return false;
    return true;
  }
  if (core.state.confirmSurrender) return false;
  // Bouwmenu open: cijfers kiezen een gebouw (gaat voor de rolletoetsen).
  if (core.state.buildMenuOpen && /^[1-9]$/.test(key)) {
    const option = core.state.buildOptions[Number(key) - 1];
    return option ? core.ctl.chooseBuild(option.buildingId) || true : true;
  }
  // Kaarten van het gebouwpaneel (alleen gebouwen, of bewoners na K): cijfers starten de kaart met die sneltoets.
  if (/^[1-9]$/.test(key) && core.ctl.cardKeysActive()) {
    const card = core.state.cards.find((c) => c.hotkey === key);
    return card ? core.ctl.startCard(card) || true : true;
  }
  // Perk-keuze bij een level-up: F1, F2, F3 (browser-hulp op F1 wordt onderdrukt).
  const perkIdx = PERK_KEYS.indexOf(key as (typeof PERK_KEYS)[number]);
  if (perkIdx >= 0) {
    const perk = core.ctl.pendingPerks() > 0 ? core.state.perkOptions[perkIdx] : undefined;
    return perk ? core.ctl.pickPerk(perk.perkId) || true : core.ctl.hasHero();
  }
  // Abilities: Z, X, C.
  const abilityIdx = ABILITY_KEYS.indexOf(key as (typeof ABILITY_KEYS)[number]);
  if (abilityIdx >= 0) {
    const ability = core.state.heroAbilities[abilityIdx];
    return ability ? core.ctl.useAbility(ability.abilityId) || true : false;
  }
  if (key === 'r' && core.state.showLobby && core.deps.toggleReady) {
    core.ctl.toggleReady();
    return true;
  }
  if (key === 'o' && core.state.showLobby && core.deps.openHostSettings && core.ctl.isHost()) {
    core.ctl.openHostSettings();
    return true;
  }
  if (key === '.' && core.deps.getRoster) return core.ctl.selectNextIdle() || true;
  if (key === PERK_PANEL_KEY) return core.ctl.togglePerkPanel();
  if (key === HERO_KEY) return core.ctl.focusHero() || core.ctl.hasHero();
  if (key === CRAFT_KEY) return core.ctl.toggleCraftMenu();
  const action = ACTIONS.find((a) => a.key === key);
  return action ? core.ctl.run(action.id) : false;
}

/** HudController.quickAvailable. */
export function quickAvailable(core: HudControllerCore, id: QuickId): boolean {
  const s = core.state;
  switch (id) {
    case 'hero':
      return (
        s.roster.some((g) => g.key === 'hero' && g.units.length > 0) ||
        (!!s.status?.hero?.entityId && !s.heroDead && core.deps.selectUnits !== undefined)
      );
    case 'building':
      return s.buildingButtons.some((b) => b.sites.length > 0) && !!core.deps.selectUnits;
    case 'idle':
      return (
        s.roster.some((g) => g.units.some((u) => u.activity === 'idle')) && !!core.deps.selectUnits
      );
    case 'build':
      return core.ctl.isEnabled(ACTIONS.find((a) => a.id === 'build')!);
    case 'lobby':
      return core.deps.getLobby !== undefined;
    case 'perks':
      return core.ctl.pendingPerks() > 0;
    case 'craft':
      return hasCraftCards(core);
    case 'training':
      return (
        s.buildingButtons.some((b) => b.key === TRAINING_BUILDING_KEY && b.sites.length > 0) &&
        !!core.deps.selectUnits
      );
    case 'alert':
      return s.toasts.some(isAlarm);
    case 'menu':
      return true;
  }
}

/** HudController.quick. */
export function quick(core: HudControllerCore, id: QuickId): boolean {
  if (core.state.confirmSurrender) return false;
  if (!core.ctl.quickAvailable(id)) {
    core.ctl.showHint(QUICK_HINT[id]);
    return false;
  }
  switch (id) {
    case 'hero':
      return core.ctl.focusHero();
    case 'building':
      return core.ctl.selectNextBuilding();
    case 'idle':
      return core.ctl.selectNextIdle();
    case 'build':
      return core.ctl.run('build');
    case 'lobby':
      return core.ctl.run('lobby');
    case 'perks':
      return core.ctl.togglePerkPanel();
    case 'craft':
      return core.ctl.toggleCraftMenu();
    case 'training':
      return core.ctl.selectBuilding(TRAINING_BUILDING_KEY, true);
    case 'alert':
      return core.ctl.run('lastAlert');
    case 'menu':
      core.ctl.requestSurrender();
      return true;
  }
}
