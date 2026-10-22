import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'preact/test-utils';
import { COMMAND_PAYLOADS, CommandEnvelope } from '@crawlout/protocol';
import type { CommandType, PlayerStatus } from '@crawlout/protocol';
import { mountHud } from './index.js';
import { renderBudgetMs } from './perfBudget.js';
import type {
  BuildOption,
  HudAlert,
  HudDeps,
  HudHandle,
  LobbyView,
  MinimapData,
  PerkOption,
  SelectedEntity,
} from './types.js';

const hero = {
  heroId: 77,
  level: 3,
  xp: 150,
  xpNext: 300,
  pendingPerks: 0,
  revivesLeft: 4,
  special: [5, 4, 6, 3, 7, 5, 2] as [number, number, number, number, number, number, number],
  perks: [10],
  state: 'alive' as const,
  reviveTicksLeft: 0,
  entityId: 0,
  abilityCooldownTicks: [0],
};
const baseStatus: PlayerStatus = {
  playerId: 0,
  scrap: 120,
  settlers: 7,
  pop: 9,
  popCap: 12,
  beds: 10,
  hero: null,
  queue: [],
  dominance: { pointsHeld: 0, pointsRequired: 2, ticksHeld: 0, ticksRequired: 9600, leader: null },
  noBedPop: 0,
  trained: [0, 0, 0, 0, 0, 0, 0],
  claimPoints: [],
};
const unit = (id: number, role: SelectedEntity['role'] = 'builder'): SelectedEntity => ({
  id,
  typeId: 3,
  loadoutName: 'Knuppel',
  hpPct: 80,
  role,
});
const options: BuildOption[] = [
  {
    buildingId: 1,
    typeId: 21,
    naam: 'Hut',
    scrapCost: 30,
    footprint: { w: 2, h: 2 },
    affordable: true,
    beds: 6,
  },
  {
    buildingId: 2,
    typeId: 22,
    naam: 'Muur',
    scrapCost: 500,
    footprint: { w: 1, h: 1 },
    affordable: false,
  },
];
const perks: PerkOption[] = [
  { perkId: 10, naam: 'Al gekozen' },
  { perkId: 11, naam: 'Taai' },
  { perkId: 12, naam: 'Snel', beschrijving: '+10% tempo' },
];
const minimap: MinimapData = {
  w: 10,
  h: 10,
  passable: new Uint8Array(100).fill(1),
  cellU: 256,
  blips: [{ x: 100, y: 100, owner: 0, kind: 'unit' }],
  claims: [{ x: 500, y: 500, owner: null }],
};

interface Sent {
  type: CommandType;
  payload: unknown;
}

function setup(
  over: Partial<HudDeps> = {},
  opts: {
    selection?: SelectedEntity[];
    status?: PlayerStatus;
    pendingPerks?: number;
    noMinimap?: boolean;
  } = {},
) {
  const sent: Sent[] = [];
  const calls = {
    focus: [] as [number, number][],
    placement: [] as BuildOption[],
    endPlacement: 0,
    targeting: [] as string[],
  };
  const alertCbs = new Set<(a: HudAlert) => void>();
  const base = opts.status ?? baseStatus;
  const state = {
    selection: opts.selection ?? [unit(5), unit(6)],
    status: base.hero
      ? { ...base, hero: { ...base.hero, pendingPerks: opts.pendingPerks ?? 0 } }
      : base,
  };
  const deps: HudDeps = {
    sendCommand: (type, payload) => void sent.push({ type, payload }),
    getStatus: () => state.status,
    getSelection: () => state.selection,
    beginTargeting: (k) => void calls.targeting.push(k),
    getMinimap: () => minimap,
    focusCamera: (x, y) => void calls.focus.push([x, y]),
    getBuildOptions: () => options,
    beginPlacement: (o) => void calls.placement.push(o),
    endPlacement: () => void calls.endPlacement++,
    heroName: () => 'Krijger',
    getPerkOptions: () => perks,
    subscribeAlerts: (cb) => {
      alertCbs.add(cb);
      return () => alertCbs.delete(cb);
    },
    ...over,
  };
  if (opts.noMinimap) delete deps.getMinimap;
  const el = document.createElement('div');
  document.body.appendChild(el);
  let handle!: HudHandle;
  act(() => {
    handle = mountHud(el, deps);
  });
  const alert = (a: HudAlert): void => void act(() => void alertCbs.forEach((cb) => cb(a)));
  return { el, sent, calls, state, handle, alert };
}

function expectValid(s: Sent): void {
  expect(COMMAND_PAYLOADS[s.type].safeParse(s.payload).success).toBe(true);
  expect(
    CommandEnvelope.safeParse({ frame: 0, playerId: 0, seq: 0, type: s.type, payload: s.payload })
      .success,
  ).toBe(true);
}
const press = (key: string): void =>
  void act(() => void document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })));
const click = (el: Element | null): void => void act(() => void (el as HTMLElement).click());

let mounted: HudHandle | null = null;
beforeEach(() => {
  document.body.innerHTML = '';
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.useRealTimers();
});

describe('bouwmenu en plaatsing', () => {
  it('B toont de opties; te dure optie is uitgeschakeld', () => {
    const t = setup();
    mounted = t.handle;
    press('b');
    const btns = t.el.querySelectorAll<HTMLButtonElement>('.co-build-option');
    expect(btns).toHaveLength(2);
    expect(btns[0]?.disabled).toBe(false);
    expect(btns[1]?.disabled).toBe(true);
    expect(btns[0]?.textContent).toContain('Hut');
    expect(btns[0]?.textContent).toContain('+6 bedden'); // data 0.41.0: the beds on the build card
    expect(btns[1]?.textContent).not.toContain('bed');
  });

  it('keuze, plaatsingsklik en Build-payload met alleen de bouwers', () => {
    const t = setup({}, { selection: [unit(5), unit(6, 'militia'), unit(7)] });
    mounted = t.handle;
    press('b');
    click(t.el.querySelector('[data-building="1"]'));
    expect(t.calls.placement).toEqual([options[0]]);
    expect(t.el.querySelector('[aria-label="Bouwmenu"]')).toBeNull();
    let ok = false;
    act(() => {
      ok = t.handle.completePlacement({ x: 1280.4, y: 512 });
    });
    expect(ok).toBe(true);
    expect(t.sent).toEqual([
      { type: 'Build', payload: { ids: [5, 7], typeId: 21, x: 1280, y: 512 } },
    ]);
    t.sent.forEach(expectValid);
    expect(t.handle.completePlacement({ x: 0, y: 0 })).toBe(false);
  });

  it('cijfertoets kiest een gebouw; de dure optie niet', () => {
    const t = setup();
    mounted = t.handle;
    press('b');
    press('2');
    expect(t.calls.placement).toEqual([]);
    press('1');
    expect(t.calls.placement).toEqual([options[0]]);
    expect(t.sent).toEqual([]); // niet als rol-toets opgevat
  });

  it('zonder bouwer staat Bouw niet op de kaart en doet B niets', () => {
    const t = setup({}, { selection: [unit(5, 'militia')] });
    mounted = t.handle;
    expect(t.el.querySelector('[data-action="build"]')).toBeNull();
    press('b');
    expect(t.el.querySelector('[aria-label="Bouwmenu"]')).toBeNull();
    press('1');
    expect(t.calls.placement).toEqual([]);
  });

  it('het bouwmenu sluit als de bouwer uit de selectie verdwijnt', () => {
    const t = setup();
    mounted = t.handle;
    press('b');
    expect(t.el.querySelector('[aria-label="Bouwmenu"]')).not.toBeNull();
    t.state.selection = [];
    act(() => t.handle.refresh());
    expect(t.el.querySelector('[aria-label="Bouwmenu"]')).toBeNull();
  });

  it('toont de reden van een rood voorbeeld in de plaatsbalk en wist hem bij annuleren', () => {
    const t = setup();
    mounted = t.handle;
    press('b');
    press('1');
    expect(t.el.querySelector('.co-placement-reason')).toBeNull();
    act(() => t.handle.setPlacementHint('Overlapt een gebouw'));
    expect(t.el.querySelector('.co-placement-reason')?.textContent).toContain(
      'Overlapt een gebouw',
    );
    act(() => t.handle.setPlacementHint(null));
    expect(t.el.querySelector('.co-placement-reason')).toBeNull();
    act(() => t.handle.setPlacementHint('Te weinig scrap'));
    press('Escape');
    act(() => t.handle.setPlacementHint('Te weinig scrap')); // no placement any more: ignored
    expect(t.el.querySelector('.co-placement-reason')).toBeNull();
  });

  it('showHint toont een korte melding die vanzelf verdwijnt', () => {
    vi.useFakeTimers();
    try {
      const t = setup();
      mounted = t.handle;
      act(() => t.handle.showHint('Buiten bereik'));
      expect(t.el.querySelector('.co-hint')?.textContent).toBe('Buiten bereik');
      act(() => void vi.advanceTimersByTime(3000));
      expect(t.el.querySelector('.co-hint')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('Escape annuleert de plaatsing en meldt endPlacement', () => {
    const t = setup();
    mounted = t.handle;
    press('b');
    press('1');
    expect(t.el.textContent).toContain('Plaats Hut');
    press('Escape');
    expect(t.calls.endPlacement).toBe(1);
    expect(t.handle.completePlacement({ x: 0, y: 0 })).toBe(false);
    expect(t.sent).toEqual([]);
  });

  it('plaatsing stopt als de bouwers uit de selectie verdwijnen', () => {
    const t = setup();
    mounted = t.handle;
    press('b');
    press('1');
    t.state.selection = [unit(9, 'militia')];
    act(() => t.handle.refresh());
    expect(t.calls.endPlacement).toBe(1);
    expect(t.handle.completePlacement({ x: 0, y: 0 })).toBe(false);
  });
});

describe('held-paneel en perks', () => {
  const heroStatus = { ...baseStatus, hero };

  it('toont level, xp-balk en SPECIAL', () => {
    const t = setup({}, { status: heroStatus });
    mounted = t.handle;
    const panel = t.el.querySelector('[aria-label="Held"]');
    expect(panel?.textContent).toContain('Krijger');
    expect(panel?.textContent).toContain('level 3');
    expect(t.el.querySelectorAll('.co-special li')).toHaveLength(7);
    expect(panel?.querySelector('[role="meter"]')?.getAttribute('aria-valuenow')).toBe('50');
    expect(t.el.querySelector('[data-action="perks"]')).toBeNull();
  });

  it('zonder held geen paneel', () => {
    const t = setup();
    mounted = t.handle;
    expect(t.el.querySelector('[aria-label="Held"]')).toBeNull();
  });

  it('level-up: kies een perk via klik; reeds gekozen perks ontbreken', () => {
    const t = setup({}, { status: heroStatus, pendingPerks: 1 });
    mounted = t.handle;
    expect(t.el.querySelector('[data-perk]')).toBeNull(); // the panel opens from the badge
    click(t.el.querySelector('[data-action="perks"]'));
    const btns = t.el.querySelectorAll('[data-perk]');
    expect([...btns].map((b) => b.getAttribute('data-perk'))).toEqual(['11', '12']);
    click(t.el.querySelector('[data-perk="12"]'));
    expect(t.sent).toEqual([{ type: 'PickPerk', payload: { heroId: 77, perkId: 12 } }]);
    t.sent.forEach(expectValid);
  });

  it('F1 kiest de eerste perk', () => {
    const t = setup({}, { status: heroStatus, pendingPerks: 1 });
    mounted = t.handle;
    press('F1');
    expect(t.sent).toEqual([{ type: 'PickPerk', payload: { heroId: 77, perkId: 11 } }]);
  });

  it('het heldpaneel staat er altijd en H verbergt het niet; zonder pending perks stuurt F1 niets', () => {
    const t = setup({}, { status: heroStatus });
    mounted = t.handle;
    press('F1');
    expect(t.sent).toEqual([]);
    press('h');
    expect(t.el.querySelector('[aria-label="Held"]')).not.toBeNull();
    expect(t.el.querySelector('[data-action="hero"]')).toBeNull();
  });
});

describe('minimap', () => {
  const clickAt = (t: ReturnType<typeof setup>, fx: number, fy: number): void => {
    const c = t.el.querySelector('canvas') as HTMLCanvasElement;
    c.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 200,
      height: 200,
      right: 200,
      bottom: 200,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    act(
      () =>
        void c.dispatchEvent(
          new MouseEvent('click', { bubbles: true, clientX: fx * 200, clientY: fy * 200 }),
        ),
    );
  };

  it('klik verplaatst de camera in sim-eenheden', () => {
    const t = setup();
    mounted = t.handle;
    clickAt(t, 0.5, 0.25);
    expect(t.calls.focus).toEqual([[1280, 640]]);
  });

  it('klik in targeting-modus voltooit het doel in plaats van de camera te verplaatsen', () => {
    const t = setup();
    mounted = t.handle;
    press('m');
    clickAt(t, 1, 0);
    expect(t.calls.focus).toEqual([]);
    expect(t.sent).toEqual([{ type: 'Move', payload: { ids: [5, 6], x: 2560, y: 0 } }]);
    t.sent.forEach(expectValid);
  });

  it('klik in gather-targeting (geen punt-doel) valt terug op de camera', () => {
    const t = setup();
    mounted = t.handle;
    press('t');
    clickAt(t, 0, 0);
    expect(t.calls.focus).toEqual([[0, 0]]);
    expect(t.sent).toEqual([]);
  });

  it('de minimap staat er altijd (geen knop, N doet niets); zonder dep geen minimap', () => {
    const t = setup();
    mounted = t.handle;
    press('n');
    expect(t.el.querySelector('canvas')).not.toBeNull();
    expect(t.el.querySelector('[data-action="minimap"]')).toBeNull();
    t.handle.unmount();
    mounted = null;
    const t2 = setup({}, { noMinimap: true });
    mounted = t2.handle;
    expect(t2.el.querySelector('canvas')).toBeNull();
  });
});

describe('waarschuwingen', () => {
  it('toont een toast per soort en focust de locatie bij klik', () => {
    const t = setup();
    mounted = t.handle;
    t.alert({ kind: 'attack', x: 100, y: 200 });
    t.alert({ kind: 'settlerLost', x: 300, y: 400 });
    t.alert({ kind: 'claimLost', x: 500, y: 600 });
    const toasts = [...t.el.querySelectorAll('[data-alert]')];
    expect(toasts.map((e) => e.getAttribute('data-alert'))).toEqual([
      'attack',
      'settlerLost',
      'claimLost',
    ]);
    click(toasts[1] ?? null);
    expect(t.calls.focus).toEqual([[300, 400]]);
  });

  it('Spatie springt naar de laatste waarschuwing', () => {
    const t = setup();
    mounted = t.handle;
    press(' ');
    expect(t.calls.focus).toEqual([]);
    t.alert({ kind: 'attack', x: 1, y: 2 });
    t.alert({ kind: 'claimLost', x: 3, y: 4 });
    press(' ');
    expect(t.calls.focus).toEqual([[3, 4]]);
  });

  it('verloopt na 6 s, kan gesloten worden en de stapel is begrensd', () => {
    vi.useFakeTimers();
    const t = setup();
    mounted = t.handle;
    t.alert({ kind: 'attack', x: 1, y: 1 });
    expect(t.el.querySelectorAll('[data-alert]')).toHaveLength(1);
    act(() => void vi.advanceTimersByTime(6100));
    expect(t.el.querySelectorAll('[data-alert]')).toHaveLength(0);
    for (let i = 0; i < 6; i++) t.alert({ kind: 'attack', x: i, y: i });
    expect(t.el.querySelectorAll('[data-alert]')).toHaveLength(4);
    click(t.el.querySelector('.co-toast-close'));
    expect(t.el.querySelectorAll('[data-alert]')).toHaveLength(3);
  });

  it('meldt zich af bij unmount', () => {
    const unsub = vi.fn();
    const t = setup({ subscribeAlerts: () => unsub });
    t.handle.unmount();
    expect(unsub).toHaveBeenCalled();
  });
});

describe('lobby', () => {
  it('toont spelers met AI-vlag en ready; R en O werken voor de host', () => {
    const lobby: LobbyView = {
      players: [
        { playerId: 0, name: 'Jij', ai: false, ready: true },
        { playerId: 1, name: 'Bot', ai: true, ready: true },
      ],
      hostId: 0,
      you: 0,
    };
    const toggleReady = vi.fn();
    const openHostSettings = vi.fn();
    const t = setup({ getLobby: () => lobby, toggleReady, openHostSettings });
    mounted = t.handle;
    expect(t.el.querySelector('[aria-label="Lobby"]')).toBeNull();
    press('l');
    const panel = t.el.querySelector('[aria-label="Lobby"]');
    expect(panel?.textContent).toContain('AI');
    expect(panel?.textContent).toContain('klaar');
    press('r');
    press('o');
    expect(toggleReady).toHaveBeenCalledOnce();
    expect(openHostSettings).toHaveBeenCalledOnce();
  });
});

describe('prestatie', () => {
  it('HUD-render met 50 geselecteerde units blijft onder 2 ms', () => {
    const sel = Array.from({ length: 50 }, (_, i) => unit(i, i % 3 === 0 ? 'builder' : 'militia'));
    const t = setup({}, { selection: sel, status: { ...baseStatus, hero }, pendingPerks: 1 });
    mounted = t.handle;
    for (let i = 0; i < 20; i++) act(() => t.handle.refresh()); // warm-up
    const n = 100;
    const times: number[] = [];
    for (let i = 0; i < n; i++) {
      t.state.selection = sel.map((s) => ({ ...s, hpPct: (s.hpPct + i) % 100 })); // elke ronde andere data
      const t0 = performance.now();
      act(() => t.handle.refresh());
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    const median = times[Math.floor(n / 2)] ?? Infinity;
    expect(median).toBeLessThan(renderBudgetMs());
  });
});
