import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'preact/test-utils';
import type { PlayerStatus } from '@crawlout/protocol';
import { mountHud } from './index.js';
import type { HudDeps, HudHandle, SurvivalView } from './index.js';

const status: PlayerStatus = {
  playerId: 0,
  scrap: 100,
  settlers: 3,
  pop: 3,
  popCap: 8,
  beds: 4,
  hero: null,
  queue: [],
  dominance: { pointsHeld: 0, pointsRequired: 2, ticksHeld: 0, ticksRequired: 9600, leader: null },
  robotPop: 0,
  trained: [0, 0, 0, 0, 0, 0, 0],
  claimPoints: [],
};

const base: SurvivalView = {
  wave: 3,
  waves: 15,
  next: { wave: 4, naam: 'Ghouls en sprinters', rank: 'normal', inSeconds: 105 },
  target: { name: 'Els', isYou: false, alive: 12 },
  alive: 20,
};

let mounted: HudHandle | null = null;
afterEach(() => {
  act(() => mounted?.unmount());
  mounted = null;
  document.body.innerHTML = '';
});

function setup(initial: SurvivalView | null) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  let current = initial;
  const deps: HudDeps = {
    sendCommand: () => undefined,
    getStatus: () => status,
    getSelection: () => [],
    beginTargeting: () => undefined,
    getSurvival: () => current,
  };
  let handle!: HudHandle;
  act(() => {
    handle = mountHud(el, deps);
  });
  mounted = handle;
  return {
    el,
    set: (v: SurvivalView | null): void => {
      current = v;
      act(() => handle.refresh());
    },
  };
}

const panel = (el: HTMLElement) => el.querySelector('.co-survival');

describe('survival panel', () => {
  it('is absent outside Survival', () => {
    expect(panel(setup(null).el)).toBeNull();
  });

  it('shows the wave counter, the countdown and the target', () => {
    const { el } = setup(base);
    const text = panel(el)?.textContent ?? '';
    expect(text).toContain('Golf 3/15');
    expect(text).toContain('Golf 4 (Ghouls en sprinters) over 1:45');
    expect(text).toContain('Doel van deze golf: Els (12 over)');
    expect(el.querySelector('[data-survival-warning]')).toBeNull();
  });

  it('warns for the mini-boss and the boss, and names you as the target', () => {
    const { el, set } = setup(base);
    set({ ...base, next: { wave: 8, naam: 'Klauwbeest', rank: 'miniboss', inSeconds: 30 } });
    expect(el.querySelector('[data-survival-warning]')?.textContent).toContain(
      'golf 8 brengt de mini-boss Klauwbeest',
    );
    set({
      ...base,
      next: { wave: 15, naam: 'Behemoth', rank: 'boss', inSeconds: 30 },
      target: { name: 'Jij', isYou: true, alive: 4 },
    });
    expect(el.querySelector('[data-survival-warning]')?.textContent).toContain('Behemoth');
    expect(el.querySelector('[data-survival-target]')?.textContent).toContain('jij (4 over)');
  });

  it('says the last wave is out when no wave follows', () => {
    const { el } = setup({ ...base, wave: 15, next: null });
    expect(panel(el)?.textContent).toContain('Laatste golf');
  });
});
