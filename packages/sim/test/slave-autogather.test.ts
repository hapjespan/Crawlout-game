import { describe, expect, it } from 'vitest';
import type { CommandEnvelope } from '@crawlout/protocol';
import { createSim } from '../src/index.js';
import type { Sim } from '../src/index.js';
import { ORDER_GATHER, SLAVE_SLAVE } from '../src/ecs/world.js';
import { createOpenMap } from '../src/testing.js';
import { CONFIG, DATA, bundle, cmd, testInit, typeByKey } from './helpers.js';

// Playtest M1 (sim 0.21.0): the Raiders' slaves go to work on their own like the Dwellers' new settlers
// (autoGatherRadiusM, orders.ts autoGather): the start slaves, a captive that becomes a slave at the cage (since sim
// 0.18.0), and a slave builder retrained into a slave at a cage (SetRole). Always the nearest node within
// autoGatherRadius and within the work radius of its cage; only for a human player (the scripted AI spreads its own).

const RAIDERS = DATA.factions.findIndex((f) => f.key === 'raiders');
const SLAAF = typeByKey('slaaf');
const SLAAF_BOUWER = typeByKey('slaaf_bouwer');
const CAMP = typeByKey('raiderkamp');

function play(sim: Sim, frames: number, script: Map<number, CommandEnvelope[]> = new Map()) {
  for (let n = 0; n < frames; n++) {
    const f = sim.frame;
    sim.applyBundle(bundle(f, script.get(f) ?? []));
    sim.tick();
  }
}
const now = (sim: Sim, type: CommandEnvelope['type'], payload: unknown): void =>
  play(sim, 1, new Map([[sim.frame, [cmd(sim.frame, 0, type, payload)]]]));
const idx = (sim: Sim, id: number): number => sim.world.resolve(id);
const slavesOf = (sim: Sim, typeId: number): number[] =>
  sim
    .entityIds()
    .filter(
      (id) =>
        sim.getUnit(id)!.owner === 0 &&
        sim.getUnit(id)!.typeId === typeId &&
        sim.world.slaveState[idx(sim, id)] === SLAVE_SLAVE,
    );
const raiders = (ai: boolean): Sim =>
  createSim(
    testInit(1, createOpenMap(64, 64), [
      { factionId: RAIDERS, ai },
      { factionId: 0, ai: false },
    ]),
  );

describe('M1: Raider slaves gather on their own', () => {
  it('the start slaves of a human Raider player gather at the node within reach of the camp', () => {
    const sim = raiders(false);
    const slaves = slavesOf(sim, SLAAF);
    expect(slaves.length).toBeGreaterThan(0);
    const scrap = sim.playerStatus(0).scrap;
    play(sim, 1);
    const camp = sim.entityIds().find((id) => sim.getUnit(id)!.typeId === CAMP)!;
    const c = sim.getUnit(camp)!;
    const work = CONFIG.buildingTypes.find((b) => b.typeId === CAMP)!.cage!.workRadius;
    for (const id of slaves) {
      const u = sim.getUnit(id)!;
      expect(u.order, `slave ${id}`).toBe(ORDER_GATHER);
      const n = sim.getUnit(u.orderTarget)!;
      expect(n.kind).toBe('scrapNode');
      expect(Math.hypot(n.x - c.x, n.y - c.y)).toBeLessThanOrEqual(work);
      expect(Math.hypot(n.x - u.x, n.y - u.y)).toBeLessThanOrEqual(CONFIG.autoGatherRadius);
    }
    // the start slave builder builds, it does not gather
    for (const id of slavesOf(sim, SLAAF_BOUWER)) expect(sim.getUnit(id)!.order).toBe(0);
    play(sim, CONFIG.ticksPerMinute);
    expect(sim.playerStatus(0).scrap).toBeGreaterThan(scrap);
  });

  it('the scripted AI spreads its own slaves: no automatic gather order', () => {
    const sim = raiders(true);
    const w = sim.world;
    for (const id of slavesOf(sim, SLAAF)) {
      const i = idx(sim, id);
      expect(w.currentOrder(i) < 0 || w.ordType[w.currentOrder(i)] !== ORDER_GATHER).toBe(true);
    }
  });

  it('a slave builder retrained into a slave at its cage (SetRole) goes to work', () => {
    const sim = raiders(false);
    const b = slavesOf(sim, SLAAF_BOUWER)[0]!;
    expect(b).toBeDefined();
    now(sim, 'SetRole', { ids: [b], role: 'scavenger' });
    play(sim, 400);
    const u = sim.getUnit(b)!;
    expect(u.typeId).toBe(SLAAF);
    expect(u.order).toBe(ORDER_GATHER);
  });
});
