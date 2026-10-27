import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { asFixture, createReplaySim, parseReplay } from './run.js';
import { gameData } from './env.js';

// s19-rustbelt-vertibird (sim 0.33.0): the Garde bot flies a crew with a Klerk, strafes and gets repaired.
describe('s19-rustbelt-vertibird', () => {
  it(
    'loads three, unloads twice, takes damage and is repaired by the Klerk',
    { timeout: 180_000 },
    () => {
      const r = asFixture(
        parseReplay(
          JSON.parse(
            readFileSync(
              join(import.meta.dirname, '..', 'fixtures', 's19-rustbelt-vertibird.json'),
              'utf8',
            ),
          ),
        ),
      );
      const { data } = gameData();
      const vt = 1 + data.loadouts.find((l) => l.key === 'vertibird')!.id;
      const sim = createReplaySim(r);
      const w = sim.world;
      const byFrame = new Map(r.bundles.map((b) => [b.frame, b]));
      let maxCargo = 0;
      let unloads = 0;
      let prev = 0;
      let minHp = Infinity;
      let repaired = false;
      const end = Math.max(...r.hashes.map((h) => h.frame));
      for (let f = 0; f <= end; f++) {
        sim.applyBundle(byFrame.get(f) ?? { frame: f, commands: [] });
        sim.tick();
        if (f % 10 !== 0) continue;
        for (let i = 0; i < w.highWater; i++) {
          if (w.alive[i] !== 1 || w.typeId[i] !== vt || w.owner[i] !== 0) continue;
          const c = sim.garde.cargoN[i]!;
          maxCargo = Math.max(maxCargo, c);
          if (prev > 0 && c === 0) unloads++;
          prev = c;
          if (w.hp[i]! < minHp) minHp = w.hp[i]!;
          else if (minHp < w.maxHp[i]! && w.hp[i]! > minHp) repaired = true;
        }
      }
      expect(maxCargo).toBe(3);
      expect(unloads).toBe(2);
      expect(minHp).toBeLessThan(320);
      expect(repaired).toBe(true);
    },
  );
});
