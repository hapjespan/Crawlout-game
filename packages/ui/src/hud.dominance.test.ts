import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'preact/test-utils';
import type { PlayerStatus } from '@crawlout/protocol';
import { mountHud } from './index.js';
import type { DominanceView, HudDeps, HudHandle } from './index.js';

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
};

const base: DominanceView = {
  pointsHeld: 0,
  pointsRequired: 2,
  secondsHeld: 0,
  secondsRequired: 300,
  leader: null,
};
const threatView: DominanceView = {
  ...base,
  pointsHeld: 1,
  leader: { name: 'AI', pointsHeld: 2, secondsHeld: 108, isYou: false },
};

let mounted: HudHandle | null = null;
let current: DominanceView | null = null;
afterEach(() => {
  act(() => mounted?.unmount());
  mounted = null;
  current = null;
  document.body.innerHTML = '';
});

function setup(withDep = true) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const deps: HudDeps = {
    sendCommand: () => undefined,
    getStatus: () => status,
    getSelection: () => [],
    beginTargeting: () => undefined,
    ...(withDep ? { getDominance: () => current } : {}),
  };
  let handle!: HudHandle;
  act(() => {
    handle = mountHud(el, deps);
  });
  mounted = handle;
  const set = (v: DominanceView | null): void => {
    current = v;
    act(() => handle.refresh());
  };
  return { el, set };
}

const panel = (el: HTMLElement) => el.querySelector('.co-dominance');
const bars = (el: HTMLElement) => [...el.querySelectorAll('.co-dominance [role=progressbar]')];
const toasts = (el: HTMLElement) => [...el.querySelectorAll('[data-alert=dominance]')];

describe('dominantie-teller', () => {
  it('toont niets zonder dep', () => {
    current = threatView;
    const t = setup(false);
    expect(panel(t.el)).toBeNull();
  });

  it('toont niets als de dep null levert', () => {
    const t = setup();
    expect(panel(t.el)).toBeNull();
  });

  it('toont eigen voortgang in punten zonder tijd', () => {
    current = {
      ...base,
      pointsHeld: 1,
      leader: { name: 'Jij', pointsHeld: 1, secondsHeld: 0, isYou: true },
    };
    const t = setup();
    expect(panel(t.el)?.textContent).toContain('Dominantie: 1/2 punten');
    expect(panel(t.el)?.textContent).not.toContain('nog');
    const [bar] = bars(t.el);
    expect(bar?.getAttribute('aria-valuenow')).toBe('1');
    expect(bar?.getAttribute('aria-valuemax')).toBe('2');
    expect(bars(t.el)).toHaveLength(1);
  });

  it('toont de resterende tijd als je genoeg punten hebt', () => {
    current = {
      ...base,
      pointsHeld: 2,
      secondsHeld: 105,
      leader: { name: 'Jij', pointsHeld: 2, secondsHeld: 105, isYou: true },
    };
    const t = setup();
    expect(panel(t.el)?.textContent).toContain('Dominantie: 2/2 punten, nog 3:15');
    const [bar] = bars(t.el);
    expect(bar?.getAttribute('aria-valuenow')).toBe('105');
    expect(bar?.getAttribute('aria-valuemax')).toBe('300');
    expect(panel(t.el)?.querySelector('.co-dom-warn')).toBeNull();
  });

  it('toont een dreigende tegenstander met tekst en icoon, niet alleen kleur', () => {
    current = threatView;
    const t = setup();
    const warn = panel(t.el)?.querySelector('.co-dom-warn');
    expect(warn?.textContent).toContain('Let op: AI houdt 2/2 punten, nog 3:12');
    expect(warn?.querySelector('.co-dom-icon')).not.toBeNull();
    const bar = bars(t.el)[1];
    expect(bar?.getAttribute('aria-valuenow')).toBe('108');
    expect(bar?.getAttribute('aria-label')).toContain('AI');
  });

  it('toont geen waarschuwing als de tegenstander nog te weinig punten heeft', () => {
    current = { ...base, leader: { name: 'AI', pointsHeld: 1, secondsHeld: 0, isYou: false } };
    const t = setup();
    expect(panel(t.el)?.querySelector('.co-dom-warn')).toBeNull();
  });

  it('geeft een toast als de tegenstander begint te tellen, en maar een keer', () => {
    current = { ...base, leader: { name: 'AI', pointsHeld: 1, secondsHeld: 0, isYou: false } };
    const t = setup();
    expect(toasts(t.el)).toHaveLength(0);
    t.set(threatView);
    expect(toasts(t.el)).toHaveLength(1);
    expect(toasts(t.el)[0]?.textContent).toContain('Tegenstander telt mee voor dominantie');
    t.set({ ...threatView, leader: { ...threatView.leader!, secondsHeld: 120 } });
    expect(toasts(t.el)).toHaveLength(1);
  });

  it('geeft opnieuw een toast als de tegenstander na verlies weer begint', () => {
    const t = setup();
    t.set(threatView);
    t.set(base);
    t.set(threatView);
    expect(toasts(t.el)).toHaveLength(2);
  });

  it('geeft geen toast als jijzelf telt', () => {
    const t = setup();
    t.set({
      ...base,
      pointsHeld: 2,
      leader: { name: 'Jij', pointsHeld: 2, secondsHeld: 5, isYou: true },
    });
    expect(toasts(t.el)).toHaveLength(0);
  });

  it('rendert onder 2 ms per refresh', () => {
    current = threatView;
    const t = setup();
    for (let i = 0; i < 20; i++) act(() => mounted?.refresh());
    const n = 100;
    const runs: number[] = [];
    for (let r = 0; r < 7; r++) {
      const t0 = performance.now();
      for (let i = 0; i < n; i++) {
        t.set({ ...threatView, leader: { ...threatView.leader!, secondsHeld: i } });
      }
      runs.push((performance.now() - t0) / n);
    }
    runs.sort((a, b) => a - b);
    expect(runs[3] ?? Infinity).toBeLessThan(2);
  });
});
