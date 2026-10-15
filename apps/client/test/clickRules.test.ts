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

describe('leftClickIs', () => {
  it('is a selection click when no mode is active', () => {
    for (const hit of ['unit', 'building', 'scrapNode', 'claimPoint', 'none'] as const)
      expect(leftClickIs({ mode: 'idle' }, hit)).toBe('select');
  });

  it('a unit or building click always leaves placement and targeting and selects', () => {
    for (const state of [
      { mode: 'placement' },
      { mode: 'targeting', kind: 'move' },
      { mode: 'targeting', kind: 'attackMove' },
      { mode: 'targeting', kind: 'gather' },
      { mode: 'targeting', kind: 'heroAbility' },
    ] as const) {
      expect(leftClickIs(state, 'unit')).toBe('select');
      expect(leftClickIs(state, 'building')).toBe('select');
    }
  });

  it('ground, nodes and claim points answer the mode', () => {
    expect(leftClickIs({ mode: 'placement' }, 'none')).toBe('complete');
    expect(leftClickIs({ mode: 'targeting', kind: 'move' }, 'none')).toBe('complete');
    expect(leftClickIs({ mode: 'targeting', kind: 'gather' }, 'scrapNode')).toBe('complete');
  });
});
