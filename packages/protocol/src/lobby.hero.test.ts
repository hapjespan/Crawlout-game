import { describe, expect, it } from 'vitest';
import { ClientMessage, HERO_ARCHETYPES, LobbyPlayer, Replay } from './index.js';

// Protocol 0.18.0 (voorstel, docs/held-keuze.md): het archetype van de held in de lobby en in de replay.
describe('held-keuze (protocol 0.18.0)', () => {
  const base = {
    playerId: 0,
    name: 'Martien',
    faction: 'dwellers',
    ready: true,
    online: true,
    ai: false,
  };

  it('LobbyPlayer.heroArchetype is optioneel, een van de drie archetypes', () => {
    expect(HERO_ARCHETYPES).toEqual(['bouwer', 'krijger', 'tacticus']);
    expect(LobbyPlayer.parse(base).heroArchetype).toBeUndefined();
    expect(LobbyPlayer.parse({ ...base, heroArchetype: 'tacticus' }).heroArchetype).toBe(
      'tacticus',
    );
    expect(() => LobbyPlayer.parse({ ...base, heroArchetype: 'held' })).toThrow();
  });

  it('setHero draagt een archetype, niets anders', () => {
    expect(ClientMessage.parse({ kind: 'setHero', heroArchetype: 'bouwer' })).toEqual({
      kind: 'setHero',
      heroArchetype: 'bouwer',
    });
    expect(() => ClientMessage.parse({ kind: 'setHero', heroArchetype: 'x' })).toThrow();
    expect(() =>
      ClientMessage.parse({ kind: 'setHero', heroArchetype: 'bouwer', heroId: 3 }),
    ).toThrow();
  });

  it('een replay zonder keuze blijft geldig, een met keuze ook', () => {
    const r = {
      dataVersion: '0.39.0',
      seed: 1,
      map: 'rustbelt',
      players: [base, { ...base, playerId: 1, ai: true, heroArchetype: 'bouwer' }],
      settings: { mode: 'skirmish', delayFrames: 3 },
      bundles: [],
      hashes: [],
    };
    expect(Replay.parse(r).players[1]!.heroArchetype).toBe('bouwer');
  });
});
