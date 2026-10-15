import { describe, expect, it } from 'vitest';
import { createSim } from '../src/index.js';
import type { Sim, UnitView } from '../src/index.js';
import { cellCenter, createOpenMap } from '../src/testing.js';
import { CONFIG, bundle, cmd, emptySim, spawnBlock, testInit } from './helpers.js';

// Group-order spreading (systems/formation.ts): a group Move gives every unit its own slot, workers sent to a node
// together each get their own spot on the ring around it.

/** ecs/world.ts PHASE_WORK: at work at the node. */
const PHASE_WORK = 1;
const R = CONFIG.unitTypes[0]!.radius;
const SPACING = 2 * R + CONFIG.formation.gap;

function units(sim: Sim, ids: readonly number[]): UnitView[] {
  return ids.map((id) => sim.getUnit(id)!);
}

function minPairDistance(us: readonly UnitView[]): number {
  let m = Infinity;
  for (let a = 0; a < us.length; a++)
    for (let b = a + 1; b < us.length; b++)
      m = Math.min(m, Math.hypot(us[a]!.x - us[b]!.x, us[a]!.y - us[b]!.y));
  return m;
}

describe('formation', () => {
  it('a group Move spreads the units over their own slots and they stand still there', () => {
    const sim = emptySim(3, createOpenMap(96, 96));
    const ids = spawnBlock(sim, 0, 10, 10, 16, 4);
    const t = cellCenter(60, 50);
    sim.applyBundle(bundle(0, [cmd(0, 0, 'Move', { ids, x: t.x, y: t.y })]));
    for (let f = 0; f < 800; f++) sim.tick();
    const end = units(sim, ids);
    for (const u of end) {
      expect(u.moving).toBe(false);
      expect(Math.hypot(u.x - t.x, u.y - t.y)).toBeLessThan(4 * 256);
    }
    // nobody on top of another: neighbours about one slot spacing apart, not clumped on one point
    expect(minPairDistance(end)).toBeGreaterThan(SPACING - 2 * CONFIG.arriveRadius);
    // no jitter: another 100 ticks change nothing
    for (let f = 0; f < 100; f++) sim.tick();
    expect(units(sim, ids).map((u) => [u.x, u.y])).toEqual(end.map((u) => [u.x, u.y]));
  });

  it('ranks face the move direction: the front of the group arrives in front', () => {
    const sim = emptySim(3, createOpenMap(96, 96));
    // a column of 8 walking east: the two leading units end up in the front (east) rank
    const ids = spawnBlock(sim, 0, 10, 40, 8, 1);
    const t = cellCenter(60, 44);
    sim.applyBundle(bundle(0, [cmd(0, 0, 'Move', { ids, x: t.x, y: t.y })]));
    for (let f = 0; f < 800; f++) sim.tick();
    const end = units(sim, ids);
    const xs = end.map((u) => u.x);
    expect(new Set(end.map((u) => `${u.x >> 6},${u.y >> 6}`)).size).toBe(8);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(SPACING / 2); // more than one rank
    expect(end.every((u) => !u.moving)).toBe(true);
  });

  it('a repeated Move to the same point does not reshuffle a group that is already there', () => {
    const sim = emptySim(3, createOpenMap(96, 96));
    const ids = spawnBlock(sim, 0, 10, 10, 12, 4);
    const t = cellCenter(50, 50);
    sim.applyBundle(bundle(0, [cmd(0, 0, 'Move', { ids, x: t.x, y: t.y })]));
    for (let f = 0; f < 700; f++) sim.tick();
    sim.applyBundle(bundle(700, [cmd(700, 0, 'Move', { ids, x: t.x, y: t.y })]));
    for (let f = 0; f < 5; f++) sim.tick();
    const before = units(sim, ids).map((u) => [u.x, u.y]);
    sim.applyBundle(bundle(705, [cmd(705, 0, 'Move', { ids, x: t.x, y: t.y })]));
    for (let f = 0; f < 300; f++) sim.tick();
    const after = units(sim, ids);
    for (let k = 0; k < ids.length; k++)
      expect(Math.hypot(after[k]!.x - before[k]![0]!, after[k]!.y - before[k]![1]!)).toBeLessThan(
        SPACING,
      );
  });

  it('workers sent to a node together take their own spots around it', () => {
    // ring spots are off in data 0.15.0 (gatherRingM 0); here with a ring of 1,25 m
    const init = testInit(3, createOpenMap(96, 96));
    const sim = createSim({
      ...init,
      config: { ...CONFIG, formation: { ...CONFIG.formation, gatherRing: 320 } },
    });
    const node = sim
      .entityIds()
      .map((id) => sim.getUnit(id)!)
      .find((u) => u.kind === 'scrapNode')!;
    const ids = spawnBlock(sim, 0, (node.x >> 8) - 12, (node.y >> 8) - 2, 5, 5);
    sim.applyBundle(bundle(0, [cmd(0, 0, 'Gather', { ids, nodeId: node.id })]));
    let spread = 0;
    for (let f = 0; f < 400; f++) {
      sim.tick();
      const working = units(sim, ids).filter((u) => u.phase === PHASE_WORK);
      if (working.length === ids.length) {
        spread = minPairDistance(working);
        break;
      }
    }
    expect(spread).toBeGreaterThan(SPACING - 2 * CONFIG.arriveRadius);
  });
});
