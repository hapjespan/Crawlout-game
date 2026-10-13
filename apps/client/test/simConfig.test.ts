import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { loadGameDataFromDir } from '@crawlout/data/node';
import { createSim, validateEnv } from '@crawlout/sim';
import { createOpenMap, testPlayers } from '@crawlout/sim/testing';
import { toSimConfig, typeIdOfLoadout } from '../src/game/simConfig.js';

const dataDir = fileURLToPath(new URL('../../../data', import.meta.url));

describe('toSimConfig', () => {
  const data = loadGameDataFromDir(dataDir);
  const config = toSimConfig(data);

  it('produces a config the sim accepts', () => {
    expect(() => validateEnv({ players: testPlayers(2), map: createOpenMap(), config })).not.toThrow();
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
      const sim = createSim({ seed: 7, players: testPlayers(2), map: createOpenMap(), config });
      for (const u of data.factions[0]!.startUnits) {
        for (let i = 0; i < u.count; i++) sim.spawnUnit({ typeId: typeIdOfLoadout(u.loadoutId), owner: 0, x: 4096 + i * 512, y: 4096 });
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
