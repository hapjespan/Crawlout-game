import { OWNER_NEUTRAL } from '@crawlout/protocol';
import { createSim, hqOf } from '../src/index.js';
import type { Sim, SimInit, SimPlayer, SimSurvival, SimSurvivalWave } from '../src/index.js';
import { CREEP_SURVIVAL } from '../src/ecs/world.js';
import { survivalMapOf, survivalScrapNodes } from '../src/fromData.part4.js';
import { createOpenMap, testPlayers } from '../src/testing.js';
import { CONFIG, DATA, bundle } from './helpers.js';

// Survival co-op (sim 0.27.0) on an open 128 x 128 map with the survival geometry of the real data (edges at 3 percent
// of the map, zones at 25 and 75 percent, the spawns on the zones) and the compact footprints of the test config. The
// real waves start at 120 s; the tests replace them with short ones (fastWaves) so a wave spawns within a few ticks.

/** The survival rules of the real data. */
export const SURVIVAL: SimSurvival = CONFIG.survival!;
/** Unit typeIds of the real data (units.json order): ghoul, runner, mutant, brute, klauwbeest, behemoth. */
export const GHOUL = SURVIVAL.typeIds[0]!;
export const KLAUWBEEST = SURVIVAL.typeIds[4]!;

export function survivalInit(
  players: SimPlayer[] = testPlayers(1),
  survival: SimSurvival = SURVIVAL,
  seed = 7,
): SimInit {
  const base = createOpenMap(128, 128);
  const sm = survivalMapOf(base, DATA.survival!);
  return {
    seed,
    players,
    map: {
      ...base,
      survival: sm,
      spawns: sm.zones.map((z) => ({ x: z.x, y: z.y })),
      scrapNodes: survivalScrapNodes(base, DATA.survival!, sm.zones, base.scrapNodes),
    },
    config: { ...CONFIG, survival },
  };
}

/** The real rules with these waves (the last one is the win wave). */
export function fastWaves(waves: SimSurvivalWave[]): SimSurvival {
  return { ...SURVIVAL, waves, winWave: waves.length };
}

/** One wave of `count` units of `typeId` at frame `at` (a single batch on one edge unless given). */
export function wave(
  at: number,
  count: number,
  more: Partial<SimSurvivalWave> = {},
): SimSurvivalWave {
  return {
    atTicks: at,
    spawns: [{ typeId: GHOUL, count }],
    edges: 1,
    batches: 1,
    batchIntervalTicks: 0,
    ...more,
  };
}

export function survivalSim(
  players: SimPlayer[] = testPlayers(1),
  survival: SimSurvival = SURVIVAL,
  seed = 7,
): Sim {
  return createSim(survivalInit(players, survival, seed));
}

/** Ticks until the sim stands at `frame` (the next frame to run), with empty bundles. */
export function runTo(sim: Sim, frame: number): void {
  while (sim.frame < frame) {
    sim.applyBundle(bundle(sim.frame));
    sim.tick();
  }
}

/** Entity indices of the living wave units, ascending. */
export function hordeOf(sim: Sim): number[] {
  const w = sim.world;
  const out: number[] = [];
  for (let i = 0; i < w.highWater; i++)
    if (w.alive[i] === 1 && w.creepCamp[i] === CREEP_SURVIVAL && w.hp[i]! > 0) out.push(i);
  return out;
}

/** Index of the survival edge nearest to entity i. */
export function edgeOf(sim: Sim, i: number): number {
  const edges = sim.map.survival!.edges;
  let best = 0;
  let bestD = Infinity;
  edges.forEach((e, k) => {
    const d = (sim.world.x[i]! - e.x) ** 2 + (sim.world.y[i]! - e.y) ** 2;
    if (d < bestD) {
      best = k;
      bestD = d;
    }
  });
  return best;
}

/** Removes every unit of player p (start units and hero), so only the HQ is left. */
export function clearUnits(sim: Sim, p: number): void {
  for (const id of sim.entityIds()) {
    const u = sim.getUnit(id)!;
    if (u.kind === 'unit' && u.owner === p) sim.destroyEntity(id);
  }
}

/** Sets the hp of player p's HQ (the destroy happens in the next tick's cleanup). */
export function setHqHp(sim: Sim, p: number, hp: number): void {
  sim.world.hp[hqOf(sim, p)] = hp;
}

export const isHorde = (sim: Sim, i: number): boolean =>
  sim.world.owner[i] === OWNER_NEUTRAL && sim.world.creepCamp[i] === CREEP_SURVIVAL;
