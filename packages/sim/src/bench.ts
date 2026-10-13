// Benchmark: 200 units, 10.000 ticks, gemiddelde ms per tick (doel: onder 5 ms).
// Twee groepen van 100 op een open map van 128 bij 128 m die elke 200 ticks van doel wisselen en elkaar kruisen,
// zodat flow fields, separatie en hash allemaal belast worden. De klok komt uit host/clock.ts, buiten de sim.
import type { CommandEnvelope } from '@crawlout/protocol';
import { now, reportBench } from '../host/clock.js';
import { idiv, imod } from './math/int.js';
import { createSim } from './sim.js';
import { TEST_SIM_CONFIG, TEST_UNIT_TYPE, cellCenter, createOpenMap } from './testing.js';

const UNITS = 200;
const TICKS = 10_000;
const RETARGET_EVERY = 200;
const MAP_SIDE = 128;

function chunks(ids: readonly number[], size: number): number[][] {
  const out: number[][] = [];
  for (let k = 0; k < ids.length; k += size) out.push(ids.slice(k, k + size));
  return out;
}

export interface BenchResult {
  units: number;
  ticks: number;
  totalMs: number;
  maxMs: number;
  finalHash: number;
}

export function runBench(clock: () => number): BenchResult {
  const sim = createSim({ seed: 12345, playerCount: 2, map: createOpenMap(MAP_SIDE, MAP_SIDE), config: TEST_SIM_CONFIG });
  const half = UNITS >> 1;
  const groups: number[][] = [[], []];
  for (let k = 0; k < UNITS; k++) {
    const side = k < half ? 0 : 1;
    const j = side === 0 ? k : k - half;
    const col = j & 7;
    const row = j >> 3;
    const c = side === 0 ? cellCenter(10 + col, 20 + row) : cellCenter(108 + col, 90 + row);
    groups[side]!.push(sim.spawnUnit({ typeId: TEST_UNIT_TYPE, owner: side, x: c.x, y: c.y }));
  }
  const targets = [cellCenter(110, 100), cellCenter(15, 25), cellCenter(64, 64), cellCenter(100, 20), cellCenter(20, 110)];

  let seq = 0;
  let total = 0;
  let max = 0;
  for (let f = 0; f < TICKS; f++) {
    const commands: CommandEnvelope[] = [];
    if (imod(f, RETARGET_EVERY) === 0) {
      const round = idiv(f, RETARGET_EVERY);
      for (let side = 0; side < 2; side++) {
        const t = targets[imod(round + side * 2, targets.length)]!;
        for (const ids of chunks(groups[side]!, 64)) commands.push({ frame: f, playerId: side, seq: seq++, type: 'Move', payload: { ids, x: t.x, y: t.y } });
      }
    }
    sim.applyBundle({ frame: f, commands });
    const t0 = clock();
    sim.tick();
    const dt = clock() - t0;
    total += dt;
    if (dt > max) max = dt;
  }
  return { units: UNITS, ticks: TICKS, totalMs: total, maxMs: max, finalHash: sim.hash() };
}

reportBench(runBench(now));
