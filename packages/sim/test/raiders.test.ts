import { describe, expect, it } from 'vitest';
import { OWNER_NEUTRAL } from '@crawlout/protocol';
import type { CommandEnvelope } from '@crawlout/protocol';
import { ROLES } from '@crawlout/data';
import { HERO_DEAD, createSim } from '../src/index.js';
import type { Sim } from '../src/index.js';
import {
  CHEM_ACTIVE,
  CHEM_COOL,
  CHEM_CRASH,
  CHEM_NONE,
  SLAVE_CAPTIVE,
  SLAVE_FREED,
  SLAVE_NONE,
  SLAVE_SLAVE,
} from '../src/ecs/world.js';
import { PLACE_HQ_RANGE, PLACE_OK, placementReasonAt } from '../src/systems/placement.js';
import { cellCenter, createOpenMap, createTestMap } from '../src/testing.js';
import { CONFIG, DATA, SCAV, bundle, cmd, emptySim, testInit, typeByKey } from './helpers.js';

// Raiders in the sim (sim 0.18.0, data 0.21.0): start slaves, tents and the safety net, beds, capture, the captive's
// way to the cage, liberation, revolt, the work radius and SetRole at a cage, chems, the Warlord's aura, plunder,
// tribute and the Kooi's placement rule. Raiders are player 0, Dwellers player 1, on an open 64 x 64 map with the
// compact footprints of helpers.ts (a camp of 5 x 5, a tent and a cage of 3 x 3).

const RAIDERS = DATA.factions.findIndex((f) => f.key === 'raiders');
const PLAYERS = [
  { factionId: RAIDERS, ai: false },
  { factionId: 0, ai: false },
];
const R = CONFIG.factions[RAIDERS]!;
const RULES = R.slaves!;
const CAMP = typeByKey('raiderkamp');
const KOOI = typeByKey('kooi');
const TENT = typeByKey('tent');
const MARKET = typeByKey('plundermarkt');
const POST = typeByKey('plunderpost');
const HQ = typeByKey('hoofdgebouw');
const WONING = typeByKey('woning');
const WERKPLAATS = typeByKey('werkplaats');
const SLAAF = typeByKey('slaaf');
const SLAAF_BOUWER = typeByKey('slaaf_bouwer');
const PLUNDERAAR = typeByKey('plunderaar');
const SLAVER = typeByKey('slaver');
const DEALER = typeByKey('chemdealer');
const MILITIE = typeByKey('militie');
const unitType = (typeId: number) => CONFIG.unitTypes.find((u) => u.typeId === typeId)!;
const buildingType = (typeId: number) => CONFIG.buildingTypes.find((b) => b.typeId === typeId)!;
const techId = (key: string): number => DATA.tech.find((t) => t.key === key)!.id;
const research = (sim: Sim, p: number, ...keys: string[]): void => {
  for (const k of keys) sim.ps.tech[p] = (sim.ps.tech[p]! | (1 << techId(k))) >>> 0;
};

function play(sim: Sim, frames: number, script: Map<number, CommandEnvelope[]> = new Map()): void {
  for (let n = 0; n < frames; n++) {
    const f = sim.frame;
    sim.applyBundle(bundle(f, script.get(f) ?? []));
    sim.tick();
  }
}
const now = (sim: Sim, playerId: number, type: CommandEnvelope['type'], payload: unknown): void =>
  play(sim, 1, new Map([[sim.frame, [cmd(sim.frame, playerId, type, payload)]]]));
const open = (): Sim => emptySim(1, createOpenMap(64, 64), PLAYERS);
const idx = (sim: Sim, id: number): number => sim.world.resolve(id);
const spawn = (sim: Sim, typeId: number, owner: number, cx: number, cy: number): number => {
  const id = sim.spawnUnit({ typeId, owner, ...cellCenter(cx, cy) });
  expect(id).not.toBe(0);
  return id;
};
/** A slave of player 0 bound to cage `cage`, taken from player `from`. */
function slave(sim: Sim, cx: number, cy: number, cage: number, from = OWNER_NEUTRAL): number {
  const id = spawn(sim, SLAAF, 0, cx, cy);
  const i = idx(sim, id);
  sim.world.slaveState[i] = SLAVE_SLAVE;
  sim.world.slaveCage[i] = cage;
  sim.world.slaveFrom[i] = from;
  return id;
}
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
    expect(sim.playerStatus(0).settlers).toBe(2); // the Slaver and his slave (the hero is no settler)
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

  it('enough fighters within the garrison radius keep the slaves; too few revolt after graceTicks', () => {
    const sim = open();
    const camp = sim.spawnBuilding(CAMP, 0, 2, 2, true);
    const ids = [0, 1, 2, 3].map((k) => slave(sim, 10 + k, 10, camp));
    const need = Math.max(RULES.minGuards, Math.ceil(4 / RULES.slavesPerGuard));
    const guards = Array.from({ length: need }, (_, k) => spawn(sim, PLUNDERAAR, 0, 12 + k, 14));
    play(sim, RULES.graceTicks + 10);
    expect(ids.every((id) => sim.world.owner[idx(sim, id)] === 0)).toBe(true);
    sim.destroyEntity(guards[0]!);
    play(sim, RULES.emptyGraceTicks + 5);
    expect(ids.every((id) => sim.world.owner[idx(sim, id)] === 0)).toBe(true); // short, not empty
    play(sim, RULES.graceTicks);
    expect(ids.some((id) => sim.world.owner[idx(sim, id)] === OWNER_NEUTRAL)).toBe(true);
  });
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

describe('Raiders: chems', () => {
  function chemSim(): { sim: Sim; dealer: number; fighter: number } {
    const sim = open();
    research(sim, 0, 'chemie', 'psycho');
    sim.setScrap(0, 200);
    const dealer = spawn(sim, DEALER, 0, 20, 20);
    const fighter = spawn(sim, PLUNDERAAR, 0, 21, 20);
    spawn(sim, MILITIE, 1, 27, 20);
    return { sim, dealer, fighter };
  }
  const psycho = R.chems[0]!;

  it('the dealer doses the units in its aura in a fight: active, crash, cooldown, then free again', () => {
    const { sim, fighter } = chemSim();
    const w = sim.world;
    const i = idx(sim, fighter);
    play(sim, 5);
    expect(w.chemPhase[i]).toBe(CHEM_ACTIVE);
    expect(w.chem[i]).toBe(1);
    expect(sim.playerStatus(0).scrap).toBe(200 - 2 * psycho.doseScrap); // the dealer and the fighter
    const dmg = psycho.effects.filter((e) => e.stat === 1).reduce((a, e) => a + e.delta, 0);
    expect(sim.auras.damage[i]).toBe(dmg);
    play(sim, psycho.activeTicks);
    expect(w.chemPhase[i]).toBe(CHEM_CRASH);
    expect(sim.auras.damage[i]!).toBeLessThan(0);
    play(sim, psycho.crashTicks);
    expect(w.chemPhase[i]).toBe(CHEM_COOL);
    play(sim, psycho.cooldownTicks);
    expect([CHEM_NONE, CHEM_ACTIVE]).toContain(w.chemPhase[i]);
  });

  it('no dose without a fight, without the tech or without scrap; refined stretches the active phase', () => {
    const sim = open();
    research(sim, 0, 'chemie');
    sim.setScrap(0, 200);
    spawn(sim, DEALER, 0, 20, 20);
    const f = spawn(sim, PLUNDERAAR, 0, 21, 20);
    play(sim, 20);
    expect(sim.world.chemPhase[idx(sim, f)]).toBe(CHEM_NONE);
    const { sim: s2, fighter } = chemSim();
    research(s2, 0, 'jet', 'zuivere_stoffen');
    play(s2, 5);
    const refined = psycho.refined!;
    const left = s2.world.chemTicks[idx(s2, fighter)]!;
    expect(left).toBeGreaterThan(psycho.activeTicks);
    expect(left).toBeLessThanOrEqual(
      Math.trunc((psycho.activeTicks * (1000 + refined.activePermille)) / 1000),
    );
  });
});

describe('Raiders: the Warlord, plunder and tribute', () => {
  it("the Warlord's aura weakens enemy units around him", () => {
    const sim = createSim(testInit(3, createTestMap(), PLAYERS));
    const hero = sim.ps.heroEnt[0]!;
    const h = sim.getUnit(hero)!;
    const enemy = sim.spawnUnit({ typeId: SCAV, owner: 1, x: h.x + 512, y: h.y });
    const near =
      enemy !== 0 ? enemy : sim.spawnUnit({ typeId: SCAV, owner: 1, x: h.x, y: h.y + 512 });
    play(sim, 1);
    const aura = CONFIG.heroes[R.heroId]!.aura!;
    const dmg = aura.effects.filter((e) => e.stat === 1).reduce((a, e) => a + e.delta, 0);
    expect(sim.auras.damage[idx(sim, near)]).toBe(dmg);
    expect(CONFIG.heroes[R.heroId]!.baseTypeId).toBe(typeByKey('warlord_basis'));
  });

  it('plunder: a razed building gives buildingLootPermille of its price, a depot more; a killed gatherer its cargo', () => {
    const pl = R.plunder!;
    const sim = open();
    sim.spawnBuilding(HQ, 1, 50, 50, true);
    const woning = sim.spawnBuilding(WONING, 1, 20, 20, true);
    const ws = sim.spawnBuilding(WERKPLAATS, 1, 30, 20, true);
    const a = spawn(sim, PLUNDERAAR, 0, 19, 24);
    const b = spawn(sim, PLUNDERAAR, 0, 29, 24);
    const w = sim.world;
    w.hp[idx(sim, woning)] = 1;
    w.hp[idx(sim, ws)] = 1;
    sim.setScrap(0, 0);
    now(sim, 0, 'Attack', { ids: [a], target: woning });
    now(sim, 0, 'Attack', { ids: [b], target: ws });
    play(sim, 60);
    const loot = (cost: number, depot: boolean): number => {
      const l = Math.trunc((cost * pl.buildingLootPermille) / 1000);
      return depot ? Math.trunc((l * pl.depotLootMultiplierPermille) / 1000) : l;
    };
    expect(sim.playerStatus(0).scrap).toBe(
      loot(buildingType(WONING).scrapCost, false) + loot(buildingType(WERKPLAATS).scrapCost, true),
    );
    const g = spawn(sim, SCAV, 1, 24, 26); // within sight of the plunderaars (fog of war)
    w.carry[idx(sim, g)] = 6;
    w.hp[idx(sim, g)] = 1;
    sim.setScrap(0, 0);
    now(sim, 0, 'Attack', { ids: [a, b], target: g });
    play(sim, 200);
    expect(sim.playerStatus(0).scrap).toBe(Math.trunc((6 * pl.carryLootPermille) / 1000));
  });

  it('tribute: a held settlement claim point pays scrapPerMin', () => {
    const tr = R.tribute!;
    const sim = createSim(testInit(1, createOpenMap(64, 64), PLAYERS));
    const pt = sim.entityIds().find((id) => sim.getUnit(id)!.kind === 'claimPoint')!;
    const p = sim.getUnit(pt)!;
    sim.spawnBuilding(POST, 0, (p.x >> 8) + 2, p.y >> 8, true);
    play(sim, 2);
    expect(sim.getUnit(pt)!.owner).toBe(0);
    sim.setScrap(0, 0);
    play(sim, CONFIG.ticksPerMinute);
    expect(sim.playerStatus(0).scrap).toBeGreaterThanOrEqual(tr.scrapPerMin - 1);
    expect(sim.playerStatus(0).scrap).toBeLessThanOrEqual(tr.scrapPerMin);
  });
});
