import { describe, it, expect } from 'vitest';
import { DELAY_FRAMES_MAX, DELAY_FRAMES_MIN } from '@crawlout/protocol';
import { harness, startTwo } from './sprint2.helpers.js';

describe('lobby: namen en facties', () => {
  const names = (h: ReturnType<typeof harness>, id: string) =>
    h
      .of(id, 'lobby')
      .at(-1)!
      .players.map((p) => p.name);

  it('maakt menselijke namen uniek in een room (Speler, Speler 2, Speler 3), hoofdletterongevoelig, binnen 32 tekens', () => {
    const h = harness();
    h.say('a', { kind: 'join', roomId: 'r', name: 'Speler' });
    h.say('b', { kind: 'join', roomId: 'r', name: 'speler' });
    h.say('c', { kind: 'join', roomId: 'r', name: 'Speler' });
    expect(names(h, 'a')).toEqual(['Speler', 'speler 2', 'Speler 3']);
    const long = 'x'.repeat(32);
    h.say('d', { kind: 'join', roomId: 'r', name: long });
    h.say('e', { kind: 'join', roomId: 'r', name: long });
    expect(names(h, 'a')[4]).toBe(`${'x'.repeat(30)} 2`);
    expect(names(h, 'a')[4]!.length).toBe(32);
  });

  it('elke verbinding krijgt in het lobby-bericht zijn eigen playerId als you, ook bij gelijke namen', () => {
    const h = harness();
    h.say('a', { kind: 'join', roomId: 'r', name: 'Speler' });
    h.say('b', { kind: 'join', roomId: 'r', name: 'Speler' });
    h.say('c', { kind: 'join', roomId: 'r', name: 'Speler' });
    h.say('a', { kind: 'addAi', faction: 'raiders' });
    for (const [conn, id] of [
      ['a', 0],
      ['b', 1],
      ['c', 2],
    ] as const) {
      const last = h.of(conn, 'lobby').at(-1)!;
      expect(last.you).toBe(id);
      expect(last.players.map((p) => p.name)).toEqual(['Speler', 'Speler 2', 'Speler 3', 'AI 4']);
    }
    // the same lobby content for everyone; only `you` differs
    const withoutYou = (conn: string) => ({ ...h.of(conn, 'lobby').at(-1)!, you: undefined });
    const fromA = withoutYou('a');
    const fromB = withoutYou('b');
    expect(fromA).toEqual(fromB);
  });

  it('een vrijgekomen naam is weer te gebruiken en een AI blokkeert geen menselijke naam', () => {
    const h = harness();
    h.say('a', { kind: 'join', roomId: 'r', name: 'AI 2' });
    h.say('a', { kind: 'addAi', faction: 'raiders' });
    h.say('b', { kind: 'join', roomId: 'r', name: 'AI 2' });
    expect(names(h, 'a')).toEqual(['AI 2', 'AI 2', 'AI 2 2']);
    h.room.disconnect('b');
    h.say('c', { kind: 'join', roomId: 'r', name: 'AI 2' });
    expect(names(h, 'a').at(-1)).toBe('AI 2 2');
  });

  it('een eigen factie per speler: setFaction komt in de lobby en in start, en vraagt opnieuw om ready', () => {
    const h = harness();
    h.say('a', { kind: 'join', roomId: 'r', name: 'A' });
    h.say('b', { kind: 'join', roomId: 'r', name: 'B' });
    h.say('b', { kind: 'setFaction', faction: 'raiders' });
    h.say('a', { kind: 'ready', ready: true });
    h.say('b', { kind: 'ready', ready: true });
    const start = h.of('a', 'start')[0]!;
    expect(start.players.map((p) => p.faction)).toEqual(['dwellers', 'raiders']);
    expect(h.of('b', 'start')[0]!.you).toBe(1);
  });

  it('held-keuze (protocol 0.18.0): setHero komt in lobby en start; zonder keuze geen veld', () => {
    const h = harness();
    h.say('a', { kind: 'join', roomId: 'r', name: 'A' });
    h.say('b', { kind: 'join', roomId: 'r', name: 'B' });
    h.say('a', { kind: 'setHero', heroArchetype: 'tacticus' });
    h.say('a', { kind: 'ready', ready: true });
    h.say('b', { kind: 'ready', ready: true });
    const start = h.of('b', 'start')[0]!;
    expect(start.players.map((p) => p.heroArchetype)).toEqual(['tacticus', undefined]);
  });
});

describe('instellingen en AI', () => {
  it('alleen de host zet settings; ze gaan mee in lobby en start, zonder defaultgetal voor dominanceMinutes', () => {
    const h = harness();
    h.say('a', { kind: 'join', roomId: 'r', name: 'A' });
    h.say('b', { kind: 'join', roomId: 'r', name: 'B' });
    h.say('b', { kind: 'setSettings', settings: { mode: 'survival', delayFrames: 5 } });
    expect(h.of('b', 'error').at(-1)?.message).toMatch(/host/);
    h.say('a', {
      kind: 'setSettings',
      settings: { mode: 'survival', delayFrames: 5, dominanceMinutes: 7 },
    });
    const lobby = h.of('b', 'lobby').at(-1);
    expect(lobby?.settings).toEqual({ mode: 'survival', delayFrames: 5, dominanceMinutes: 7 });
    h.say('a', { kind: 'ready', ready: true });
    h.say('b', { kind: 'ready', ready: true });
    expect(h.of('a', 'start')[0]?.settings).toEqual({
      mode: 'survival',
      delayFrames: 5,
      dominanceMinutes: 7,
    });
    // Zonder dominanceMinutes blijft het veld weg: de waarde komt uit de map.
    const h2 = startTwo();
    expect(h2.of('a', 'start')[0]?.settings).not.toHaveProperty('dominanceMinutes');
  });

  it('klemt delayFrames binnen MIN en MAX en vraagt opnieuw om ready', () => {
    const h = harness();
    h.say('a', { kind: 'join', roomId: 'r', name: 'A' });
    h.say('a', { kind: 'ready', ready: true });
    h.say('a', { kind: 'setSettings', settings: { mode: 'skirmish', delayFrames: 99 } });
    expect(h.of('a', 'lobby').at(-1)?.settings?.delayFrames).toBe(DELAY_FRAMES_MAX);
    expect(h.of('a', 'lobby').at(-1)?.players[0]?.ready).toBe(false);
    h.say('a', { kind: 'setSettings', settings: { mode: 'skirmish', delayFrames: 0 } });
    expect(h.of('a', 'lobby').at(-1)?.settings?.delayFrames).toBe(DELAY_FRAMES_MIN);
  });

  it('AI telt mee voor minPlayers, is ready, heeft geen verbinding en hashes tellen niet', () => {
    const h = harness();
    h.say('a', { kind: 'join', roomId: 'r', name: 'A' });
    h.say('a', { kind: 'addAi', faction: 'wanderers' });
    const ai = h.of('a', 'lobby').at(-1)?.players[1];
    expect(ai).toMatchObject({
      playerId: 1,
      ai: true,
      ready: true,
      online: true,
      faction: 'wanderers',
    });
    h.say('a', { kind: 'ready', ready: true });
    expect(h.room.isStarted).toBe(true);
    expect(h.of('a', 'start')[0]?.players.map((p) => p.ai)).toEqual([false, true]);
    expect(h.room.connectionCount).toBe(1);
    // Alleen de mens hoeft te hashen.
    h.say('a', { kind: 'hash', report: { frame: 0, playerId: 0, hash: 5 } });
    expect(h.of('a', 'desync')).toHaveLength(0);
  });

  it('addAi en removeAi alleen door de host, niet na start, en removeAi alleen op AI', () => {
    const h = harness();
    h.say('a', { kind: 'join', roomId: 'r', name: 'A' });
    h.say('b', { kind: 'join', roomId: 'r', name: 'B' });
    h.say('b', { kind: 'addAi', faction: 'x' });
    expect(h.of('b', 'error')).toHaveLength(1);
    h.say('a', { kind: 'addAi', faction: 'x' });
    h.say('a', { kind: 'removeAi', playerId: 1 }); // een mens
    expect(h.of('a', 'error').at(-1)?.message).toMatch(/AI/);
    h.say('b', { kind: 'removeAi', playerId: 2 });
    expect(h.of('b', 'error')).toHaveLength(2);
    h.say('a', { kind: 'removeAi', playerId: 2 });
    expect(h.of('a', 'lobby').at(-1)?.players).toHaveLength(2);
    h.say('a', { kind: 'ready', ready: true });
    h.say('b', { kind: 'ready', ready: true });
    h.say('a', { kind: 'addAi', faction: 'x' });
    expect(h.of('a', 'error').at(-1)?.message).toMatch(/gestart/);
  });

  it('de host verschuift naar de laagste menselijke speler; AI-spelers gaan weg als de laatste mens vertrekt', () => {
    const h = harness();
    h.say('a', { kind: 'join', roomId: 'r', name: 'A' });
    h.say('b', { kind: 'join', roomId: 'r', name: 'B' });
    h.say('a', { kind: 'addAi', faction: 'x' }); // playerId 2
    h.say('a', { kind: 'leave' });
    h.say('b', { kind: 'setSettings', settings: { mode: 'skirmish', delayFrames: 3 } });
    expect(h.of('b', 'lobby').at(-1)?.settings?.delayFrames).toBe(3);
    h.say('b', { kind: 'leave' });
    h.say('c', { kind: 'join', roomId: 'r', name: 'C' });
    expect(
      h
        .of('c', 'lobby')
        .at(-1)
        ?.players.map((p) => p.ai),
    ).toEqual([false]);
  });
});
