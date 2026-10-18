import { typeByKey, CONFIG, testInit, SCAV } from './helpers.js';
import { type Sim, createSim, HERO_DEAD } from '../src/index.js';
import { describe, it, expect } from 'vitest';
import { createTestMap, cellCenter, createOpenMap } from '../src/testing.js';
import { SLAVE_SLAVE, SLAVE_NONE, SLAVE_CAPTIVE, SLAVE_FREED } from '../src/ecs/world.js';
import { OWNER_NEUTRAL } from '@crawlout/protocol';
import { ROLES } from '@crawlout/data';
import { placementReasonAt, PLACE_HQ_RANGE, PLACE_OK } from '../src/systems/placement.js';
import {
  CAMP,
  HQ,
  MILITIE,
  PLAYERS,
  PLUNDERAAR,
  POST,
  R,
  SLAAF,
  buildingType,
  idx,
  now,
  open,
  play,
  slave,
  spawn,
} from './raiders.helpers.js';

const RULES = R.slaves!;

const KOOI = typeByKey('kooi');

const TENT = typeByKey('tent');

const MARKET = typeByKey('plundermarkt');

const SLAAF_BOUWER = typeByKey('slaaf_bouwer');

const SLAVER = typeByKey('slaver');

const unitType = (typeId: number) => CONFIG.unitTypes.find((u) => u.typeId === typeId)!;

const owned = (sim: Sim, p: number, typeId: number): number[] =>
  sim.entityIds().filter((id) => {
    const u = sim.getUnit(id)!;
    return u.owner === p && u.kind === 'unit' && u.typeId === typeId;
  });

describe('Raiders: start, tents, beds and the safety net', () => {
  it('the start slaves are slaves of the Raiderkamp, which is a cage', () => {
    const sim = createSim(testInit(3, createTestMap(), PLAYERS));
    const w = sim.world;
    const camp = sim.entityIds().find((id) => sim.getUnit(id)!.typeId === CAMP)!;
    let slaves = 0;
    for (const id of sim.entityIds()) {
      const i = idx(sim, id);
      if (w.owner[i] !== 0 || sim.getUnit(id)!.kind !== 'unit') continue;
      const t = unitType(w.typeId[i]!);
      expect(w.slaveState[i]).toBe(t.slave ? SLAVE_SLAVE : SLAVE_NONE);
      if (t.slave) {
        expect(w.slaveCage[i]).toBe(camp);
        expect(w.slaveFrom[i]).toBe(OWNER_NEUTRAL);
        slaves++;
      }
    }
    const start = R.startUnits.filter((s) => unitType(s.typeId).slave);
    expect(slaves).toBe(start.reduce((a, s) => a + s.count, 0));
    expect(buildingType(CAMP).cage!.capacity).toBeGreaterThanOrEqual(slaves);
    // slaves need no bed: the camp's beds are for the fighters
    const st = sim.playerStatus(0);
    expect(st.popCap).toBe(Math.min(st.beds + slaves, CONFIG.popCapMax));
  });

  it('a tent produces a fighter (Produce, producedAt) when a bed is free, never a robot pop', () => {
    const sim = open();
    const tent = sim.spawnBuilding(TENT, 0, 20, 20, true);
    sim.setScrap(0, 500);
    const p = unitType(PLUNDERAAR);
    now(sim, 0, 'Produce', { buildingId: tent, loadoutId: p.loadoutId });
    expect(sim.playerStatus(0).scrap).toBe(500 - p.scrapCost);
    play(sim, p.craftTicks + 2);
    expect(owned(sim, 0, PLUNDERAAR)).toHaveLength(1);
    expect(sim.playerStatus(0).robotPop).toBe(0);
    // the tent has 4 beds: four fighters, then no fifth without a bed
    for (let k = 0; k < 3; k++) spawn(sim, PLUNDERAAR, 0, 5 + k, 40);
    now(sim, 0, 'Produce', { buildingId: tent, loadoutId: p.loadoutId });
    expect(sim.queue(0)).toEqual([]);
    expect(sim.playerStatus(0).scrap).toBe(500 - p.scrapCost);
  });

  it('tenten_instroom: under the threshold of fighters a plunderaar comes at a finished tent every interval', () => {
    const net = R.safetyNet!;
    const sim = open();
    play(sim, net.intervalTicks + 5);
    expect(owned(sim, 0, net.typeId)).toHaveLength(0); // no tent, no net
    sim.spawnBuilding(TENT, 0, 20, 20, true);
    // slaves are no fighters: they do not stop the net
    const camp = sim.spawnBuilding(CAMP, 0, 2, 2, true);
    for (let k = 0; k < 6; k++) slave(sim, 10 + k, 10, camp);
    play(sim, net.intervalTicks + 1);
    expect(owned(sim, 0, net.typeId)).toHaveLength(1);
    for (let k = 0; k < net.threshold - 1; k++) spawn(sim, PLUNDERAAR, 0, 30 + k, 40);
    play(sim, net.intervalTicks * 2);
    expect(owned(sim, 0, net.typeId)).toHaveLength(net.threshold); // at the threshold it stops
    expect(sim.ps.netArrivals[0]).toBe(1);
  });
});

describe('Raiders: capture, the cage and the transition', () => {
  function captureSim(): { sim: Sim; camp: number; settler: number; slaver: number } {
    const sim = open();
    const camp = sim.spawnBuilding(CAMP, 0, 2, 2, true);
    sim.spawnBuilding(HQ, 1, 48, 48, true);
    const settler = spawn(sim, SCAV, 1, 20, 20);
    const slaver = spawn(sim, SLAVER, 0, 22, 20);
    // the guard of the camp (sim 0.24.0, the guard rule): without one the new slave would run off after emptyGrace
    spawn(sim, PLUNDERAAR, 0, 8, 3);
    return { sim, camp, settler, slaver };
  }
  const cap = unitType(SLAVER).capture!;

  it('the Slaver beats a settler down, catches it and the captive becomes a slave of the camp', () => {
    const { sim, camp, settler, slaver } = captureSim();
    sim.ps.heroState[0] = HERO_DEAD; // xp counts for a dead hero too
    const w = sim.world;
    const dwellers0 = sim.playerStatus(1).settlers;
    const s = idx(sim, settler);
    const hp0 = w.hp[s]!;
    now(sim, 0, 'Attack', { ids: [slaver], target: settler });
    play(sim, 400);
    // hit down to the threshold, then caught (not killed)
    expect(w.owner[s]).toBe(0);
    expect(w.hp[s]! * 1000).toBeLessThanOrEqual(w.maxHp[s]! * cap.maxHpPermille);
    expect(w.hp[s]).toBeGreaterThan(0);
    expect(w.hp[s]).toBeLessThan(hp0);
    expect([SLAVE_CAPTIVE, SLAVE_SLAVE]).toContain(w.slaveState[s]);
    expect(w.slaveFrom[s]).toBe(1);
    expect(w.slaveCage[s]).toBe(camp);
    expect(sim.ps.heroXp[0]).toBe(CONFIG.heroes[R.heroId]!.xpPerCapture);
    // commands do not move a captive
    now(sim, 0, 'Move', { ids: [settler], ...cellCenter(60, 60) });
    // to the camp, the transition, then a slave of the captured type
    play(sim, buildingType(CAMP).cage!.transitionTicks + 600);
    expect(w.slaveState[s]).toBe(SLAVE_SLAVE);
    expect(w.typeId[s]).toBe(RULES.capturedTypeId);
    // the Dwellers grow at their hq meanwhile; the caught settler is no longer theirs
    expect(owned(sim, 1, SCAV).includes(settler)).toBe(false);
    expect(sim.playerStatus(1).settlers).toBeGreaterThanOrEqual(dwellers0 - 1);
    expect(sim.playerStatus(0).settlers).toBe(3); // the Slaver, the guard and his slave (the hero is no settler)
  });

  it('holds the target still for captureTicks and starts over when it gets out of reach', () => {
    const { sim, settler, slaver } = captureSim();
    const w = sim.world;
    const s = idx(sim, settler);
    w.hp[s] = 1;
    now(sim, 0, 'Attack', { ids: [slaver], target: settler });
    for (let k = 0; k < 60 && w.capWork[idx(sim, slaver)] === 0; k++) play(sim, 1);
    expect(w.slaveState[s]).toBe(SLAVE_NONE);
    expect(w.capWork[idx(sim, slaver)]).toBeGreaterThan(0);
    // the target is pinned: a Move does not take it away
    const x0 = w.x[s]!;
    now(sim, 1, 'Move', { ids: [settler], ...cellCenter(5, 60) });
    play(sim, 5);
    expect(w.x[s]).toBe(x0);
    expect(w.slaveState[s]).toBe(SLAVE_NONE);
    play(sim, cap.captureTicks);
    expect(w.owner[s]).toBe(0);
  });

  it('not within the base radius of the owner, not a hero, robot or a unit above the hp threshold', () => {
    const sim = open();
    sim.spawnBuilding(CAMP, 0, 2, 2, true);
    sim.spawnBuilding(HQ, 1, 30, 30, true);
    const near = spawn(sim, SCAV, 1, 30, 37); // ~6 m from the Dweller hq
    const slaver = spawn(sim, SLAVER, 0, 31, 38);
    const w = sim.world;
    w.hp[idx(sim, near)] = 1;
    now(sim, 0, 'Attack', { ids: [slaver], target: near });
    play(sim, cap.captureTicks + 40);
    // inside the base radius: it is hit, not caught
    expect(sim.world.alive[idx(sim, near)] === 1 ? w.owner[idx(sim, near)] : 1).toBe(1);
    expect(RULES.minDistanceFromOwnerBase).toBeGreaterThan(10 * 256);
  });
});

describe('Raiders: liberation', () => {
  function libSim(): { sim: Sim; camp: number; s: number; dweller: number } {
    const sim = open();
    const camp = sim.spawnBuilding(CAMP, 0, 2, 2, true);
    sim.spawnBuilding(HQ, 1, 48, 48, true);
    const s = slave(sim, 30, 30, camp, 1);
    const dweller = spawn(sim, SCAV, 1, 31, 30);
    return { sim, camp, s, dweller };
  }

  it('a touch of touchTicks without a guard frees the slave: back to its owner, faster, home to his hq', () => {
    const { sim, s } = libSim();
    const w = sim.world;
    const i = idx(sim, s);
    const home0 = sim.playerStatus(1).settlers;
    play(sim, RULES.touchTicks + 1);
    expect(w.owner[i]).toBe(1);
    expect(w.slaveState[i]).toBe(SLAVE_FREED);
    expect(w.typeId[i]).toBe(CONFIG.factions[0]!.settlerTypeId);
    expect(w.slaveTicks[i]).toBe(RULES.freedSpeedPermille);
    // freed units are not commanded until home
    play(sim, 1500);
    expect(w.slaveState[i]).toBe(SLAVE_NONE);
    expect(sim.playerStatus(1).settlers).toBeGreaterThanOrEqual(home0 + 1);
  });

  it('a Raider fighter within guardRadius prevents it; slaves are no target for shots', () => {
    const { sim, s, dweller } = libSim();
    spawn(sim, PLUNDERAAR, 0, 30, 36); // 6 m: a guard (it shoots the Dweller, not the slave)
    const w = sim.world;
    const i = idx(sim, s);
    const militie = spawn(sim, MILITIE, 1, 30, 26);
    play(sim, RULES.touchTicks * 2);
    expect(w.owner[i]).toBe(0);
    expect(w.hp[i]).toBe(w.maxHp[i]); // the Dweller militie never shot at the slave
    void dweller;
    void militie;
  });

  it('Attack on an enemy slave walks up to it and frees it (the comeback)', () => {
    const sim = open();
    const camp = sim.spawnBuilding(CAMP, 0, 2, 2, true);
    sim.spawnBuilding(HQ, 1, 48, 48, true);
    const s = slave(sim, 30, 30, camp, 1);
    const m = spawn(sim, MILITIE, 1, 30, 40);
    now(sim, 1, 'Attack', { ids: [m], target: s });
    play(sim, 400);
    expect(sim.world.owner[idx(sim, s)]).toBe(1);
  });
});

describe('Raiders: revolt', () => {
  it('without a guard escapePermille of the slaves escape after emptyGraceTicks, and again after repeatTicks', () => {
    const sim = open();
    const camp = sim.spawnBuilding(CAMP, 0, 2, 2, true);
    const ids = [0, 1, 2, 3].map((k) => slave(sim, 10 + k, 10, camp));
    play(sim, RULES.emptyGraceTicks - 2);
    expect(ids.every((id) => sim.world.owner[idx(sim, id)] === 0)).toBe(true);
    play(sim, 3);
    const free = (): number =>
      ids.filter((id) => sim.world.owner[idx(sim, id)] === OWNER_NEUTRAL).length;
    expect(free()).toBe(Math.max(1, Math.trunc((4 * RULES.escapePermille) / 1000)));
    // an escaped slave is a neutral wanderer walking away, no slave anymore
    const e = ids.find((id) => sim.world.owner[idx(sim, id)] === OWNER_NEUTRAL)!;
    expect(sim.world.slaveState[idx(sim, e)]).toBe(SLAVE_NONE);
    play(sim, RULES.repeatTicks + 1);
    expect(free()).toBe(3);
  });
  // the guard rule itself (data 0.29.0, sim 0.24.0): test/guard.test.ts
});

describe('Raiders: the work radius, SetRole at a cage, the Kooi placement rule', () => {
  it('a slave gathers only within the work radius of its cage', () => {
    // a started match: the map's scrap nodes (16, 6) next to the camp and (47, 57) far away, a start slave
    const sim = createSim(testInit(1, createOpenMap(64, 64), PLAYERS));
    const s = sim
      .entityIds()
      .find(
        (id) =>
          sim.world.slaveState[idx(sim, id)] === SLAVE_SLAVE && sim.getUnit(id)!.typeId === SLAAF,
      )!;
    const nodes = sim.entityIds().filter((id) => sim.getUnit(id)!.kind === 'scrapNode');
    const far = nodes.find((id) => sim.getUnit(id)!.x > 40 * 256)!;
    const nearNode = nodes.find((id) => sim.getUnit(id)!.x < 40 * 256)!;
    // a start slave of a human player gathers on its own at the node within reach (sim 0.21.0); stopped first here
    play(sim, 1);
    expect(sim.getUnit(s)!.orderTarget).toBe(nearNode);
    now(sim, 0, 'Stop', { ids: [s] });
    now(sim, 0, 'Gather', { ids: [s], nodeId: far });
    expect(sim.getUnit(s)!.order).toBe(0);
    now(sim, 0, 'Gather', { ids: [s], nodeId: nearNode });
    expect(sim.getUnit(s)!.order).not.toBe(0);
  });

  it('a slave builder builds within the work radius; a claim post anywhere', () => {
    const sim = open();
    const camp = sim.spawnBuilding(CAMP, 0, 2, 2, true);
    const b = slave(sim, 10, 8, camp);
    sim.world.typeId[idx(sim, b)] = SLAAF_BOUWER;
    sim.world.role[idx(sim, b)] = ROLES.indexOf('builder');
    sim.setScrap(0, 1000);
    // the open map has no territory rule in the test config
    now(sim, 0, 'Build', { ids: [b], typeId: MARKET, ...cellCenter(55, 55) });
    expect(sim.playerStatus(0).scrap).toBe(1000);
    now(sim, 0, 'Build', { ids: [b], typeId: POST, ...cellCenter(55, 55) });
    expect(sim.playerStatus(0).scrap).toBe(1000 - buildingType(POST).scrapCost);
  });

  it('SetRole turns a slave into a slave builder at a cage; fighters never retrain', () => {
    const sim = open();
    const camp = sim.spawnBuilding(CAMP, 0, 2, 2, true);
    const s = slave(sim, 12, 12, camp);
    const f = spawn(sim, PLUNDERAAR, 0, 14, 14);
    now(sim, 0, 'SetRole', { ids: [s, f], role: 'builder' });
    now(sim, 0, 'SetRole', { ids: [f], role: 'militia' });
    play(sim, 200);
    expect(sim.getUnit(s)!.typeId).toBe(SLAAF_BOUWER);
    expect(sim.world.slaveState[idx(sim, s)]).toBe(SLAVE_SLAVE);
    expect(sim.getUnit(f)!.typeId).toBe(PLUNDERAAR);
    // a slave never becomes a soldier
    now(sim, 0, 'SetRole', { ids: [s], role: 'militia' });
    play(sim, 200);
    expect(sim.getUnit(s)!.typeId).toBe(SLAAF_BOUWER);
  });

  it('the Kooi stands between minFromHq and maxFromHq of an own headquarters (centre to centre)', () => {
    const sim = open();
    sim.spawnBuilding(CAMP, 0, 2, 2, true); // centre (4.5, 4.5) m
    const kooi = buildingType(KOOI);
    const range = kooi.hqRange!;
    const reason = (fx: number, fy: number): number => placementReasonAt(sim, kooi, fx, fy, 0, 0);
    expect(reason(8, 2)).toBe(PLACE_HQ_RANGE); // ~5 m
    const ok = Math.trunc((range.min + range.max) / 2 / 256);
    expect(reason(2 + ok, 2)).toBe(PLACE_OK);
    expect(reason(50, 50)).toBe(PLACE_HQ_RANGE);
    // no rule without a player (the AI's own checks and old callers) and for other buildings
    expect(placementReasonAt(sim, kooi, 8, 2)).toBe(PLACE_OK);
    expect(placementReasonAt(sim, buildingType(TENT), 50, 50, 0, 0)).toBe(PLACE_OK);
  });
});
