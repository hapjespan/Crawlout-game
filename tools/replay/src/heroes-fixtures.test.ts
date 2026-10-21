import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { asFixture, createReplaySim, parseReplay } from './run.js';
import { gameData } from './env.js';

// s20-rustbelt-heroes and s20-rustbelt-heroes-garde (sim 0.33.0, hero choice): each AI plays the hero of the archetype
// in its LobbyPlayer, the heroes level and at least one per match casts its ability.
const CASES = [
  ['s20-rustbelt-heroes', ['controleur', 'marktmeester']],
  ['s20-rustbelt-heroes-garde', ['kwartiermeester', 'voorman']],
] as const;

describe('s20 hero fixtures', () => {
  for (const [name, keys] of CASES) {
    it(`${name}: ${keys.join(' and ')} play, level, one casts`, { timeout: 60_000 }, () => {
      const file = join(import.meta.dirname, '..', 'fixtures', `${name}.json`);
      const r = asFixture(parseReplay(JSON.parse(readFileSync(file, 'utf8'))));
      const { data } = gameData();
      const sim = createReplaySim(r);
      const end = Math.max(...r.hashes.map((h) => h.frame));
      const used = [false, false];
      for (let f = 0; f <= end; f++) {
        sim.applyBundle({ frame: f, commands: [] });
        sim.tick();
        for (let p = 0; p < 2; p++)
          if ((sim.playerStatus(p).hero?.abilityCooldownTicks[0] ?? 0) > 0) used[p] = true;
      }
      for (let p = 0; p < 2; p++) {
        const hero = sim.playerStatus(p).hero!;
        expect(data.heroes[hero.heroId]!.key).toBe(keys[p]);
        expect(hero.level).toBeGreaterThanOrEqual(2);
      }
      // the Kwartiermeester does not cast in these 6 minutes; one hero per match does
      expect(used.some((u) => u)).toBe(true);
    });
  }
});
