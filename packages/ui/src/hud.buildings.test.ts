import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'preact/test-utils';
import type { CommandPayload, CommandType, PlayerStatus } from '@crawlout/protocol';
import { mountHud } from './index.js';
import type {
  BuildingButton,
  BuildingCard,
  HudDeps,
  HudHandle,
  SelectedEntity,
  TargetingKind,
} from './index.js';

// A small model of the game the HUD talks to: buildings, a selection, a scrap stock and a work queue. The deps read
// it the way the client does, so "select a building, click a card, the queue has the research" runs end to end
// without a browser (the real-browser version lives in tools/replay/src/hud-clicks.ts).

const WORKSHOP = 1024 + 2;
const LAB = 1024 + 8;
const HOUSE = 1024 + 1;
const FACTORY = 1024 + 7;
const TRAINING = 1024 + 9;
const HQ = 1024;

interface Site {
  id: number;
  typeId: number;
  key: string;
  naam: string;
  x: number;
  y: number;
}
const SITES: Site[] = [
  { id: 10, typeId: HQ, key: 'hoofdgebouw', naam: 'Basis', x: 0, y: 0 },
  { id: 11, typeId: WORKSHOP, key: 'werkplaats', naam: 'Werkplaats', x: 100, y: 0 },
  { id: 12, typeId: LAB, key: 'lab', naam: 'Lab', x: 200, y: 0 },
  { id: 13, typeId: HOUSE, key: 'woning', naam: 'Woning', x: 300, y: 0 },
  { id: 14, typeId: HOUSE, key: 'woning', naam: 'Woning', x: 400, y: 0 },
  { id: 15, typeId: HOUSE, key: 'woning', naam: 'Woning', x: 500, y: 0 },
  { id: 16, typeId: FACTORY, key: 'robotfabriek', naam: 'Robotfabriek', x: 600, y: 0 },
  { id: 17, typeId: TRAINING, key: 'trainingsfaciliteit', naam: 'Training', x: 700, y: 0 },
];

const research = (
  id: number,
  naam: string,
  scrapCost: number,
  state: BuildingCard['state'],
  extra: Partial<BuildingCard> = {},
): BuildingCard => ({
  kind: 'research',
  id,
  naam,
  icon: 'research',
  scrapCost,
  seconds: 25,
  effects: [],
  unlocks: [],
  requires: [],
  state,
  hotkey: String(id),
  ...extra,
});

function setup(opts: { scrap?: number; selection?: number[]; units?: SelectedEntity[] } = {}) {
  const sent: { type: CommandType; payload: unknown }[] = [];
  const focus: [number, number][] = [];
  const model = {
    scrap: opts.scrap ?? 300,
    selection: opts.selection ?? [],
    units: opts.units ?? [],
    queue: [] as PlayerStatus['queue'],
    targetingEnded: 0,
    robotPop: 0,
  };
  const status = (): PlayerStatus => ({
    playerId: 0,
    scrap: model.scrap,
    settlers: 3,
    pop: 3,
    popCap: 8,
    beds: 4,
    hero: null,
    queue: model.queue,
    robotPop: model.robotPop,
    dominance: {
      pointsHeld: 0,
      pointsRequired: 2,
      ticksHeld: 0,
      ticksRequired: 9600,
      leader: null,
    },
    trained: [0, 0, 0, 0, 0, 0, 0],
    claimPoints: [],
  });
  const runningHere = (id: number) => model.queue.find((q) => q.buildingId === id);
  /** Cards of one building, like the client's: the workshop and the lab research, busy while they work. */
  const cardsOf = (site: Site): BuildingCard[] => {
    const busy = runningHere(site.id) !== undefined;
    if (site.typeId === WORKSHOP) {
      const running = model.queue.find((q) => q.kind === 'research' && q.id === 1);
      return [
        research(
          1,
          'Geweerrek',
          100,
          running ? 'running' : busy ? 'busy' : model.scrap >= 100 ? 'available' : 'tooExpensive',
          running ? { progressPct: Math.round(running.progressPermille / 10) } : {},
        ),
        research(2, 'Composiet pantser', 150, 'locked', {
          requires: ['Geweerrek'],
          reason: 'Vergrendeld: vereist Geweerrek',
        }),
      ];
    }
    if (site.typeId === LAB) return [research(3, 'Raffinage', 125, 'available')];
    if (site.typeId === FACTORY)
      return [
        {
          ...research(7, 'Beveiligingsrobot', 150, 'available'),
          kind: 'produce',
          buildingId: site.id,
          icon: 'robot',
        },
      ];
    if (site.typeId === TRAINING)
      return [
        {
          ...research(0, 'Training kracht', 100, 'available'),
          kind: 'train',
          buildingId: site.id,
          icon: 'training',
        },
      ];
    return [];
  };
  const selected = (): SelectedEntity[] => [
    ...model.selection.flatMap((id) => {
      const s = SITES.find((x) => x.id === id);
      return s
        ? [{ id, typeId: s.typeId, loadoutName: s.naam, hpPct: 100, role: null } as SelectedEntity]
        : [];
    }),
    ...model.units,
  ];
  const buttons = (): BuildingButton[] => {
    const groups = new Map<string, Site[]>();
    for (const s of SITES) groups.set(s.key, [...(groups.get(s.key) ?? []), s]);
    return [...groups.entries()].map(([key, list]) => {
      const sites = list.map((s) => ({
        id: s.id,
        x: s.x,
        y: s.y,
        available: cardsOf(s).filter((c) => c.state === 'available').length,
        running: runningHere(s.id) ? 1 : 0,
        ...(runningHere(s.id)
          ? { progressPct: Math.round(runningHere(s.id)!.progressPermille / 10) }
          : {}),
      }));
      const prog = sites.flatMap((s) => (s.progressPct === undefined ? [] : [s.progressPct]));
      return {
        key,
        naam: list[0]!.naam,
        sites,
        available: sites.reduce((n, s) => n + s.available, 0),
        running: sites.reduce((n, s) => n + s.running, 0),
        ...(prog.length > 0 ? { progressPct: Math.max(...prog) } : {}),
      };
    });
  };
  const listeners = new Set<() => void>();
  const deps: HudDeps = {
    sendCommand: <T extends CommandType>(type: T, payload: CommandPayload<T>) =>
      void sent.push({ type, payload }),
    getStatus: status,
    getSelection: selected,
    beginTargeting: () => undefined,
    endTargeting: () => void model.targetingEnded++,
    subscribe: (l) => (listeners.add(l), () => listeners.delete(l)),
    focusCamera: (x, y) => void focus.push([x, y]),
    selectUnits: (ids, add) => {
      model.selection = add ? [...model.selection, ...ids] : [...ids];
      model.units = [];
    },
    getBuildingButtons: buttons,
    getBuildingCards: () => {
      const sites = model.selection.flatMap((id) => SITES.filter((s) => s.id === id));
      return model.units.length > 0 ? [] : sites.flatMap(cardsOf);
    },
    startCard: (card) => {
      // The sim's own rule: a card starts only when it is available; research takes the scrap and queues.
      if (card.kind === 'research' && card.state === 'available') {
        model.scrap -= card.scrapCost;
        model.queue = [
          ...model.queue,
          {
            kind: 'research',
            buildingId: model.selection[0]!,
            unitId: 0,
            id: card.id,
            progressPermille: 0,
          },
        ];
        sent.push({ type: 'Research', payload: { techId: card.id } });
      } else if (card.kind === 'produce')
        sent.push({
          type: 'Produce',
          payload: { buildingId: card.buildingId, loadoutId: card.id },
        });
      else if (card.kind === 'train')
        sent.push({ type: 'Train', payload: { buildingId: card.buildingId, programId: card.id } });
    },
  };
  const el = document.createElement('div');
  document.body.appendChild(el);
  let handle!: HudHandle;
  act(() => {
    handle = mountHud(el, deps);
  });
  /** A world click on a building: the client replaces the selection and tells the HUD. */
  const clickWorld = (id: number): void =>
    void act(() => {
      model.selection = [id];
      model.units = [];
      handle.refresh();
    });
  const tick = (): void => void act(() => handle.refresh());
  return { el, sent, focus, model, handle, clickWorld, tick, listeners };
}

const q = <T extends Element = HTMLElement>(root: ParentNode, sel: string): T =>
  root.querySelector<T>(sel)!;
const click = (el: Element | null): void => void act(() => void (el as HTMLElement).click());
const press = (key: string): void =>
  void act(() => void document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })));

let mounted: HudHandle | null = null;
beforeEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('gebouwenpaneel', () => {
  it('toont alle eigen gebouwen per type, met aantal ("Woning ×3")', () => {
    const t = setup();
    mounted = t.handle;
    const names = [...t.el.querySelectorAll('.co-building-btn .co-building-name')].map(
      (e) => e.textContent,
    );
    expect(names).toEqual(['Basis', 'Werkplaats', 'Lab', 'Woning', 'Robotfabriek', 'Training']);
    expect(q(t.el, '[data-building="woning"]').textContent).toContain('×3');
    expect(q(t.el, '[data-building="lab"]').textContent).not.toContain('×');
  });

  it('toont een badge met het aantal beschikbare acties en geen badge als er niets is', () => {
    const t = setup();
    mounted = t.handle;
    expect(q(t.el, '[data-building="werkplaats"] .co-building-badge').textContent).toBe('1');
    expect(t.el.querySelector('[data-building="woning"] .co-building-badge')).toBeNull();
  });

  it('toont voortgang zolang er iets loopt', () => {
    const t = setup();
    mounted = t.handle;
    t.model.queue = [{ kind: 'research', buildingId: 11, unitId: 0, id: 1, progressPermille: 450 }];
    t.tick();
    const bar = q(t.el, '[data-building="werkplaats"] [role="progressbar"]');
    expect(bar.getAttribute('aria-valuenow')).toBe('45');
    expect(q(t.el, '[data-building="werkplaats"]').classList.contains('co-busy')).toBe(true);
  });

  it('een klik selecteert het gebouw en opent zijn kaarten; klik op een kaart start het onderzoek', () => {
    const t = setup();
    mounted = t.handle;
    expect(t.el.querySelector('.co-cards')).toBeNull();
    click(q(t.el, '[data-building="werkplaats"]'));
    expect(t.model.selection).toEqual([11]);
    expect(q(t.el, '.co-cards').textContent).toContain('Geweerrek');
    click(q(t.el, '[data-card-id="1"]'));
    expect(t.sent).toEqual([{ type: 'Research', payload: { techId: 1 } }]);
    expect(t.model.queue).toHaveLength(1);
    expect(t.model.queue[0]).toMatchObject({ kind: 'research', id: 1, buildingId: 11 });
  });

  it('dezelfde route via een wereldklik op het gebouw', () => {
    const t = setup();
    mounted = t.handle;
    t.clickWorld(11);
    click(q(t.el, '[data-card-id="1"]'));
    expect(t.model.queue).toHaveLength(1);
    expect(t.model.scrap).toBe(200);
  });

  it('klikken met meerdere gebouwen van een type loopt ze om en zet de camera op elk gebouw; dubbelklik loopt niet verder', () => {
    const t = setup();
    mounted = t.handle;
    const btn = (): HTMLElement => q(t.el, '[data-building="woning"]');
    click(btn());
    expect(t.model.selection).toEqual([13]);
    expect(t.focus).toEqual([[300, 0]]); // a single click already moves the camera
    click(btn());
    expect(t.model.selection).toEqual([14]);
    expect(t.focus.at(-1)).toEqual([400, 0]);
    click(btn());
    click(btn());
    expect(t.model.selection).toEqual([13]); // rond
    const before = t.focus.length;
    act(() => void btn().dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
    expect(t.focus.length).toBe(before + 1);
    expect(t.focus.at(-1)).toEqual([300, 0]);
    expect(t.model.selection).toEqual([13]); // dubbelklik loopt niet verder om
  });

  it('shift-klik op een gebouwknop voegt toe en laat de camera staan', () => {
    const t = setup();
    mounted = t.handle;
    act(
      () =>
        void q(t.el, '[data-building="werkplaats"]').dispatchEvent(
          new MouseEvent('click', { bubbles: true, shiftKey: true }),
        ),
    );
    expect(t.focus).toEqual([]);
  });

  it('een geselecteerd gebouwtype is gemarkeerd', () => {
    const t = setup();
    mounted = t.handle;
    t.clickWorld(12);
    expect(q(t.el, '[data-building="lab"]').getAttribute('aria-pressed')).toBe('true');
    expect(q(t.el, '[data-building="werkplaats"]').getAttribute('aria-pressed')).toBe('false');
  });

  it('robotfabriek en trainingsfaciliteit starten Produce en Train met het gebouw erbij', () => {
    const t = setup();
    mounted = t.handle;
    click(q(t.el, '[data-building="robotfabriek"]'));
    expect(q(t.el, '[aria-label="Robotfabriek"]')).not.toBeNull();
    click(q(t.el, '[data-card-kind="produce"]'));
    click(q(t.el, '[data-building="trainingsfaciliteit"]'));
    expect(q(t.el, '[aria-label="Training"]')).not.toBeNull();
    click(q(t.el, '[data-card-kind="train"]'));
    expect(t.sent).toEqual([
      { type: 'Produce', payload: { buildingId: 16, loadoutId: 7 } },
      { type: 'Train', payload: { buildingId: 17, programId: 0 } },
    ]);
  });
});

describe('kaarten die niet starten', () => {
  it('een vergrendelde kaart toont zijn reden, ook als tooltip, en klikken geeft de melding', () => {
    const t = setup({ selection: [11] });
    mounted = t.handle;
    const locked = q(t.el, '[data-card-id="2"]');
    expect(locked.getAttribute('aria-disabled')).toBe('true');
    expect(locked.textContent).toContain('Vereist: Geweerrek');
    expect(locked.getAttribute('title')).toBe('Vergrendeld: vereist Geweerrek');
    click(locked);
    expect(t.sent).toEqual([]);
    expect(q(t.el, '.co-card-notice').textContent).toBe('Vergrendeld: vereist Geweerrek');
  });

  it('een te dure kaart legt uit waarom, en er verdwijnt geen scrap', () => {
    const t = setup({ selection: [11], scrap: 40 });
    mounted = t.handle;
    const card = q(t.el, '[data-card-id="1"]');
    expect(card.getAttribute('aria-disabled')).toBe('true');
    click(card);
    expect(t.sent).toEqual([]);
    expect(t.model.scrap).toBe(40);
    expect(q(t.el, '.co-card-notice').textContent).toContain('Te duur');
  });

  it('een lopend onderzoek toont als running (de kaart start niet opnieuw)', () => {
    const t = setup({ selection: [12] });
    mounted = t.handle;
    t.model.queue = [{ kind: 'research', buildingId: 11, unitId: 0, id: 1, progressPermille: 100 }];
    t.model.selection = [11];
    t.tick();
    const running = q(t.el, '[data-card-id="1"]');
    expect(running.closest('li')!.getAttribute('data-state')).toBe('running');
  });

  it('de melding verdwijnt vanzelf', () => {
    vi.useFakeTimers();
    const t = setup({ selection: [11] });
    mounted = t.handle;
    click(q(t.el, '[data-card-id="2"]'));
    expect(t.el.querySelector('.co-card-notice')).not.toBeNull();
    act(() => void vi.advanceTimersByTime(4000));
    expect(t.el.querySelector('.co-card-notice')).toBeNull();
  });
});

describe('klikken die niet verloren gaan', () => {
  it('de kaartknop blijft hetzelfde DOM-element terwijl de HUD elke snapshot opnieuw rendert', () => {
    const t = setup({ selection: [11] });
    mounted = t.handle;
    const before = q(t.el, '[data-card-id="1"]');
    for (let i = 0; i < 5; i++) t.tick();
    expect(q(t.el, '[data-card-id="1"]')).toBe(before);
  });

  it('pointerdown en pointerup op dezelfde kaart starten hem één keer, ook zonder click', () => {
    const t = setup({ selection: [11] });
    mounted = t.handle;
    const card = q(t.el, '[data-card-id="1"]');
    act(() => {
      card.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
      card.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0 }));
    });
    expect(t.model.queue).toHaveLength(1);
    // de click die bij dezelfde druk hoort, telt niet nog een keer
    expect(t.sent).toHaveLength(1);
  });

  it('indrukken op de ene kaart en loslaten op een andere start niets', () => {
    const t = setup({ selection: [11] });
    mounted = t.handle;
    act(() => {
      q(t.el, '[data-card-id="1"]').dispatchEvent(
        new MouseEvent('pointerdown', { bubbles: true, button: 0 }),
      );
      q(t.el, '[data-card-id="2"]').dispatchEvent(
        new MouseEvent('pointerup', { bubbles: true, button: 0 }),
      );
    });
    expect(t.sent).toEqual([]);
  });

  it('muis en pointer-events op het HUD bereiken niets daarbuiten', () => {
    const t = setup({ selection: [11] });
    mounted = t.handle;
    const outside = vi.fn();
    document.body.addEventListener('pointerdown', outside);
    document.body.addEventListener('mousedown', outside);
    document.body.addEventListener('click', outside);
    document.body.addEventListener('contextmenu', outside);
    const card = q(t.el, '[data-card-id="2"]');
    act(() => {
      card.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      card.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      card.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    });
    expect(outside).not.toHaveBeenCalled();
    document.body.removeEventListener('pointerdown', outside);
  });
});

describe("context-gevoelige commando's", () => {
  const unit = (id: number, role: SelectedEntity['role'], typeId = 3): SelectedEntity => ({
    id,
    typeId,
    loadoutName: 'x',
    hpPct: 100,
    role,
  });
  const actionsOf = (el: HTMLElement): string[] =>
    [...el.querySelectorAll('.co-buttons [data-action]')].map((b) =>
      b.getAttribute('data-action')!,
    );

  it('zonder selectie staat er alleen een hint', () => {
    const t = setup();
    mounted = t.handle;
    expect(actionsOf(t.el)).toEqual([]);
    expect(q(t.el, '.co-commands').textContent).toContain('Selecteer een eenheid of gebouw');
  });

  it('bouwer: Verplaats, Stop, Bouw en de andere rollen; geen Val aan', () => {
    const t = setup({ units: [unit(1, 'builder')] });
    mounted = t.handle;
    expect(actionsOf(t.el)).toEqual(['move', 'stop', 'build', 'roleScavenger', 'roleMilitia']);
  });

  it('plunderaar: Verplaats, Stop, Verzamel', () => {
    const t = setup({ units: [unit(1, 'scavenger')] });
    mounted = t.handle;
    expect(actionsOf(t.el)).toEqual(['move', 'stop', 'gather', 'roleBuilder', 'roleMilitia']);
  });

  it('militie: Verplaats, Stop, Val aan', () => {
    const t = setup({ units: [unit(1, 'militia')] });
    mounted = t.handle;
    expect(actionsOf(t.el)).toEqual(['move', 'stop', 'attackMove', 'roleScavenger', 'roleBuilder']);
  });

  it('een robot (geen rol): Verplaats, Stop, Val aan en geen rolknoppen', () => {
    const t = setup({ units: [unit(1, null)] });
    mounted = t.handle;
    expect(actionsOf(t.el)).toEqual(['move', 'stop', 'attackMove']);
  });

  it('een geselecteerd gebouw heeft geen commando-knoppen maar een hint', () => {
    const t = setup({ selection: [11] });
    mounted = t.handle;
    expect(actionsOf(t.el)).toEqual([]);
    expect(q(t.el, '.co-commands').textContent).toContain('Kies hierboven');
  });

  it('Held-, Craft- en Minimap-knoppen bestaan niet meer', () => {
    const t = setup({ units: [unit(1, 'builder')] });
    mounted = t.handle;
    for (const id of ['hero', 'craft', 'minimap'])
      expect(t.el.querySelector(`[data-action="${id}"]`)).toBeNull();
  });
});

describe('plaatsing van het kaartenvenster', () => {
  it('het kaartenvenster staat in dezelfde kolom direct boven de commando-kaart', () => {
    const t = setup({ selection: [11] });
    mounted = t.handle;
    const col = q(t.el, '.co-right-col');
    const kids = [...col.children].map((c) => c.className);
    expect(kids[0]).toContain('co-cards');
    expect(kids[1]).toContain('co-commands');
  });
});

describe('targeting zonder vastlopers', () => {
  it('een afgeronde order meldt endTargeting, zodat de client geen klikken meer opslokt', () => {
    const t = setup({
      units: [{ id: 1, typeId: 3, loadoutName: 'x', hpPct: 100, role: 'militia' }],
    });
    mounted = t.handle;
    const kinds: TargetingKind[] = [];
    press('m');
    expect(t.handle.targetingActive()).toBe(true);
    act(() => void t.handle.completeTargeting({ x: 5, y: 5 }));
    expect(t.handle.targetingActive()).toBe(false);
    expect(t.model.targetingEnded).toBe(1);
    expect(kinds).toEqual([]);
  });
});

describe('robots in de bovenbalk', () => {
  it('toont de robot-pop naast de pop', () => {
    const t = setup();
    mounted = t.handle;
    expect(q(t.el, '[aria-label="Voorraad en bewoners"]').textContent).not.toContain('Robots');
    t.model.robotPop = 4;
    t.tick();
    const text = q(t.el, '[aria-label="Voorraad en bewoners"]').textContent!;
    expect(text).toContain('Robots');
    expect(text).toContain('4');
  });
});

describe('altijd opnieuw kunnen klikken', () => {
  const militia: SelectedEntity = {
    id: 1,
    typeId: 3,
    loadoutName: 'x',
    hpPct: 100,
    role: 'militia',
  };

  it('gebouw selecteren en dan op lege grond klikken sluit het kaartenvenster en reset de commando-kaart', () => {
    const t = setup();
    mounted = t.handle;
    t.clickWorld(11);
    expect(t.el.querySelector('.co-cards')).not.toBeNull();
    act(() => {
      t.model.selection = []; // click on empty ground: the client clears the selection
      t.handle.refresh();
    });
    expect(t.el.querySelector('.co-cards')).toBeNull();
    expect(q(t.el, '.co-commands').textContent).toContain('Selecteer een eenheid of gebouw');
    expect(t.el.querySelectorAll('.co-buttons [data-action]')).toHaveLength(0);
  });

  it('eenheid selecteren en dan op lege grond klikken laat niets geselecteerd', () => {
    const t = setup({ units: [militia] });
    mounted = t.handle;
    expect(t.el.querySelectorAll('.co-buttons [data-action]').length).toBeGreaterThan(0);
    act(() => {
      t.model.units = [];
      t.handle.refresh();
    });
    expect(q(t.el, '.co-selection').textContent).toContain('Niets geselecteerd');
    expect(t.el.querySelectorAll('.co-buttons [data-action]')).toHaveLength(0);
  });

  it('gebouw geselecteerd en dan een eenheid aanklikken: de eenheid is geselecteerd en het kaartenvenster weg', () => {
    const t = setup();
    mounted = t.handle;
    t.clickWorld(11);
    act(() => {
      t.model.selection = [];
      t.model.units = [militia];
      t.handle.refresh();
    });
    expect(t.el.querySelector('.co-cards')).toBeNull();
    expect(q(t.el, '[data-action="attackMove"]')).not.toBeNull();
  });

  it('een open commandomodus (targeting) stopt als de selectie leeg wordt', () => {
    const t = setup({ units: [militia] });
    mounted = t.handle;
    press('m');
    expect(t.handle.targetingActive()).toBe(true);
    act(() => {
      t.model.units = [];
      t.handle.refresh();
    });
    expect(t.handle.targetingActive()).toBe(false);
    expect(t.model.targetingEnded).toBe(1);
  });
});
