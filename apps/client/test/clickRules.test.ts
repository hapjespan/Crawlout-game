import { describe, expect, it } from 'vitest';
import { leftClickIs, nextSelection } from '../src/game/clickRules.js';

describe('nextSelection', () => {
  it('a click on empty ground clears units and buildings', () => {
    expect([...nextSelection(new Set([1, 2, 1025]), [], false)]).toEqual([]);
  });

  it('a click on a building or unit replaces whatever is selected', () => {
    expect([...nextSelection(new Set([1, 2]), [77], false)]).toEqual([77]); // units, then a building
    expect([...nextSelection(new Set([77]), [3], false)]).toEqual([3]); // a building, then a unit
  });

  it('shift adds to the selection and an empty shift click keeps it', () => {
    expect([...nextSelection(new Set([1]), [2], true)].sort()).toEqual([1, 2]);
    expect([...nextSelection(new Set([1]), [], true)]).toEqual([1]);
  });
});

describe('nextSelection with an enemy to inspect', () => {
  const enemy = (id: number): boolean => id >= 900;

  it('a plain click on an enemy replaces the selection with just the enemy', () => {
    expect([...nextSelection(new Set([1, 2]), [901], false, enemy)]).toEqual([901]);
  });

  it('a click on an own unit replaces an inspected enemy', () => {
    expect([...nextSelection(new Set([901]), [3], false, enemy)]).toEqual([3]);
  });

  it('shift never adds an enemy to a group of own units', () => {
    expect([...nextSelection(new Set([1, 2]), [901], true, enemy)].sort()).toEqual([1, 2]);
  });

  it('shift on an own unit while inspecting an enemy drops the enemy instead of mixing', () => {
    expect([...nextSelection(new Set([901]), [3], true, enemy)]).toEqual([3]);
  });
});

describe('leftClickIs', () => {
  it('is a selection click when no mode is active', () => {
    for (const hit of ['unit', 'building', 'scrapNode', 'claimPoint', 'none'] as const)
      expect(leftClickIs({ mode: 'idle' }, hit)).toBe('select');
  });

  it('an own unit or building click always leaves placement and targeting and selects', () => {
    for (const state of [
      { mode: 'placement' },
      { mode: 'targeting', kind: 'move' },
      { mode: 'targeting', kind: 'attackMove' },
      { mode: 'targeting', kind: 'gather' },
      { mode: 'targeting', kind: 'heroAbility' },
    ] as const) {
      expect(leftClickIs(state, 'unit')).toBe('select');
      expect(leftClickIs(state, 'building', false)).toBe('select');
    }
  });

  it('an enemy unit or building is the target in attack-move and ability targeting', () => {
    for (const kind of ['attackMove', 'heroAbility'] as const)
      for (const hit of ['unit', 'building'] as const)
        expect(leftClickIs({ mode: 'targeting', kind }, hit, true)).toBe('complete');
  });

  it('an enemy click still selects in move, gather and placement', () => {
    for (const state of [
      { mode: 'placement' },
      { mode: 'targeting', kind: 'move' },
      { mode: 'targeting', kind: 'gather' },
    ] as const) {
      expect(leftClickIs(state, 'unit', true)).toBe('select');
      expect(leftClickIs(state, 'building', true)).toBe('select');
    }
  });

  it('ground, nodes and claim points answer the mode', () => {
    expect(leftClickIs({ mode: 'placement' }, 'none')).toBe('complete');
    expect(leftClickIs({ mode: 'targeting', kind: 'move' }, 'none')).toBe('complete');
    expect(leftClickIs({ mode: 'targeting', kind: 'gather' }, 'scrapNode')).toBe('complete');
  });
});
