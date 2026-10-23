import { MAX_ENTITIES_PER_COMMAND } from '@crawlout/protocol';
import {
  type ActionId,
  ACTIONS,
  ACTION_ROLE,
  ACTION_TARGETING,
  summarize,
  targetingHint,
} from './controller.actions.js';
import {
  type HudControllerCore,
  hasCraftCards,
  focusLastAlert,
  selectedIds,
  stopTargeting,
  stopPlacement,
  readState,
  setState,
  emit,
} from './controller.core.js';
import type { TargetPoint, TargetResult } from './types.js';

// HudController: the command card, build placement, targeting, perks and the minimap click.

/** HudController.run. */
export function run(core: HudControllerCore, id: ActionId): boolean {
  const action = ACTIONS.find((a) => a.id === id);
  if (!action || !core.ctl.isEnabled(action) || core.state.confirmSurrender) return false;
  const ids = selectedIds(core);
  const targeting = ACTION_TARGETING[id];
  const role = ACTION_ROLE[id];
  if (targeting) {
    setState(core, { targeting, buildMenuOpen: false });
    core.deps.beginTargeting(targeting);
    // Bewaak en Claim hebben een doel dat de speler moet aanwijzen en dat per factie verschilt: zeg welk.
    const hint = targetingHint(targeting, summarize(core.state.selection));
    if (hint) core.ctl.showHint(hint);
  } else if (role) {
    // Only settlers switch role: the hero and robots would be ignored by the sim anyway.
    const settlers = core.state.selection
      .filter((s) => !s.enemy && !s.robot && s.role !== null && s.role !== role)
      .slice(0, MAX_ENTITIES_PER_COMMAND)
      .map((s) => s.id);
    if (settlers.length === 0) return false;
    stopTargeting(core);
    core.deps.sendCommand('SetRole', { ids: settlers, role });
  } else if (id === 'stop') {
    stopTargeting(core);
    core.deps.sendCommand('Stop', { ids });
  } else if (id === 'build') {
    stopTargeting(core);
    stopPlacement(core);
    setState(core, { buildMenuOpen: !core.state.buildMenuOpen, craftMenuOpen: false });
    readState(core);
    emit(core);
  } else if (id === 'revive') {
    core.ctl.revive();
  } else if (id === 'lastAlert') {
    focusLastAlert(core);
  } else if (id === 'lobby') {
    setState(core, { showLobby: !core.state.showLobby });
    readState(core);
    emit(core);
  }
  return true;
}

/** HudController.toggleCraftMenu. */
export function toggleCraftMenu(core: HudControllerCore): boolean {
  if (!hasCraftCards(core) || core.state.confirmSurrender) return false;
  stopTargeting(core);
  stopPlacement(core);
  setState(core, { craftMenuOpen: !core.state.craftMenuOpen, buildMenuOpen: false });
  return true;
}

/** HudController.chooseBuild. */
export function chooseBuild(core: HudControllerCore, buildingId: number): boolean {
  const option = core.state.buildOptions.find((o) => o.buildingId === buildingId);
  if (!option || !core.ctl.canChooseBuild(option)) return false;
  stopTargeting(core);
  setState(core, { placement: option, buildMenuOpen: core.keepBuildMenuWhilePlacing });
  core.deps.beginPlacement?.(option);
  return true;
}

/** HudController.completePlacement. */
export function completePlacement(core: HudControllerCore, pos: TargetPoint): boolean {
  const option = core.state.placement;
  if (!option) return false;
  const ids = core.ctl.selectedBuilders();
  if (ids.length === 0) {
    core.ctl.cancelPlacement();
    return false;
  }
  core.deps.sendCommand('Build', {
    ids,
    typeId: option.typeId,
    x: Math.round(pos.x),
    y: Math.round(pos.y),
  });
  setState(core, { placement: null, placementHint: null });
  core.deps.endPlacement?.();
  return true;
}

/** HudController.pickPerk. */
export function pickPerk(core: HudControllerCore, perkId: number): boolean {
  const heroId = core.state.status?.hero?.heroId;
  const option = core.state.perkOptions.find((p) => p.perkId === perkId);
  if (heroId === undefined || core.ctl.pendingPerks() <= 0 || !option || option.available === false)
    return false;
  core.deps.sendCommand('PickPerk', { heroId, perkId });
  // The last pending pick closes the panel; with more picks left it stays open (the sim answers on the next status).
  if (core.ctl.pendingPerks() <= 1) setState(core, { perkPanelOpen: false });
  return true;
}

/** HudController.minimapClick. */
export function minimapClick(core: HudControllerCore, fx: number, fy: number): void {
  const m = core.state.minimap;
  if (!m) return;
  const cell = m.cellU ?? 256;
  const x = Math.round(Math.min(1, Math.max(0, fx)) * m.w * cell);
  const y = Math.round(Math.min(1, Math.max(0, fy)) * m.h * cell);
  if (core.state.targeting && core.ctl.completeTargeting({ x, y })) return;
  core.deps.focusCamera?.(x, y);
}

/** HudController.completeTargeting. */
export function completeTargeting(core: HudControllerCore, target: TargetResult): boolean {
  const kind = core.state.targeting;
  if (!kind) return false;
  if (kind === 'heroAbility') {
    const a = core.state.pendingAbility;
    const heroId = core.state.status?.hero?.heroId;
    if (!('x' in target)) return false; // a clicked enemy also carries its position
    if (!a || heroId === undefined) {
      core.ctl.cancelTargeting();
      return false;
    }
    core.deps.sendCommand('HeroAbility', {
      heroId,
      abilityId: a.abilityId,
      x: Math.round(target.x),
      y: Math.round(target.y),
    });
    setState(core, { targeting: null, pendingAbility: null });
    core.deps.endTargeting?.();
    return true;
  }
  const ids = selectedIds(core);
  if (ids.length === 0) {
    core.ctl.cancelTargeting();
    return false;
  }
  if (kind === 'gather') {
    if (!('nodeId' in target)) return false;
    core.deps.sendCommand('Gather', { ids, nodeId: target.nodeId });
  } else if (kind === 'claim') {
    // Claim: alleen een claimpunt is een doel; een klik op de grond laat de richtmodus staan (contract 2 Claim).
    // Alleen de bouwers uit de selectie, zodat een grote gemengde selectie de bouwers niet uit de 64 ids drukt.
    const builders = core.ctl.selectedBuilders();
    if (!('pointId' in target) || builders.length === 0) return false;
    core.deps.sendCommand('Claim', { ids: builders, pointId: target.pointId });
  } else if (kind === 'guard') {
    // Bewaak: a scrap node or an own guard post (Kooi, claim post or turret; the sim checks which, applyGuard,
    // besluit fase-0 sectie 27); a click on the ground is no target
    if ('nodeId' in target) core.deps.sendCommand('Guard', { ids, targetId: target.nodeId });
    else if ('ownId' in target) core.deps.sendCommand('Guard', { ids, targetId: target.ownId });
    else return false;
  } else if ('ownId' in target) {
    return false;
  } else if ('enemyId' in target) {
    // Attack-move onto an enemy unit or building: attack that entity.
    if (kind !== 'attackMove' && kind !== 'capture' && kind !== 'liberate') return false;
    core.deps.sendCommand('Attack', { ids, target: target.enemyId });
  } else {
    if (!('x' in target)) return false;
    const pos = { x: Math.round(target.x), y: Math.round(target.y) };
    core.deps.sendCommand(kind === 'move' ? 'Move' : 'AttackMove', { ids, ...pos });
  }
  setState(core, { targeting: null });
  // The client keeps its own cursor and click mode; without this a finished order left it in targeting mode for good.
  core.deps.endTargeting?.();
  return true;
}
