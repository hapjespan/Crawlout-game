import { describe, expect, it } from 'vitest';
import { createSim, deserialize } from '../src/index.js';
import type { Sim } from '../src/index.js';
import { CAMP_CLEARED, CAMP_IDLE } from '../src/systems/creeps.js';
import { territoryOf } from '../src/systems/placement.js';
import { createOpenMap, testPlayers } from '../src/testing.js';
import { bandits, campMap } from './creepHarness.js';
import { WONING } from './gameplay.helpers.js';
import { CONFIG, REAL_CONFIG, bundle, envOf, testInit } from './helpers.js';

// Audit fixes, round 2 (sim 0.38.2): each test fails on the code before the fix.

const tick = (sim: Sim): void => {
  sim.applyBundle(bundle(sim.frame));
  sim.tick();
};

describe('audit fixes, round 2', () => {
  it('territory: an owner change without alloc or free recomputes the mask', () => {
    // the test CONFIG has no territory rule (buildRange 0); the real one has
    const sim = createSim(
      { ...testInit(1, createOpenMap()), config: REAL_CONFIG },
      { start: false },
    );
    expect(REAL_CONFIG.placement.buildRange).toBeGreaterThan(0);
    const w = sim.world;
    const a = w.resolve(sim.spawnBuilding(WONING, 0, 20, 20));
    const b = w.resolve(sim.spawnBuilding(WONING, 1, 90, 90));
    const cell = (cx: number, cy: number) => cy * sim.map.w + cx;
    const before = territoryOf(sim, 0)!;
    expect(before[cell(18, 21)]).toBe(1);
    expect(before[cell(88, 91)]).toBe(0);
    // same world version, same number of sources, another source set (as a project part reverted and one restored)
    const version = w.structVersion;
    w.owner[a] = 1;
    w.owner[b] = 0;
    expect(w.structVersion).toBe(version);
    const after = territoryOf(sim, 0)!;
    expect(after[cell(18, 21)]).toBe(0);
    expect(after[cell(88, 91)]).toBe(1);
  });

  describe('resync: deserialize checks the allocator and the flow slots', () => {
    /** A sim with two freed entities (a free stack of two) and some ticks played. */
    const played = (): Sim => {
      const sim = createSim(testInit(3));
      const units = sim.entityIds().filter((id) => sim.getUnit(id)!.kind === 'unit');
      sim.destroyEntity(units[0]!);
      sim.destroyEntity(units[1]!);
      for (let k = 0; k < 30; k++) tick(sim);
      expect(sim.world.freeCount).toBeGreaterThanOrEqual(2);
      return sim;
    };
    const load = (sim: Sim) => deserialize(sim.serialize(), envOf(testInit(3)));

    it('a valid state still loads', () => {
      const sim = played();
      expect(load(sim).hash()).toBe(sim.hash());
    });

    it('rejects a corrupt alive, gen, free stack or flow slot', () => {
      const corrupt: ((sim: Sim) => void)[] = [
        (s) => (s.world.alive[s.world.freeStack[0]!] = 2),
        (s) => (s.world.gen[s.world.resolve(s.entityIds()[0]!)] = 0),
        (s) => (s.world.freeStack[1] = s.world.freeStack[0]!), // twice on the free stack
        (s) => (s.world.freeStack[0] = s.world.resolve(s.entityIds()[0]!)), // a live index on it
        (s) => (s.world.freeStack[0] = s.world.highWater), // past the end
        (s) => {
          s.flow.active[0] = 1;
          s.flow.tx0[0] = s.map.w;
          s.flow.tw[0] = 1;
          s.flow.th[0] = 1;
        },
      ];
      for (const f of corrupt) {
        const sim = played();
        f(sim);
        expect(() => load(sim)).toThrow(/state:/);
      }
    });
  });

  it('camp respawn in a nearly full world does not stack bandits', () => {
    const tiers = CONFIG.creepTiers!.map((t) => (t.tier === 1 ? { ...t, respawnTicks: 100 } : t));
    const sim = createSim({
      seed: 1,
      players: testPlayers(2),
      map: campMap(1),
      config: { ...CONFIG, creepTiers: tiers },
    });
    for (const id of bandits(sim)) sim.destroyEntity(id);
    sim.creeps.state[0] = CAMP_CLEARED;
    sim.creeps.timer[0] = 1;
    const w = sim.world;
    const taken: number[] = [];
    for (let i = w.alloc(); i >= 0; i = w.alloc()) taken.push(i);
    // one free slot per tick: the old code spawned one bandit, failed on the next and stayed cleared, every tick
    for (let k = 0; k < 4; k++) {
      w.free(taken.pop()!);
      tick(sim);
    }
    expect(bandits(sim)).toHaveLength(1);
    expect(sim.creeps.state[0]).toBe(CAMP_IDLE);
  });
});
