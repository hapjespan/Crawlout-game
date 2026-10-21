import { describe, expect, it } from 'vitest';
import {
  createSim,
  type Sim,
  type SimAiScript,
  type SimConfig,
  type SimRaidPlan,
} from '../src/index.js';
import { cellCenter, createOpenMap } from '../src/testing.js';
import { grantTech } from '../src/techBits.js';
import { ORDER_ATTACK_MOVE } from '../src/ecs/world.js';
import { AI_SITE_FRONT } from '../src/config.js';
import { ORDER_UNLOAD } from '../src/systems/garde.transport.js';
import type { SimMap } from '../src/index.js';
import { DATA, REAL_CONFIG, bundle, typeByKey } from './helpers.js';

// The Garde AI (sim 0.34.0, data 0.43.0; proposal for the architect; docs/garde.md items 3 and 5, overdracht
// 21 October item 2): the scripted Garde builds and uses the Klerk (raidPlan support) and the Vertibird
// (raidPlan airlift, Load and Unload). Every test switches the rest of the script off, so it tests one rule.
const GARDE = DATA.factions.find((f) => f.key === 'garde')!.id;
const DWELLERS = DATA.factions.find((f) => f.key === 'dwellers')!.id;
const SCRIPT = REAL_CONFIG.factions[GARDE]!.aiScript;
const BASE = REAL_CONFIG.aiScripts[SCRIPT]!;
const C = 256;
const KLERK = typeByKey('klerk');
const VERTIBIRD = typeByKey('vertibird');
const WACHT = typeByKey('initiate_wacht');
const KAZERNE = typeByKey('kazerne');
const LANDING = typeByKey('landingsplatform');

/** The Garde script with everything off but `over` (and `plan` on its raid plan). */
function config(over: Partial<SimAiScript> = {}, plan: Partial<SimRaidPlan> = {}): SimConfig {
  const script: SimAiScript = {
    ...BASE,
    buildOrder: [],
    attackTimersTicks: [],
    research: [],
    researchFromTicks: 1 << 29,
    richBuilds: [],
    richScrap: 1 << 29,
    claimFromTicks: 1 << 29,
    claimFarFromTicks: 1 << 29,
    waveIntervalTicks: 1 << 29,
    waveJitterTicks: 0,
    waveMinArmy: 4096,
    pushFromTicks: 1 << 29,
    housingTypeId: 0,
    builders: 0,
    allInWithoutNodes: false,
    creeps: null,
    project: null,
    reserve: null,
    liberate: null,
    // the free workers off (they would spend every tick's scrap in the kazerne), the Klerk and the Vertibird per test
    raidPlan: {
      ...BASE.raidPlan!,
      workers: { scavengers: 0 },
      support: null,
      airlift: null,
      ...plan,
    },
    ...over,
  };
  return {
    ...REAL_CONFIG,
    aiScripts: REAL_CONFIG.aiScripts.map((s, k) => (k === SCRIPT ? script : s)),
    factions: REAL_CONFIG.factions.map((f) => ({
      ...f,
      aiScriptVersus: f.aiScriptVersus.map(() => -1),
    })),
  };
}

/**
 * An open arena of 160 x 160 with the spawns far enough from the edge for a Bastion of 21 x 21 (real footprints) and
 * one claim point in the middle: the rally point of the script, about 56 cells from the headquarters.
 */
function arenaMap(): SimMap {
  const m = createOpenMap(160, 160);
  return {
    ...m,
    spawns: [cellCenter(24, 24), cellCenter(136, 136)],
    scrapNodes: [{ ...cellCenter(40, 20), amount: 500 }],
    claimPoints: [
      { ...cellCenter(80, 80), kind: 1 },
      { ...cellCenter(120, 40), kind: 1 },
    ],
    dominance: { pointsRequired: 2, ticks: 600 },
  };
}

const gardeAi = (cfg: SimConfig): Sim =>
  createSim(
    {
      seed: 9,
      map: arenaMap(),
      players: [
        { factionId: GARDE, ai: true },
        { factionId: DWELLERS, ai: false },
      ],
      config: cfg,
    },
    { start: true },
  );

const run = (sim: Sim, n: number): void => {
  for (let k = 0; k < n; k++) {
    sim.applyBundle(bundle(sim.frame));
    sim.tick();
  }
};

const mine = (sim: Sim, typeId: number): number[] => {
  const w = sim.world;
  const out: number[] = [];
  for (let i = 0; i < w.highWater; i++)
    if (w.alive[i] === 1 && w.owner[i] === 0 && w.typeId[i] === typeId && w.hp[i]! > 0) out.push(i);
  return out;
};

const unit = (sim: Sim, typeId: number, cx: number, cy: number): number => {
  const id = sim.spawnUnit({ typeId, owner: 0, x: cx * C + 128, y: cy * C + 128 });
  expect(id, `spawn ${typeId} at ${cx},${cy}`).not.toBe(0);
  return sim.world.resolve(id);
};

describe('the Garde AI builds and uses the Klerk (raidPlan support)', () => {
  const SUPPORT = { typeId: KLERK, fromTicks: 0, max: 2, perArmy: 2, withWave: 1 };

  it('keeps one Klerk per perArmy fighters, never more than max', () => {
    const sim = gardeAi(config({}, { support: SUPPORT }));
    sim.spawnBuilding(KAZERNE, 0, 40, 40, true);
    sim.spawnBuilding(typeByKey('slaapzaal'), 0, 60, 40, true); // beds, else Produce fails on the pop cap
    sim.spawnBuilding(typeByKey('slaapzaal'), 0, 60, 60, true);
    sim.ps.scrap[0] = 2000;
    // the two start wachten only pay for one Klerk (perArmy 2)
    run(sim, 400);
    expect(mine(sim, KLERK)).toHaveLength(1);
    for (let k = 0; k < 4; k++) unit(sim, WACHT, 100 + k * 2, 100);
    sim.ps.scrap[0] = 2000;
    run(sim, 800);
    expect(mine(sim, KLERK)).toHaveLength(2); // max 2, not 3
  });

  it('is no fighter: it never counts for the wave, and withWave of them march along', () => {
    const sim = gardeAi(
      config(
        { attackTimersTicks: [60], waveMinArmy: 3, pushFromTicks: 0, pushMinArmy: 3 },
        { support: SUPPORT },
      ),
    );
    const w = sim.world;
    const klerks = [unit(sim, KLERK, 40, 24), unit(sim, KLERK, 42, 24)];
    expect(klerks.every((i) => i >= 0)).toBe(true);
    const spawn = sim.map.spawns[1]!;
    const onPush = () =>
      klerks.filter(
        (i) => w.orderType(i) === ORDER_ATTACK_MOVE && w.ordX[w.currentOrder(i)] === spawn.x,
      );
    // two Klerks and the two start wachten: 2 fighters, under waveMinArmy 3, so no wave leaves
    run(sim, 90);
    expect(onPush()).toHaveLength(0);
    unit(sim, WACHT, 44, 24); // the third fighter: the push leaves
    run(sim, 10);
    expect(onPush()).toHaveLength(1); // withWave 1; the other stays with the defence
  });
});

describe('the Garde AI flies its Vertibird (raidPlan airlift, Load and Unload)', () => {
  const AIRLIFT = {
    typeId: VERTIBIRD,
    fromTicks: 0,
    max: 1,
    minArmy: 0,
    minPath: 20 * C,
    gather: 30 * C,
    minLoad: 2,
    minHpPermille: 700,
  };
  /** Player 0 owns the claim point in the middle: that is its rally point, where the transport parks. */
  function arena(over: Partial<SimAiScript> = {}): { sim: Sim; bird: number; pt: number } {
    const sim = gardeAi(
      config(
        {
          rallySite: AI_SITE_FRONT,
          attackTimersTicks: [800], // the transport first flies from the Bastion to the rally point
          waveMinArmy: 3,
          pushFromTicks: 0,
          pushMinArmy: 3,
          ...over,
        },
        { airlift: AIRLIFT },
      ),
    );
    const w = sim.world;
    const pt = sim.claimPoints[0]!;
    // a finished wachtpost within claimRadius makes the point p's own, so rallyPoint picks it
    sim.spawnBuilding(typeByKey('wachtpost'), 0, 83, 83, true);
    const bird = unit(sim, VERTIBIRD, w.x[pt]! >> 8, (w.y[pt]! >> 8) + 2);
    expect(bird).toBeGreaterThanOrEqual(0);
    return { sim, bird, pt };
  }

  it('boards part of the wave at the rally point and sets it down at the wave target', () => {
    const { sim, bird, pt } = arena();
    const w = sim.world;
    for (const k of [-4, -2, 0, 2]) unit(sim, WACHT, (w.x[pt]! >> 8) + k, (w.y[pt]! >> 8) + 5);
    const before = mine(sim, WACHT).map((i) => w.idOf(i));
    // the transport parks at the rally point first; the wave leaves at frame 800 and part of it boards
    run(sim, 700);
    expect(w.owner[pt]).toBe(0);
    let carried = 0;
    let at: { x: number; y: number } | null = null;
    for (let k = 0; k < 800; k++) {
      run(sim, 1);
      const c = sim.garde.cargoN[bird]!;
      if (c > carried) carried = c;
      if (w.orderType(bird) === ORDER_UNLOAD && at === null) {
        const o = w.currentOrder(bird);
        at = { x: w.ordX[o]!, y: w.ordY[o]! };
      }
    }
    // it carried part of the wave and flew to the point the walking half marches to
    expect(carried).toBeGreaterThanOrEqual(2);
    const spawn = sim.map.spawns[1]!;
    expect(at).toEqual({ x: spawn.x, y: spawn.y });
    expect(sim.garde.cargoN[bird]).toBe(0);
    // a passenger is no entity while it is cargo: the ids that boarded are gone
    const left = before.filter((id) => {
      const i = w.resolve(id);
      return i >= 0 && w.alive[i] === 1 && w.typeId[i] === WACHT;
    });
    expect(before.length - left.length).toBeGreaterThanOrEqual(2);
  });

  it('stays on the ground below minHpPct and never marches with a wave', () => {
    const { sim, bird, pt } = arena();
    const w = sim.world;
    w.hp[bird] = Math.trunc(w.maxHp[bird]! / 2); // 50 percent, under minHpPermille 700
    for (const k of [-4, -2, 0]) unit(sim, WACHT, (w.x[pt]! >> 8) + k, (w.y[pt]! >> 8) + 5);
    run(sim, 200);
    expect(sim.garde.cargoN[bird]).toBe(0);
    // the wave went out, but the transport is no fighter: it never walks to the enemy spawn
    const spawn = sim.map.spawns[1]!;
    const o = w.currentOrder(bird);
    expect(o < 0 || w.ordX[o] !== spawn.x || w.ordY[o] !== spawn.y).toBe(true);
  });
});

describe('the Garde AI produces its Vertibird from the script', () => {
  it('keeps airlift.max transports, made at the landingsplatform', () => {
    const sim = gardeAi(
      config(
        {},
        {
          airlift: {
            typeId: VERTIBIRD,
            fromTicks: 0,
            max: 1,
            minArmy: 0,
            minPath: 20 * C,
            gather: 20 * C,
            minLoad: 2,
            minHpPermille: 700,
          },
        },
      ),
    );
    sim.spawnBuilding(LANDING, 0, 50, 50, true);
    sim.ps.scrap[0] = 4000;
    grantTech(sim.ps, 0, DATA.tech.find((t) => t.key === 'plasmakern')!.id);
    run(sim, 1200);
    expect(mine(sim, VERTIBIRD)).toHaveLength(1);
  });
});
