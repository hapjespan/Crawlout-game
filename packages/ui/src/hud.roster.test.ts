import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'preact/test-utils';
import type { PlayerStatus } from '@crawlout/protocol';
import { mountHud, unitStateOf } from './index.js';
import { HUD_CSS } from './styles.js';
import type { HudDeps, HudHandle, RosterGroup, SelectedEntity } from './index.js';

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

const roster: RosterGroup[] = [
  {
    key: 'scavenger',
    naam: 'Plunderaar',
    units: [
      { id: 11, hpPct: 100, activity: 'gathering', x: 1000, y: 2000, progressPct: 40 },
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
    startCard: () => undefined,
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
const press = (key: string): void =>
  void act(() => void document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })));
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
    // The camera goes to the centroid of the group.
    expect(t.focus).toEqual([[3000, 4000]]);
    const units = [...t.el.querySelectorAll('.co-roster-unit')];
    expect(units.map((u) => u.getAttribute('data-activity'))).toEqual([
      'gathering',
      'idle',
      'carrying',
    ]);
    // Colour only: the bars carry no text, the state is in the aria-label and tooltip.
    expect(units.every((u) => (u.textContent ?? '') === '')).toBe(true);
    expect(units[1]?.getAttribute('aria-label')).toContain('beschikbaar');
    expect(units[1]?.getAttribute('title')).toBe(units[1]?.getAttribute('aria-label'));
    expect(groups(t.el)[0]?.getAttribute('aria-expanded')).toBe('true');
  });

  it('kleur per toestand: groen beschikbaar, oranje aan het werk, rood bezig', () => {
    const all: RosterGroup = {
      key: 'all',
      naam: 'Alles',
      units: (['idle', 'gathering', 'carrying', 'building', 'moving', 'fighting'] as const).map(
        (activity, i) => ({ id: 100 + i, hpPct: 100, activity, x: 0, y: 0 }),
      ),
    };
    const t = setup({ getRoster: () => [all] });
    mounted = t.handle;
    click(groups(t.el)[0]!);
    const states = [...t.el.querySelectorAll('.co-roster-unit')].map((u) =>
      u.getAttribute('data-state'),
    );
    expect(states).toEqual(['available', 'working', 'working', 'working', 'busy', 'busy']);
    expect(unitStateOf('idle')).toBe('available');
    expect(unitStateOf('fighting')).toBe('busy');
  });

  it('verzamelen toont de verzameltijd als laadbalkje; andere toestanden hebben er geen', () => {
    const t = setup();
    mounted = t.handle;
    click(groups(t.el)[0]!);
    const units = [...t.el.querySelectorAll('.co-roster-unit')];
    const fill = units[0]?.querySelector<HTMLElement>('.co-roster-fill');
    expect(fill?.style.width).toBe('40%');
    expect(units[0]?.getAttribute('aria-label')).toContain('(40%)');
    expect(units[1]?.querySelector('.co-roster-fill')).toBeNull();
    expect(units[2]?.querySelector('.co-roster-fill')).toBeNull();
  });

  it('met meer dan 8 units blijft het een rij balkjes in een lijst die niet uitloopt', () => {
    const many: RosterGroup = {
      key: 'many',
      naam: 'Veel',
      units: Array.from({ length: 14 }, (_, i) => ({
        id: 200 + i,
        hpPct: 100,
        activity: 'idle' as const,
        x: 0,
        y: 0,
      })),
    };
    const t = setup({ getRoster: () => [many] });
    mounted = t.handle;
    click(groups(t.el)[0]!);
    expect(t.el.querySelectorAll('.co-roster-unit')).toHaveLength(14);
    // The shrinking is CSS (flex-basis 0 with a max width per bar); the list must be the flex row that does it.
    expect(HUD_CSS).toMatch(/\.co-roster-list\{[^}]*display:flex;[^}]*flex-wrap:wrap/);
    expect(HUD_CSS).toMatch(/\.co-roster-list>li\{[^}]*flex:1 1 0/);
  });

  it('shift-klik voegt een type toe aan de selectie', () => {
    const t = setup();
    mounted = t.handle;
    click(groups(t.el)[1]!, true);
    expect(t.selects).toEqual([{ ids: [21], add: true }]);
    expect(t.focus).toEqual([]); // adding to the selection leaves the camera alone
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
    expect(t.focus.at(-1)).toEqual([5000, 6000]);
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
