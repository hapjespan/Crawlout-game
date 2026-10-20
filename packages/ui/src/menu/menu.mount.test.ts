import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'preact/test-utils';
import type { LobbyPlayer } from '@crawlout/protocol';
import { mountMatchEnd, mountMenu, type MenuDeps, type MenuMount } from '../index.js';
import { DEFAULT_SETTINGS } from './settings.js';

const content: MenuDeps['content'] = {
  factions: [
    { key: 'dwellers', name: 'Dwellers', subtitle: 'De Kluis', blurb: 'Snel.', hero: 'Opziener' },
    { key: 'raiders', name: 'Raiders', subtitle: 'De Horde', blurb: 'Zwermen.', hero: 'Warlord' },
  ],
  map: {
    id: 'rustbelt',
    name: 'Rustbelt XL',
    sizeLabel: '384 x 384 m',
    maxPlayers: 2,
    dominance: { pointsRequired: 3, minutes: 8 },
    minimap: { w: 2, h: 2, passable: new Uint8Array(4).fill(1), blips: [], claims: [] },
  },
  versionLabel: 'data 1',
};

let host: HTMLElement;
let calls: string[];
let menu: MenuMount;

function setup(over: Partial<MenuDeps> = {}) {
  calls = [];
  menu = mountMenu(host, {
    content,
    settings: DEFAULT_SETTINGS,
    skinAvailable: false,
    initialForm: { name: 'Rik', room: '', relayUrl: 'ws://localhost:8787' },
    startAi: (c) => calls.push(`ai:${c.faction}:${c.aiFaction}`),
    connect: (c) => calls.push(`connect:${c.name}:${c.roomId}:${c.relayUrl}`),
    leave: () => calls.push('leave'),
    lobbyRequest: (r) => calls.push(`lobby:${JSON.stringify(r)}`),
    onSettings: (s) => calls.push(`settings:${s.shadows}:${s.hudScale}`),
    reload: () => calls.push('reload'),
    random: () => 0.99,
    ...over,
  });
}

const key = (k: string) =>
  act(() => {
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }),
    );
  });
const click = (el: Element | null | undefined) =>
  act(() => {
    (el as HTMLElement).click();
  });
const q = (sel: string) => host.querySelector<HTMLElement>(sel);
const byText = (sel: string, text: string) =>
  [...host.querySelectorAll<HTMLElement>(sel)].find((e) => e.textContent?.includes(text));
const p = (id: number, name: string, over: Partial<LobbyPlayer> = {}): LobbyPlayer => ({
  playerId: id,
  name,
  faction: 'dwellers',
  ready: false,
  online: true,
  ai: false,
  ...over,
});

beforeEach(() => {
  document.head.innerHTML = '';
  host = document.createElement('div');
  document.body.replaceChildren(host);
});
afterEach(() => menu.unmount());

describe('splash', () => {
  it('shows the title and progress, and waits for the loading before a key counts', () => {
    setup();
    expect(q('.co-m-title')?.textContent).toBe('Crawlout');
    expect(q('.co-menu')?.getAttribute('lang')).toBe('nl');
    act(() => menu.setProgress(0.4, 'Terrein opbouwen'));
    expect(q('[role=progressbar]')?.getAttribute('aria-valuenow')).toBe('40');
    expect(host.textContent).toContain('Terrein opbouwen');
    expect(q('.co-m-press')).toBeNull();
    key('Enter');
    expect(menu.screen()).toBe('splash');
  });

  it('offers "Druk op een toets" once loaded; any key or a click goes to the main menu', () => {
    setup();
    act(() => menu.setLoaded());
    expect(q('.co-m-press')?.textContent).toContain('Druk op een toets');
    key('x');
    expect(menu.screen()).toBe('main');
    menu.unmount();
    setup();
    act(() => menu.setLoaded());
    click(q('.co-m-press'));
    expect(menu.screen()).toBe('main');
  });

  it('modifier keys do not leave the splash', () => {
    setup();
    act(() => menu.setLoaded());
    key('Shift');
    key('Tab');
    expect(menu.screen()).toBe('splash');
  });

  it('a return from a match goes on by itself once loaded', () => {
    setup({ skipSplash: true });
    expect(menu.screen()).toBe('splash');
    act(() => menu.setLoaded());
    expect(menu.screen()).toBe('main');
  });
});

describe('main menu and keyboard', () => {
  const toMain = () => {
    act(() => menu.setLoaded());
    key(' ');
  };

  it('has three choices with Dutch aria labels and digit shortcuts', () => {
    setup();
    toMain();
    const items = [...host.querySelectorAll('.co-m-item')];
    expect(items.map((i) => i.getAttribute('aria-label'))).toEqual([
      'Tegen AI, sneltoets 1',
      'Speler tegen speler, sneltoets 2',
      'Instellingen, sneltoets 3',
    ]);
    key('3');
    expect(menu.screen()).toBe('settings');
    key('Escape');
    expect(menu.screen()).toBe('main');
  });

  it('moves the focus with the arrow keys and wraps', () => {
    setup();
    document.body.appendChild(host);
    toMain();
    const items = [...host.querySelectorAll<HTMLElement>('.co-m-item')];
    items[0]!.focus();
    key('ArrowDown');
    expect(document.activeElement).toBe(items[1]);
    key('ArrowUp');
    key('ArrowUp');
    expect(document.activeElement).toBe(items[2]);
  });

  it('keeps keys away from the game behind it while visible, and gives them back when hidden', () => {
    setup();
    toMain();
    const seen: string[] = [];
    const spy = (e: Event) => seen.push((e as KeyboardEvent).key);
    window.addEventListener('keydown', spy);
    key('ArrowDown');
    expect(seen).toEqual([]);
    act(() => menu.hide());
    key('ArrowDown');
    expect(seen).toEqual(['ArrowDown']);
    window.removeEventListener('keydown', spy);
  });
});

describe('Tegen AI', () => {
  const toAi = () => {
    act(() => menu.setLoaded());
    key(' ');
    key('1');
  };

  it('chooses factions and starts; "willekeurig" resolves to a real faction', () => {
    setup();
    toAi();
    expect(q('#co-m-ai-title')?.textContent).toBe('Nieuw potje');
    expect(host.textContent).toContain('Rustbelt XL');
    expect(host.textContent).toContain('3 punten, 8 min');
    // all three game types are playable now (Survival co-op since ui 0.20.0)
    expect(host.querySelectorAll('.co-m-soon')).toHaveLength(0);
    click(byText('[role=radio]', 'Raiders'));
    click(byText('.co-btn', 'Start'));
    expect(calls).toEqual(['ai:raiders:raiders']);
  });

  it('arrow keys inside a group choose', () => {
    setup();
    toAi();
    document.body.appendChild(host);
    const group = host.querySelector('[role=radiogroup][aria-label="Speltype"]')!;
    const radios = [...group.querySelectorAll<HTMLElement>('[role=radio]')];
    radios[0]!.focus();
    act(() => {
      radios[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    expect(radios[1]!.getAttribute('aria-checked')).toBe('true');
    const factions = host.querySelector('[role=radiogroup][aria-label="Jouw factie"]')!;
    const f = [...factions.querySelectorAll<HTMLElement>('[role=radio]')];
    f[0]!.focus();
    act(() => {
      f[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    expect(f[1]!.getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(f[1]);
  });

  it('Escape goes back to the main menu', () => {
    setup();
    toAi();
    key('Escape');
    expect(menu.screen()).toBe('main');
  });
});

describe('Speler tegen speler', () => {
  const toPvp = () => {
    act(() => menu.setLoaded());
    key(' ');
    key('2');
  };
  const connect = () => {
    toPvp();
    click(byText('.co-btn', 'Nieuwe kamer'));
  };

  it('fills the form, refuses empty input and connects with the typed values', () => {
    setup();
    toPvp();
    const name = q('#co-m-name') as HTMLInputElement;
    expect(name.value).toBe('Rik');
    expect((q('#co-m-relay') as HTMLInputElement).value).toBe('ws://localhost:8787');
    click(byText('.co-btn', 'Kamer joinen'));
    expect(q('.co-m-status')?.textContent).toContain('kamercode');
    expect(calls).toEqual([]);
    act(() => {
      const room = q('#co-m-room') as HTMLInputElement;
      room.value = 'k7m2x';
      room.dispatchEvent(new Event('input', { bubbles: true }));
    });
    click(byText('.co-btn', 'Kamer joinen'));
    expect(calls).toEqual(['connect:Rik:k7m2x:ws://localhost:8787']);
  });

  it('shows the lobby with players, ready state and the host controls', () => {
    setup();
    connect();
    expect(calls[0]).toMatch(/^connect:Rik:[A-Z2-9]{5}:ws:/);
    expect(q('.co-m-status')?.textContent).toContain('Verbinden met');
    act(() => {
      menu.setLink('up');
      menu.setLobby('ROOM1', 'rustbelt', [p(0, 'Rik')]);
    });
    expect(q('.co-m-roomcode')?.textContent).toBe('99999');
    expect(q('.co-m-status')?.textContent).toContain('Verbonden');
    expect(q('.co-m-player[data-you]')?.textContent).toContain('Host');
    expect(byText('.co-btn', 'AI toevoegen')).toBeDefined();
    expect((byText('.co-btn', 'Start potje') as HTMLButtonElement).disabled).toBe(true);
    click(byText('.co-btn', 'AI toevoegen'));
    expect(calls.at(-1)).toBe('lobby:{"kind":"addAi","faction":"raiders"}');
    act(() => menu.setLobby('ROOM1', 'rustbelt', [p(0, 'Rik'), p(1, 'Els', { ready: true })]));
    const start = byText('.co-btn', 'Start potje') as HTMLButtonElement;
    expect(start.disabled).toBe(false);
    click(start);
    expect(calls.at(-1)).toBe('lobby:{"kind":"ready","ready":true}');
    // faction choice of this player
    click(byText('.co-m-player[data-you] [role=radio]', 'Raiders'));
    expect(calls.at(-1)).toBe('lobby:{"kind":"setFaction","faction":"raiders"}');
  });

  it('a guest has a Klaar toggle and no AI button; relay errors show in Dutch', () => {
    setup();
    connect();
    act(() => {
      menu.setLobby('ROOM1', 'rustbelt', [p(0, 'Anna'), p(1, 'Rik')]);
      menu.setError('room is vol');
    });
    expect(byText('.co-btn', 'Klaar')).toBeDefined();
    expect(byText('.co-btn', 'AI toevoegen')).toBeUndefined();
    expect(q('[role=alert]')?.textContent).toContain('De kamer is vol.');
  });

  it('reports a relay that cannot be reached and leaves the room on Terug', () => {
    setup();
    connect();
    act(() => menu.setLink('down'));
    expect(q('.co-m-status')?.getAttribute('data-tone')).toBe('bad');
    expect(q('.co-m-status')?.textContent).toContain('Geen verbinding');
    click(byText('.co-btn', 'Terug'));
    expect(calls.at(-1)).toBe('leave');
    expect(q('#co-m-name')).not.toBeNull();
  });
});

describe('settings', () => {
  const toSettings = () => {
    act(() => menu.setLoaded());
    key(' ');
    key('3');
  };

  it('reports every change, and offers a reload only for shadows and detail', () => {
    setup();
    toSettings();
    click(byText('[role=radio]', 'Extra groot'));
    expect(calls).toEqual(['settings:auto:xlarge']);
    expect(q('.co-m-reload')).toBeNull();
    click(byText('[role=radiogroup][aria-label="Schaduwkwaliteit"] [role=radio]', 'Uit'));
    expect(calls.at(-1)).toBe('settings:off:xlarge');
    expect(q('.co-m-reload')?.textContent).toContain('opnieuw laden');
    click(byText('.co-btn', 'Nu opnieuw laden'));
    expect(calls.at(-1)).toBe('reload');
  });

  it('hides the skin choice without local art and shows it with', () => {
    setup();
    toSettings();
    expect(host.textContent).not.toContain('Kunst van de ontwerper');
    menu.unmount();
    setup({ skinAvailable: true });
    toSettings();
    expect(host.textContent).toContain('Kunst van de ontwerper');
  });
});

describe('end of a match', () => {
  it('says Gewonnen or Verloren and offers the way back to the menu', () => {
    const end = document.createElement('div');
    document.body.appendChild(end);
    let back = 0;
    act(() => mountMatchEnd(end, { won: false, how: 'opgave', onMenu: () => back++ }));
    expect(end.textContent).toContain('Verloren');
    expect(end.textContent).toContain('door opgave');
    expect(end.querySelector('[role=alertdialog]')).not.toBeNull();
    click(end.querySelector('.co-btn'));
    expect(back).toBe(1);
    act(() =>
      mountMatchEnd(end, { won: false, how: '', survival: 'overrun', onMenu: () => back++ }),
    );
    expect(end.textContent).toContain('Overrompeld');
    expect(end.textContent).toContain('Alle hoofdkwartieren zijn gevallen');
    act(() =>
      mountMatchEnd(end, { won: true, how: '', survival: 'survived', onMenu: () => back++ }),
    );
    expect(end.textContent).toContain('Gewonnen');
    expect(end.textContent).toContain('laatste golf');
    act(() => mountMatchEnd(end, { won: true, how: 'dominantie', onMenu: () => back++ }));
    expect(end.textContent).toContain('Gewonnen');
  });
});

describe('type size', () => {
  it('never sets text under 11 px in the menu stylesheet', async () => {
    const { MENU_CSS } = await import('./styles.js');
    const sizes = [...MENU_CSS.matchAll(/font(?:-size)?:[^;}]*?(\d+(?:\.\d+)?)px/g)].map((m) =>
      Number(m[1]),
    );
    for (const s of sizes) expect(s).toBeGreaterThanOrEqual(11);
    // every menu font size goes through max(11px, ...)
    const fontSizes = [...MENU_CSS.matchAll(/font-size:([^;}]*)/g)].map((m) => m[1]!);
    for (const f of fontSizes) expect(f).toMatch(/max\(11px|max\(\d+px,/);
  });
});

describe('hero choice (protocol 0.18.0)', () => {
  const hero = (archetype: 'bouwer' | 'krijger' | 'tacticus', name: string) => ({
    archetype,
    name,
    role: archetype === 'bouwer' ? 'Bouwer · economie' : archetype,
    passive: `passief ${name}`,
    ability: `Ability ${name}`,
  });
  const withHeroes: MenuDeps['content'] = {
    ...content,
    factions: content.factions.map((f) => ({
      ...f,
      heroes: [
        hero('bouwer', `B-${f.key}`),
        hero('krijger', f.hero),
        hero('tacticus', `T-${f.key}`),
      ],
    })),
  };

  it('Tegen AI: three cards of the own faction, Krijger preselected; the choice goes into the start', () => {
    const started: string[] = [];
    setup({ content: withHeroes, startAi: (c) => started.push(`${c.faction}:${c.heroArchetype}`) });
    act(() => menu.setLoaded());
    key(' ');
    key('1');
    const group = () => host.querySelector('[role=radiogroup][aria-label="Jouw held"]')!;
    expect(group().querySelectorAll('[role=radio]')).toHaveLength(3);
    expect(group().querySelector('[aria-checked=true]')?.textContent).toContain('Opziener');
    expect(group().textContent).toContain('Bouwer · economie');
    click(byText('[role=radio]', 'Raiders'));
    expect(group().textContent).toContain('B-raiders');
    click(byText('[role=radiogroup][aria-label="Jouw held"] [role=radio]', 'T-raiders'));
    click(byText('.co-btn', 'Start'));
    expect(started).toEqual(['raiders:tacticus']);
  });

  it('lobby: the own hero choice sends setHero; other rows show their hero', () => {
    setup({ content: withHeroes });
    act(() => menu.setLoaded());
    key(' ');
    key('2');
    click(byText('.co-btn', 'Nieuwe kamer'));
    act(() => {
      menu.setLink('up');
      menu.setLobby('ROOM1', 'rustbelt', [
        p(0, 'Rik'),
        p(1, 'Els', { faction: 'raiders', heroArchetype: 'bouwer' }),
      ]);
    });
    expect(byText('.co-m-player', 'Els')?.textContent).toContain('held B-raiders');
    click(byText('[role=radiogroup][aria-label="Jouw held"] [role=radio]', 'T-dwellers'));
    expect(calls.at(-1)).toBe('lobby:{"kind":"setHero","heroArchetype":"tacticus"}');
  });

  it('without heroes in the content there is no hero choice', () => {
    setup();
    act(() => menu.setLoaded());
    key(' ');
    key('1');
    expect(host.querySelector('[aria-label="Jouw held"]')).toBeNull();
  });
});
