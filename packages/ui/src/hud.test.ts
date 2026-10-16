import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'preact/test-utils';
import { COMMAND_PAYLOADS, CommandEnvelope } from '@crawlout/protocol';
import type { CommandType, PlayerStatus } from '@crawlout/protocol';
import { mountHud } from './index.js';
import type { HudDeps, HudHandle, NetworkState, SelectedEntity, TargetingKind } from './types.js';

const status: PlayerStatus = {
  playerId: 0,
  scrap: 120,
  settlers: 7,
  pop: 9,
  popCap: 12,
  beds: 10,
  hero: null,
  queue: [],
  dominance: { pointsHeld: 0, pointsRequired: 2, ticksHeld: 0, ticksRequired: 9600, leader: null },
  robotPop: 0,
  trained: [0, 0, 0, 0, 0, 0, 0],
};
const unit = (id: number, role: SelectedEntity['role'] = 'scavenger'): SelectedEntity => ({
  id,
  typeId: 3,
  loadoutName: 'Knuppel',
  hpPct: 80,
  role,
});

interface Sent {
  type: CommandType;
  payload: unknown;
}

function setup(opts: { selection?: SelectedEntity[]; network?: NetworkState } = {}) {
  const sent: Sent[] = [];
  const targeting: TargetingKind[] = [];
  const state = {
    selection: opts.selection ?? [unit(5), unit(6)],
    network: opts.network ?? { desync: null, stall: null },
    status: status as PlayerStatus | null,
  };
  const deps: HudDeps = {
    sendCommand: (type, payload) => void sent.push({ type, payload }),
    getStatus: () => state.status,
    getSelection: () => state.selection,
    getNetwork: () => state.network,
    playerName: (id) => ['Jij', 'Rik'][id] ?? `P${id}`,
    beginTargeting: (k) => void targeting.push(k),
  };
  const el = document.createElement('div');
  document.body.appendChild(el);
  let handle!: HudHandle;
  act(() => {
    handle = mountHud(el, deps);
  });
  return { el, sent, targeting, state, handle };
}

/** Elke verzonden payload moet als volledig commando door het protocol-schema komen. */
function expectValid(s: Sent): void {
  expect(COMMAND_PAYLOADS[s.type].safeParse(s.payload).success).toBe(true);
  const env = CommandEnvelope.safeParse({
    frame: 0,
    playerId: 0,
    seq: 0,
    type: s.type,
    payload: s.payload,
  });
  expect(env.success).toBe(true);
}

const press = (key: string): void => {
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
};

let mounted: HudHandle | null = null;
beforeEach(() => {
  document.body.innerHTML = '';
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('tellers', () => {
  it('toont scrap, bewoners, pop/popCap en bedden', () => {
    const t = setup();
    mounted = t.handle;
    const text = t.el.querySelector('[aria-label="Voorraad en bewoners"]')?.textContent ?? '';
    expect(text).toContain('120');
    expect(text).toContain('7');
    expect(text).toContain('9/12');
    expect(text).toContain('10');
  });

  it('toont een streepje zonder status en werkt bij na refresh', () => {
    const t = setup();
    mounted = t.handle;
    t.state.status = null;
    act(() => t.handle.refresh());
    expect(t.el.querySelector('[aria-label="Voorraad en bewoners"]')?.textContent).toContain('–');
    t.state.status = { ...status, scrap: 999 };
    act(() => t.handle.refresh());
    expect(t.el.textContent).toContain('999');
  });
});

describe('sneltoetsen', () => {
  it('Stop (S) stuurt Stop met geldig payload', () => {
    const t = setup();
    mounted = t.handle;
    press('s');
    expect(t.sent).toEqual([{ type: 'Stop', payload: { ids: [5, 6] } }]);
    t.sent.forEach(expectValid);
  });

  it.each([
    ['2', 'builder'],
    ['3', 'militia'],
  ])('toets %s zet rol %s (plunderaars hebben nog een andere rol nodig)', (key, role) => {
    const t = setup();
    mounted = t.handle;
    press(key);
    expect(t.sent).toEqual([{ type: 'SetRole', payload: { ids: [5, 6], role } }]);
    t.sent.forEach(expectValid);
  });

  it('een rol die iedereen al heeft staat niet op de kaart en stuurt niets', () => {
    const t = setup();
    mounted = t.handle;
    expect(t.el.querySelector('[data-action="roleScavenger"]')).toBeNull();
    press('1');
    expect(t.sent).toEqual([]);
  });

  it('SetRole gaat alleen naar bewoners die de rol nog niet hebben', () => {
    const t = setup({ selection: [unit(5, 'scavenger'), unit(6, 'builder'), unit(7, 'militia')] });
    mounted = t.handle;
    press('2');
    expect(t.sent).toEqual([{ type: 'SetRole', payload: { ids: [5, 7], role: 'builder' } }]);
  });

  it.each([
    ['m', 'move', 'Move'],
    ['a', 'attackMove', 'AttackMove'],
  ] as const)('toets %s start targeting en de wereldklik stuurt %s', (key, kind, type) => {
    const t = setup({ selection: [unit(5, 'militia'), unit(6, 'militia')] });
    mounted = t.handle;
    press(key);
    expect(t.targeting).toEqual([kind]);
    expect(t.sent).toEqual([]);
    let ok = false;
    act(() => {
      ok = t.handle.completeTargeting({ x: 1280.4, y: -512 });
    });
    expect(ok).toBe(true);
    expect(t.sent).toEqual([{ type, payload: { ids: [5, 6], x: 1280, y: -512 } }]);
    t.sent.forEach(expectValid);
    // Targeting is verbruikt.
    expect(t.handle.completeTargeting({ x: 0, y: 0 })).toBe(false);
  });

  it('G start gather-targeting en een node-klik stuurt Gather', () => {
    const t = setup();
    mounted = t.handle;
    press('g');
    expect(t.targeting).toEqual(['gather']);
    act(() => void t.handle.completeTargeting({ x: 1, y: 1 })); // verkeerd soort doel
    expect(t.sent).toEqual([]);
    act(() => void t.handle.completeTargeting({ nodeId: 42 }));
    expect(t.sent).toEqual([{ type: 'Gather', payload: { ids: [5, 6], nodeId: 42 } }]);
    t.sent.forEach(expectValid);
  });

  it('Escape annuleert targeting', () => {
    const t = setup();
    mounted = t.handle;
    press('m');
    press('Escape');
    expect(t.handle.completeTargeting({ x: 0, y: 0 })).toBe(false);
    expect(t.sent).toEqual([]);
  });

  it("commando's zonder selectie worden niet gestuurd", () => {
    const t = setup({ selection: [] });
    mounted = t.handle;
    press('s');
    press('1');
    press('m');
    expect(t.sent).toEqual([]);
    expect(t.targeting).toEqual([]);
  });

  it('begrenst ids op MAX_ENTITIES_PER_COMMAND', () => {
    const t = setup({ selection: Array.from({ length: 80 }, (_, i) => unit(i)) });
    mounted = t.handle;
    press('s');
    expect((t.sent[0]?.payload as { ids: number[] }).ids).toHaveLength(64);
    t.sent.forEach(expectValid);
  });

  it('negeert toetsen met modifier en in invoervelden', () => {
    const t = setup();
    mounted = t.handle;
    act(
      () => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true })),
    );
    const input = document.createElement('input');
    document.body.appendChild(input);
    act(() => void input.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true })));
    expect(t.sent).toEqual([]);
  });

  it('knopklik werkt en B opent het bouwmenu-placeholder', () => {
    const t = setup({ selection: [unit(5, 'builder'), unit(6, 'builder')] });
    mounted = t.handle;
    act(() => (t.el.querySelector('[data-action="stop"]') as HTMLButtonElement).click());
    expect(t.sent[0]?.type).toBe('Stop');
    press('b');
    expect(t.el.querySelector('[aria-label="Bouwmenu"]')).not.toBeNull();
    expect(t.sent).toHaveLength(1);
  });

  it('knoppen hebben aria-labels', () => {
    const t = setup();
    mounted = t.handle;
    const buttons = [...t.el.querySelectorAll('button')];
    expect(buttons.length).toBeGreaterThan(0);
    for (const b of buttons) expect(b.getAttribute('aria-label')).toBeTruthy();
  });
});

describe('selectiepaneel', () => {
  it('toont één unit uitgebreid en meerdere als raster', () => {
    const one = setup({ selection: [unit(1, 'builder')] });
    expect(one.el.querySelector('.co-selection')?.textContent).toContain('Loadout: Knuppel');
    expect(one.el.querySelector('.co-selection')?.textContent).toContain('Bouwer');
    one.handle.unmount();
    const many = setup();
    mounted = many.handle;
    expect(many.el.querySelectorAll('.co-cell')).toHaveLength(2);
  });
});

describe('opgeven', () => {
  it('vraagt bevestiging en stuurt pas na Ja', () => {
    const t = setup();
    mounted = t.handle;
    act(() => (t.el.querySelector('[aria-label="Opgeven"]') as HTMLButtonElement).click());
    expect(t.sent).toEqual([]);
    expect(t.el.querySelector('[role="alertdialog"]')).not.toBeNull();
    act(() => (t.el.querySelector('[aria-label="Ja, opgeven"]') as HTMLButtonElement).click());
    expect(t.sent).toEqual([{ type: 'Surrender', payload: {} }]);
    t.sent.forEach(expectValid);
    expect(t.el.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it('Nee en Escape sturen niets', () => {
    const t = setup();
    mounted = t.handle;
    act(() => (t.el.querySelector('[aria-label="Opgeven"]') as HTMLButtonElement).click());
    act(() => (t.el.querySelector('[aria-label="Nee, doorspelen"]') as HTMLButtonElement).click());
    act(() => (t.el.querySelector('[aria-label="Opgeven"]') as HTMLButtonElement).click());
    press('Escape');
    expect(t.el.querySelector('[role="alertdialog"]')).toBeNull();
    expect(t.sent).toEqual([]);
  });
});

describe('netwerkmeldingen', () => {
  it('toont de desync-melding', () => {
    const t = setup({
      network: { desync: { frame: 240, hashes: { '0': 1, '1': 2 } }, stall: null },
    });
    mounted = t.handle;
    const alert = t.el.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('Desync');
    expect(alert?.textContent).toContain('240');
  });

  it('toont wachten op speler X bij een stall en verbergt het daarna', () => {
    const t = setup({ network: { desync: null, stall: { waitingFor: [1] } } });
    mounted = t.handle;
    expect(t.el.querySelector('.co-stall')?.textContent).toContain('wachten op Rik');
    t.state.network = { desync: null, stall: null };
    act(() => t.handle.refresh());
    expect(t.el.querySelector('.co-stall')).toBeNull();
    expect(t.el.querySelector('[role="alert"]')).toBeNull();
  });

  it('pollt de deps zonder subscribe', () => {
    vi.useFakeTimers();
    try {
      const t = setup();
      mounted = t.handle;
      t.state.status = { ...status, scrap: 55 };
      act(() => void vi.advanceTimersByTime(300));
      expect(t.el.textContent).toContain('55');
    } finally {
      vi.useRealTimers();
    }
  });
});
