import { describe, expect, it } from 'vitest';
import { OWNER_NEUTRAL } from '@crawlout/protocol';
import type { CommandEnvelope } from '@crawlout/protocol';
import { createSim, deserialize } from '../src/index.js';
import type { Sim } from '../src/index.js';
import { C, ORDER_MOVE } from '../src/ecs/world.js';
import {
  CAMP_CLEARED,
  CAMP_FIGHT,
  CAMP_TAKEN,
  aiCreepRun,
  campAlive,
  takeoverRule,
} from '../src/systems/creeps.js';
import { cellCenter } from '../src/testing.js';
import { CAMP_CELL, bandits, campMap, fightCamp } from './creepHarness.js';
import { CONFIG, DATA, MILITIA, SCAV, bundle, cmd, envOf, typeByKey } from './helpers.js';

// Camp takeover (sim 0.22.0, data 0.27.0, data/creeps.json takeover; voorstel, ter bevestiging door
// de architect). Martien, 18 oktober: "raiders moeten wel vanaf het begin een camp over kunnen nemen". A Raider force
// that beats a camp down to its surrender share takes it over: the surviving bandits join the Raiders, the loot and xp
// are those of a clear, and the camp is an outpost that yields a bandit now and then. The Dwellers clear camps as before
// (creeps.test.ts). Raiders are player 0, Dwellers player 1, on the open map of creepHarness.ts (camp at cell 48, 64).

const RAIDERS = DATA.factions.findIndex((f) => f.key === 'raiders');
const PLAYERS = [
  { factionId: RAIDERS, ai: false },
  { factionId: 0, ai: false },
];
const PLUNDERAAR = typeByKey('plunderaar');
const KNUPPELAAR = typeByKey('knuppelaar');
const LOW = CONFIG.creepTiers!.find((t) => t.tier === 1)!;
const HIGH = CONFIG.creepTiers!.find((t) => t.tier === 2)!;
const RULES = CONFIG.creepTakeover!.find((r) => r.factionId === RAIDERS)!;
const RULE_LOW = RULES.tiers.find((t) => t.tier === 1)!;
const CENTRE = cellCenter(CAMP_CELL.x, CAMP_CELL.y);

const newSim = (tier = 1, seed = 1): Sim =>
  createSim({ seed, players: PLAYERS, map: campMap(tier), config: CONFIG });

function play(sim: Sim, frames: number, cmds: CommandEnvelope[] = []): void {
  for (let n = 0; n < frames; n++) {
    const f = sim.frame;
    sim.applyBundle(bundle(f, n === 0 ? cmds.map((c) => ({ ...c, frame: f })) : []));
    sim.tick();
  }
}

/** A unit of player p on cell (cx, cy). */
function unitAt(sim: Sim, p: number, cx: number, cy: number, typeId = PLUNDERAAR): number {
  const c = cellCenter(cx, cy);
  const id = sim.spawnUnit({ typeId, owner: p, x: c.x, y: c.y });
  if (id === 0) throw new Error(`spawn op ${cx},${cy}`);
  return id;
}

/** Puts every bandit of the camp at `pct` percent of its max hp (a fight that went that far). */
function beatDown(sim: Sim, ids: number[], pct: number): void {
  const w = sim.world;
  for (const id of ids) {
    const i = w.resolve(id);
    w.hp[i] = Math.max(1, Math.trunc((w.maxHp[i]! * pct) / 100));
  }
}

/** n Raider units of player 0 just west of the camp centre, inside its aggro radius: the camp wakes. */
function raidersAtCamp(sim: Sim, n: number): number[] {
  const ids: number[] = [];
  for (let k = 0; k < n; k++) ids.push(unitAt(sim, 0, CAMP_CELL.x - 3, CAMP_CELL.y - 2 + k));
  play(sim, 1);
  expect(sim.creeps.state[0]).toBe(CAMP_FIGHT);
  return ids;
}

describe('camp takeover: the rules (data/creeps.json takeover)', () => {
  it('the Raiders take over both camp tiers, the Dwellers none', () => {
    expect(takeoverRule(newSim(), 0, 1)).toBeDefined();
    expect(takeoverRule(newSim(), 0, 2)).toBeDefined();
    expect(takeoverRule(newSim(), 1, 1)).toBeUndefined();
    expect(RULE_LOW.minUnits).toBeGreaterThanOrEqual(1);
    expect(RULE_LOW.surrenderPermille).toBeGreaterThan(0);
  });

  it('a camp beaten down to its surrender share by Raiders alone surrenders: the bandits join them', () => {
    const sim = newSim();
    const ids = bandits(sim);
    raidersAtCamp(sim, RULE_LOW.minUnits);
    const scrap = sim.playerStatus(0).scrap;
    beatDown(sim, ids, Math.trunc(RULE_LOW.surrenderPermille / 10));
    play(sim, 1);
    expect(sim.creeps.state[0]).toBe(CAMP_TAKEN);
    expect(sim.creeps.clearedBy[0]).toBe(1);
    expect(sim.playerStatus(0).scrap).toBe(scrap + LOW.lootScrap);
    const w = sim.world;
    for (const id of ids) {
      const i = w.resolve(id);
      expect(w.owner[i]).toBe(0);
      expect(w.creepCamp[i]).toBe(0);
      expect(w.has(i, C.orders)).toBe(true);
    }
    expect(bandits(sim)).toHaveLength(0);
    // a recruit is an ordinary unit of his new owner: it takes orders
    const away = cellCenter(CAMP_CELL.x - 20, CAMP_CELL.y);
    play(sim, 1, [cmd(0, 0, 'Move', { ids: [ids[0]!], x: away.x, y: away.y })]);
    expect(w.orderType(w.resolve(ids[0]!))).toBe(ORDER_MOVE);
    // and nobody fights over it any more
    play(sim, 60);
    for (const id of ids) expect(sim.getUnit(id)!.hp).toBeGreaterThan(0);
  });

  it('above the surrender share it fights on', () => {
    const sim = newSim();
    const ids = bandits(sim);
    raidersAtCamp(sim, RULE_LOW.minUnits);
    beatDown(sim, ids, Math.trunc(RULE_LOW.surrenderPermille / 10) + 5);
    play(sim, 1);
    expect(sim.creeps.state[0]).toBe(CAMP_FIGHT);
  });

  it('too few Raiders (below minUnits) do not intimidate it', () => {
    const sim = newSim();
    const ids = bandits(sim);
    raidersAtCamp(sim, RULE_LOW.minUnits - 1);
    beatDown(sim, ids, 5);
    play(sim, 1);
    expect(sim.creeps.state[0]).not.toBe(CAMP_TAKEN);
  });

  it('a contested camp does not surrender: a Dweller unit in the leash circle stops it', () => {
    const sim = newSim();
    const ids = bandits(sim);
    raidersAtCamp(sim, RULE_LOW.minUnits);
    unitAt(sim, 1, CAMP_CELL.x + 3, CAMP_CELL.y, MILITIA);
    beatDown(sim, ids, 5);
    play(sim, 1);
    expect(sim.creeps.state[0]).toBe(CAMP_FIGHT);
  });

  it('the Raiders killing blow on the last bandit takes it over too (no recruits); a Dweller one clears it', () => {
    for (const [p, state] of [
      [0, CAMP_TAKEN],
      [1, CAMP_CLEARED],
    ] as const) {
      const sim = newSim();
      const ids = bandits(sim);
      const scrap = sim.playerStatus(p).scrap;
      const w = sim.world;
      for (const id of ids) {
        const i = w.resolve(id);
        w.hp[i] = 0;
        w.lastHit[i] = p + 1;
      }
      play(sim, 1);
      expect(sim.creeps.state[0]).toBe(state);
      expect(sim.creeps.clearedBy[0]).toBe(p + 1);
      expect(sim.playerStatus(p).scrap).toBe(scrap + LOW.lootScrap);
    }
  });
});

describe('camp takeover: the outpost', () => {
  function takenCamp(seed = 1): Sim {
    const sim = newSim(1, seed);
    const ids = bandits(sim);
    const mine = raidersAtCamp(sim, RULE_LOW.minUnits);
    beatDown(sim, ids, 10);
    play(sim, 1);
    expect(sim.creeps.state[0]).toBe(CAMP_TAKEN);
    // everyone walks away from the camp
    const away = cellCenter(CAMP_CELL.x - 30, CAMP_CELL.y);
    play(sim, 1, [cmd(0, 0, 'Move', { ids: [...mine, ...ids], x: away.x, y: away.y })]);
    return sim;
  }
  const own = (sim: Sim): number =>
    sim.entityIds().filter((id) => {
      const u = sim.getUnit(id)!;
      return u.owner === 0 && u.kind === 'unit' && u.hp > 0;
    }).length;

  it(`yields a bandit for its owner every yieldTicks, at most yieldMax (${RULE_LOW.yieldMax})`, () => {
    expect(RULE_LOW.yieldTicks).toBeGreaterThan(0);
    expect(RULE_LOW.yieldMax).toBeGreaterThan(0);
    const sim = takenCamp();
    const before = own(sim);
    play(sim, RULE_LOW.yieldTicks - 4);
    expect(own(sim)).toBe(before);
    play(sim, 4);
    expect(own(sim)).toBe(before + 1);
    expect(sim.creeps.yields[0]).toBe(1);
    play(sim, RULE_LOW.yieldTicks * (RULE_LOW.yieldMax + 1));
    expect(own(sim)).toBe(before + RULE_LOW.yieldMax);
    expect(bandits(sim)).toHaveLength(0);
  });

  it('waits while a unit of another player stands at the camp', () => {
    const sim = takenCamp();
    // a Dweller scavenger (no fighter: it stays put) at the camp
    const s = unitAt(sim, 1, CAMP_CELL.x + 2, CAMP_CELL.y, SCAV);
    play(sim, RULE_LOW.yieldTicks * 2);
    expect(sim.getUnit(s)!.hp).toBeGreaterThan(0);
    expect(sim.creeps.yields[0]).toBe(0);
  });

  it('a taken camp is no target for a creep run, and the status shows it in its owner', () => {
    const sim = takenCamp();
    expect(campAlive(sim, 0)).toBe(false);
    const home = sim.terrainDist.fieldAt(cellCenter(8, 8).x, cellCenter(8, 8).y);
    const script = {
      ...CONFIG.aiScripts[0]!,
      creeps: { fromTicks: 0, maxPath: 200 << 8, tiers: [{ tier: 1, minArmy: 1 }] },
    };
    const army = [unitAt(sim, 0, 20, 20)];
    expect(aiCreepRun(sim, 0, script, home, army, -1)).toBe(false);
    expect(sim.playerStatus(0).camps).toEqual([
      { camp: 0, x: CENTRE.x, y: CENTRE.y, tier: 1, state: 'taken', owner: 0, takeover: true },
    ]);
    expect(sim.playerStatus(1).camps![0]).toMatchObject({
      state: 'taken',
      owner: 0,
      takeover: false,
    });
    expect(newSim().playerStatus(1).camps![0]).toMatchObject({
      state: 'bandits',
      owner: OWNER_NEUTRAL,
      takeover: false,
    });
  });

  it('serialize while it waits for a yield and deserialize: the same hashes after', () => {
    const sim = takenCamp(3);
    play(sim, 100);
    const copy = deserialize(
      sim.serialize(),
      envOf({ seed: 3, players: PLAYERS, map: campMap(1), config: CONFIG }),
    );
    expect(copy.hash()).toBe(sim.hash());
    for (let n = 0; n < RULE_LOW.yieldTicks; n++) {
      const f = sim.frame;
      sim.applyBundle(bundle(f));
      copy.applyBundle(bundle(f));
      expect(copy.tick()).toBe(sim.tick());
    }
    expect(copy.creeps.yields[0]).toBe(1);
  });
});

// Data 0.29.0: the low camp is weak (Martien: "die zijn zwakker dan bouwers", the camps), the Raider fighters are back to
// their strength of data 0.26.0. Measured: the start army takes it in 9 s with one recruit, the Warlord with two
// plunderaar in 12 s (the killing blow, no recruits), three plunderaar without him with one loss.
describe('camp takeover: from the start (balance, data 0.29.0)', () => {
  it('the Raider start army (Warlord, 3 plunderaar, 1 knuppelaar) takes a low camp and keeps a recruit', () => {
    const r = fightCamp(1, 0, true, 1, {
      players: PLAYERS,
      army: [PLUNDERAAR, PLUNDERAAR, PLUNDERAAR, KNUPPELAAR],
    });
    expect(r.taken, JSON.stringify(r)).toBe(true);
    expect(r.recruits, JSON.stringify(r)).toBeGreaterThanOrEqual(1);
    expect(r.scrapGain).toBe(LOW.lootScrap);
  });

  it('even a smaller Raider force takes it from the start: the Warlord with 2 plunderaar, or 3 plunderaar alone', () => {
    for (const r of [
      fightCamp(1, 0, true, 1, { players: PLAYERS, army: [PLUNDERAAR, PLUNDERAAR] }),
      fightCamp(1, 3, false, 1, { players: PLAYERS, typeId: PLUNDERAAR }),
    ]) {
      expect(r.taken, JSON.stringify(r)).toBe(true);
      expect(r.losses, JSON.stringify(r)).toBeLessThanOrEqual(1);
    }
  });

  it('a Dweller hero with militie clears it without recruits (the Dwellers have no takeover rule)', () => {
    const r = fightCamp(1, 4);
    expect(r.cleared).toBe(true);
    expect(r.taken).toBe(false);
    expect(r.recruits).toBe(0);
  });

  it('the high camp stays a mid-game target: twelve plunderaar with the Warlord take it, eight do not', () => {
    const opts = { players: PLAYERS, typeId: PLUNDERAAR };
    expect(fightCamp(2, 8, true, 1, opts).cleared).toBe(false);
    const r = fightCamp(2, 12, true, 1, opts);
    expect(r.taken, JSON.stringify(r)).toBe(true);
    expect(r.scrapGain).toBe(HIGH.lootScrap);
  });
});
