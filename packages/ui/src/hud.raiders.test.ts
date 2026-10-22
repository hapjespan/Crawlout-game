import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'preact/test-utils';
import type { CommandType, PlayerStatus } from '@crawlout/protocol';
import { COMMAND_PAYLOADS } from '@crawlout/protocol';
import { SCRAP_NODE_TYPE_ID, unitTypeId } from '@crawlout/data';
import { mountHud } from './index.js';
import { portraitOfEntity, portraitOfGroup } from './portraits.js';
import type {
  HudAlert,
  HudDeps,
  HudHandle,
  RaiderStats,
  RosterGroup,
  SelectedEntity,
} from './index.js';

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

const typeId = unitTypeId(1);
const unit = (over: Partial<SelectedEntity>): SelectedEntity => ({
  id: 1,
  typeId,
  loadoutName: 'Slaaf',
  hpPct: 100,
  role: 'scavenger',
  ...over,
});

const stats = (over: Partial<RaiderStats> = {}): RaiderStats => ({
  slaves: 6,
  slavesWorking: 4,
  prisoners: 1,
  fighters: 3,
  safetyThreshold: 5,
  tentReady: true,
  cages: [
    { id: 9, x: 0, y: 0, naam: 'Raiderkamp', slaves: 6, capacity: 8, guards: 1, guardsNeeded: 1 },
  ],
  guardGroups: [
    { kind: 'kooi', id: 9, x: 0, y: 0, naam: 'Raiderkamp', slaves: 6, guards: 1, guardsNeeded: 1 },
  ],
  ...over,
});

function setup(over: Partial<HudDeps> = {}) {
  const sent: { type: CommandType; payload: unknown }[] = [];
  const targets: string[] = [];
  const state: { selection: SelectedEntity[] } = { selection: [] };
  const deps: HudDeps = {
    sendCommand: (type, payload) => void sent.push({ type, payload }),
    getStatus: () => status,
    getSelection: () => state.selection,
    beginTargeting: (kind) => void targets.push(kind),
    ...over,
  };
  const el = document.createElement('div');
  document.body.appendChild(el);
  let handle!: HudHandle;
  act(() => {
    handle = mountHud(el, deps);
  });
  const select = (s: SelectedEntity[]): void => {
    state.selection = s;
    act(() => handle.refresh());
  };
  return { el, handle, sent, targets, select };
}

const actions = (el: HTMLElement): string[] =>
  [...el.querySelectorAll('.co-buttons [data-action]')].map((b) => b.getAttribute('data-action')!);
const press = (key: string): void =>
  void act(() => void document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })));

let mounted: HudHandle | null = null;
beforeEach(() => {
  document.body.innerHTML = '';
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('Raider commands', () => {
  it('a slave gets Verplaats, Stop, Verzamel and the slave role names, never Val aan or Vang', () => {
    const t = setup({ canSwitchRole: () => true });
    mounted = t.handle;
    t.select([unit({ raiderKind: 'slave', lines: ['Kooi: Raiderkamp, werkstraal 45 m'] })]);
    expect(actions(t.el)).toEqual(['move', 'stop', 'gather', 'roleBuilder']);
    expect(t.el.querySelector('[data-action="roleBuilder"]')!.textContent).toContain(
      'Slaaf-bouwer',
    );
    expect(t.el.querySelector('.co-selection')!.textContent).toContain(
      'Kooi: Raiderkamp, werkstraal 45 m',
    );
    expect(t.el.querySelector('.co-selection')!.textContent).toContain('Slaaf');
    t.select([unit({ raiderKind: 'slave', role: 'builder', loadoutName: 'Slaaf-bouwer' })]);
    expect(actions(t.el)).toEqual(['move', 'stop', 'build', 'roleScavenger']);
    expect(t.el.querySelector('[data-action="roleScavenger"]')!.textContent).toContain('Slaaf');
  });

  it('a multi-selection tells a slave (S) from a slave builder (SB) after SetRole (playtest M3)', () => {
    const t = setup();
    mounted = t.handle;
    t.select([
      unit({ id: 1, raiderKind: 'slave' }),
      unit({ id: 2, raiderKind: 'slave', role: 'builder', loadoutName: 'Slaaf-bouwer' }),
      unit({ id: 3, raiderKind: 'fighter', role: 'militia', loadoutName: 'Rover' }),
    ]);
    const cells = [...t.el.querySelectorAll('.co-selection .co-cell')];
    expect(cells.map((c) => c.querySelector('b')!.textContent)).toEqual(['S', 'SB', 'V']);
    expect(cells[1]!.getAttribute('aria-label')).toContain('Slaaf-bouwer');
    expect(cells[2]!.getAttribute('aria-label')).toContain('Rover (Vechter)');
  });

  it("Vang is the Slaver's own command: it aims with a hint and sends Attack on an enemy", () => {
    const t = setup();
    mounted = t.handle;
    t.select([unit({ raiderKind: 'slaver', role: 'militia', loadoutName: 'Slaver' })]);
    expect(actions(t.el)).toEqual(['move', 'stop', 'capture', 'guard']);
    expect(t.el.querySelector('[data-action="capture"]')!.getAttribute('title')).toContain(
      'Sla een vijandelijke bewoner neer buiten zijn basis',
    );
    act(() => void (t.el.querySelector('[data-action="capture"]') as HTMLElement).click());
    expect(t.targets).toEqual(['capture']);
    expect(t.el.querySelector('.co-targeting')!.textContent).toContain(
      'Sla een vijandelijke bewoner neer buiten zijn basis',
    );
    act(() => void t.handle.completeTargeting({ enemyId: 77, x: 5, y: 6 }));
    expect(t.sent).toEqual([{ type: 'Attack', payload: { ids: [1], target: 77 } }]);
  });

  it('F is the hotkey of Vang', () => {
    const t = setup();
    mounted = t.handle;
    t.select([unit({ raiderKind: 'slaver', role: 'militia', loadoutName: 'Slaver' })]);
    press('f');
    expect(t.targets).toEqual(['capture']);
  });

  it('Bevrijd shows for a fighter only while an enemy slave is in sight, and attacks him', () => {
    let enemySlaves = false;
    const t = setup({ hasEnemySlaves: () => enemySlaves });
    mounted = t.handle;
    const militia = unit({ role: 'militia', loadoutName: 'Militie' });
    t.select([militia]);
    expect(actions(t.el)).not.toContain('liberate');
    enemySlaves = true;
    t.select([militia]);
    expect(actions(t.el)).toContain('liberate');
    act(() => void (t.el.querySelector('[data-action="liberate"]') as HTMLElement).click());
    expect(t.targets).toEqual(['liberate']);
    act(() => void t.handle.completeTargeting({ enemyId: 5, x: 1, y: 1 }));
    expect(t.sent.at(-1)).toEqual({ type: 'Attack', payload: { ids: [1], target: 5 } });
    // a slave cannot liberate
    t.select([unit({ raiderKind: 'slave' })]);
    expect(actions(t.el)).not.toContain('liberate');
  });

  it('Raider fighters get Val aan but no role switching', () => {
    const t = setup({ canSwitchRole: () => true });
    mounted = t.handle;
    t.select([unit({ raiderKind: 'fighter', role: 'militia', loadoutName: 'Knuppelaar' })]);
    expect(actions(t.el)).toEqual(['move', 'stop', 'attackMove', 'guard']);
  });
});

describe('Bewaak (protocol 0.15.0 Guard, data 0.29.0)', () => {
  it('fighters get Bewaak (G) with its hint; it aims at a Kooi or a scrap node and sends Guard', () => {
    const t = setup();
    mounted = t.handle;
    t.select([unit({ id: 4, raiderKind: 'fighter', role: 'militia', loadoutName: 'Rover' })]);
    const button = t.el.querySelector('[data-action="guard"]')!;
    expect(button.textContent).toContain('Bewaak');
    expect(button.getAttribute('title')).toBe(
      'Bewaak een kooi of scrapbron: houdt slaven aan het werk',
    );
    press('g');
    expect(t.targets).toEqual(['guard']);
    expect(t.el.querySelector('.co-targeting')!.textContent).toContain(
      'Kies een kooi of scrapbron om te bewaken',
    );
    // the ground is no post: the mode stays
    let done = true;
    act(() => void (done = t.handle.completeTargeting({ x: 5, y: 6 })));
    expect(done).toBe(false);
    expect(t.sent).toEqual([]);
    act(() => void t.handle.completeTargeting({ nodeId: 21 }));
    expect(t.sent).toEqual([{ type: 'Guard', payload: { ids: [4], targetId: 21 } }]);
    expect(COMMAND_PAYLOADS.Guard.safeParse(t.sent[0]!.payload).success).toBe(true);
    press('g');
    act(() => void t.handle.completeTargeting({ ownId: 9 }));
    expect(t.sent[1]).toEqual({ type: 'Guard', payload: { ids: [4], targetId: 9 } });
  });

  it('a selected scrap node shows its guard lines and a hint, no hp bar', () => {
    const t = setup();
    mounted = t.handle;
    t.select([
      {
        id: 7,
        typeId: SCRAP_NODE_TYPE_ID,
        loadoutName: 'Scrapbron',
        hpPct: 100,
        role: null,
        enemy: true,
        ownerLabel: 'Grondstof',
        lines: ['5 slaven aan het werk', 'Bewakers 1/2 nodig (te weinig: slaven lopen weg)'],
      },
    ]);
    const panel = t.el.querySelector('.co-selection')!;
    expect(panel.textContent).toContain('Scrapbron');
    expect(panel.textContent).toContain('Selectie · grondstof');
    expect(panel.textContent).not.toContain('vijand');
    expect(panel.textContent).toContain('Bewakers 1/2 nodig');
    expect(panel.querySelector('.co-hp')).toBeNull();
    expect(t.el.textContent).toContain('kies eenheden om te verzamelen of te bewaken (W)');
  });

  it('a Dweller militie can guard a node too; slaves and the hero alone get no Bewaak', () => {
    const t = setup();
    mounted = t.handle;
    t.select([unit({ role: 'militia', loadoutName: 'Militie' })]);
    expect(actions(t.el)).toContain('guard');
    t.select([unit({ raiderKind: 'slave' })]);
    expect(actions(t.el)).not.toContain('guard');
  });
});

describe('Raider top bar', () => {
  it('shows slaves, fighters against the safety net and the Kooi guards; nothing without Raider stats', () => {
    const none = setup();
    expect(none.el.querySelector('.co-raiders')).toBeNull();
    none.handle.unmount();
    const t = setup({ getRaiderStats: () => stats({ fighters: 3 }) });
    mounted = t.handle;
    const bar = t.el.querySelector('.co-raiders')!;
    expect(bar.querySelector('[data-raider="slaves"]')!.textContent).toBe(
      'Slaven6· 4 aan het werk, 1 gevangen',
    );
    const fighters = bar.querySelector('[data-raider="fighters"]')!;
    expect(fighters.textContent).toContain('3/5');
    expect(fighters.className).toContain('co-raider-warn');
    expect(fighters.getAttribute('title')).toContain('komt er een Rover bij de tent');
    const guards = bar.querySelector('[data-raider="guards"]')!;
    expect(guards.textContent).toContain('Bewakers1/1');
    expect(guards.className).not.toContain('warn');
  });

  it('warns on a slave group with too few guards (the guard rule, data 0.29.0) and on fighters under the safety net', () => {
    const short = stats({
      fighters: 7,
      guardGroups: [
        { kind: 'kooi', id: 9, x: 0, y: 0, naam: 'Kooi', slaves: 2, guards: 1, guardsNeeded: 1 },
        {
          kind: 'node',
          id: 12,
          x: 0,
          y: 0,
          naam: 'Scrapbron',
          slaves: 5,
          guards: 1,
          guardsNeeded: 2,
        },
      ],
    });
    const t = setup({ getRaiderStats: () => short });
    mounted = t.handle;
    expect(t.el.querySelector('[data-raider="fighters"]')!.className).not.toContain('warn');
    const guards = t.el.querySelector('[data-raider="guards"]')!;
    expect(guards.className).toContain('co-raider-warn');
    expect(guards.textContent).toContain('2/3');
    expect(guards.getAttribute('title')).toContain('Scrapbron: 5 slaven, bewakers 1/2 nodig');
    expect(guards.getAttribute('title')).toContain('Bewaak (G)');
  });

  it('shows the revolt alert as a toast', () => {
    let alert: ((a: HudAlert) => void) | null = null;
    const t = setup({
      subscribeAlerts: (cb) => {
        alert = cb;
        return () => undefined;
      },
    });
    mounted = t.handle;
    act(() => alert!({ kind: 'revolt', x: 1, y: 2 }));
    expect(t.el.querySelector('[data-alert="revolt"]')!.textContent).toBe(
      'Te weinig bewakers: slaven lopen weg! Zet vechters op Bewaak (G)',
    );
  });

  it('shows the no-free-beds hint with its own text (playtest M5)', () => {
    let alert: ((a: HudAlert) => void) | null = null;
    const t = setup({
      subscribeAlerts: (cb) => {
        alert = cb;
        return () => undefined;
      },
    });
    mounted = t.handle;
    act(() => alert!({ kind: 'noBeds', x: 1, y: 2, text: 'Geen vrije bedden: bouw een tent' }));
    const toast = t.el.querySelector('[data-alert="noBeds"]')!;
    expect(toast.textContent).toBe('Geen vrije bedden: bouw een tent');
    expect(toast.getAttribute('aria-label')).toBe(
      'Geen vrije bedden: bouw een tent, ga naar de locatie',
    );
    // advice, not an alarm: the Alarm button does not come up for it
    expect(actions(t.el)).not.toContain('lastAlert');
    act(() => alert!({ kind: 'attack', x: 1, y: 2 }));
    expect(actions(t.el)).toContain('lastAlert');
  });
});

describe('Raider roster tile and portraits', () => {
  it('shows the short label on the tile and keeps the full name in the tooltip', () => {
    const roster: RosterGroup[] = [
      {
        key: 'slaaf_bouwer',
        naam: 'Slaaf-bouwer',
        short: 'Bouwer',
        units: [{ id: 1, hpPct: 100, activity: 'idle', x: 0, y: 0 }],
      },
    ];
    const t = setup({ getRoster: () => roster });
    mounted = t.handle;
    const tile = t.el.querySelector('.co-roster-group')!;
    expect(tile.querySelector('.co-roster-name')!.textContent).toBe('Bouwer');
    expect(tile.getAttribute('title')).toBe('Slaaf-bouwer');
    expect(tile.getAttribute('aria-label')).toContain('Slaaf-bouwer');
  });

  it('gives every Raider type its own face; the dog and the buggy the generic unit', () => {
    const keys = [
      'plunderaar',
      'plunderaar_staal',
      'knuppelaar',
      'molotovgooier',
      'slaver',
      'chemdealer',
      'slaaf',
      'slaaf_bouwer',
    ];
    const faces = keys.map(portraitOfGroup);
    expect(new Set(faces).size).toBe(keys.length);
    expect(portraitOfGroup('hond')).toBe('robot');
    expect(portraitOfGroup('buggy')).toBe('robot');
    // the selected-unit portrait agrees with the tile, also for a Raider fighter whose role is militia
    const sel = (loadoutName: string, role: SelectedEntity['role']): SelectedEntity =>
      unit({ loadoutName, role });
    // the Raider fighter is called Rover (playtest L4), its steel variant Rover in staal
    expect(portraitOfEntity(sel('Rover', 'militia'))).toBe(portraitOfGroup('plunderaar'));
    expect(portraitOfEntity(sel('Rover in staal', 'militia'))).toBe(
      portraitOfGroup('plunderaar_staal'),
    );
    expect(portraitOfEntity(sel('Slaver', 'militia'))).toBe(portraitOfGroup('slaver'));
    expect(portraitOfEntity(sel('Chem-dealer', 'militia'))).toBe(portraitOfGroup('chemdealer'));
    expect(portraitOfEntity(sel('Molotovgooier', 'militia'))).toBe(
      portraitOfGroup('molotovgooier'),
    );
    expect(portraitOfEntity(sel('Slaaf-bouwer', 'builder'))).toBe(portraitOfGroup('slaaf_bouwer'));
    expect(portraitOfEntity(sel('Slaaf', 'scavenger'))).toBe(portraitOfGroup('slaaf'));
    expect(portraitOfEntity(sel('Hond', 'militia'))).toBe('robot');
    // the Dwellers keep theirs: a scavenger named Plunderaar is still the scavenger face
    expect(portraitOfEntity(sel('Plunderaar', 'scavenger'))).toBe(portraitOfGroup('scavenger'));
  });
});

describe('Zonder bed counter', () => {
  const producing: PlayerStatus = {
    ...status,
    queue: [{ kind: 'produce', id: 10, unitId: 5, buildingId: 1, progressPermille: 100 }],
  };
  it('does not show for the Raiders: a tent producing fighters is no robot production', () => {
    const t = setup({ getStatus: () => producing, getRaiderStats: () => stats() });
    mounted = t.handle;
    expect(t.el.querySelector('.co-counters')!.textContent).not.toContain('Zonder bed');
  });
  it('shows for a faction with robots once something is produced', () => {
    const t = setup({ getStatus: () => producing });
    mounted = t.handle;
    expect(t.el.querySelector('.co-counters')!.textContent).toContain('Zonder bed');
  });
});
