import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'preact/test-utils';
import type { PlayerStatus } from '@crawlout/protocol';
import { mountHud } from './index.js';
import type { BuildingCard, CardState, HudDeps, HudHandle, SelectedEntity } from './index.js';

const status: PlayerStatus = {
  playerId: 0,
  scrap: 100,
  settlers: 3,
  pop: 3,
  popCap: 8,
  beds: 4,
  hero: null,
  queue: [],
};
const unit = (id: number): SelectedEntity => ({
  id,
  typeId: 3,
  loadoutName: 'Knuppel',
  hpPct: 80,
  role: 'scavenger',
});
const building = (id: number): SelectedEntity => ({
  id,
  typeId: 1024 + 4,
  loadoutName: null,
  hpPct: 100,
  role: null,
});

const card = (state: CardState, n: number, extra: Partial<BuildingCard> = {}): BuildingCard => ({
  kind: 'research',
  id: n,
  naam: `Kaart ${n}`,
  icon: 'shield',
  scrapCost: 80,
  seconds: 30,
  effects: ['+20% schade voor militie'],
  unlocks: ['Patrouille', 'Turret'],
  requires: [],
  state,
  hotkey: String(n),
  ...extra,
});
const ALL: BuildingCard[] = [
  card('available', 1),
  card('tooExpensive', 2, { scrapCost: 900 }),
  card('locked', 3, { requires: ['Geweerrek'] }),
  card('running', 4, { progressPct: 45 }),
  card('done', 5),
];

function setup(
  cards: BuildingCard[] | (() => BuildingCard[]),
  selection: SelectedEntity[] = [building(9)],
  withCancel = true,
) {
  const started: BuildingCard[] = [];
  const cancelled: BuildingCard[] = [];
  const queries: SelectedEntity[][] = [];
  const deps: HudDeps = {
    sendCommand: () => undefined,
    getStatus: () => status,
    getSelection: () => selection,
    beginTargeting: () => undefined,
    getBuildingCards: (sel) => (
      queries.push([...sel]),
      typeof cards === 'function' ? cards() : cards
    ),
    startCard: (c) => void started.push(c),
    ...(withCancel ? { cancelCard: (c: BuildingCard) => void cancelled.push(c) } : {}),
  };
  const el = document.createElement('div');
  document.body.appendChild(el);
  let handle!: HudHandle;
  act(() => {
    handle = mountHud(el, deps);
  });
  return { el, started, cancelled, queries, handle };
}
const press = (key: string): void =>
  void act(() => void document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })));
const click = (el: Element | null): void => void act(() => void (el as HTMLElement).click());
const cardEl = (root: HTMLElement, id: number): HTMLElement =>
  root.querySelector<HTMLElement>(`[data-card-id="${id}"]`)!;

let mounted: HudHandle | null = null;
beforeEach(() => {
  document.body.innerHTML = '';
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('gebouwpaneel met kaarten: weergave', () => {
  it('geeft de selectie aan de dep en toont een kaart per item', () => {
    const t = setup(ALL);
    mounted = t.handle;
    expect(t.queries.at(-1)).toEqual([building(9)]);
    const panel = t.el.querySelector('[aria-label="Gebouw"]')!;
    expect(panel.querySelectorAll('.co-card')).toHaveLength(5);
  });

  it('toont naam, kosten, duur, effect en ontgrendelt', () => {
    const t = setup([ALL[0]!]);
    mounted = t.handle;
    const text = t.el.querySelector('.co-card')!.textContent!;
    expect(text).toContain('Kaart 1');
    expect(text).toContain('80 scrap');
    expect(text).toContain('30 s');
    expect(text).toContain('+20% schade voor militie');
    expect(text).toContain('Ontgrendelt: Patrouille, Turret');
    expect(t.el.querySelector('.co-card-icon')).not.toBeNull();
  });

  it('available: beschikbaar, start mogelijk', () => {
    const t = setup(ALL);
    mounted = t.handle;
    const c = t.el.querySelector('[data-state="available"]')!;
    expect(c.textContent).toContain('Beschikbaar');
    expect(c.querySelector('button')!.getAttribute('aria-disabled')).toBe('false');
  });

  it('tooExpensive: kosten rood plus tekst Te duur', () => {
    const t = setup(ALL);
    mounted = t.handle;
    const c = t.el.querySelector('[data-state="tooExpensive"]')!;
    expect(c.querySelector('.co-card-cost.co-full')?.textContent).toBe('900 scrap');
    expect(c.textContent).toContain('Te duur');
    expect(c.querySelector('.co-card-glyph')).not.toBeNull();
  });

  it('locked: toont Vereist: Geweerrek', () => {
    const t = setup(ALL);
    mounted = t.handle;
    const c = t.el.querySelector('[data-state="locked"]')!;
    expect(c.textContent).toContain('Vergrendeld');
    expect(c.textContent).toContain('Vereist: Geweerrek');
    expect(c.querySelector('button')!.getAttribute('aria-label')).toContain('vereist: Geweerrek');
  });

  it('running: voortgangsbalk en annuleerknop', () => {
    const t = setup(ALL);
    mounted = t.handle;
    const c = t.el.querySelector('[data-state="running"]')!;
    const bar = c.querySelector('[role="progressbar"]')!;
    expect(bar.getAttribute('aria-valuenow')).toBe('45');
    expect(c.textContent).toContain('45%');
    expect(c.querySelector('.co-card-cancel')!.getAttribute('aria-label')).toBe(
      'Annuleer onderzoek Kaart 4',
    );
  });

  it('done: Klaar met vinkje, geen voortgang of annuleren', () => {
    const t = setup(ALL);
    mounted = t.handle;
    const c = t.el.querySelector('[data-state="done"]')!;
    expect(c.textContent).toContain('Klaar');
    expect(c.querySelector('.co-card-glyph')).not.toBeNull();
    expect(c.querySelector('[role="progressbar"]')).toBeNull();
    expect(c.querySelector('.co-card-cancel')).toBeNull();
  });

  it('elke kaartknop heeft een aria-label met de status als tekst', () => {
    const t = setup(ALL);
    mounted = t.handle;
    const labels = [...t.el.querySelectorAll('.co-card-main')].map((b) =>
      b.getAttribute('aria-label'),
    );
    expect(labels[0]).toContain('Status: beschikbaar');
    expect(labels[1]).toContain('Status: te duur');
    expect(labels[2]).toContain('Status: vergrendeld');
    expect(labels[3]).toContain('Status: bezig');
    expect(labels[4]).toContain('Status: klaar');
  });

  it('onbekend icoon valt terug op een symbool; geen kaarten geen paneel', () => {
    const t = setup([card('available', 1, { icon: 'bestaatniet' })]);
    mounted = t.handle;
    expect(t.el.querySelector('.co-card-icon path')?.getAttribute('d')).toBeTruthy();
    t.handle.unmount();
    document.body.innerHTML = '';
    const none = setup([]);
    mounted = none.handle;
    expect(none.el.querySelector('.co-cards')).toBeNull();
  });

  it('vraagt geen kaarten zonder selectie', () => {
    const t = setup(ALL, []);
    mounted = t.handle;
    expect(t.queries).toEqual([]);
    expect(t.el.querySelector('.co-cards')).toBeNull();
  });
});

describe('gebouwpaneel met kaarten: acties', () => {
  it('klik op een beschikbare kaart start hem', () => {
    const t = setup(ALL);
    mounted = t.handle;
    click(cardEl(t.el, 1));
    expect(t.started).toEqual([ALL[0]]);
  });

  it('cijfertoets start de kaart met die sneltoets', () => {
    const t = setup(ALL);
    mounted = t.handle;
    press('1');
    expect(t.started).toEqual([ALL[0]]);
  });

  it('vergrendeld, te duur, lopend en klaar starten niet (klik en toets)', () => {
    const t = setup(ALL);
    mounted = t.handle;
    for (const id of [2, 3, 4, 5]) {
      click(cardEl(t.el, id));
      press(String(id));
    }
    expect(t.started).toEqual([]);
  });

  it('cijfers gaan niet naar de rolletoetsen zolang een gebouw geselecteerd is', () => {
    const t = setup(ALL);
    mounted = t.handle;
    press('2');
    expect(t.started).toEqual([]);
  });

  it('annuleren roept cancelCard aan voor een lopende kaart', () => {
    const t = setup(ALL);
    mounted = t.handle;
    click(t.el.querySelector('.co-card-cancel'));
    expect(t.cancelled).toEqual([ALL[3]]);
  });

  it('zonder cancelCard-dep geen annuleerknop', () => {
    const t = setup(ALL, [building(9)], false);
    mounted = t.handle;
    expect(t.el.querySelector('.co-card-cancel')).toBeNull();
  });

  it('voortgang en status volgen de dep bij refresh', () => {
    let state: BuildingCard[] = [card('available', 1)];
    const t = setup(() => state);
    mounted = t.handle;
    state = [card('running', 1, { progressPct: 70 })];
    act(() => t.handle.refresh());
    expect(t.el.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('70');
    state = [card('done', 1)];
    act(() => t.handle.refresh());
    expect(t.el.querySelector('[data-state="done"]')).not.toBeNull();
  });
});

describe('craftkaarten bij bewoners', () => {
  const craft = [
    card('available', 1, { kind: 'craft', naam: 'Geweer' }),
    card('tooExpensive', 2, { kind: 'craft', naam: 'Zwaard' }),
  ];

  it('paneel Craft zichtbaar; cijfers zijn rollen tot K; daarna start de kaart', () => {
    const t = setup(craft, [unit(1), unit(2)]);
    mounted = t.handle;
    expect(t.el.querySelector('[aria-label="Craft"]')).not.toBeNull();
    expect(t.el.querySelector('.co-cards-hint')).not.toBeNull();
    press('1');
    expect(t.started).toEqual([]);
    press('k');
    expect(t.el.querySelector('.co-cards-hint')).toBeNull();
    press('2');
    expect(t.started).toEqual([]);
    press('1');
    expect(t.started).toEqual([craft[0]]);
  });

  it('klik start craft', () => {
    const t = setup(craft, [unit(1)]);
    mounted = t.handle;
    click(cardEl(t.el, 1));
    expect(t.started).toEqual([craft[0]]);
  });

  it('een revive-kaart naast onderzoek werkt in hetzelfde paneel', () => {
    const rev = card('available', 6, { kind: 'revive', naam: 'Held oplappen', icon: 'revive' });
    const t = setup([ALL[0]!, rev]);
    mounted = t.handle;
    expect(t.el.querySelector('[data-card-kind="revive"]')!.getAttribute('aria-label')).toContain(
      'Oplappen Held oplappen',
    );
    click(cardEl(t.el, 6));
    expect(t.started).toEqual([rev]);
  });
});

describe('prestaties', () => {
  it('rendert negen kaarten in alle statussen ruim onder 2 ms per refresh', () => {
    const cards = Array.from({ length: 9 }, (_, i) =>
      card((['available', 'tooExpensive', 'locked', 'running', 'done'] as const)[i % 5]!, i + 1, {
        progressPct: i * 10,
        requires: ['Geweerrek'],
      }),
    );
    const t = setup(cards);
    mounted = t.handle;
    for (let i = 0; i < 20; i++) act(() => t.handle.refresh()); // opwarmen
    const n = 100;
    const t0 = performance.now();
    for (let i = 0; i < n; i++) act(() => t.handle.refresh());
    const per = (performance.now() - t0) / n;
    expect(per).toBeLessThan(2);
  });
});
