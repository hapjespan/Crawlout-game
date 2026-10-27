import { type HudControllerCore, readState, setState } from './controller.core.js';

// HudController: selecting the hero, buildings, roster groups and idle units.

/** HudController.focusHero. */
export function focusHero(core: HudControllerCore): boolean {
  const unit = core.state.roster.find((g) => g.key === 'hero')?.units[0];
  if (unit) return core.ctl.selectRosterUnit(unit.id);
  const entityId = core.state.status?.hero?.entityId;
  // ENTITY_NONE (0) means no living hero entity.
  if (!entityId || !core.deps.selectUnits || core.state.heroDead) return false;
  core.deps.selectUnits([entityId], false);
  core.ctl.refresh();
  return true;
}

/** HudController.selectBuilding. */
export function selectBuilding(
  core: HudControllerCore,
  key: string,
  focus = false,
  add = false,
): boolean {
  const group = core.state.buildingButtons.find((b) => b.key === key);
  if (!group || group.sites.length === 0 || !core.deps.selectUnits) return false;
  const selected = new Set(core.state.selection.map((s) => s.id));
  const at = group.sites.findIndex((s) => selected.has(s.id));
  const only = core.state.selection.length === 1;
  const site = focus
    ? (group.sites[at] ?? group.sites[0]!)
    : (group.sites[at >= 0 && only ? (at + 1) % group.sites.length : 0] ?? group.sites[0]!);
  core.deps.selectUnits([site.id], add);
  if (focus || !add) core.deps.focusCamera?.(site.x, site.y);
  core.ctl.refresh();
  return true;
}

/** HudController.selectGroup. */
export function selectGroup(core: HudControllerCore, key: string, add = false): boolean {
  const group = core.state.roster.find((g) => g.key === key);
  if (!group || !core.deps.selectUnits) return false;
  core.deps.selectUnits(
    group.units.map((u) => u.id),
    add,
  );
  if (!add && group.units.length > 0) {
    const n = group.units.length;
    const cx = group.units.reduce((sum, u) => sum + u.x, 0) / n;
    const cy = group.units.reduce((sum, u) => sum + u.y, 0) / n;
    core.deps.focusCamera?.(Math.round(cx), Math.round(cy));
  }
  readState(core);
  setState(core, { rosterOpen: core.state.rosterOpen === key && !add ? null : key });
  return true;
}

/** HudController.selectRosterUnit. */
export function selectRosterUnit(core: HudControllerCore, id: number, add = false): boolean {
  const unit = core.state.roster.flatMap((g) => g.units).find((u) => u.id === id);
  if (!unit || !core.deps.selectUnits) return false;
  core.deps.selectUnits([id], add);
  if (!add) core.deps.focusCamera?.(unit.x, unit.y);
  core.ctl.refresh();
  return true;
}

/** HudController.selectSelected. */
export function selectSelected(core: HudControllerCore, id: number): boolean {
  const entry = core.state.selection.find((s) => s.id === id);
  if (!entry || !core.deps.selectUnits) return false;
  core.deps.selectUnits([id], false);
  if (entry.x !== undefined && entry.y !== undefined) core.deps.focusCamera?.(entry.x, entry.y);
  core.ctl.refresh();
  return true;
}

/** HudController.selectNextIdle. */
export function selectNextIdle(core: HudControllerCore): boolean {
  const idle = core.state.roster.flatMap((g) => g.units).filter((u) => u.activity === 'idle');
  if (idle.length === 0 || !core.deps.selectUnits) return false;
  const current = core.state.selection.length === 1 ? core.state.selection[0]?.id : undefined;
  const at = idle.findIndex((u) => u.id === current);
  const next = idle[(at + 1) % idle.length]!;
  return core.ctl.selectRosterUnit(next.id);
}

/** HudController.selectNextBuilding. */
export function selectNextBuilding(core: HudControllerCore): boolean {
  const sites = core.state.buildingButtons.flatMap((b) => b.sites);
  if (sites.length === 0 || !core.deps.selectUnits) return false;
  const current = core.state.selection.length === 1 ? core.state.selection[0]?.id : undefined;
  const at = sites.findIndex((s) => s.id === current);
  const next = sites[(at + 1) % sites.length]!;
  core.deps.selectUnits([next.id], false);
  core.deps.focusCamera?.(next.x, next.y);
  core.ctl.refresh();
  return true;
}
