import { type HudControllerCore, setState } from './controller.core.js';
import type { HudState } from './controller.core.js';
import type { RosterGroup } from './types.js';

// HudController: the control groups (Ctrl+1..9 stores the selection, 1..9 selects it again).
//
// WHERE THEY LIVE. Entirely in the HUD, next to the rest of the client-side selection state. Contract 1
// (docs/fase-0/04c-contract-1-snapshot-en-ai.md) says the selection is the client's, not the sim's: `flags.selected` is
// set by the client. A control group is nothing but a remembered selection, so it follows the selection: it never goes
// into the snapshot, the hash or the command protocol, and two players in one match can hold different groups without
// ever diverging.
//
// WHY ENTITY IDS ARE ENOUGH. An entity id is `index * 2^ENTITY_GEN_BITS + generation` (protocol constants.ts), so a
// dead unit whose index is handed to a new one yields a *different* id: a stored id can never silently point at the
// newcomer. Dead units drop out because `pruneControlGroups` keeps only the ids the unit bar still reports as alive.

/**
 * Eén besturingsgroep zoals de HUD hem toont: het cijfer, hoeveel eenheden er nog leven, en of die groep op dit moment
 * precies de selectie is.
 */
export interface ControlGroupView {
  /** 1 tot 9: de toets die de groep selecteert (Ctrl plus dat cijfer bewaart hem). */
  slot: number;
  count: number;
  active: boolean;
}

/** How many control groups there are: the digits 1 to 9. */
export const CONTROL_GROUP_COUNT = 9;

/** Is this key one of the control-group digits? */
export const isControlGroupKey = (key: string): boolean => /^[1-9]$/.test(key);

const NO_IDS: readonly number[] = [];

/** The empty set of control groups; one shared reference per slot, so an untouched state never re-renders the chips. */
export const NO_CONTROL_GROUPS: readonly (readonly number[])[] = Array.from(
  { length: CONTROL_GROUP_COUNT },
  () => NO_IDS,
);

/** The ids the unit bar still reports: a unit that is not in it is dead, sold or no longer ours. */
function liveIds(roster: readonly RosterGroup[]): Set<number> {
  const live = new Set<number>();
  for (const g of roster) for (const u of g.units) live.add(u.id);
  return live;
}

/**
 * Drops the units that died. Returns the same array (and the same inner arrays) when nothing changed, so the common
 * case costs one scan of nine slots and never makes the HUD re-render.
 */
export function pruneControlGroups(
  groups: readonly (readonly number[])[],
  roster: readonly RosterGroup[],
): readonly (readonly number[])[] {
  if (!groups.some((g) => g.length > 0)) return groups;
  const live = liveIds(roster);
  let changed = false;
  const next = groups.map((g) => {
    if (g.length === 0) return g;
    const kept = g.filter((id) => live.has(id));
    if (kept.length === g.length) return g;
    changed = true;
    return kept.length === 0 ? NO_IDS : kept;
  });
  return changed ? next : groups;
}

/** The groups that hold units, with their size and whether they are exactly the current selection. */
export function controlGroupViews(state: HudState): ControlGroupView[] {
  const groups = state.controlGroups;
  if (!groups.some((g) => g.length > 0)) return [];
  const selected = new Set(state.selection.filter((s) => !s.enemy).map((s) => s.id));
  const views: ControlGroupView[] = [];
  for (let i = 0; i < groups.length; i++) {
    const ids = groups[i]!;
    if (ids.length === 0) continue;
    views.push({
      slot: i + 1,
      count: ids.length,
      active: selected.size === ids.length && ids.every((id) => selected.has(id)),
    });
  }
  return views;
}

/** HudController.hasControlGroup. */
export function hasControlGroup(core: HudControllerCore, slot: number): boolean {
  return (core.state.controlGroups[slot - 1]?.length ?? 0) > 0;
}

/** The units of a group, in unit-bar order; the stored ids that no longer live are already gone. */
function unitsOf(core: HudControllerCore, slot: number): { id: number; x: number; y: number }[] {
  const ids = core.state.controlGroups[slot - 1];
  if (!ids || ids.length === 0) return [];
  const want = new Set(ids);
  return core.state.roster.flatMap((g) => g.units).filter((u) => want.has(u.id));
}

/**
 * HudController.assignControlGroup. Only own, living units go in: a building or an id that the unit bar does not know
 * would never leave the group again, and the group would resurrect a selection that is no longer there.
 */
export function assignControlGroup(core: HudControllerCore, slot: number): boolean {
  if (core.state.confirmSurrender || slot < 1 || slot > CONTROL_GROUP_COUNT) return false;
  const own = new Set(core.state.selection.filter((s) => !s.enemy).map((s) => s.id));
  const ids =
    own.size === 0
      ? []
      : core.state.roster.flatMap((g) => g.units.filter((u) => own.has(u.id)).map((u) => u.id));
  if (ids.length === 0) {
    core.ctl.showHint(`Selecteer eerst eenheden om ze als groep ${slot} te bewaren.`);
    return false;
  }
  const groups = [...core.state.controlGroups];
  groups[slot - 1] = ids;
  setState(core, { controlGroups: groups });
  core.ctl.showHint(`Groep ${slot}: ${ids.length} ${ids.length === 1 ? 'eenheid' : 'eenheden'}`);
  return true;
}

/**
 * HudController.recallControlGroup: the group becomes the selection and the camera goes to its centre of gravity, the
 * same as a click on a type in the unit bar. With `add` (shift) they join the selection and the camera stays put.
 */
export function recallControlGroup(core: HudControllerCore, slot: number, add = false): boolean {
  if (core.state.confirmSurrender || !core.deps.selectUnits) return false;
  const units = unitsOf(core, slot);
  if (units.length === 0) return false;
  core.deps.selectUnits(
    units.map((u) => u.id),
    add,
  );
  if (!add) {
    const n = units.length;
    core.deps.focusCamera?.(
      Math.round(units.reduce((sum, u) => sum + u.x, 0) / n),
      Math.round(units.reduce((sum, u) => sum + u.y, 0) / n),
    );
  }
  core.ctl.refresh();
  return true;
}
