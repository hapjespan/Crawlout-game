// Split from placement.test.ts to stay under the 5,000-token file limit.
import { REAL_CONFIG, typeByKey, bundle } from './helpers.js';
import { type Sim, type SimMap, createSim } from '../src/index.js';
import { createOpenMap, cellCenter, testPlayers } from '../src/testing.js';
import type { CommandEnvelope } from '@crawlout/protocol';

// The playtest bot of 16 October (data 0.18.0): after a house, workshop, lab, training facility and robot factory were
// placed close around the HQ, the scavengers at the node next to the HQ's south-west corner stood still for 500+ game
// seconds playing the walk animation, and scrap income stopped. Root cause: Build only checked that the footprint
// cells were free, so a building could cover a scrap node. Gatherers ordered to that node walked to the edge of the
// building (the flow field to a point on a building leads to its footprint), never came within interactRange of the
// node and kept "walking" on the spot. Fixed twice over: the placement rule (systems/placement.ts) refuses such a
// footprint and keeps a free ring around every building, so placing never cuts a route; and a gatherer whose node or
// depot it cannot reach (under a building, another piece of terrain) picks another one instead of freezing.

export const BT = (key: string) =>
  REAL_CONFIG.buildingTypes.find((b) => b.typeId === typeByKey(key))!;

export const HQ_CELL = 40;

/** The node 4 cells west and 6 cells south of the HQ's south-west corner, as on Rustbelt (HQ 301,77; node 287,93). */
export const NODE0 = { cx: HQ_CELL - 10 - 4, cy: HQ_CELL + 10 + 6 };

const NODE1 = { cx: 60, cy: 8 };

/** Open 128 x 128 map with the real footprints: player 0's HQ (21 x 21) centred on cell (40, 40). */
export function baseSim(seed = 1, ai = false, config = REAL_CONFIG): Sim {
  const open = createOpenMap();
  const map: SimMap = {
    ...open,
    spawns: [cellCenter(HQ_CELL, HQ_CELL), cellCenter(103, 103)],
    scrapNodes: [
      { ...cellCenter(NODE0.cx, NODE0.cy), amount: 100000 },
      { ...cellCenter(NODE1.cx, NODE1.cy), amount: 100000 },
      { ...cellCenter(115, 80), amount: 100000 },
    ],
  };
  const players = testPlayers(2);
  return createSim({
    seed,
    players: ai ? [players[0]!, { ...players[1]!, ai: true }] : players,
    map,
    config,
  });
}

export function run(
  sim: Sim,
  frames: number,
  cmds: Map<number, CommandEnvelope[]> = new Map(),
): void {
  for (let n = 0; n < frames; n++) {
    sim.applyBundle(bundle(sim.frame, cmds.get(sim.frame) ?? []));
    sim.tick();
  }
}
