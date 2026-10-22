import { CARD_DEDUPE_MS } from './controller.actions.js';
import {
  type HudControllerCore,
  showNotice,
  selectedIds,
  stopTargeting,
  setState,
} from './controller.core.js';
import type { BuildingCard } from './types.js';

// HudController: the card panel (start, press and release, reasons) and hero abilities.

/** HudController.canStartCard. */
export function canStartCard(core: HudControllerCore, card: BuildingCard): boolean {
  if (card.state !== 'available' || core.state.confirmSurrender) return false;
  return card.kind !== 'craft' || selectedIds(core, false).length > 0;
}

/** HudController.cardReason. */
export function cardReason(core: HudControllerCore, card: BuildingCard): string | null {
  if (core.ctl.canStartCard(card)) return null;
  if (card.reason) return card.reason;
  switch (card.state) {
    case 'tooExpensive':
      return `Te duur: ${card.naam} kost ${card.scrapCost} scrap`;
    case 'locked':
      return card.requires.length > 0
        ? `Vergrendeld: vereist ${card.requires.join(', ')}`
        : 'Vergrendeld';
    case 'busy':
      return 'Dit gebouw is al bezig met ander werk';
    case 'running':
      return `${card.naam} loopt al`;
    case 'done':
      return `${card.naam} is al klaar`;
    default:
      return card.kind === 'craft' ? 'Selecteer eerst een bewoner om te craften' : null;
  }
}

function cardKey(card: BuildingCard): string {
  return `${card.kind}:${card.id}`;
}

/** HudController.cardPress. */
export function cardPress(core: HudControllerCore, card: BuildingCard): void {
  core.pressedCard = cardKey(card);
}

/** HudController.cardRelease. */
export function cardRelease(core: HudControllerCore, card: BuildingCard): void {
  const key = cardKey(card);
  if (core.pressedCard !== key) return;
  core.pressedCard = null;
  core.lastCardStart = { key, at: Date.now() };
  core.ctl.startCard(card);
}

/** HudController.cardClick. */
export function cardClick(core: HudControllerCore, card: BuildingCard): void {
  const last = core.lastCardStart;
  core.lastCardStart = null;
  if (last && last.key === cardKey(card) && Date.now() - last.at < CARD_DEDUPE_MS) return;
  core.ctl.startCard(card);
}

/** HudController.startCard. */
export function startCard(core: HudControllerCore, card: BuildingCard): boolean {
  if (!core.ctl.canStartCard(card)) {
    const reason = core.ctl.cardReason(card);
    if (reason) showNotice(core, reason);
    return false;
  }
  if (core.state.cardNotice) setState(core, { cardNotice: null });
  if (core.deps.startCard) core.deps.startCard(card);
  else if (card.kind === 'research') core.deps.sendCommand('Research', { techId: card.id });
  else if (card.kind === 'revive') core.deps.sendCommand('Recruit', { buildingId: card.id });
  else if (card.kind === 'produce' && card.buildingId !== undefined)
    core.deps.sendCommand('Produce', { buildingId: card.buildingId, loadoutId: card.id });
  else if (card.kind === 'train' && card.buildingId !== undefined)
    core.deps.sendCommand('Train', { buildingId: card.buildingId, programId: card.id });
  else if (card.kind === 'craft')
    core.deps.sendCommand('Craft', { ids: selectedIds(core, false), loadoutId: card.id });
  if (card.kind === 'craft') setState(core, { craftMenuOpen: false });
  return true;
}

/** HudController.cancelCard. */
export function cancelCard(core: HudControllerCore, card: BuildingCard): boolean {
  if (card.state !== 'running' || !core.deps.cancelCard) return false;
  core.deps.cancelCard(card);
  return true;
}

/** HudController.useAbility. */
export function useAbility(core: HudControllerCore, abilityId: number): boolean {
  const a = core.state.heroAbilities.find((x) => x.abilityId === abilityId);
  const heroId = core.state.status?.hero?.heroId;
  if (!a || heroId === undefined || !core.ctl.canUseAbility(a) || core.state.confirmSurrender)
    return false;
  if (a.needsTarget) {
    stopTargeting(core);
    setState(core, {
      targeting: 'heroAbility',
      pendingAbility: a,
      buildMenuOpen: false,
      craftMenuOpen: false,
    });
    core.deps.beginTargeting('heroAbility');
  } else {
    stopTargeting(core);
    core.deps.sendCommand('HeroAbility', { heroId, abilityId });
  }
  return true;
}
