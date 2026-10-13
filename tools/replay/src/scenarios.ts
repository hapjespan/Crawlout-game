import type { Sim, SimEnv } from '@crawlout/sim';
import { TEST_SIM_CONFIG, TEST_UNIT_TYPE, cellCenter, createOpenMap, createTestMap } from '@crawlout/sim/testing';

// Sprint 1: de map-package en de data-loader bestaan nog niet. Een replay noemt zijn map bij naam; hier staat
// per naam de programmatische testmap, de testconfig en de startopstelling. Bij de integratie vervangt de echte
// map (packages/map) plus de startUnits uit data/ deze tabel.

export interface Scenario {
  readonly env: (playerCount: number) => SimEnv;
  /** Startopstelling. Moet deterministisch zijn: dezelfde ids bij elke run. */
  readonly setup: (sim: Sim) => void;
}

function spawnBlock(sim: Sim, owner: number, cx: number, cy: number, count: number, cols: number): void {
  for (let k = 0; k < count; k++) {
    const c = cellCenter(cx + (k % cols), cy + Math.floor(k / cols));
    if (sim.spawnUnit({ typeId: TEST_UNIT_TYPE, owner, x: c.x, y: c.y }) === 0) throw new Error(`scenario: spawn mislukt op cel ${cx + (k % cols)},${cy + Math.floor(k / cols)}`);
  }
}

export const SCENARIOS: Readonly<Record<string, Scenario>> = {
  // 64 bij 64 m: rand, muur door het midden met een opening van 4 m, een blok rechtsboven. 20 units per kant.
  'test-arena-64': {
    env: (playerCount) => ({ playerCount, map: createTestMap(64, 64), config: TEST_SIM_CONFIG }),
    setup: (sim) => {
      spawnBlock(sim, 0, 4, 4, 20, 5);
      spawnBlock(sim, 1, 40, 50, 20, 5);
    },
  },
  // 128 bij 128 m open veld, 100 units per kant.
  'test-open-128': {
    env: (playerCount) => ({ playerCount, map: createOpenMap(128, 128), config: TEST_SIM_CONFIG }),
    setup: (sim) => {
      spawnBlock(sim, 0, 10, 20, 100, 10);
      spawnBlock(sim, 1, 108, 90, 100, 10);
    },
  },
};

export function scenarioFor(map: string): Scenario {
  const s = Object.hasOwn(SCENARIOS, map) ? SCENARIOS[map] : undefined;
  if (s === undefined) throw new Error(`onbekende map in replay: ${map}`);
  return s;
}
