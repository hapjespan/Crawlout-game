import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'preact/test-utils';
import type { CommandType, PlayerStatus } from '@crawlout/protocol';
import { unitTypeId } from '@crawlout/data';
import { mountHud } from './index.js';
import type { HudDeps, HudHandle, SelectedEntity } from './index.js';

// Claim op de commandokaart (speltest 22 oktober, Martien: "De garde en raiders moeten in domination gewoon een flag
// kunnen claimen met een bouwer"). De sim kon dit al voor alle drie de facties (contract 2 Claim, zie
// packages/sim/test/claim.factions.test.ts); alleen de knop ontbrak, zodat claimen alleen via een rechtsklik op het
// punt of via het bouwmenu ging. Elke factie heeft een claimgebouw (claimpaal, plunderpost, wachtpost), dus de knop
// hoort bij elke bouwer: de Dweller-bouwer, de Bouwrobot, de slaaf-bouwer van de Raiders en de Initiate-bouwer van de
// Garde.

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
const unit = (over: Partial<SelectedEntity> = {}): SelectedEntity => ({
  id: 1,
  typeId,
  loadoutName: 'Bouwer',
  hpPct: 100,
  role: 'builder',
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

describe('Claim op de commandokaart', () => {
  it('elke bouwer krijgt Claim naast Bouw: Dwellers, de Bouwrobot, de Raiders en de Garde', () => {
    const t = setup();
    mounted = t.handle;
    for (const builder of [
      unit(),
      unit({ robot: true, loadoutName: 'Bouwrobot' }),
      unit({ raiderKind: 'slave', loadoutName: 'Slaaf-bouwer' }),
      unit({ loadoutName: 'Initiate-bouwer' }),
    ]) {
      t.select([builder]);
      expect(actions(t.el)).toContain('claim');
    }
  });

  it('wie niet bouwt krijgt geen Claim', () => {
    const t = setup();
    mounted = t.handle;
    t.select([unit({ role: 'scavenger', loadoutName: 'Plunderaar' })]);
    expect(actions(t.el)).not.toContain('claim');
    t.select([unit({ role: 'militia', loadoutName: 'Initiate-wacht' })]);
    expect(actions(t.el)).not.toContain('claim');
  });

  it('N richt op een claimpunt en stuurt Claim met alleen de bouwers uit de selectie', () => {
    const t = setup();
    mounted = t.handle;
    t.select([unit({ id: 3 }), unit({ id: 4, role: 'militia', loadoutName: 'Militie' })]);
    press('n');
    expect(t.targets).toEqual(['claim']);
    expect(t.el.querySelector('.co-targeting')!.textContent).toContain(
      'Kies een claimpunt om te claimen',
    );
    // de grond is geen claimpunt: de richtmodus blijft staan en er gaat niets weg
    let done = true;
    act(() => void (done = t.handle.completeTargeting({ x: 5, y: 6 })));
    expect(done).toBe(false);
    expect(t.sent).toEqual([]);
    act(() => void t.handle.completeTargeting({ pointId: 77 }));
    expect(t.sent).toEqual([{ type: 'Claim', payload: { ids: [3], pointId: 77 } }]);
  });

  it('de knop legt uit wat de speler moet aanklikken', () => {
    const t = setup();
    mounted = t.handle;
    t.select([unit()]);
    const button = t.el.querySelector('[data-action="claim"]')!;
    expect(button.textContent).toContain('Claim');
    expect(button.getAttribute('title')).toContain('claimpunt');
  });
});

describe('Bewaak hoort bij elke factie, met de uitleg van die factie', () => {
  it('een Raidervechter leest Kooi of scrapbron, een Garde-wacht alleen scrapbron', () => {
    const t = setup();
    mounted = t.handle;
    t.select([unit({ id: 4, raiderKind: 'fighter', role: 'militia', loadoutName: 'Rover' })]);
    expect(actions(t.el)).toContain('guard');
    press('g');
    expect(t.el.querySelector('.co-hint')!.textContent).toContain('eigen Kooi of een scrapbron');
    act(() => t.handle.cancelTargeting());
    // De Garde heeft geen Kooi (data/buildings/04-garde.json): voor hem is een scrapbron het enige doel.
    t.select([unit({ id: 5, role: 'militia', loadoutName: 'Initiate-wacht' })]);
    expect(actions(t.el)).toContain('guard');
    press('g');
    expect(t.el.querySelector('.co-hint')!.textContent).toContain('scrapbron');
    expect(t.el.querySelector('.co-hint')!.textContent).not.toContain('Kooi');
  });
});
