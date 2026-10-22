import { describe, expect, it } from 'vitest';
import { ClientMessage, DIFFICULTIES, MatchSettings, Replay } from './index.js';

// Protocol 0.21.0 (voorstel, besluit fase-0 sectie 26): de moeilijkheidsgraad in MatchSettings, dus in start en replay.
describe('moeilijkheidsgraad (protocol 0.21.0)', () => {
  const base = { mode: 'skirmish', delayFrames: 4 } as const;

  it('drie niveaus, in vaste volgorde', () => {
    expect(DIFFICULTIES).toEqual(['easy', 'normal', 'hard']);
  });

  it('MatchSettings.difficulty is optioneel en alleen een van de drie', () => {
    expect(MatchSettings.parse(base).difficulty).toBeUndefined();
    expect(MatchSettings.parse({ ...base, difficulty: 'hard' }).difficulty).toBe('hard');
    expect(() => MatchSettings.parse({ ...base, difficulty: 'brutal' })).toThrow();
  });

  it('setSettings draagt hem mee', () => {
    const msg = ClientMessage.parse({
      kind: 'setSettings',
      settings: { ...base, difficulty: 'easy' },
    });
    expect(msg).toEqual({ kind: 'setSettings', settings: { ...base, difficulty: 'easy' } });
  });

  it('hij is replay-invoer: een replay zonder niveau blijft geldig', () => {
    const replay = {
      dataVersion: '0.45.0',
      seed: 7,
      map: 'rustbelt',
      players: [
        { playerId: 0, name: 'ai0', faction: 'dwellers', ready: true, online: false, ai: true },
      ],
      settings: base,
      bundles: [],
      hashes: [{ frame: 0, hash: 1 }],
    };
    expect(Replay.parse(replay).settings.difficulty).toBeUndefined();
    expect(
      Replay.parse({ ...replay, settings: { ...base, difficulty: 'normal' } }).settings.difficulty,
    ).toBe('normal');
  });
});
