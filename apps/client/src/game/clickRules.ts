// What a left click on the world does. The rule that keeps the player in control: a click on a unit or a building
// always selects it, whatever is selected and whatever mode is active, and a click on empty ground always clears the
// selection. Modes (placement, targeting) only keep the click for ground, and for the scrap node of a gather target.
import type { TargetingKind } from '@crawlout/ui';

export type HitKind = 'unit' | 'building' | 'scrapNode' | 'claimPoint' | 'none';
export type ClickMode =
  { mode: 'idle' } | { mode: 'placement' } | { mode: 'targeting'; kind: TargetingKind };

/**
 * 'select': the click is a selection click (leave any mode first); 'complete': the click answers the active mode
 * (places the building, sets the target).
 */
export function leftClickIs(state: ClickMode, hit: HitKind): 'select' | 'complete' {
  if (state.mode === 'idle') return 'select';
  if (hit === 'unit' || hit === 'building') return 'select';
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
