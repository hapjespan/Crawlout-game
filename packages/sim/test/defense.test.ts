import { describe, expect, it } from 'vitest';
import { ROLES } from '@crawlout/data';
import { C, ORDER_ATTACK_MOVE, ORDER_GATHER, ORDER_MOVE, SLAVE_SLAVE } from '../src/ecs/world.js';
import { createSim, envHash, hqOf } from '../src/index.js';
import type { Sim } from '../src/index.js';
import { CONFIG, DATA, bundle, cmd, envOf, testInit } from './helpers.js';
import { fastWaves, hordeOf, runTo, survivalInit, wave } from './survivalHarness.js';

// Base defence (sim 0.29.0, data 0.35.0; Martien 19 October): an attacked base makes its fighters engage and its
// workers shelter at the HQ or Kooi; once calm the work resumes. On in Survival, off in skirmish (data toggle).

const RAIDERS = DATA.factions.find((f) => f.key === 'raiders')!.id;
const DWELLERS = DATA.factions.find((f) => f.key === 'dwellers')!.id;
const SCAV = ROLES.indexOf('scavenger');
const BUILDER = ROLES.indexOf('builder');
const isWorker = (sim: Sim, i: number): boolean =>
  sim.world.role[i] === SCAV || sim.world.role[i] === BUILDER;
const CALM = CONFIG.baseDefense.calmTicks;

const unitsOf = (sim: Sim, p: number, ok: (i: number) => boolean): number[] => {
  const w = sim.world;
  const out: number[] = [];
  for (let i = 0; i < w.highWater; i++)
    if (w.alive[i] === 1 && w.owner[i] === p && w.has(i, C.unit) && w.hp[i]! > 0 && ok(i))
      out.push(i);
  return out;
};

/** Solo survival of `faction`; every worker gathers at the nearest node; a ghoul spawns at frame 150 (before an unguarded slave group
 * starts to flee) next to the HQ. */
function attacked(faction: number) {
  const sim = createSim(
    survivalInit([{ factionId: faction, ai: false }], fastWaves([wave(2, 2), wave(100000, 1)])),
  );
  const w = sim.world;
  const hq = hqOf(sim, 0);
  const workers = unitsOf(sim, 0, (i) => w.role[i] === SCAV);
  const fighters = unitsOf(sim, 0, (i) => w.damage[i]! > 0 && !isWorker(sim, i));
  const nodes = sim.entityIds().filter((id) => sim.getUnit(id)!.kind === 'scrapNode');
  const node = nodes
    .map((id) => sim.getUnit(id)!)
    .sort(
      (a, b) =>
        (a.x - w.x[hq]!) ** 2 +
        (a.y - w.y[hq]!) ** 2 -
        ((b.x - w.x[hq]!) ** 2 + (b.y - w.y[hq]!) ** 2),
    )[0]!;
  sim.applyBundle(
    bundle(0, [cmd(0, 0, 'Gather', { ids: workers.map((i) => w.idOf(i)), nodeId: node.id })]),
  );
  sim.tick();
  runTo(sim, 150);
  for (const i of workers) expect(w.orderType(i)).toBe(ORDER_GATHER);
  // the wave of frame 2 stands 25 m east of the HQ now (it marches on the HQ)
  for (const [k, i] of hordeOf(sim).entries()) {
    w.x[i] = w.x[hq]! + 25 * 256 + k * 256;
    w.y[i] = w.y[hq]!;
  }
  return { sim, workers, fighters };
}

describe('base defence', () => {
  for (const [name, faction] of [
    ['Dwellers', DWELLERS],
    ['Raiders (slaves)', RAIDERS],
  ] as const) {
    it(`${name}: fighters engage, workers shelter, then the work resumes`, () => {
      const { sim, workers, fighters } = attacked(faction);
      const w = sim.world;
      expect(workers.length).toBeGreaterThan(0);
      expect(fighters.length).toBeGreaterThan(0);
      if (faction === RAIDERS)
        expect(workers.some((i) => w.slaveState[i] === SLAVE_SLAVE)).toBe(true);
      // the ghoul walks in and hits something of the base
      let alarmAt = -1;
      for (let f = 0; f < 400 && alarmAt < 0; f++) {
        runTo(sim, sim.frame + 1);
        if (sim.defense.alarm[0]! > 0) alarmAt = sim.frame;
      }
      expect(alarmAt).toBeGreaterThan(0);
      runTo(sim, sim.frame + 1);
      const busy = (i: number) => w.orderType(i);
      expect(
        fighters.filter((i) => busy(i) === ORDER_ATTACK_MOVE || w.resolve(w.target[i]!) >= 0)
          .length,
      ).toBeGreaterThan(0);
      for (const i of workers)
        if (w.hp[i]! > 0) expect([ORDER_MOVE, ORDER_GATHER]).toContain(busy(i));
      expect(workers.filter((i) => busy(i) === ORDER_MOVE).length).toBeGreaterThan(0);
      // the fighters kill it; calm after CALM ticks, everyone back at work
      for (let f = 0; f < 1200 && hordeOf(sim).length > 0; f++) runTo(sim, sim.frame + 1);
      expect(hordeOf(sim)).toHaveLength(0);
      runTo(sim, sim.frame + CALM + 4);
      expect(sim.defense.alarm[0]).toBe(0);
      for (const i of workers)
        if (w.alive[i] === 1 && w.hp[i]! > 0) expect(busy(i)).toBe(ORDER_GATHER);
      for (const i of fighters) if (w.alive[i] === 1) expect(busy(i)).not.toBe(ORDER_ATTACK_MOVE);
    });
  }

  it('leaves a unit on a player command (Move) alone', () => {
    const { sim, workers } = attacked(DWELLERS);
    const w = sim.world;
    for (let f = 0; f < 400 && sim.defense.alarm[0] === 0; f++) runTo(sim, sim.frame + 1);
    runTo(sim, sim.frame + 2);
    const i = workers.find((k) => sim.defense.mark[k] !== 0)!;
    expect(i).toBeDefined();
    const x = w.x[i]! - 30 * 256;
    sim.applyBundle(
      bundle(sim.frame, [cmd(sim.frame, 0, 'Move', { ids: [w.idOf(i)], x, y: w.y[i]! })]),
    );
    sim.tick();
    for (let f = 0; f < 20; f++) {
      runTo(sim, sim.frame + 1);
      expect(sim.defense.alarm[0]).toBeGreaterThan(0);
      expect(sim.defense.mark[i]).toBe(0);
      expect(w.orderType(i)).toBe(ORDER_MOVE);
      expect(w.ordX[w.currentOrder(i)]).toBe(x);
    }
  });

  it('is off in skirmish by default: no state, no env hash change', () => {
    expect(CONFIG.baseDefense.skirmish).toBe(false);
    const init = testInit();
    const sim = createSim(init);
    expect(sim.defense.active).toBe(false);
    const on = {
      ...init,
      config: { ...init.config, baseDefense: { ...init.config.baseDefense, skirmish: true } },
    };
    expect(createSim(on).defense.active).toBe(true);
    const off2 = {
      ...init,
      config: { ...init.config, baseDefense: { ...init.config.baseDefense, radius: 1 } },
    };
    expect(envHash(envOf(off2))).toBe(envHash(envOf(init)));
    expect(envHash(envOf(on))).not.toBe(envHash(envOf(init)));
    expect(sim.serialize().byteLength).toBe(createSim(off2).serialize().byteLength);
  });
});
