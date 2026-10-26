import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'preact/test-utils';
import type { PlayerStatus } from '@crawlout/protocol';
import { mountHud } from './index.js';
import { HUD_CSS } from './styles.js';
import { HUD_SCALE } from './units.js';
import { portraitOfEntity, portraitOfGroup } from './portraits.js';
import type { BuildingButton, HudDeps, HudHandle, RosterGroup, SelectedEntity } from './index.js';

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
      { id: 11, hpPct: 100, activity: 'gathering', x: 1000, y: 2000 },
      { id: 12, hpPct: 60, activity: 'idle', x: 3000, y: 4000 },
    ],
  },
];

const buildings: BuildingButton[] = [
  {
    key: 'werkplaats',
    naam: 'Werkplaats',
    sites: [{ id: 50, x: 100, y: 200, available: 1, running: 0 }],
    available: 1,
    running: 0,
  },
  {
    key: 'trainingsfaciliteit',
    naam: 'Training',
    sites: [{ id: 60, x: 300, y: 400, available: 1, running: 0 }],
    available: 1,
    running: 0,
  },
];

function setup(over: Partial<HudDeps> = {}, withLists = true) {
  let selection: SelectedEntity[] = [];
  const selects: number[][] = [];
  const focus: [number, number][] = [];
  const deps: HudDeps = {
    sendCommand: () => undefined,
    getStatus: () => status,
    getSelection: () => selection,
    beginTargeting: () => undefined,
    startCard: () => undefined,
    ...(withLists
      ? {
          getRoster: () => roster,
          getBuildingButtons: () => buildings,
          selectUnits: (ids: readonly number[]) => {
            selects.push([...ids]);
            selection = ids.map((id) => ({
              id,
              typeId: 1,
              loadoutName: 'Plunderaar',
              hpPct: 80,
              role: 'scavenger' as const,
            }));
          },
          focusCamera: (x: number, y: number) => void focus.push([x, y]),
        }
      : {}),
    ...over,
  };
  const el = document.createElement('div');
  document.body.appendChild(el);
  let handle!: HudHandle;
  act(() => {
    handle = mountHud(el, deps);
  });
  return { el, handle, selects, focus };
}

const btn = (el: HTMLElement, id: string, within = ''): HTMLButtonElement =>
  el.querySelector<HTMLButtonElement>(`${within} [data-console="${id}"]`.trim())!;
const click = (el: Element | null): void =>
  void act(() => void el!.dispatchEvent(new MouseEvent('click', { bubbles: true })));

let mounted: HudHandle | null = null;
beforeEach(() => {
  document.body.innerHTML = '';
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('zijconsole en rechterconsole', () => {
  it('heeft vijf platen links en vijf sleutelplaten rechts, elk met een aria-label', () => {
    const t = setup();
    mounted = t.handle;
    const side = [...t.el.querySelectorAll('.co-sidebar .co-side-btn')];
    const keys = [...t.el.querySelectorAll('.co-console .co-key-plate')];
    expect(side.map((b) => b.getAttribute('data-console'))).toEqual([
      'hero',
      'building',
      'idle',
      'build',
      'lobby',
    ]);
    expect(keys.map((b) => b.textContent)).toEqual(['SKL', 'INV', 'CHR', 'PIP', 'MNU']);
    for (const b of [...side, ...keys]) expect(b.getAttribute('aria-label')).toBeTruthy();
  });

  it('VRIJ selecteert de volgende eenheid zonder taak en zet de camera erop', () => {
    const t = setup();
    mounted = t.handle;
    click(btn(t.el, 'idle', '.co-sidebar'));
    expect(t.selects).toEqual([[12]]);
    expect(t.focus).toEqual([[3000, 4000]]);
  });

  it('GEBOUWEN loopt door de gebouwen met een taak', () => {
    const t = setup();
    mounted = t.handle;
    click(btn(t.el, 'building', '.co-sidebar'));
    click(btn(t.el, 'building', '.co-sidebar'));
    click(btn(t.el, 'building', '.co-sidebar'));
    expect(t.selects).toEqual([[50], [60], [50]]);
    expect(t.focus[0]).toEqual([100, 200]);
  });

  it('CHR selecteert de trainingsfaciliteit', () => {
    const t = setup();
    mounted = t.handle;
    click(btn(t.el, 'training', '.co-console'));
    expect(t.selects).toEqual([[60]]);
  });

  it('een knop die nu niets kan doen zegt waarom, in plaats van niets te doen', () => {
    const t = setup({}, false);
    mounted = t.handle;
    // No roster, no buildings, no lobby, no perk, no alert: every button explains itself.
    const expected: Record<string, string> = {
      idle: 'Alle eenheden hebben een taak.',
      building: 'Je hebt nog geen gebouw met een taak.',
      lobby: 'Er is geen lobby in dit potje.',
      perks: 'Je hebt geen perk om te kiezen.',
      craft: 'Selecteer een bewoner om uit te rusten.',
      training: 'Je hebt nog geen trainingsfaciliteit.',
      alert: 'Er is geen alarm om naartoe te gaan.',
      build: 'Selecteer eerst een bouwer om te bouwen.',
    };
    for (const [id, text] of Object.entries(expected)) {
      const b = btn(t.el, id);
      expect(b.getAttribute('aria-disabled')).toBe('true');
      click(b);
      expect(t.el.querySelector('.co-hint')?.textContent).toBe(text);
    }
  });

  it('MNU opent de opgeefbevestiging, niets wordt meteen gestuurd', () => {
    const sent: string[] = [];
    const t = setup({ sendCommand: (type) => void sent.push(type) });
    mounted = t.handle;
    click(btn(t.el, 'menu'));
    expect(t.el.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(sent).toEqual([]);
  });

  it('de console toont de geselecteerde eenheid: naam, gezondheid en portret', () => {
    const t = setup();
    mounted = t.handle;
    expect(t.el.querySelector('.co-con-portrait')?.getAttribute('data-portrait')).toBe('none');
    click(btn(t.el, 'idle', '.co-sidebar'));
    const con = t.el.querySelector('.co-console')!;
    expect(con.querySelector('.co-con-name')?.textContent).toBe('Plunderaar');
    expect(con.querySelector('.co-con-hp')?.textContent).toContain('80%');
    expect(con.querySelector('.co-con-portrait')?.getAttribute('data-portrait')).toBe('4');
    expect(con.querySelectorAll('.co-con-dots .co-lit')).toHaveLength(6);
  });
});

describe('eenhedenbalk als portretten', () => {
  it('elke groep heeft een portret en een kleurbalkje per toestand', () => {
    const t = setup();
    mounted = t.handle;
    const tile = t.el.querySelector('.co-roster-group')!;
    expect(tile.querySelector('.co-tile-portrait')?.getAttribute('data-portrait')).toBe(
      portraitOfGroup('scavenger'),
    );
    expect(
      [...tile.querySelectorAll('.co-tile-bar > i')].map((i) => i.getAttribute('data-state')),
    ).toEqual(['available', 'working']);
    expect(tile.textContent).toContain('1 vrij');
  });

  it('gebouwknoppen staan in een eigen strook boven de balk', () => {
    const t = setup();
    mounted = t.handle;
    expect(t.el.querySelector('.co-roster')?.className).toContain('co-roster-has-buildings');
    expect(t.el.querySelector('.co-building-buttons')).not.toBeNull();
  });
});

describe('portretten', () => {
  it('geeft rollen, de held en robots vaste portretten', () => {
    expect(portraitOfGroup('hero')).toBe('1');
    expect(portraitOfGroup('bouwer')).toBe('3');
    expect(portraitOfGroup('sentinel')).toBe('robot');
    expect(portraitOfGroup('iets_onbekends')).toBe(portraitOfGroup('iets_onbekends'));
    const e = (loadoutName: string, role: SelectedEntity['role'] = null): SelectedEntity => ({
      id: 1,
      typeId: 2,
      loadoutName,
      hpPct: 100,
      role,
    });
    expect(portraitOfEntity(e('x', 'militia'))).toBe('5');
    expect(portraitOfEntity(e('Reparatiedrone'))).toBe('robot');
    expect(portraitOfEntity(e('Technicus'))).toBe('2');
  });
});

describe('indeling in eenheden van het ontwerp', () => {
  it('legt de HUD uit in units van 1024x572, geschaald naar 15% van het scherm, en houdt tekst op minstens 11 px', () => {
    expect(HUD_CSS).toContain(
      `--u:calc(min(calc(100vh / 572), calc(100vw / 1024)) * var(--hud-scale, ${HUD_SCALE}))`,
    );
    expect(HUD_CSS).toContain('max(11px,');
    // The tallest bottom panel (the unit bar, 134 units of 572) stays within 15% of a 16:9 window.
    expect((134 * HUD_SCALE) / 572).toBeLessThanOrEqual(0.15);
  });

  it('geeft de kaarten genoeg breedte voor een hele naam en breekt niet middenin', () => {
    expect(HUD_CSS).toMatch(/\.co-card-name\{[^}]*hyphens:none/);
    expect(HUD_CSS).not.toContain('hyphens:auto');
    expect(HUD_CSS).toMatch(/\.co-card-list\{[^}]*minmax\(calc\(var\(--u\) \* 145\),1fr\)/);
  });
});
