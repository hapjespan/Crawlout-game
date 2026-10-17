// HUD round 2 (designer feedback): role switch only after a workshop, camera follows HUD selections, and the hero's
// perk panel (badge, panel with name, effect and requirement, PickPerk).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'preact/test-utils';
import { COMMAND_PAYLOADS } from '@crawlout/protocol';
import type { CommandType, HeroStatus, PlayerStatus } from '@crawlout/protocol';
import { mountHud } from './index.js';
import type { HudDeps, HudHandle, PerkOption, SelectedEntity } from './index.js';

const heroBase: HeroStatus = {
  heroId: 5,
  level: 3,
  xp: 100,
  xpNext: 200,
  special: [5, 5, 5, 5, 5, 5, 5],
  perks: [],
  pendingPerks: 0,
  revivesLeft: 3,
  state: 'alive',
  reviveTicksLeft: 0,
  entityId: 0,
  abilityCooldownTicks: [0],
};
const status = (hero: HeroStatus | null): PlayerStatus => ({
  playerId: 0,
  scrap: 100,
  settlers: 3,
  pop: 3,
  popCap: 8,
  beds: 4,
  hero,
  queue: [],
  dominance: { pointsHeld: 0, pointsRequired: 2, ticksHeld: 0, ticksRequired: 9600, leader: null },
  robotPop: 0,
  trained: [0, 0, 0, 0, 0, 0, 0],
});
const settler = (
  id: number,
  role: SelectedEntity['role'],
  x?: number,
  y?: number,
): SelectedEntity => ({
  id,
  typeId: 3,
  loadoutName: 'Plunderaar',
  hpPct: 80,
  role,
  ...(x !== undefined && y !== undefined ? { x, y } : {}),
});

interface Sent {
  type: CommandType;
  payload: unknown;
}
interface Over {
  hero?: HeroStatus | null;
  selection?: SelectedEntity[];
  perks?: PerkOption[];
  /** Undefined: the client has no canSwitchRole dep. */
  workshop?: boolean;
}

function setup(o: Over = {}) {
  const sent: Sent[] = [];
  const focus: [number, number][] = [];
  const selects: { ids: number[]; add: boolean }[] = [];
  const state = {
    hero: o.hero === undefined ? heroBase : o.hero,
    selection: o.selection ?? [],
    workshop: o.workshop,
  };
  const deps: HudDeps = {
    sendCommand: (type, payload) => void sent.push({ type, payload }),
    getStatus: () => status(state.hero),
    getSelection: () => state.selection,
    beginTargeting: () => undefined,
    heroName: () => 'Opziener',
    getPerkOptions: () => o.perks ?? [],
    focusCamera: (x, y) => void focus.push([x, y]),
    selectUnits: (ids, add) => {
      selects.push({ ids: [...ids], add });
      state.selection = state.selection.filter((s) => ids.includes(s.id));
    },
    ...(o.workshop === undefined ? {} : { canSwitchRole: () => state.workshop === true }),
  };
  const el = document.createElement('div');
  document.body.appendChild(el);
  let handle!: HudHandle;
  act(() => {
    handle = mountHud(el, deps);
  });
  return { el, sent, focus, selects, state, handle };
}
const press = (key: string): void =>
  void act(() => void document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })));
const click = (el: Element | null): void => void act(() => void (el as HTMLElement).click());
const actions = (el: HTMLElement): string[] =>
  [...el.querySelectorAll('.co-buttons [data-action]')].map((b) => b.getAttribute('data-action')!);

let mounted: HudHandle | null = null;
beforeEach(() => {
  document.body.innerHTML = '';
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('rol wisselen pas na een werkplaats', () => {
  it('zonder voltooide werkplaats geen rolknoppen en doen 1 tot 3 niets', () => {
    const t = setup({ selection: [settler(1, 'scavenger')], workshop: false });
    mounted = t.handle;
    expect(actions(t.el)).toEqual(['move', 'stop', 'gather']);
    expect(t.el.querySelector('[data-action="roleBuilder"]')).toBeNull();
    press('2');
    press('3');
    expect(t.sent).toEqual([]);
  });

  it('met een voltooide werkplaats staan de rolknoppen er weer en werken de toetsen', () => {
    const t = setup({ selection: [settler(1, 'scavenger')], workshop: true });
    mounted = t.handle;
    expect(actions(t.el)).toEqual(['move', 'stop', 'gather', 'roleBuilder', 'roleMilitia']);
    press('2');
    expect(t.sent).toEqual([{ type: 'SetRole', payload: { ids: [1], role: 'builder' } }]);
    expect(COMMAND_PAYLOADS.SetRole.safeParse(t.sent[0]!.payload).success).toBe(true);
  });

  it('de knoppen volgen de werkplaats zodra die klaar is', () => {
    const t = setup({ selection: [settler(1, 'militia')], workshop: false });
    mounted = t.handle;
    expect(t.el.querySelector('[data-action="roleScavenger"]')).toBeNull();
    t.state.workshop = true;
    act(() => t.handle.refresh());
    expect(t.el.querySelector('[data-action="roleScavenger"]')).not.toBeNull();
  });

  it('zonder de dep (oude client) blijven de rolknoppen staan', () => {
    const t = setup({ selection: [settler(1, 'scavenger')] });
    mounted = t.handle;
    expect(t.el.querySelector('[data-action="roleBuilder"]')).not.toBeNull();
  });
});

describe('camera volgt een selectie via de HUD', () => {
  it('een kaart in het selectiepaneel selecteert alleen die eenheid en zet de camera erop', () => {
    const t = setup({
      selection: [settler(1, 'scavenger', 100, 200), settler(2, 'builder', 300, 400)],
    });
    mounted = t.handle;
    click(t.el.querySelector('.co-selection [data-unit="2"]'));
    expect(t.selects).toEqual([{ ids: [2], add: false }]);
    expect(t.focus).toEqual([[300, 400]]);
  });

  it('een kaart zonder positie selecteert, maar laat de camera staan', () => {
    const t = setup({ selection: [settler(1, 'scavenger'), settler(2, 'builder')] });
    mounted = t.handle;
    click(t.el.querySelector('.co-selection [data-unit="1"]'));
    expect(t.selects).toEqual([{ ids: [1], add: false }]);
    expect(t.focus).toEqual([]);
  });

  it('een selectie van buiten de HUD (wereldklik) beweegt de camera niet', () => {
    const t = setup({ selection: [] });
    mounted = t.handle;
    t.state.selection = [settler(1, 'scavenger', 10, 20)];
    act(() => t.handle.refresh());
    expect(t.focus).toEqual([]);
  });
});

describe('perk-paneel', () => {
  const perks: PerkOption[] = [
    {
      perkId: 0,
      naam: 'Zware Laarzen',
      effects: ['+10% leven voor de held'],
      requirement: 'Uithoudingsvermogen 5',
      flavour: 'Drie maten te groot.',
    },
    {
      perkId: 1,
      naam: 'Geluksschot',
      effects: ['+8% schade voor de held'],
      requirement: 'Geluk 8',
      available: false,
    },
  ];
  const withPending = (n: number): HeroStatus => ({ ...heroBase, pendingPerks: n });

  it('zonder te kiezen perk geen badge en geen paneel', () => {
    const t = setup({ perks });
    mounted = t.handle;
    expect(t.el.querySelector('[data-action="perks"]')).toBeNull();
    press('p');
    expect(t.el.querySelector('.co-perk-panel')).toBeNull();
  });

  it('toont "Kies perk (n)" op het heldpaneel en opent bij een klik het paneel', () => {
    const t = setup({ perks, hero: withPending(2) });
    mounted = t.handle;
    const badge = t.el.querySelector('[data-action="perks"]');
    expect(badge?.textContent).toContain('Kies perk (2)');
    expect(badge?.getAttribute('aria-expanded')).toBe('false');
    expect(t.el.querySelector('.co-perk-panel')).toBeNull();
    click(badge);
    expect(badge?.getAttribute('aria-expanded')).toBe('true');
    const panel = t.el.querySelector('.co-perk-panel');
    expect(panel?.textContent).toContain('Zware Laarzen');
    expect(panel?.textContent).toContain('+10% leven voor de held');
    expect(panel?.textContent).toContain('Vereist Uithoudingsvermogen 5');
  });

  it('een kiesbare perk stuurt PickPerk en sluit het paneel bij de laatste keuze', () => {
    const t = setup({ perks, hero: withPending(1) });
    mounted = t.handle;
    click(t.el.querySelector('[data-action="perks"]'));
    click(t.el.querySelector('[data-perk="0"]'));
    expect(t.sent).toEqual([{ type: 'PickPerk', payload: { heroId: 5, perkId: 0 } }]);
    expect(COMMAND_PAYLOADS.PickPerk.safeParse(t.sent[0]!.payload).success).toBe(true);
    expect(t.el.querySelector('.co-perk-panel')).toBeNull();
  });

  it('bij meerdere keuzes blijft het paneel open', () => {
    const t = setup({ perks, hero: withPending(2) });
    mounted = t.handle;
    click(t.el.querySelector('[data-action="perks"]'));
    click(t.el.querySelector('[data-perk="0"]'));
    expect(t.el.querySelector('.co-perk-panel')).not.toBeNull();
  });

  it('een perk waarvan de vereiste niet gehaald is staat er, maar is niet te kiezen', () => {
    const t = setup({ perks, hero: withPending(1) });
    mounted = t.handle;
    click(t.el.querySelector('[data-action="perks"]'));
    const locked = t.el.querySelector('[data-perk="1"]');
    expect(locked?.getAttribute('aria-disabled')).toBe('true');
    expect(locked?.textContent).toContain('nog niet gehaald');
    click(locked);
    press('F2');
    expect(t.sent).toEqual([]);
  });

  it('P en Escape openen en sluiten het paneel; ook het kruisje sluit', () => {
    const t = setup({ perks, hero: withPending(1) });
    mounted = t.handle;
    press('p');
    expect(t.el.querySelector('.co-perk-panel')).not.toBeNull();
    press('Escape');
    expect(t.el.querySelector('.co-perk-panel')).toBeNull();
    press('p');
    click(t.el.querySelector('.co-perk-close'));
    expect(t.el.querySelector('.co-perk-panel')).toBeNull();
  });

  it('F1 kiest ook zonder open paneel de eerste perk', () => {
    const t = setup({ perks, hero: withPending(1) });
    mounted = t.handle;
    press('F1');
    expect(t.sent).toEqual([{ type: 'PickPerk', payload: { heroId: 5, perkId: 0 } }]);
  });

  it('het paneel sluit als er niets meer te kiezen is', () => {
    const t = setup({ perks, hero: withPending(1) });
    mounted = t.handle;
    press('p');
    t.state.hero = withPending(0);
    act(() => t.handle.refresh());
    expect(t.el.querySelector('.co-perk-panel')).toBeNull();
    expect(t.el.querySelector('[data-action="perks"]')).toBeNull();
  });
});

describe('vijand aanklikken om te bekijken', () => {
  const foe = (over: Partial<SelectedEntity> = {}): SelectedEntity => ({
    id: 901,
    typeId: 5,
    loadoutName: 'Beveiligingsrobot',
    hpPct: 55,
    role: null,
    enemy: true,
    ownerLabel: 'Vijand (Dwellers)',
    detail: 'Wapen: Schokgeweer (energie) \u00b7 Pantser: robot',
    ...over,
  });

  it('toont soort, eigenaar, hp en wapen en pantser in het selectiepaneel', () => {
    const t = setup({ selection: [foe()] });
    mounted = t.handle;
    const panel = t.el.querySelector('.co-selection');
    expect(panel?.classList.contains('co-selection-enemy')).toBe(true);
    expect(panel?.textContent).toContain('Beveiligingsrobot');
    expect(panel?.textContent).toContain('Vijand (Dwellers)');
    expect(panel?.textContent).toContain('55%');
    expect(panel?.textContent).toContain('Wapen: Schokgeweer');
    expect(panel?.querySelector('[role="meter"]')?.getAttribute('aria-valuenow')).toBe('55');
  });

  it('een vijandelijk gebouw toont "Gebouw" en geen wapenregel', () => {
    const building = foe({ typeId: 1024 + 6, loadoutName: 'Turret' });
    delete building.detail;
    const t = setup({ selection: [building] });
    mounted = t.handle;
    const text = t.el.querySelector('.co-selection')?.textContent ?? '';
    expect(text).toContain('Turret');
    expect(text).toContain('Gebouw');
    expect(text).not.toContain('Wapen');
  });

  it('geen commandoknoppen, alleen een hint; sneltoetsen sturen niets', () => {
    const t = setup({ selection: [foe()], workshop: true });
    mounted = t.handle;
    expect(actions(t.el)).toEqual([]);
    expect(t.el.querySelector('.co-commands')?.textContent).toContain('kun je niet bevelen');
    for (const k of ['m', 's', 'a', 'g', 'b', '1', '2', '3']) press(k);
    expect(t.sent).toEqual([]);
    expect(t.el.querySelector('.co-cards')).toBeNull();
  });

  it('een vijandelijke held toont de abilities van de eigen held niet in de commandokaart', () => {
    const t = setup({ selection: [foe({ typeId: 1000, loadoutName: 'Opziener' })] });
    mounted = t.handle;
    expect(t.el.querySelector('.co-commands .co-abilities')).toBeNull();
  });

  it('een klik op een eigen eenheid vervangt de bekeken vijand en geeft weer commandos', () => {
    const t = setup({ selection: [foe()] });
    mounted = t.handle;
    t.state.selection = [settler(1, 'scavenger')];
    act(() => t.handle.refresh());
    expect(t.el.querySelector('.co-selection-enemy')).toBeNull();
    expect(actions(t.el)).toContain('move');
  });

  it('een ghost (laatst gezien) zegt dat in het paneel en in de console, en is nog steeds niet te bevelen', () => {
    const ghost = foe({ typeId: 1024 + 6, loadoutName: 'Turret', lastSeen: true });
    delete ghost.detail;
    const t = setup({ selection: [ghost] });
    mounted = t.handle;
    const panel = t.el.querySelector('.co-selection');
    expect(panel?.textContent).toContain('Laatst gezien');
    expect(panel?.textContent).toContain('Turret');
    expect(t.el.querySelector('.co-console')?.textContent).toContain('laatst gezien');
    expect(actions(t.el)).toEqual([]);
    // A visible enemy says nothing of the kind.
    t.state.selection = [foe()];
    act(() => t.handle.refresh());
    expect(t.el.querySelector('.co-selection')?.textContent).not.toContain('Laatst gezien');
    expect(t.el.querySelector('.co-console')?.textContent).not.toContain('laatst gezien');
  });

  it('een vijand beweegt de camera niet', () => {
    const t = setup({ selection: [] });
    mounted = t.handle;
    t.state.selection = [foe()];
    act(() => t.handle.refresh());
    expect(t.focus).toEqual([]);
  });
});
