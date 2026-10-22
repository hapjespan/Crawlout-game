import { describe, expect, it } from 'vitest';
import type { LobbyPlayer } from '@crawlout/protocol';
import {
  DEFAULT_DIFFICULTY,
  DIFFICULTY_CHOICES,
  GAME_TYPES,
  RANDOM_FACTION,
  cleanRoomCode,
  defaultRelayUrl,
  initialMenuState,
  randomRoomCode,
  reduceMenu,
  relayUrlError,
  type MenuAction,
  type MenuEnv,
  type MenuState,
} from './flow.js';
import { hostId, identifyYou, lobbyControls, lobbyRows, relayErrorText } from './lobbyModel.js';

const env = (random = 0): MenuEnv => ({
  random: () => random,
  factionKeys: ['dwellers', 'raiders'],
});
const form = { name: 'Rik', room: '', relayUrl: 'ws://localhost:8787' };
const fresh = (skipSplash = false): MenuState => {
  const state = initialMenuState({ skipSplash, factionKey: 'dwellers', form });
  // the menu tests below start on the main menu: the loading is done
  return skipSplash ? reduceMenu(state, { type: 'loaded' }, env()).state : state;
};

/** Applies actions in order and returns the last result. */
function play(actions: MenuAction[], start: MenuState = fresh(), e: MenuEnv = env()) {
  let state = start;
  let effect = null as ReturnType<typeof reduceMenu>['effect'];
  for (const a of actions) ({ state, effect } = reduceMenu(state, a, e));
  return { state, effect };
}

const p = (playerId: number, name: string, over: Partial<LobbyPlayer> = {}): LobbyPlayer => ({
  playerId,
  name,
  faction: 'dwellers',
  ready: false,
  online: true,
  ai: false,
  ...over,
});

describe('splash and main menu', () => {
  it('starts on the splash and only continues once everything is loaded', () => {
    expect(fresh().screen).toBe('splash');
    expect(play([{ type: 'continue' }]).state.screen).toBe('splash');
    const loaded = play([
      { type: 'progress', value: 0.4 },
      { type: 'loaded' },
      { type: 'continue' },
    ]);
    expect(loaded.state.screen).toBe('main');
  });

  it('progress only moves forward and stays between 0 and 1', () => {
    const s = play([
      { type: 'progress', value: 0.5, label: 'Terrein' },
      { type: 'progress', value: 0.2 },
      { type: 'progress', value: 7 },
    ]).state;
    expect(s.progress).toBe(1);
    expect(s.progressLabel).toBe('Terrein');
    expect(
      play([
        { type: 'progress', value: 0.5 },
        { type: 'progress', value: 0.2 },
      ]).state.progress,
    ).toBe(0.5);
  });

  it('a return from a match skips the key press but still waits for the loading', () => {
    const s = initialMenuState({ skipSplash: true, factionKey: 'dwellers', form });
    expect(s.screen).toBe('splash');
    expect(s.loaded).toBe(false);
    expect(play([{ type: 'continue' }], s).state.screen).toBe('splash');
    expect(play([{ type: 'progress', value: 0.5 }], s).state.screen).toBe('splash');
    expect(play([{ type: 'loaded' }], s).state.screen).toBe('main');
  });

  it('opens the sub screens from the main menu only, and back returns to the main menu', () => {
    expect(play([{ type: 'open', screen: 'ai' }]).state.screen).toBe('splash');
    expect(fresh(true).screen).toBe('main');
    for (const screen of ['ai', 'pvp', 'settings'] as const) {
      const open = play([{ type: 'open', screen }], fresh(true)).state;
      expect(open.screen).toBe(screen);
      expect(play([{ type: 'back' }], open).state.screen).toBe('main');
    }
    expect(play([{ type: 'back' }], fresh(true)).state.screen).toBe('main');
  });
});

describe('Tegen AI', () => {
  const ai = (...actions: MenuAction[]) =>
    play([{ type: 'open', screen: 'ai' }, ...actions], fresh(true));

  it('defaults to Skirmish, own faction dwellers and a random AI faction', () => {
    expect(ai().state.ai).toEqual({
      gameType: 'skirmish',
      faction: 'dwellers',
      hero: 'krijger',
      aiFaction: RANDOM_FACTION,
      // moeilijkheidsgraad (protocol 0.21.0): het middelste niveau zonder keuze
      difficulty: DEFAULT_DIFFICULTY,
    });
  });

  it('moeilijkheidsgraad (protocol 0.21.0): drie niveaus, de keuze gaat mee in de startconfig', () => {
    expect(DIFFICULTY_CHOICES.map((d) => d.id)).toEqual(['easy', 'normal', 'hard']);
    expect(ai({ type: 'ai/difficulty', id: 'hard' }).state.ai.difficulty).toBe('hard');
    // een onbekend niveau verandert niets
    expect(ai({ type: 'ai/difficulty', id: 'brutal' as never }).state.ai.difficulty).toBe(
      DEFAULT_DIFFICULTY,
    );
    const r = ai({ type: 'ai/difficulty', id: 'easy' }, { type: 'ai/start' });
    expect(r.effect).toMatchObject({ kind: 'startAi', config: { difficulty: 'easy' } });
  });

  it('hero choice (protocol 0.19.0): an archetype, kept across a faction change, into the start config', () => {
    const r = ai(
      { type: 'ai/hero', archetype: 'tacticus' },
      { type: 'ai/faction', key: 'raiders' },
      { type: 'ai/start' },
    );
    expect(r.state.ai.hero).toBe('tacticus');
    expect(r.effect).toMatchObject({ config: { faction: 'raiders', heroArchetype: 'tacticus' } });
    expect(ai({ type: 'ai/hero', archetype: 'held' as never }).state.ai.hero).toBe('krijger');
  });

  it('lists all three game types as playable', () => {
    expect(GAME_TYPES.map((g) => [g.id, g.available])).toEqual([
      ['skirmish', true],
      ['survival', true],
      ['build', true],
    ]);
  });

  it('starts a Survival co-op run and a Bouwproject (win route C)', () => {
    const sv = ai({ type: 'ai/gameType', id: 'survival' }, { type: 'ai/start' }).effect;
    expect(sv?.kind === 'startAi' && sv.config.gameType).toBe('survival');
    const e = ai({ type: 'ai/gameType', id: 'build' }, { type: 'ai/start' }).effect;
    expect(e?.kind).toBe('startAi');
    expect(e?.kind === 'startAi' && e.config.gameType).toBe('build');
  });

  it('takes only known factions', () => {
    expect(ai({ type: 'ai/faction', key: 'raiders' }).state.ai.faction).toBe('raiders');
    expect(ai({ type: 'ai/faction', key: 'garde' }).state.ai.faction).toBe('dwellers');
    expect(ai({ type: 'ai/aiFaction', key: 'garde' }).state.ai.aiFaction).toBe(RANDOM_FACTION);
  });

  it('starts a skirmish with the chosen factions', () => {
    const r = ai(
      { type: 'ai/faction', key: 'raiders' },
      { type: 'ai/aiFaction', key: 'dwellers' },
      { type: 'ai/start' },
    );
    expect(r.effect).toEqual({
      kind: 'startAi',
      config: {
        gameType: 'skirmish',
        faction: 'raiders',
        heroArchetype: 'krijger',
        aiFaction: 'dwellers',
        difficulty: DEFAULT_DIFFICULTY,
      },
    });
  });

  it('resolves "willekeurig" with the random source when the match starts', () => {
    const low = play([{ type: 'open', screen: 'ai' }, { type: 'ai/start' }], fresh(true), env(0));
    const high = play(
      [{ type: 'open', screen: 'ai' }, { type: 'ai/start' }],
      fresh(true),
      env(0.99),
    );
    expect(low.effect).toMatchObject({ config: { aiFaction: 'dwellers' } });
    expect(high.effect).toMatchObject({ config: { aiFaction: 'raiders' } });
  });

  it('does not start from another screen', () => {
    expect(play([{ type: 'ai/start' }], fresh(true)).effect).toBeNull();
  });
});

describe('Speler tegen speler', () => {
  const pvp = (...actions: MenuAction[]) =>
    play([{ type: 'open', screen: 'pvp' }, ...actions], fresh(true));

  it('refuses an empty name, a bad relay address and joining without a code, in Dutch', () => {
    const noName = pvp(
      { type: 'pvp/form', patch: { name: '  ' } },
      { type: 'pvp/connect', create: true },
    );
    expect(noName.effect).toBeNull();
    expect(noName.state.pvp.formError).toBe('Vul een naam in.');
    const badUrl = pvp(
      { type: 'pvp/form', patch: { relayUrl: 'http://localhost:8787' } },
      { type: 'pvp/connect', create: true },
    );
    expect(badUrl.state.pvp.formError).toBe('Het relay-adres moet met ws:// of wss:// beginnen.');
    const noRoom = pvp({ type: 'pvp/connect', create: false });
    expect(noRoom.state.pvp.formError).toBe('Vul een kamercode in om te joinen.');
    expect(noRoom.state.pvp.phase).toBe('form');
  });

  it('creates a room with a random code and asks the client to connect', () => {
    const r = pvp({ type: 'pvp/connect', create: true });
    expect(r.state.pvp.phase).toBe('lobby');
    expect(r.state.pvp.link).toBe('connecting');
    expect(r.effect).toEqual({
      kind: 'connect',
      config: { name: 'Rik', roomId: 'AAAAA', relayUrl: 'ws://localhost:8787', created: true },
    });
  });

  it('joins the typed code (cleaned) and trims the name', () => {
    const r = pvp(
      { type: 'pvp/form', patch: { room: ' k7 m2!? ', name: ' Els ' } },
      { type: 'pvp/connect', create: false },
    );
    expect(r.effect).toEqual({
      kind: 'connect',
      config: { name: 'Els', roomId: 'k7m2', relayUrl: 'ws://localhost:8787', created: false },
    });
  });

  it('knows which row is "you" and who is the host once the lobby arrives', () => {
    const r = pvp({ type: 'pvp/connect', create: false });
    expect(r.state.pvp.formError).not.toBeNull();
    const s = pvp(
      { type: 'pvp/form', patch: { room: 'ABC' } },
      { type: 'pvp/connect', create: false },
      { type: 'pvp/link', status: 'up' },
      { type: 'pvp/lobby', roomId: 'ABC', map: 'rustbelt', players: [p(0, 'Anna'), p(1, 'Rik')] },
    ).state;
    expect(s.pvp.lobby?.youId).toBe(1);
    expect(s.pvp.link).toBe('up');
  });

  it('takes "you" from the lobby message over the name match', () => {
    const s = pvp(
      { type: 'pvp/form', patch: { room: 'ABC', name: 'Rik' } },
      { type: 'pvp/connect', create: false },
      // by name the own row would be 1; the relay says 0
      {
        type: 'pvp/lobby',
        roomId: 'ABC',
        map: 'rustbelt',
        players: [p(0, 'Anna'), p(1, 'Rik')],
        you: 0,
      },
    ).state;
    expect(s.pvp.lobby?.youId).toBe(0);
  });

  it('keeps the id it found for "you" when the lobby changes', () => {
    const s = pvp(
      { type: 'pvp/form', patch: { room: 'ABC' } },
      { type: 'pvp/connect', create: false },
      { type: 'pvp/lobby', roomId: 'ABC', map: 'rustbelt', players: [p(0, 'Rik')] },
      { type: 'pvp/lobby', roomId: 'ABC', map: 'rustbelt', players: [p(0, 'Rik'), p(1, 'Rik 2')] },
    ).state;
    expect(s.pvp.lobby?.youId).toBe(0);
  });

  it('shows the connection state: down before it was ever up, and a relay error as a notice', () => {
    const s = pvp(
      { type: 'pvp/form', patch: { room: 'ABC' } },
      { type: 'pvp/connect', create: false },
      { type: 'pvp/link', status: 'down' },
      { type: 'pvp/error', message: 'room is vol' },
    ).state;
    expect(s.pvp.link).toBe('down');
    expect(s.pvp.everUp).toBe(false);
    expect(s.pvp.notice).toBe('De kamer is vol.');
  });

  it('back from the lobby leaves the relay and returns to the form; back from the form to the main menu', () => {
    const inLobby = pvp({ type: 'pvp/connect', create: true }).state;
    const left = play([{ type: 'back' }], inLobby);
    expect(left.effect).toEqual({ kind: 'leave' });
    expect(left.state.screen).toBe('pvp');
    expect(left.state.pvp.phase).toBe('form');
    expect(left.state.pvp.lobby).toBeNull();
    expect(play([{ type: 'back' }], left.state).state.screen).toBe('main');
  });

  it('ignores lobby messages when not in a lobby', () => {
    const s = pvp({
      type: 'pvp/lobby',
      roomId: 'X',
      map: 'rustbelt',
      players: [p(0, 'Rik')],
    }).state;
    expect(s.pvp.lobby).toBeNull();
  });
});

describe('room codes and the relay address', () => {
  it('makes five characters from an alphabet without look-alikes', () => {
    const codes = Array.from({ length: 200 }, (_, i) => randomRoomCode(() => (i * 0.00497) % 1));
    for (const c of codes) expect(c).toMatch(/^[A-HJKMNP-Z2-9]{5}$/);
    expect(randomRoomCode(() => 0.9999999)).toHaveLength(5);
  });

  it('cleans typed codes', () => {
    expect(cleanRoomCode('ab c-1_2!')).toBe('abc-1_2');
    expect(cleanRoomCode('x'.repeat(40))).toHaveLength(24);
  });

  it('defaults to the page host on port 8787, with wss on https', () => {
    expect(defaultRelayUrl({ protocol: 'http:', hostname: '192.168.1.5' })).toBe(
      'ws://192.168.1.5:8787',
    );
    expect(defaultRelayUrl({ protocol: 'https:', hostname: 'spel.example' })).toBe(
      'wss://spel.example:8787',
    );
    expect(defaultRelayUrl({ protocol: 'http:', hostname: '::1' })).toBe('ws://[::1]:8787');
    expect(defaultRelayUrl({ protocol: 'file:', hostname: '' })).toBe('ws://localhost:8787');
  });

  it('judges a relay address', () => {
    expect(relayUrlError('ws://localhost:8787')).toBeNull();
    expect(relayUrlError(' wss://relay.example/path ')).toBeNull();
    expect(relayUrlError('')).not.toBeNull();
    expect(relayUrlError('localhost:8787')).not.toBeNull();
    expect(relayUrlError('ws://')).not.toBeNull();
    expect(relayUrlError('ws://a b')).not.toBeNull();
  });
});

describe('lobby model', () => {
  it('recognises itself by name, also after the relay added a number', () => {
    expect(identifyYou([p(0, 'Rik')], 'Rik', null)).toBe(0);
    expect(identifyYou([p(0, 'Anna'), p(1, 'rik')], 'Rik', null)).toBe(1);
    // two players called Rik: the relay renamed the newcomer to "Rik 2"; each picks the highest suffix of its first message
    expect(identifyYou([p(0, 'Rik')], 'Rik', null)).toBe(0);
    expect(identifyYou([p(0, 'Rik'), p(1, 'Rik 2')], 'Rik', null)).toBe(1);
    expect(identifyYou([p(0, 'Rik'), p(1, 'Rik 2'), p(2, 'Rik 3')], 'Rik', null)).toBe(2);
    // later messages keep the id
    expect(identifyYou([p(0, 'Rik'), p(1, 'Rik 2'), p(2, 'Rik 3')], 'Rik', 0)).toBe(0);
    // the remembered row got another name: look again
    expect(identifyYou([p(0, 'Els'), p(1, 'Rik')], 'Rik', 0)).toBe(1);
    expect(identifyYou([p(0, 'Els')], 'Rik', null)).toBeNull();
    expect(identifyYou([p(0, 'Rik', { ai: true })], 'Rik', null)).toBeNull();
    expect(identifyYou([p(0, 'a.b'), p(1, 'axb')], 'a.b', null)).toBe(0);
  });

  it('names the lowest human the host and puts the rows in player order', () => {
    const rows = lobbyRows([p(2, 'Cor'), p(1, 'AI 2', { ai: true }), p(3, 'Dirk')], 3);
    expect(rows.map((r) => r.playerId)).toEqual([1, 2, 3]);
    expect(hostId([p(2, 'Cor'), p(1, 'AI 2', { ai: true })])).toBe(2);
    expect(rows.find((r) => r.host)?.name).toBe('Cor');
    expect(rows.find((r) => r.you)?.name).toBe('Dirk');
  });

  const controls = (
    players: LobbyPlayer[],
    you: number,
    link: 'connecting' | 'up' | 'down' = 'up',
  ) => lobbyControls(lobbyRows(players, you), 2, link);

  it('Survival co-op offers no AI slot and refuses to start with an AI in the room', () => {
    const solo = lobbyControls(lobbyRows([p(0, 'Rik')], 0), 4, 'up', 'survival');
    expect(solo.canAddAi).toBe(false);
    expect(solo.hint).toContain('Survival');
    const withAi = lobbyControls(
      lobbyRows([p(0, 'Rik'), p(1, 'AI 2', { ai: true })], 0),
      4,
      'up',
      'survival',
    );
    expect(withAi.actionEnabled).toBe(false);
    expect(withAi.canRemoveAi).toBe(true);
    const duo = lobbyControls(
      lobbyRows([p(0, 'Rik'), p(1, 'Els', { ready: true })], 0),
      4,
      'up',
      'survival',
    );
    expect(duo.actionEnabled).toBe(true);
  });

  it('waits for a second player, or offers an AI to the host', () => {
    const c = controls([p(0, 'Rik')], 0);
    expect(c.actionEnabled).toBe(false);
    expect(c.canAddAi).toBe(true);
    expect(c.hint).toContain('tweede speler');
  });

  it('the host starts only when the other humans are ready', () => {
    const waiting = controls([p(0, 'Rik'), p(1, 'Els')], 0);
    expect(waiting.actionLabel).toBe('Start potje');
    expect(waiting.actionEnabled).toBe(false);
    expect(waiting.hint).toContain('0 van 1');
    const ready = controls([p(0, 'Rik'), p(1, 'Els', { ready: true })], 0);
    expect(ready.actionEnabled).toBe(true);
    expect(ready.actionReady).toBe(true);
    expect(ready.canAddAi).toBe(false);
  });

  it('a guest toggles ready and cannot add an AI', () => {
    const guest = controls([p(0, 'Rik'), p(1, 'Els')], 1);
    expect(guest.actionLabel).toBe('Klaar');
    expect(guest.actionEnabled).toBe(true);
    expect(guest.isHost).toBe(false);
    expect(guest.canAddAi).toBe(false);
    const readyGuest = controls([p(0, 'Rik'), p(1, 'Els', { ready: true })], 1);
    expect(readyGuest.actionLabel).toBe('Niet meer klaar');
    expect(readyGuest.actionReady).toBe(false);
  });

  it('an AI counts as a player and as ready; the host can remove it', () => {
    const c = controls(
      [p(0, 'Rik'), p(1, 'AI 2', { ai: true, ready: true, faction: 'raiders' })],
      0,
    );
    expect(c.actionEnabled).toBe(true);
    expect(c.canRemoveAi).toBe(true);
    expect(c.canAddAi).toBe(false);
  });

  it('refuses a room with more players than the map holds, and disables everything without a connection', () => {
    const crowded = controls(
      [p(0, 'A'), p(1, 'B', { ready: true }), p(2, 'C', { ready: true })],
      0,
    );
    expect(crowded.actionEnabled).toBe(false);
    expect(crowded.hint).toContain('2 spelers');
    const down = controls([p(0, 'A'), p(1, 'B', { ready: true })], 0, 'down');
    expect(down.actionEnabled).toBe(false);
    expect(controls([p(0, 'A')], 5).me).toBeNull();
  });

  it('translates relay errors', () => {
    expect(relayErrorText('potje is al gestart')).toBe('Dit potje is al gestart.');
    expect(relayErrorText('iets anders')).toBe('iets anders');
  });
});
