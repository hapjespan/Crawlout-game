// Split from raiders.test.ts to stay under the 5,000-token file limit.
import { DATA, CONFIG, typeByKey, bundle, cmd, emptySim } from './helpers.js';
import type { Sim } from '../src/index.js';
import { type CommandEnvelope, OWNER_NEUTRAL } from '@crawlout/protocol';
import { createOpenMap, cellCenter } from '../src/testing.js';
import { expect } from 'vitest';
import { SLAVE_SLAVE } from '../src/ecs/world.js';

// Raiders in the sim (sim 0.18.0, data 0.21.0): start slaves, tents and the safety net, beds, capture, the captive's
// way to the cage, liberation, revolt, the work radius and SetRole at a cage, chems, the Warlord's aura, plunder,
// tribute and the Kooi's placement rule. Raiders are player 0, Dwellers player 1, on an open 64 x 64 map with the
// compact footprints of helpers.ts (a camp of 5 x 5, a tent and a cage of 3 x 3).

export const RAIDERS = DATA.factions.findIndex((f) => f.key === 'raiders');

export const PLAYERS = [
  { factionId: RAIDERS, ai: false },
  { factionId: 0, ai: false },
];

export const R = CONFIG.factions[RAIDERS]!;

export const CAMP = typeByKey('raiderkamp');

export const POST = typeByKey('plunderpost');

export const HQ = typeByKey('hoofdgebouw');

export const SLAAF = typeByKey('slaaf');

export const PLUNDERAAR = typeByKey('plunderaar');

export const MILITIE = typeByKey('militie');

export const buildingType = (typeId: number) =>
  CONFIG.buildingTypes.find((b) => b.typeId === typeId)!;

export function play(
  sim: Sim,
  frames: number,
  script: Map<number, CommandEnvelope[]> = new Map(),
): void {
  for (let n = 0; n < frames; n++) {
    const f = sim.frame;
    sim.applyBundle(bundle(f, script.get(f) ?? []));
    sim.tick();
  }
}

export const now = (
  sim: Sim,
  playerId: number,
  type: CommandEnvelope['type'],
  payload: unknown,
): void => play(sim, 1, new Map([[sim.frame, [cmd(sim.frame, playerId, type, payload)]]]));

export const open = (): Sim => emptySim(1, createOpenMap(64, 64), PLAYERS);

export const idx = (sim: Sim, id: number): number => sim.world.resolve(id);

export const spawn = (sim: Sim, typeId: number, owner: number, cx: number, cy: number): number => {
  const id = sim.spawnUnit({ typeId, owner, ...cellCenter(cx, cy) });
  expect(id).not.toBe(0);
  return id;
};

/** A slave of player 0 bound to cage `cage`, taken from player `from`. */
export function slave(
  sim: Sim,
  cx: number,
  cy: number,
  cage: number,
  from = OWNER_NEUTRAL,
): number {
  const id = spawn(sim, SLAAF, 0, cx, cy);
  const i = idx(sim, id);
  sim.world.slaveState[i] = SLAVE_SLAVE;
  sim.world.slaveCage[i] = cage;
  sim.world.slaveFrom[i] = from;
  return id;
}
