// Split from raiders.test.ts to stay under the 5,000-token file limit.
import { grantTech } from '../src/techBits.js';
import { typeByKey, DATA, testInit, SCAV, CONFIG } from './helpers.js';
import { type Sim, createSim, type SimAiScript, type SimConfig } from '../src/index.js';
import { describe, it, expect } from 'vitest';
import { CHEM_ACTIVE, CHEM_CRASH, CHEM_COOL, CHEM_NONE, SLAVE_SLAVE } from '../src/ecs/world.js';
import { createTestMap, createOpenMap, cellCenter } from '../src/testing.js';
import { AI_SITE_HQ } from '../src/config.js';
import {
  CAMP,
  HQ,
  MILITIE,
  PLAYERS,
  PLUNDERAAR,
  POST,
  R,
  RAIDERS,
  buildingType,
  idx,
  now,
  open,
  play,
  slave,
  spawn,
} from './raiders.helpers.js';

const WONING = typeByKey('woning');

const WERKPLAATS = typeByKey('werkplaats');

const DEALER = typeByKey('chemdealer');

const techId = (key: string): number => DATA.tech.find((t) => t.key === key)!.id;

const research = (sim: Sim, p: number, ...keys: string[]): void => {
  for (const k of keys) grantTech(sim.ps, p, techId(k));
};

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

  it('PlayerStatus.chems (protocol 0.13.0, proposal) lists the dosed units with phase and ticks left', () => {
    const { sim, dealer, fighter } = chemSim();
    expect(sim.playerStatus(0).chems).toEqual([]);
    play(sim, 5);
    const chems = sim.playerStatus(0).chems!;
    const fighterId = sim.world.idOf(idx(sim, fighter));
    const own = chems.find((c) => c.unitId === fighterId)!;
    expect(own).toMatchObject({ chem: 0, phase: 'active' });
    expect(own.ticksLeft).toBeGreaterThan(0);
    expect(own.ticksLeft).toBeLessThanOrEqual(psycho.activeTicks);
    expect(chems.map((c) => c.unitId)).toEqual(
      [...chems.map((c) => c.unitId)].sort((a, b) => a - b),
    );
    expect(chems.some((c) => c.unitId === sim.world.idOf(idx(sim, dealer)))).toBe(true);
    expect(sim.playerStatus(1).chems).toEqual([]);
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
    // the start slaves gather on their own (sim 0.21.0): stopped, so only tribute pays
    const slaves = sim
      .entityIds()
      .filter((id) => sim.world.slaveState[idx(sim, id)] === SLAVE_SLAVE);
    now(sim, 0, 'Stop', { ids: slaves });
    sim.setScrap(0, 0);
    play(sim, CONFIG.ticksPerMinute);
    expect(sim.playerStatus(0).scrap).toBeGreaterThanOrEqual(tr.scrapPerMin - 1);
    expect(sim.playerStatus(0).scrap).toBeLessThanOrEqual(tr.scrapPerMin);
  });
});

describe('Dweller AI against Raiders (data 0.24.0): liberate and defendHqFirst', () => {
  // a Dweller AI that does nothing else: no builds, waves, claims or retraining; its militia stay where they stand
  const quietDwellers: SimAiScript = {
    ...CONFIG.aiScripts[0]!,
    buildOrder: [],
    attackTimersTicks: [],
    militiaPermille: 0,
    militiaPermilleMax: 0,
    militiaPermillePerMin: 0,
    threatMilitiaPermille: 0,
    builders: 0,
    housingTypeId: 0,
    research: [],
    richBuilds: [],
    claimFromTicks: 1 << 30,
    claimFarFromTicks: 1 << 30,
    heroClaimRadius: 0,
    waveIntervalTicks: 1 << 30,
    waveJitterTicks: 0,
    rallySite: AI_SITE_HQ,
    rallyRadius: 64 << 8,
    robots: null,
    reserve: null,
    training: null,
    allInWithoutNodes: false, // the open map has no scrap nodes
  };
  const LIBERATE = { minFree: 2, units: 2, radius: 40 << 8 };

  /** The slave's owner after 30 s: a Raider slave (taken from the Dwellers) 11 m from the Dweller headquarters. */
  function run(liberate: SimAiScript['liberate'], militia: number): number {
    const config: SimConfig = { ...CONFIG, aiScripts: [{ ...quietDwellers, liberate }] };
    const sim = createSim(
      {
        seed: 1,
        players: [
          { factionId: RAIDERS, ai: false },
          { factionId: 0, ai: true },
        ],
        map: createOpenMap(64, 64),
        config,
      },
      { start: false },
    );
    const camp = sim.spawnBuilding(CAMP, 0, 2, 2, true);
    sim.spawnBuilding(HQ, 1, 44, 44, true);
    const s = slave(sim, 36, 38, camp, 1);
    spawn(sim, PLUNDERAAR, 0, 8, 8); // the garrison of the camp (no revolt), far from the slave
    for (let k = 0; k < militia; k++) spawn(sim, MILITIE, 1, 54, 40 + k);
    play(sim, 600);
    return sim.world.owner[idx(sim, s)]!;
  }

  it('with spare idle militia the AI frees a visible enemy slave near its buildings (Attack = touch)', () => {
    expect(run(LIBERATE, 3)).toBe(1);
  });
  it('without liberate the slave stays a Raider slave (the militia do not walk there by themselves)', () => {
    expect(run(null, 3)).toBe(0);
  });
  it('with fewer idle militia than minFree it waits', () => {
    expect(run({ ...LIBERATE, minFree: 4 }, 3)).toBe(0);
  });

  /** Where the Dweller militia head 1 s after a Raider shows up at their headquarters while they march elsewhere. */
  function hqFirst(defendHqFirst: boolean): { x: number; y: number }[] {
    const config: SimConfig = { ...CONFIG, aiScripts: [{ ...quietDwellers, defendHqFirst }] };
    const sim = createSim(
      {
        seed: 1,
        players: [
          { factionId: RAIDERS, ai: false },
          { factionId: 0, ai: true },
        ],
        map: createOpenMap(64, 64),
        config,
      },
      { start: false },
    );
    sim.spawnBuilding(CAMP, 0, 2, 2, true);
    sim.spawnBuilding(HQ, 1, 44, 44, true);
    const ms = [0, 1, 2].map((k) => spawn(sim, MILITIE, 1, 54, 30 + k));
    // on their way to a far point (as to a threat elsewhere): not idle, so the AI otherwise leaves them
    now(sim, 1, 'AttackMove', { ids: ms, ...cellCenter(60, 4) });
    spawn(sim, PLUNDERAAR, 0, 40, 52);
    play(sim, 20);
    const w = sim.world;
    return ms.map((id) => {
      const o = w.currentOrder(idx(sim, id));
      return { x: w.ordX[o]! >> 8, y: w.ordY[o]! >> 8 };
    });
  }

  it('defendHqFirst (data 0.24.0): an enemy at the headquarters turns militia that march elsewhere', () => {
    for (const to of hqFirst(true))
      expect(Math.abs(to.x - 40) + Math.abs(to.y - 52)).toBeLessThan(4);
  });
  it('without defendHqFirst they march on', () => {
    for (const to of hqFirst(false)) expect(to).toEqual({ x: 60, y: 4 });
  });
});
