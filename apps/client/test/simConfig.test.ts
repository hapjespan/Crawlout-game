import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { loadGameDataFromDir } from '@crawlout/data/node';
import { createSim, validateEnv } from '@crawlout/sim';
import { cellCenter, createOpenMap, testPlayers } from '@crawlout/sim/testing';
import { toSimConfig, typeIdOfLoadout } from '../src/game/simConfig.js';

const dataDir = fileURLToPath(new URL('../../../data', import.meta.url));

describe('toSimConfig', () => {
  const data = loadGameDataFromDir(dataDir);
  const config = toSimConfig(data);

  it('produces a config the sim accepts', () => {
    expect(() =>
      validateEnv({ players: testPlayers(2), map: createOpenMap(), config }),
    ).not.toThrow();
  });

  it('maps every loadout to a unit type with its converted stats', () => {
    expect(config.unitTypes).toHaveLength(data.loadouts.length);
    for (const l of data.loadouts) {
      const t = config.unitTypes.find((u) => u.typeId === typeIdOfLoadout(l.id));
      expect(t).toMatchObject({ maxHp: l.hpI, speed: l.speedUPT, loadoutId: l.id, role: l.role });
    }
    expect(config.dataVersion).toBe(data.dataVersion);
  });

  it('spawns the faction start units deterministically', () => {
    const run = (): number => {
      // Spawns ver genoeg van de rand voor het hoofdgebouw op echte schaal (20 x 20 m, data 0.14.0).
      const map = { ...createOpenMap(), spawns: [cellCenter(24, 24), cellCenter(103, 103)] };
      const sim = createSim({ seed: 7, players: testPlayers(2), map, config });
      for (const u of data.factions[0]!.startUnits) {
        for (let i = 0; i < u.count; i++)
          sim.spawnUnit({
            typeId: typeIdOfLoadout(u.loadoutId),
            owner: 0,
            x: 4096 + i * 512,
            y: 48 * 256,
          });
      }
      for (let f = 0; f < 40; f++) {
        sim.applyBundle({ frame: f, commands: [] });
        sim.tick();
      }
      return sim.hash();
    };
    expect(run()).toBe(run());
  });
});
