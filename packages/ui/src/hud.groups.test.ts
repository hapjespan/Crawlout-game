import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'preact/test-utils';
import { ENTITY_GEN_BITS, type PlayerStatus } from '@crawlout/protocol';
import { mountHud } from './index.js';
import type { HudDeps, HudHandle, RosterGroup, SelectedEntity } from './index.js';
import { renderBudgetMs } from './perfBudget.js';

// Control groups: Ctrl+1..9 stores the selection, 1..9 selects it again (ui 0.22.0).

const status: PlayerStatus = {
  playerId: 0,
  scrap: 100,
  settlers: 5,
  pop: 5,
  popCap: 8,
  beds: 8,
  hero: null,
  queue: [],
  dominance: { pointsHeld: 0, pointsRequired: 2, ticksHeld: 0, ticksRequired: 9600, leader: null },
  noBedPop: 0,
  trained: [0, 0, 0, 0, 0, 0, 0],
  claimPoints: [],
};

/** An entity id as the sim makes it: index in the high bits, generation in the low ones. */
const entityId = (index: number, generation: number): number =>
  index * 2 ** ENTITY_GEN_BITS + generation;

const unit = (id: number, x = 1000, y = 2000) =>
  ({ id, hpPct: 100, activity: 'idle', x, y }) as const;

function setup(initial: RosterGroup[]) {
  let roster = initial;
  let selection: SelectedEntity[] = [];
  const selects: { ids: number[]; add: boolean }[] = [];
  const focus: [number, number][] = [];
  const deps: HudDeps = {
    sendCommand: () => undefined,
    getStatus: () => status,
    getSelection: () => selection,
    beginTargeting: () => undefined,
    getRoster: () => roster,
    canSwitchRole: () => true,
    selectUnits: (ids, add) => {
      selects.push({ ids: [...ids], add });
      const picked = ids.map((id): SelectedEntity => ({
        id,
        typeId: 1,
        loadoutName: null,
        hpPct: 100,
        role: 'scavenger',
      }));
      selection = add ? [...selection, ...picked] : picked;
    },
    focusCamera: (x, y) => void focus.push([x, y]),
  };
  const el = document.createElement('div');
  document.body.appendChild(el);
  let handle!: HudHandle;
  act(() => {
    handle = mountHud(el, deps);
  });
  return {
    el,
    handle,
    selects,
    focus,
    select: (ids: number[]) =>
      act(() => {
        deps.selectUnits!(ids, false);
        handle.refresh();
      }),
    setRoster: (next: RosterGroup[]) => {
      roster = next;
      act(() => handle.refresh());
    },
  };
}

const press = (key: string, init: KeyboardEventInit = {}): void =>
  void act(
    () =>
      void document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init })),
  );
const click = (el: Element | null, shiftKey = false): void =>
  void act(() => void el!.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey })));
const chips = (el: HTMLElement) => [...el.querySelectorAll('.co-group')];

let mounted: HudHandle | null = null;
beforeEach(() => {
  document.body.innerHTML = '';
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('besturingsgroepen', () => {
  const base: RosterGroup[] = [
    {
      key: 'militie',
      naam: 'Militie',
      units: [unit(11, 1000, 2000), unit(12, 3000, 4000), unit(13, 5000, 6000)],
    },
    { key: 'bouwer', naam: 'Bouwer', units: [unit(21, 7000, 8000)] },
  ];

  it('Ctrl plus een cijfer bewaart de selectie, het cijfer zelf selecteert ze en zet de camera op hun midden', () => {
    const t = setup(base);
    mounted = t.handle;
    t.select([11, 12]);
    press('1', { ctrlKey: true });
    t.select([21]);
    t.selects.length = 0;
    t.focus.length = 0;
    press('1');
    expect(t.selects).toEqual([{ ids: [11, 12], add: false }]);
    expect(t.focus).toEqual([[2000, 3000]]);
  });

  it('shift plus een klik op een plaatje voegt de groep bij de selectie en laat de camera staan', () => {
    const t = setup(base);
    mounted = t.handle;
    t.select([11]);
    press('2', { ctrlKey: true });
    t.select([21]);
    t.focus.length = 0;
    t.selects.length = 0;
    click(chips(t.el)[0]!, true);
    expect(t.selects).toEqual([{ ids: [11], add: true }]);
    expect(t.focus).toEqual([]);
  });

  it('dode eenheden vallen uit hun groep; is de hele groep dood, dan verdwijnt het plaatje', () => {
    const t = setup(base);
    mounted = t.handle;
    t.select([11, 12, 13]);
    press('3', { ctrlKey: true });
    expect(chips(t.el)[0]?.textContent).toContain('3');
    // Unit 12 dies: the unit bar no longer reports it.
    t.setRoster([{ ...base[0]!, units: [unit(11), unit(13)] }, base[1]!]);
    t.selects.length = 0;
    press('3');
    expect(t.selects).toEqual([{ ids: [11, 13], add: false }]);
    // All of them die: the group is gone and the digit does nothing any more.
    t.setRoster([{ ...base[0]!, units: [] }, base[1]!]);
    expect(chips(t.el)).toEqual([]);
    t.selects.length = 0;
    press('3');
    expect(t.selects).toEqual([]);
  });

  it('een hergebruikte index komt niet in een oude groep: de generatie in het id verschilt', () => {
    const dead = entityId(7, 1);
    const reborn = entityId(7, 2);
    const t = setup([{ key: 'militie', naam: 'Militie', units: [unit(dead)] }]);
    mounted = t.handle;
    t.select([dead]);
    press('4', { ctrlKey: true });
    // The unit dies and a new one takes its index; only the generation differs.
    t.setRoster([{ key: 'militie', naam: 'Militie', units: [unit(reborn)] }]);
    expect(chips(t.el)).toEqual([]);
    t.selects.length = 0;
    press('4');
    expect(t.selects).toEqual([]);
  });

  it('het plaatje toont cijfer en aantal, en licht op zodra die groep precies de selectie is', () => {
    const t = setup(base);
    mounted = t.handle;
    t.select([11, 12]);
    press('5', { ctrlKey: true });
    const [chip] = chips(t.el);
    expect(chip?.textContent).toBe('52');
    expect(chip?.getAttribute('aria-label')).toBe(
      'Groep 5: 2 eenheden, nu geselecteerd. Selecteer ze met toets 5.',
    );
    expect(chip?.getAttribute('aria-pressed')).toBe('true');
    expect(chip?.getAttribute('aria-keyshortcuts')).toBe('5');
    // A different selection dims it again.
    t.select([21]);
    expect(chips(t.el)[0]?.getAttribute('aria-pressed')).toBe('false');
    expect(chips(t.el)[0]?.getAttribute('aria-label')).toContain('Groep 5: 2 eenheden.');
  });

  it('zonder eenheden in de selectie bewaart Ctrl niets en zegt de HUD waarom', () => {
    const t = setup(base);
    mounted = t.handle;
    press('6', { ctrlKey: true });
    expect(chips(t.el)).toEqual([]);
    expect(t.el.querySelector('.co-hint')?.textContent).toContain('Selecteer eerst eenheden');
  });

  it('de rolknoppen houden 1, 2 en 3 tot er een groep op dat cijfer staat', () => {
    const t = setup(base);
    mounted = t.handle;
    t.select([11]);
    // No group yet: 3 is still Militie on the command card, with its key badge.
    const militia = () => t.el.querySelector('[data-action="roleMilitia"]');
    expect(militia()?.querySelector('.co-key')?.textContent).toBe('3');
    expect(militia()?.getAttribute('aria-keyshortcuts')).toBe('3');
    press('3', { ctrlKey: true });
    // The group has taken the digit: the button stays, its key promise does not.
    expect(militia()?.querySelector('.co-key')).toBeNull();
    expect(militia()?.getAttribute('aria-keyshortcuts')).toBeNull();
    expect(militia()?.getAttribute('aria-label')).toBe('Militie');
    // 2 is untouched, so Bouwer keeps its shortcut.
    expect(t.el.querySelector('[data-action="roleBuilder"] .co-key')?.textContent).toBe('2');
  });

  it('negen volle groepen blijven binnen de 2 ms per refresh', () => {
    const many: RosterGroup[] = Array.from({ length: 9 }, (_, g) => ({
      key: `type${g}`,
      naam: `Type ${g}`,
      units: Array.from({ length: 12 }, (_, i) => unit(g * 100 + i)),
    }));
    const t = setup(many);
    mounted = t.handle;
    for (let g = 0; g < 9; g++) {
      t.select(many[g]!.units.map((u) => u.id));
      press(String(g + 1), { ctrlKey: true });
    }
    expect(chips(t.el)).toHaveLength(9);
    for (let i = 0; i < 20; i++) act(() => t.handle.refresh());
    const n = 100;
    const runs: number[] = [];
    for (let r = 0; r < 7; r++) {
      const t0 = performance.now();
      for (let i = 0; i < n; i++) act(() => t.handle.refresh());
      runs.push((performance.now() - t0) / n);
    }
    runs.sort((a, b) => a - b);
    expect(runs[3] ?? Infinity).toBeLessThan(renderBudgetMs());
  });
});
