// What a left click on the world does. The rule that keeps the player in control: a click on an own unit or building
// always selects it, whatever is selected and whatever mode is active, and a click on empty ground always clears the
// selection. Modes (placement, targeting) only keep the click for ground, and for the scrap node of a gather target.
// One exception: in attack-move and ability targeting a click on an ENEMY unit or building is the target (attack that
// entity, cast at its spot), so aiming at an enemy does not throw the order away.
import type { TargetingKind } from '@crawlout/ui';

export type HitKind = 'unit' | 'building' | 'scrapNode' | 'claimPoint' | 'none';
export type ClickMode =
  { mode: 'idle' } | { mode: 'placement' } | { mode: 'targeting'; kind: TargetingKind };

/** Targeting kinds in which an enemy entity is a valid target. */
export const takesEnemyTarget = (state: ClickMode): boolean =>
  state.mode === 'targeting' && (state.kind === 'attackMove' || state.kind === 'heroAbility');

/**
 * 'select': the click is a selection click (leave any mode first); 'complete': the click answers the active mode
 * (places the building, sets the target). `hostile`: the clicked unit or building belongs to an enemy.
 */
export function leftClickIs(
  state: ClickMode,
  hit: HitKind,
  hostile = false,
): 'select' | 'complete' {
  if (state.mode === 'idle') return 'select';
  if (hit === 'unit' || hit === 'building')
    return hostile && takesEnemyTarget(state) ? 'complete' : 'select';
  return 'complete';
}

/** The selection after a click or box: replaced by the picked ids (none on empty ground), or added to with shift. */
export function nextSelection(
  current: ReadonlySet<number>,
  picked: readonly number[],
  shift: boolean,
): Set<number> {
  return shift ? new Set([...current, ...picked]) : new Set(picked);
}
