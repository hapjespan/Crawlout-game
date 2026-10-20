import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { asFixture, createReplaySim, parseReplay } from './run.js';
import { gameData } from './env.js';

// s18-rustbelt-garde (sim 0.32.0): what the Garde AI shows in its 17.5 minutes against the Dweller AI.
describe('s18-rustbelt-garde', () => {
  it(
    'the Garde AI recruits, promotes a veteran, crafts cores, forges a frame and attacks',
    { timeout: 120_000 },
    () => {
      const r = asFixture(
        parseReplay(
          JSON.parse(
            readFileSync(
              join(import.meta.dirname, '..', 'fixtures', 's18-rustbelt-garde.json'),
              'utf8',
            ),
          ),
        ),
      );
      const { data } = gameData();
      const typeOf = (key: string) => 1 + data.loadouts.find((l) => l.key === key)!.id;
      const zoeker = typeOf('initiate_zoeker');
      const frame = typeOf('krachtpantser');
      const sim = createReplaySim(r);
      const w = sim.world;
      let maxRank = 0;
      let maxCores = 0;
      let frames = 0;
      let zoekers = 0;
      const end = Math.max(...r.hashes.map((h) => h.frame));
      for (let f = 0; f <= end; f++) {
        sim.applyBundle({ frame: f, commands: [] });
        sim.tick();
        if (f % 200 !== 0) continue;
        maxCores = Math.max(maxCores, sim.garde.cores[0]!);
        let z = 0;
        for (let i = 0; i < w.highWater; i++) {
          if (w.alive[i] !== 1 || w.owner[i] !== 0) continue;
          maxRank = Math.max(maxRank, sim.garde.rank[i]!);
          if (w.typeId[i] === frame) frames = Math.max(frames, 1);
          if (w.typeId[i] === zoeker) z++;
        }
        zoekers = Math.max(zoekers, z);
      }
      expect(zoekers).toBeGreaterThan(3); // recruited in the kazerne (3 at the start)
      expect(maxRank).toBeGreaterThanOrEqual(1);
      expect(maxCores).toBeGreaterThanOrEqual(1);
      expect(frames).toBe(1);
      expect(sim.ps.aiAttack[0]).toBeGreaterThanOrEqual(1);
      expect(sim.winner()).toBeNull();
    },
  );
});
