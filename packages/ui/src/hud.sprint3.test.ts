import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'preact/test-utils';
import { COMMAND_PAYLOADS, CommandEnvelope } from '@crawlout/protocol';
import type { CommandType, HeroStatus, PlayerStatus } from '@crawlout/protocol';
import { ACTIONS, mountHud } from './index.js';
import type {
  CraftOption,
  HeroAbilityOption,
  HudDeps,
  HudHandle,
  PerkOption,
  RecruitOption,
  ResearchOption,
  SelectedEntity,
} from './index.js';

const heroBase: HeroStatus = {
  heroId: 5,
  level: 4,
  xp: 200,
  xpNext: 400,
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
});
const unit = (id: number): SelectedEntity => ({
  id,
  typeId: 3,
  loadoutName: 'Knuppel',
  hpPct: 80,
  role: 'scavenger',
});
const building = (id: number, buildingId: number): SelectedEntity => ({
  id,
  typeId: 1024 + buildingId,
  loadoutName: null,
  hpPct: 100,
  role: null,
});
const perks: PerkOption[] = [
  { perkId: 11, naam: 'Taai' },
  { perkId: 12, naam: 'Snel' },
  { perkId: 13, naam: 'Scherp' },
];

interface Sent {
  type: CommandType;
  payload: unknown;
}
interface Over {
  hero?: HeroStatus | null;
  selection?: SelectedEntity[];
  abilities?: HeroAbilityOption[];
  dead?: boolean;
  research?: ResearchOption[];
  recruit?: RecruitOption[];
  craft?: CraftOption[];
  deps?: Partial<HudDeps>;
  omit?: (keyof HudDeps)[];
}

function setup(o: Over = {}) {
  const sent: Sent[] = [];
  const targeting: string[] = [];
  const state = {
    hero: o.hero === undefined ? heroBase : o.hero,
    selection: o.selection ?? [unit(1)],
    abilities: o.abilities ?? [],
    dead: o.dead ?? false,
  };
  const reviveHero = vi.fn();
  const queries: { research: number[][]; recruit: number[][] } = { research: [], recruit: [] };
  const deps: HudDeps = {
    sendCommand: (type, payload) => void sent.push({ type, payload }),
    getStatus: () => status(state.hero),
    getSelection: () => state.selection,
    beginTargeting: (k) => void targeting.push(k),
    heroName: () => 'Opziener',
    getPerkOptions: () => perks,
    getHeroAbilities: () => state.abilities,
    isHeroDead: () => state.dead,
    reviveHero,
    getResearchOptions: (ids) => (queries.research.push([...ids]), o.research ?? []),
    getRecruitOptions: (ids) => (queries.recruit.push([...ids]), o.recruit ?? []),
    getCraftOptions: () => o.craft ?? [],
    ...o.deps,
  };
  for (const k of o.omit ?? []) delete deps[k];
  const el = document.createElement('div');
  document.body.appendChild(el);
  let handle!: HudHandle;
  act(() => {
    handle = mountHud(el, deps);
  });
  return { el, sent, targeting, state, handle, reviveHero, queries };
}
const press = (key: string): void =>
  void act(() => void document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })));
const click = (el: Element | null): void => void act(() => void (el as HTMLElement).click());
function expectValid(s: Sent): void {
  expect(COMMAND_PAYLOADS[s.type].safeParse(s.payload).success).toBe(true);
  expect(
    CommandEnvelope.safeParse({ frame: 0, playerId: 0, seq: 0, type: s.type, payload: s.payload })
      .success,
  ).toBe(true);
}

let mounted: HudHandle | null = null;
beforeEach(() => {
  document.body.innerHTML = '';
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('held-paneel uit HeroStatus', () => {
  it('toont naam uit heroName, level, xp en resterende oplap-beurten', () => {
    const t = setup();
    mounted = t.handle;
    const panel = t.el.querySelector('[aria-label="Held"]');
    expect(panel?.textContent).toContain('Opziener');
    expect(panel?.textContent).toContain('level 4');
    expect(panel?.textContent).toContain('nog 3x');
    expect(panel?.querySelector('[role="meter"]')?.getAttribute('aria-valuenow')).toBe('50');
  });

  it('perk-keuze via F1, F2, F3 en klik; Q, W, E doen niets', () => {
    const t = setup({ hero: { ...heroBase, pendingPerks: 2 } });
    mounted = t.handle;
    press('q');
    press('w');
    press('e');
    expect(t.sent).toEqual([]);
    press('F2');
    press('F3');
    click(t.el.querySelector('[data-perk="11"]'));
    expect(t.sent.map((s) => s.payload)).toEqual([
      { heroId: 5, perkId: 12 },
      { heroId: 5, perkId: 13 },
      { heroId: 5, perkId: 11 },
    ]);
    t.sent.forEach(expectValid);
    expect(t.el.querySelector('[data-perk="11"]')?.getAttribute('aria-label')).toContain('F1');
  });

  it('F1 wordt afgevangen zodra er een held is (geen browser-hulp)', () => {
    const t = setup();
    mounted = t.handle;
    const ev = new KeyboardEvent('keydown', { key: 'F1', bubbles: true, cancelable: true });
    act(() => void document.dispatchEvent(ev));
    expect(ev.defaultPrevented).toBe(true);
  });
});

describe('oplappen', () => {
  it('knop en V zijn er alleen bij een dode held met beurten over', () => {
    const t = setup({ dead: true });
    mounted = t.handle;
    expect(t.el.querySelector('.co-revive')).not.toBeNull();
    press('v');
    expect(t.reviveHero).toHaveBeenCalledOnce();
    click(t.el.querySelector('.co-revive'));
    expect(t.reviveHero).toHaveBeenCalledTimes(2);
  });

  it('levende held of revivesLeft 0: geen knop, V doet niets', () => {
    const alive = setup();
    mounted = alive.handle;
    expect(alive.el.querySelector('.co-revive')).toBeNull();
    press('v');
    expect(alive.reviveHero).not.toHaveBeenCalled();
    alive.handle.unmount();
    mounted = null;
    document.body.innerHTML = '';
    const empty = setup({ dead: true, hero: { ...heroBase, revivesLeft: 0 } });
    mounted = empty.handle;
    expect(empty.el.querySelector('.co-revive')).toBeNull();
    press('v');
    expect(empty.reviveHero).not.toHaveBeenCalled();
  });
});

describe('held-abilities', () => {
  const abilities: HeroAbilityOption[] = [
    { abilityId: 1, naam: 'Schreeuw', needsTarget: false, cooldownPct: 0 },
    { abilityId: 2, naam: 'Vuurbal', needsTarget: true, cooldownPct: 0 },
    { abilityId: 3, naam: 'Sprint', needsTarget: false, cooldownPct: 40 },
  ];

  it('een knop per ability; ability zonder doel stuurt direct HeroAbility', () => {
    const t = setup({ abilities });
    mounted = t.handle;
    expect(t.el.querySelectorAll('[data-ability]')).toHaveLength(3);
    click(t.el.querySelector('[data-ability="1"]'));
    press('z');
    expect(t.sent).toEqual([
      { type: 'HeroAbility', payload: { heroId: 5, abilityId: 1 } },
      { type: 'HeroAbility', payload: { heroId: 5, abilityId: 1 } },
    ]);
    t.sent.forEach(expectValid);
  });

  it('ability met doel gaat in targeting en stuurt x, y bij de wereldklik', () => {
    const t = setup({ abilities });
    mounted = t.handle;
    press('x');
    expect(t.targeting).toEqual(['heroAbility']);
    expect(t.el.querySelector('.co-targeting')?.textContent).toContain('ability');
    let ok = false;
    act(() => {
      ok = t.handle.completeTargeting({ x: 1000.6, y: 2000 });
    });
    expect(ok).toBe(true);
    expect(t.sent).toEqual([
      { type: 'HeroAbility', payload: { heroId: 5, abilityId: 2, x: 1001, y: 2000 } },
    ]);
    expectValid(t.sent[0]!);
    expect(t.el.querySelector('.co-targeting')).toBeNull();
  });

  it('targeting werkt zonder selectie en Esc annuleert; een node als doel wordt geweigerd', () => {
    const t = setup({ abilities, selection: [] });
    mounted = t.handle;
    press('x');
    expect(t.el.querySelector('.co-targeting')).not.toBeNull();
    let ok = true;
    act(() => {
      ok = t.handle.completeTargeting({ nodeId: 3 });
    });
    expect(ok).toBe(false);
    press('Escape');
    expect(t.el.querySelector('.co-targeting')).toBeNull();
    expect(t.sent).toEqual([]);
  });

  it('cooldown, dode held of ontbrekend heroId: knop uitgeschakeld en toets doet niets', () => {
    const t = setup({ abilities, dead: true });
    mounted = t.handle;
    expect(t.el.querySelector<HTMLButtonElement>('[data-ability="3"]')?.disabled).toBe(true);
    expect(t.el.querySelector<HTMLButtonElement>('[data-ability="1"]')?.disabled).toBe(true);
    press('z');
    press('c');
    expect(t.sent).toEqual([]);
  });

  it('zonder dep geen ability-knoppen', () => {
    const t = setup({ omit: ['getHeroAbilities'] });
    mounted = t.handle;
    expect(t.el.querySelector('[data-ability]')).toBeNull();
  });
});

describe('verouderde deps: research en recruit worden kaarten', () => {
  const research: ResearchOption[] = [
    { techId: 7, naam: 'Pantser', scrapCost: 80, affordable: true },
    { techId: 8, naam: 'Vuurwapens', scrapCost: 900, affordable: false },
  ];
  const recruit: RecruitOption[] = [
    { buildingId: 4, naam: 'Strijder', scrapCost: 50, affordable: true },
  ];

  it('toont het paneel met kosten en geeft de buildingIds aan de deps', () => {
    const t = setup({ selection: [building(9, 4), building(10, 4)], research, recruit });
    mounted = t.handle;
    const panel = t.el.querySelector('[aria-label="Gebouw"]');
    expect(panel?.textContent).toContain('Pantser');
    expect(panel?.textContent).toContain('900');
    expect(
      t.el
        .querySelector<HTMLButtonElement>('[data-card-kind="research"][data-card-id="8"]')
        ?.getAttribute('aria-disabled'),
    ).toBe('true');
    expect(t.queries.research.at(-1)).toEqual([4]);
  });

  it('klik en cijfers sturen Research en Recruit; te duur stuurt niets', () => {
    const t = setup({ selection: [building(9, 4)], research, recruit });
    mounted = t.handle;
    click(t.el.querySelector('[data-card-kind="research"][data-card-id="7"]'));
    press('3');
    press('2');
    press('1');
    expect(t.sent).toEqual([
      { type: 'Research', payload: { techId: 7 } },
      { type: 'Recruit', payload: { buildingId: 4 } },
      { type: 'Research', payload: { techId: 7 } },
    ]);
    t.sent.forEach(expectValid);
  });

  it('geen paneel zonder opties of zonder gebouw; cijfers blijven rollen bij units', () => {
    const none = setup({ selection: [building(9, 4)] });
    mounted = none.handle;
    expect(none.el.querySelector('[aria-label="Gebouw"]')).toBeNull();
    none.handle.unmount();
    document.body.innerHTML = '';
    const units = setup({ selection: [unit(1)], research });
    mounted = units.handle;
    expect(units.el.querySelector('[aria-label="Gebouw"]')).toBeNull();
    expect(units.queries.research).toEqual([]);
    press('2');
    expect(units.sent).toEqual([{ type: 'SetRole', payload: { ids: [1], role: 'builder' } }]);
  });
});

describe('verouderde deps: craft wordt kaarten', () => {
  const craft: CraftOption[] = [
    { loadoutId: 2, naam: 'Knuppel', scrapCost: 20, affordable: true },
    { loadoutId: 3, naam: 'Geweer', scrapCost: 300, affordable: false },
  ];

  it('K activeert de cijfertoetsen; keuze stuurt Craft met alleen units', () => {
    const t = setup({ selection: [unit(1), unit(2), building(9, 1)], craft });
    mounted = t.handle;
    expect(t.el.querySelector('[aria-label="Gebouw"]')).toBeNull();
    press('2'); // zonder K is 2 de rolletoets, en alleen voor de bewoners (niet voor het gebouw)
    expect(t.sent).toEqual([{ type: 'SetRole', payload: { ids: [1, 2], role: 'builder' } }]);
    t.sent.length = 0;
    press('k');
    click(t.el.querySelector('[data-card-id="3"]'));
    press('2');
    expect(t.sent).toEqual([]);
    press('1');
    expect(t.sent).toEqual([{ type: 'Craft', payload: { ids: [1, 2], loadoutId: 2 } }]);
    expectValid(t.sent[0]!);
  });

  it('zonder opties (niet bij een werkplaats) is K uitgeschakeld', () => {
    const t = setup({ selection: [unit(1)] });
    mounted = t.handle;
    press('k');
    expect(t.el.querySelector('.co-cards')).toBeNull();
  });
});

describe('sneltoetsen', () => {
  it('alleen A en S vallen samen met de camera-toetsen (bewust), verder geen dubbelen', () => {
    const cameraKeys = new Set(['w', 'a', 's', 'd', 'q', 'e']);
    const hudKeys = [...ACTIONS.map((a) => a.key), 'h', 'k', 'f1', 'f2', 'f3', 'z', 'x', 'c'];
    expect(hudKeys.filter((k) => cameraKeys.has(k)).sort()).toEqual(['a', 's']);
    expect(new Set(hudKeys).size).toBe(hudKeys.length);
  });
});
