import { describe, expect, it } from 'vitest';
import { OWNER_NEUTRAL } from '@crawlout/protocol';
import type { CommandEnvelope } from '@crawlout/protocol';
import { createSim, deserialize, envHash } from '../src/index.js';
import type { Sim, SimMap } from '../src/index.js';
import { C, ORDER_ATTACK_MOVE } from '../src/ecs/world.js';
import {
  CAMP_CLEARED,
  CAMP_FIGHT,
  CAMP_IDLE,
  CAMP_RETURN,
  aiCreepRun,
  campAt,
} from '../src/systems/creeps.js';
import { raidOver } from '../src/systems/ai.js';
import { cellCenter, testPlayers } from '../src/testing.js';
import { CAMP_CELL, armyAt, bandits, campMap, fightCamp, heroOf } from './creepHarness.js';
import { CONFIG, MILITIA, bundle, cmd, envOf, typeByKey } from './helpers.js';

// Creep camps (sim 0.20.0, data 0.25.0; voorstel, ter bevestiging door de architect): the bandits of a camp spawn at
// the start, wake on a player unit in the aggro radius or a hit, fight player units within the leash circle and never
// buildings, go home and heal when leashed, and give their loot to the killing blow on the last bandit. Balance: a hero
// with 4 to 6 militia clears a low camp with losses, the high camp takes about ten units. On an open 128 x 128 map with
// the compact footprints of helpers.ts and one camp at cell (48, 64); the players' headquarters stand at (8, 8) and
// (119, 119).

const LOW = CONFIG.creepTiers!.find((t) => t.tier === 1)!;
const HIGH = CONFIG.creepTiers!.find((t) => t.tier === 2)!;
const PATROL = typeByKey('patrol');
const TURRET = typeByKey('turret');
const CENTRE = cellCenter(CAMP_CELL.x, CAMP_CELL.y);

const newSim = (tier = 1, seed = 1, map: SimMap = campMap(tier)): Sim =>
  createSim({ seed, players: testPlayers(2), map, config: CONFIG });

function play(sim: Sim, frames: number, script: Map<number, CommandEnvelope[]> = new Map()): void {
  for (let n = 0; n < frames; n++) {
    const f = sim.frame;
    sim.applyBundle(bundle(f, script.get(f) ?? []));
    sim.tick();
  }
}

function order(sim: Sim, ...cmds: CommandEnvelope[]): void {
  const f = sim.frame;
  sim.applyBundle(
    bundle(
      f,
      cmds.map((c) => ({ ...c, frame: f })),
    ),
  );
  sim.tick();
}

/** A unit of player p on cell (cx, cy). */
function unitAt(sim: Sim, p: number, cx: number, cy: number, typeId = MILITIA): number {
  const c = cellCenter(cx, cy);
  const id = sim.spawnUnit({ typeId, owner: p, x: c.x, y: c.y });
  if (id === 0) throw new Error(`spawn op ${cx},${cy}`);
  return id;
}

const hpOf = (sim: Sim, id: number): number => sim.getUnit(id)?.hp ?? 0;

describe('creep camps: the start', () => {
  it('every camp spawns the bandits of its tier: neutral, no orders, around the centre, the camp idle', () => {
    const sim = newSim(2);
    const ids = bandits(sim);
    expect(ids).toHaveLength(HIGH.typeIds.length);
    for (const [k, id] of ids.entries()) {
      const u = sim.getUnit(id)!;
      expect(u.owner).toBe(OWNER_NEUTRAL);
      expect(u.typeId).toBe(HIGH.typeIds[k]);
      expect(u.hp).toBe(u.maxHp);
      const i = sim.world.resolve(id);
      expect(sim.world.creepCamp[i]).toBe(1);
      expect(sim.world.has(i, C.orders)).toBe(false);
      expect(Math.abs(u.x - CENTRE.x)).toBeLessThanOrEqual(2 * 256);
      expect(Math.abs(u.y - CENTRE.y)).toBeLessThanOrEqual(2 * 256);
    }
    expect(sim.creeps.state[0]).toBe(CAMP_IDLE);
    // the bandits come after the players' start setup: the headquarters and start units keep their ids
    const first = Math.min(...ids);
    for (const id of sim.entityIds())
      if (sim.getUnit(id)!.owner < 2) expect(id).toBeLessThan(first);
  });

  it('the camps and their tiers are in the envHash; a map without camps has none', () => {
    const base = { players: testPlayers(2), config: CONFIG };
    const low = envHash({ ...base, map: campMap(1) });
    const high = envHash({ ...base, map: campMap(2) });
    expect(low).not.toBe(high);
    const plain = campMap(1);
    const none: SimMap = { ...plain, creepCamps: [] };
    expect(envHash({ ...base, map: none })).not.toBe(low);
    expect(bandits(newSim(1, 1, none))).toHaveLength(0);
  });

  it('refuses a camp whose tier is not in the data', () => {
    expect(() => newSim(1, 1, { ...campMap(1), creepCamps: [{ ...CENTRE, tier: 9 }] })).toThrow(
      /tier 9/,
    );
  });
});

describe('creep camps: aggro, leash and reset', () => {
  it('a player unit outside the aggro radius leaves the camp asleep; inside it, the camp wakes and fights it', () => {
    const sim = newSim();
    const r = LOW.aggroRadius >> 8;
    const far = unitAt(sim, 0, CAMP_CELL.x - r - 3, CAMP_CELL.y);
    play(sim, 40);
    expect(sim.creeps.state[0]).toBe(CAMP_IDLE);
    expect(hpOf(sim, far)).toBe(sim.getUnit(far)!.maxHp);
    const near = unitAt(sim, 0, CAMP_CELL.x - r + 2, CAMP_CELL.y);
    play(sim, 2);
    expect(sim.creeps.state[0]).toBe(CAMP_FIGHT);
    for (const id of bandits(sim)) expect(sim.getUnit(id)!.target).toBe(near);
    play(sim, 200);
    expect(hpOf(sim, near)).toBe(0);
  });

  it('a hit from outside the aggro radius wakes the camp', () => {
    const sim = newSim();
    // a patrol (11 m) shoots from beyond the aggro radius (9 m)
    const r = LOW.aggroRadius >> 8;
    const p = unitAt(sim, 0, CAMP_CELL.x - r - 2, CAMP_CELL.y, PATROL);
    const target = bandits(sim)[0]!;
    order(sim, cmd(0, 0, 'Attack', { ids: [p], target }));
    play(sim, 60);
    expect(sim.creeps.state[0]).not.toBe(CAMP_IDLE);
  });

  it('a sleeping camp is not acquired by militia or turrets nearby; an explicit Attack is', () => {
    const sim = newSim();
    const r = LOW.aggroRadius >> 8;
    // militia idle just outside the aggro radius: its own aggroRange (10 m) reaches the nearest bandit
    const m = unitAt(sim, 0, CAMP_CELL.x - r - 1, CAMP_CELL.y);
    expect(sim.spawnBuilding(TURRET, 1, CAMP_CELL.x + r + 2, CAMP_CELL.y)).not.toBe(0);
    play(sim, 60);
    expect(sim.creeps.state[0]).toBe(CAMP_IDLE);
    expect(sim.getUnit(m)!.target).toBe(0);
    for (const id of bandits(sim)) expect(hpOf(sim, id)).toBe(sim.getUnit(id)!.maxHp);
    order(sim, cmd(0, 0, 'Attack', { ids: [m], target: bandits(sim)[0]! }));
    play(sim, 12);
    expect(sim.creeps.state[0]).toBe(CAMP_FIGHT);
  });

  it('never attacks a building on its own: a site in the aggro radius without units keeps the camp asleep', () => {
    const sim = newSim();
    expect(sim.spawnBuilding(typeByKey('woning'), 0, CAMP_CELL.x - 6, CAMP_CELL.y - 1)).not.toBe(0);
    play(sim, 100);
    expect(sim.creeps.state[0]).toBe(CAMP_IDLE);
    for (const id of bandits(sim)) expect(sim.getUnit(id)!.target).toBe(0);
  });

  it('no player unit left in the leash circle takes the camp home, where it heals to full and sleeps again', () => {
    const sim = newSim();
    const r = LOW.aggroRadius >> 8;
    const bait = unitAt(sim, 0, CAMP_CELL.x - r + 1, CAMP_CELL.y);
    play(sim, 3);
    expect(sim.creeps.state[0]).toBe(CAMP_FIGHT);
    const hurt = sim.world.resolve(bandits(sim)[0]!);
    sim.world.hp[hurt] = 10;
    // the bait is gone from the circle (far west): the camp has nobody left to fight
    const away = cellCenter(CAMP_CELL.x - 40, CAMP_CELL.y);
    const b = sim.world.resolve(bait);
    sim.world.x[b] = away.x;
    sim.world.y[b] = away.y;
    play(sim, 1);
    // home already (they had hardly moved) or on the way
    expect([CAMP_RETURN, CAMP_IDLE]).toContain(sim.creeps.state[0]);
    for (let n = 0; n < 400 && sim.creeps.state[0] !== CAMP_IDLE; n++) play(sim, 1);
    expect(sim.creeps.state[0]).toBe(CAMP_IDLE);
    for (const id of bandits(sim)) {
      const u = sim.getUnit(id)!;
      expect(u.hp).toBe(u.maxHp);
      expect(u.target).toBe(0);
    }
    expect(hpOf(sim, bait)).toBeGreaterThan(0);
  });

  it('a bandit beyond the leash radius takes the whole camp home, and hits on the way do not turn it', () => {
    const sim = newSim();
    const r = LOW.aggroRadius >> 8;
    const m = unitAt(sim, 0, CAMP_CELL.x - r + 1, CAMP_CELL.y);
    play(sim, 3);
    expect(sim.creeps.state[0]).toBe(CAMP_FIGHT);
    const strayer = sim.world.resolve(bandits(sim)[0]!);
    const out = cellCenter(CAMP_CELL.x + (LOW.leashRadius >> 8) + 2, CAMP_CELL.y);
    sim.world.x[strayer] = out.x;
    sim.world.y[strayer] = out.y;
    play(sim, 1);
    expect(sim.creeps.state[0]).toBe(CAMP_RETURN);
    // the militia keeps shooting the returning bandits: they do not fight back until they are home
    play(sim, 10);
    for (const id of bandits(sim)) expect(sim.getUnit(id)!.target).toBe(0);
    for (let n = 0; n < 400 && sim.creeps.state[0] === CAMP_RETURN; n++) play(sim, 1);
    // home again with the militia still in the aggro radius: it wakes again
    play(sim, 2);
    expect(sim.creeps.state[0]).toBe(CAMP_FIGHT);
    expect(hpOf(sim, m)).toBeGreaterThan(0);
  });
});

describe('creep camps: loot and xp', () => {
  it('the killing blow on the last bandit gives the loot to that player, not to the one who fought before', () => {
    const sim = newSim();
    const ids = bandits(sim);
    // all but the last bandit gone, the last one nearly dead
    for (const id of ids.slice(0, -1)) sim.destroyEntity(id);
    const last = ids.at(-1)!;
    sim.world.hp[sim.world.resolve(last)] = 1;
    const p1 = unitAt(sim, 1, CAMP_CELL.x - 4, CAMP_CELL.y);
    const scrap0 = sim.playerStatus(0).scrap;
    const scrap1 = sim.playerStatus(1).scrap;
    order(sim, cmd(0, 1, 'Attack', { ids: [p1], target: last }));
    play(sim, 40);
    expect(sim.creeps.state[0]).toBe(CAMP_CLEARED);
    expect(sim.creeps.clearedBy[0]).toBe(2);
    expect(sim.creeps.clearedAt[0]).toBeGreaterThan(0);
    expect(sim.playerStatus(1).scrap).toBe(scrap1 + LOW.lootScrap);
    expect(sim.playerStatus(0).scrap).toBe(scrap0);
  });

  it('the hero within the radius gets the camp xp; a hero at home does not', () => {
    const run = (heroNear: boolean): number => {
      const sim = newSim();
      const ids = bandits(sim);
      for (const id of ids.slice(0, -1)) sim.destroyEntity(id);
      const last = ids.at(-1)!;
      sim.world.hp[sim.world.resolve(last)] = 1;
      const m = unitAt(sim, 0, CAMP_CELL.x - 4, CAMP_CELL.y);
      if (heroNear) {
        const h = sim.world.resolve(heroOf(sim, 0));
        const at = cellCenter(CAMP_CELL.x - 12, CAMP_CELL.y + 3);
        sim.world.x[h] = at.x;
        sim.world.y[h] = at.y;
      }
      const xp0 = sim.playerStatus(0).hero!.xp;
      order(sim, cmd(0, 0, 'Attack', { ids: [m], target: last }));
      play(sim, 40);
      expect(sim.creeps.state[0]).toBe(CAMP_CLEARED);
      return sim.playerStatus(0).hero!.xp - xp0;
    };
    const far = run(false);
    const near = run(true);
    expect(far).toBe(0);
    // the camp xp plus the assist xp for the kill near the hero
    expect(near).toBe(LOW.heroXp + CONFIG.heroes[0]!.xpPerAssist);
  });

  it('a cleared camp stays empty without a respawn', () => {
    const sim = newSim();
    for (const id of bandits(sim).slice(0, -1)) sim.destroyEntity(id);
    const last = bandits(sim)[0]!;
    sim.world.hp[sim.world.resolve(last)] = 1;
    const m = unitAt(sim, 0, CAMP_CELL.x - 4, CAMP_CELL.y);
    order(sim, cmd(0, 0, 'Attack', { ids: [m], target: last }));
    play(sim, 2000);
    expect(LOW.respawnTicks).toBe(0);
    expect(sim.creeps.state[0]).toBe(CAMP_CLEARED);
    expect(bandits(sim)).toHaveLength(0);
  });

  it('with respawnTicks the camp comes back full once no player unit is near', () => {
    const tiers = CONFIG.creepTiers!.map((t) => (t.tier === 1 ? { ...t, respawnTicks: 100 } : t));
    const sim = createSim({
      seed: 1,
      players: testPlayers(2),
      map: campMap(1),
      config: { ...CONFIG, creepTiers: tiers },
    });
    for (const id of bandits(sim).slice(0, -1)) sim.destroyEntity(id);
    const last = bandits(sim)[0]!;
    sim.world.hp[sim.world.resolve(last)] = 1;
    const m = unitAt(sim, 0, CAMP_CELL.x - 4, CAMP_CELL.y);
    order(sim, cmd(0, 0, 'Attack', { ids: [m], target: last }));
    play(sim, 40);
    expect(sim.creeps.state[0]).toBe(CAMP_CLEARED);
    // the militia stands in the aggro radius: no respawn
    play(sim, 200);
    expect(bandits(sim)).toHaveLength(0);
    const away = cellCenter(CAMP_CELL.x - 30, CAMP_CELL.y);
    order(sim, cmd(0, 0, 'Move', { ids: [m], x: away.x, y: away.y }));
    play(sim, 200);
    expect(bandits(sim)).toHaveLength(LOW.typeIds.length);
    expect(sim.creeps.state[0]).toBe(CAMP_IDLE);
  });
});

describe('creep camps: balance (data/creeps.json)', () => {
  it('low camp: a hero with 4 to 6 militia clears it with losses, with 2 he loses', () => {
    expect(fightCamp(1, 2).cleared).toBe(false);
    for (const n of [4, 5]) {
      const r = fightCamp(1, n);
      expect(r.cleared, JSON.stringify(r)).toBe(true);
      expect(r.losses, JSON.stringify(r)).toBeGreaterThanOrEqual(1);
      expect(r.scrapGain).toBe(LOW.lootScrap);
    }
    expect(fightCamp(1, 6).cleared).toBe(true);
  });

  it('high camp: about ten units; nine fail, ten clear it barely, eleven with losses', () => {
    expect(fightCamp(2, 8).cleared).toBe(false);
    for (const seed of [1, 2, 3, 4]) {
      const ten = fightCamp(2, 9, true, seed);
      expect(ten.cleared, JSON.stringify(ten)).toBe(true);
      expect(ten.losses, JSON.stringify(ten)).toBeGreaterThanOrEqual(6);
    }
    const eleven = fightCamp(2, 10);
    expect(eleven.cleared, JSON.stringify(eleven)).toBe(true);
    expect(eleven.losses, JSON.stringify(eleven)).toBeGreaterThanOrEqual(3);
    expect(eleven.scrapGain).toBe(HIGH.lootScrap);
  });
});

describe('creep camps: determinism', () => {
  it('the same fight twice gives the same outcome and hashes', () => {
    expect(fightCamp(1, 4, true, 3)).toEqual(fightCamp(1, 4, true, 3));
  });

  it('serialize halfway through a fight and deserialize: the same hashes after', () => {
    const sim = newSim(2, 5);
    const army = armyAt(sim, 9, false, -14);
    order(sim, cmd(0, 0, 'AttackMove', { ids: army, x: CENTRE.x, y: CENTRE.y }));
    play(sim, 120);
    expect(sim.creeps.state[0]).toBe(CAMP_FIGHT);
    const copy = deserialize(
      sim.serialize(),
      envOf({ seed: 5, players: testPlayers(2), map: campMap(2), config: CONFIG }),
    );
    expect(copy.hash()).toBe(sim.hash());
    for (let n = 0; n < 400; n++) {
      const f = sim.frame;
      sim.applyBundle(bundle(f));
      copy.applyBundle(bundle(f));
      expect(copy.tick()).toBe(sim.tick());
    }
    expect(copy.creeps.state[0]).toBe(sim.creeps.state[0]);
  });
});

describe('creep camps: the scripted AI (ai/*.json creeps)', () => {
  const script = (fromTicks: number, minArmy: number) => ({
    ...CONFIG.aiScripts[0]!,
    creeps: { fromTicks, maxPath: 200 << 8, tiers: [{ tier: 1, minArmy }] },
  });

  it('sends an idle army that is big enough to the nearest camp, and the run is over once it is cleared', () => {
    const sim = newSim();
    const army = armyAt(sim, 6, false);
    const home = sim.terrainDist.fieldAt(cellCenter(8, 8).x, cellCenter(8, 8).y);
    expect(aiCreepRun(sim, 0, script(0, 7), home, army, -1)).toBe(false); // too small
    expect(aiCreepRun(sim, 0, script(100000, 6), home, army, -1)).toBe(false); // too early
    expect(aiCreepRun(sim, 0, script(0, 6), home, army, -1)).toBe(true);
    const i = sim.world.resolve(army[0]!);
    expect(sim.world.orderType(i)).toBe(ORDER_ATTACK_MOVE);
    const o = sim.world.currentOrder(i);
    expect(campAt(sim, sim.world.ordX[o]!, sim.world.ordY[o]!)).toBe(0);
    expect(raidOver(sim, 0, i)).toBe(false);
    play(sim, 20 * 60);
    expect(sim.creeps.state[0]).toBe(CAMP_CLEARED);
    const alive = army
      .map((id) => sim.world.resolve(id))
      .find((k) => k >= 0 && sim.world.orderType(k) === ORDER_ATTACK_MOVE);
    if (alive !== undefined) expect(raidOver(sim, 0, alive)).toBe(true);
    // nothing left to clear
    expect(aiCreepRun(sim, 0, script(0, 1), home, army, -1)).toBe(false);
  });

  it('an AI without a creeps block leaves the camps alone', () => {
    const sim = newSim();
    const army = armyAt(sim, 8, false);
    const home = sim.terrainDist.fieldAt(cellCenter(8, 8).x, cellCenter(8, 8).y);
    expect(aiCreepRun(sim, 0, { ...CONFIG.aiScripts[0]!, creeps: null }, home, army, -1)).toBe(
      false,
    );
  });
});
