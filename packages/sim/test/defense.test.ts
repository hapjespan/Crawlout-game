import { describe, expect, it } from 'vitest';
import { ROLES } from '@crawlout/data';
import { C, ORDER_ATTACK, ORDER_GATHER, ORDER_MOVE, SLAVE_SLAVE } from '../src/ecs/world.js';
import { createSim, envHash, hqOf } from '../src/index.js';
import type { Sim } from '../src/index.js';
import { CONFIG, DATA, bundle, cmd, envOf, testInit } from './helpers.js';
import { fastWaves, hordeOf, runTo, survivalInit, wave } from './survivalHarness.js';

// Base defence, the defend stance (sim 0.30.0, data 0.36.0; Martien 20 October): an attacked base makes its fighters
// and armed workers defend it inside the radius (no charge, no chase), its unarmed units (the Raider slaves) shelter at
// the HQ or Kooi; once calm the work resumes. On in Survival, off in skirmish (data toggle).

const RAIDERS = DATA.factions.find((f) => f.key === 'raiders')!.id;
const DWELLERS = DATA.factions.find((f) => f.key === 'dwellers')!.id;
const SCAV = ROLES.indexOf('scavenger');
const BUILDER = ROLES.indexOf('builder');
const isWorker = (sim: Sim, i: number): boolean =>
  sim.world.role[i] === SCAV || sim.world.role[i] === BUILDER;
const CALM = CONFIG.baseDefense.calmTicks;
const MARK_DEFEND = 1;
const MARK_RETURN = 3;

/** Distance squared from i to the centre of player 0's build zone, and the zone radius. */
const zoneOf = (sim: Sim) => sim.map.survival!.zones[0]!;
const fromZone2 = (sim: Sim, i: number): number => {
  const z = zoneOf(sim);
  return (sim.world.x[i]! - z.x) ** 2 + (sim.world.y[i]! - z.y) ** 2;
};

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

/** Runs until player 0's alarm is on. */
function toAlarm(sim: Sim): void {
  for (let f = 0; f < 400 && sim.defense.alarm[0] === 0; f++) runTo(sim, sim.frame + 1);
  expect(sim.defense.alarm[0]).toBeGreaterThan(0);
}

describe('base defence', () => {
  for (const [name, faction] of [
    ['Dwellers (armed workers)', DWELLERS],
    ['Raiders (slaves)', RAIDERS],
  ] as const) {
    it(`${name}: armed units defend inside the radius, unarmed shelter, then the work resumes`, () => {
      const { sim, workers, fighters } = attacked(faction);
      const w = sim.world;
      const armed = workers.filter((i) => w.damage[i]! > 0);
      const unarmed = workers.filter((i) => w.damage[i]! === 0);
      expect(fighters.length).toBeGreaterThan(0);
      if (faction === RAIDERS) {
        expect(unarmed.length).toBeGreaterThan(0);
        expect(unarmed.every((i) => w.slaveState[i] === SLAVE_SLAVE)).toBe(true);
      } else expect(armed.length).toBeGreaterThan(0);
      toAlarm(sim);
      runTo(sim, sim.frame + 1);
      const busy = (i: number) => w.orderType(i);
      // armed workers defend (an Attack in front of their Gather), never shelter; the unarmed shelter
      for (const i of armed)
        if (w.hp[i]! > 0) expect([ORDER_ATTACK, ORDER_GATHER]).toContain(busy(i));
      if (armed.length > 0)
        expect(armed.filter((i) => busy(i) === ORDER_ATTACK).length).toBeGreaterThan(0);
      for (const i of unarmed)
        if (w.hp[i]! > 0) expect([ORDER_MOVE, ORDER_GATHER]).toContain(busy(i));
      if (unarmed.length > 0)
        expect(unarmed.filter((i) => busy(i) === ORDER_MOVE).length).toBeGreaterThan(0);
      expect(
        fighters.filter((i) => busy(i) === ORDER_ATTACK || w.resolve(w.target[i]!) >= 0).length,
      ).toBeGreaterThan(0);
      // the defenders kill it without leaving the zone; calm after CALM ticks, everyone back at work
      const r = zoneOf(sim).radius + 4 * 256;
      for (let f = 0; f < 1200 && hordeOf(sim).length > 0; f++) {
        runTo(sim, sim.frame + 1);
        for (let i = 0; i < w.highWater; i++)
          if (sim.defense.mark[i] === MARK_DEFEND)
            expect(fromZone2(sim, i)).toBeLessThanOrEqual(r * r);
      }
      expect(hordeOf(sim)).toHaveLength(0);
      runTo(sim, sim.frame + CALM + 4);
      expect(sim.defense.alarm[0]).toBe(0);
      for (const i of workers)
        if (w.alive[i] === 1 && w.hp[i]! > 0) expect(busy(i)).toBe(ORDER_GATHER);
      for (const i of [...workers, ...fighters])
        if (w.alive[i] === 1) expect(busy(i)).not.toBe(ORDER_ATTACK);
    });
  }

  it('does not chase a threat out of the radius: the defenders walk back to their post', () => {
    const { sim } = attacked(DWELLERS);
    const w = sim.world;
    toAlarm(sim);
    runTo(sim, sim.frame + 2);
    const posts = new Map<number, [number, number]>();
    for (let i = 0; i < w.highWater; i++)
      if (sim.defense.mark[i] === MARK_DEFEND) {
        const o = w.currentOrder(i);
        posts.set(i, [w.ordX[o]!, w.ordY[o]!]);
      }
    expect(posts.size).toBeGreaterThan(0);
    // the threat steps out: twice the radius east of the zone centre
    const z = zoneOf(sim);
    for (const [k, i] of hordeOf(sim).entries()) {
      w.x[i] = z.x + 2 * z.radius + k * 256;
      w.y[i] = z.y;
    }
    runTo(sim, sim.frame + 1);
    expect(sim.defense.alarm[0]).toBeGreaterThan(0);
    for (const [i, [x, y]] of posts) {
      if (w.alive[i] !== 1 || w.hp[i]! <= 0) continue;
      expect(w.orderType(i)).not.toBe(ORDER_ATTACK);
      if (sim.defense.mark[i] === MARK_RETURN) {
        expect(w.orderType(i)).toBe(ORDER_MOVE);
        expect([w.ordX[w.currentOrder(i)], w.ordY[w.currentOrder(i)]]).toEqual([x, y]);
      }
    }
    expect([...posts.keys()].some((i) => sim.defense.mark[i] === MARK_RETURN)).toBe(true);
  });

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

  it('is off in skirmish when the toggle is off: no state, no env hash change', () => {
    // data 0.39.0 turns the skirmish toggle on; the off case is built here
    const base = testInit();
    const init = {
      ...base,
      config: { ...base.config, baseDefense: { ...base.config.baseDefense, skirmish: false } },
    };
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

  it('clears the defence mark when an entity dies or is freed: a unit on a reused index is no defender', () => {
    const { sim } = attacked(DWELLERS);
    const w = sim.world;
    toAlarm(sim);
    runTo(sim, sim.frame + 1);
    const marked = (): number[] => {
      const out: number[] = [];
      for (let i = 0; i < w.highWater; i++) if (sim.defense.mark[i] !== 0) out.push(i);
      return out;
    };
    const [dies, freed] = marked();
    expect(freed).toBeDefined();
    // death (system 8): the mark goes with the hp, also while it lies as a corpse
    w.hp[dies!] = 0;
    runTo(sim, sim.frame + 1);
    expect(sim.defense.mark[dies!]).toBe(0);
    // freed (World.free): a new unit on the same index starts without a mark
    const typeId = w.typeId[freed!]!;
    const x = w.x[freed!]!;
    const y = w.y[freed!]!;
    expect(sim.defense.mark[freed!]).not.toBe(0);
    expect(sim.destroyEntity(w.idOf(freed!))).toBe(true);
    expect(sim.defense.mark[freed!]).toBe(0);
    const id = sim.spawnUnit({ typeId, owner: 0, x, y });
    expect(w.resolve(id)).toBe(freed);
    expect(sim.defense.mark[freed!]).toBe(0);
  });
});
