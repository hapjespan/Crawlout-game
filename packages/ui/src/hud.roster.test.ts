import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'preact/test-utils';
import type { PlayerStatus } from '@crawlout/protocol';
import { mountHud } from './index.js';
import type { HudDeps, HudHandle, RosterGroup, SelectedEntity } from './index.js';

const status: PlayerStatus = {
  playerId: 0,
  scrap: 100,
  settlers: 5,
  pop: 5,
  popCap: 8,
  beds: 8,
  hero: null,
};

const roster: RosterGroup[] = [
  {
    key: 'scavenger',
    naam: 'Plunderaar',
    units: [
      { id: 11, hpPct: 100, activity: 'gathering', x: 1000, y: 2000 },
      { id: 12, hpPct: 60, activity: 'idle', x: 3000, y: 4000 },
      { id: 13, hpPct: 90, activity: 'carrying', x: 5000, y: 6000 },
    ],
  },
  {
    key: 'builder',
    naam: 'Bouwer',
    units: [{ id: 21, hpPct: 100, activity: 'idle', x: 7000, y: 8000 }],
  },
  { key: 'militia', naam: 'Militie', units: [] },
];

function setup(over: Partial<HudDeps> = {}, omit: (keyof HudDeps)[] = []) {
  let selection: SelectedEntity[] = [];
  const selects: { ids: number[]; add: boolean }[] = [];
  const focus: [number, number][] = [];
  const deps: HudDeps = {
    sendCommand: () => undefined,
    getStatus: () => status,
    getSelection: () => selection,
    beginTargeting: () => undefined,
    getRoster: () => roster,
    selectUnits: (ids, add) => {
      selects.push({ ids: [...ids], add });
      selection = ids.map((id) => ({ id, typeId: 1, loadoutName: null, hpPct: 100, role: null }));
    },
    focusCamera: (x, y) => void focus.push([x, y]),
    ...over,
  };
  for (const k of omit) delete deps[k];
  const el = document.createElement('div');
  document.body.appendChild(el);
  let handle!: HudHandle;
  act(() => {
    handle = mountHud(el, deps);
  });
  return { el, handle, selects, focus };
}

const click = (el: Element | null, shiftKey = false): void =>
  void act(() => void el!.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey })));
const press = (key: string): void => void act(() => void document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })));
const groups = (el: HTMLElement) => [...el.querySelectorAll('.co-roster-group')];

let mounted: HudHandle | null = null;
beforeEach(() => {
  document.body.innerHTML = '';
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('eenhedenbalk', () => {
  it('toont per type het aantal en hoeveel er niets te doen hebben', () => {
    const t = setup();
    mounted = t.handle;
    const [scav, build, mil] = groups(t.el);
    expect(scav?.textContent).toContain('Plunderaar');
    expect(scav?.textContent).toContain('3');
    expect(scav?.textContent).toContain('1 vrij');
    expect(build?.textContent).toContain('1 vrij');
    expect((mil as HTMLButtonElement).disabled).toBe(true);
  });

  it('klik op een type selecteert alle units van dat type en toont wat elke unit doet', () => {
    const t = setup();
    mounted = t.handle;
    click(groups(t.el)[0]!);
    expect(t.selects).toEqual([{ ids: [11, 12, 13], add: false }]);
    const units = [...t.el.querySelectorAll('.co-roster-unit')];
    expect(units.map((u) => u.getAttribute('data-activity'))).toEqual(['gathering', 'idle', 'carrying']);
    expect(units[1]?.textContent).toContain('Niets te doen');
    expect(groups(t.el)[0]?.getAttribute('aria-expanded')).toBe('true');
  });

  it('shift-klik voegt een type toe aan de selectie', () => {
    const t = setup();
    mounted = t.handle;
    click(groups(t.el)[1]!, true);
    expect(t.selects).toEqual([{ ids: [21], add: true }]);
  });

  it('nogmaals klikken klapt de lijst in', () => {
    const t = setup();
    mounted = t.handle;
    click(groups(t.el)[0]!);
    click(groups(t.el)[0]!);
    expect(t.el.querySelector('.co-roster-list')).toBeNull();
  });

  it('klik op een unit in de lijst selecteert alleen die unit en zet de camera erop', () => {
    const t = setup();
    mounted = t.handle;
    click(groups(t.el)[0]!);
    click(t.el.querySelectorAll('.co-roster-unit')[2]!);
    expect(t.selects.at(-1)).toEqual({ ids: [13], add: false });
    expect(t.focus).toEqual([[5000, 6000]]);
  });

  it('de punt-toets loopt de units zonder taak langs', () => {
    const t = setup();
    mounted = t.handle;
    press('.');
    expect(t.selects.at(-1)?.ids).toEqual([12]);
    press('.');
    expect(t.selects.at(-1)?.ids).toEqual([21]);
    press('.');
    expect(t.selects.at(-1)?.ids).toEqual([12]);
    expect(t.focus).toEqual([
      [3000, 4000],
      [7000, 8000],
      [3000, 4000],
    ]);
  });

  it('zonder getRoster geen balk', () => {
    const t = setup({}, ['getRoster']);
    mounted = t.handle;
    expect(t.el.querySelector('.co-roster')).toBeNull();
  });
});
