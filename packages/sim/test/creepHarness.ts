import { OWNER_NEUTRAL } from '@crawlout/protocol';
import { createSim } from '../src/index.js';
import type { Sim, SimMap } from '../src/index.js';
import { cellCenter, createOpenMap, testPlayers } from '../src/testing.js';
import { CAMP_CLEARED } from '../src/systems/creeps.js';
import { CONFIG, MILITIA, bundle, cmd } from './helpers.js';

// A fight against one creep camp (creeps.test.ts): an open map with a camp of the given tier in the middle-left, the
// start setup of two Dweller players, and player 0's hero plus `militia` militie spawned 24 m west of the camp, sent
// with one AttackMove at the camp centre. No rng in the fight unless the hero crits (sim.rng, seeded).

export const CAMP_CELL = { x: 48, y: 64 };

export function campMap(tier: number): SimMap {
  return {
    ...createOpenMap(128, 128),
    creepCamps: [{ ...cellCenter(CAMP_CELL.x, CAMP_CELL.y), tier }],
  };
}

export interface CampFight {
  readonly cleared: boolean;
  /** Player 0 units lost (militia; the hero counts as one). */
  readonly losses: number;
  readonly heroDied: boolean;
  /** Seconds from the order until the camp was cleared (or the end of the run). */
  readonly seconds: number;
  readonly scrapGain: number;
  readonly heroXpGain: number;
  readonly sent: number;
}

export function bandits(sim: Sim): number[] {
  return sim.entityIds().filter((id) => {
    const u = sim.getUnit(id)!;
    return u.owner === OWNER_NEUTRAL && u.kind === 'unit' && u.hp > 0;
  });
}

export function heroOf(sim: Sim, p: number): number {
  return sim.playerStatus(p).hero!.entityId;
}

/** Spawns player 0's army next to the camp and returns its ids (hero last when withHero). */
export function armyAt(sim: Sim, militia: number, withHero: boolean, dx = -24): number[] {
  const ids: number[] = [];
  for (let k = 0; k < militia; k++) {
    const c = cellCenter(CAMP_CELL.x + dx - (k % 3), CAMP_CELL.y - 2 + Math.floor(k / 3));
    const id = sim.spawnUnit({ typeId: MILITIA, owner: 0, x: c.x, y: c.y });
    if (id === 0) throw new Error('spawn');
    ids.push(id);
  }
  if (withHero) {
    const h = heroOf(sim, 0);
    ids.push(h);
  }
  return ids;
}

export function fightCamp(tier: number, militia: number, withHero = true, seed = 1): CampFight {
  const sim = createSim({ seed, players: testPlayers(2), map: campMap(tier), config: CONFIG });
  // the hero starts at the headquarters: bring him to the army first
  const army = armyAt(sim, militia, withHero);
  const gather = cellCenter(CAMP_CELL.x - 24, CAMP_CELL.y);
  let f = sim.frame;
  if (withHero) {
    sim.applyBundle(
      bundle(f, [cmd(f, 0, 'Move', { ids: [army.at(-1)!], x: gather.x, y: gather.y })]),
    );
    sim.tick();
    for (f = sim.frame; f < 1200; f++) {
      sim.applyBundle(bundle(f));
      sim.tick();
      const u = sim.getUnit(army.at(-1)!)!;
      if (Math.abs(u.x - gather.x) < 768 && Math.abs(u.y - gather.y) < 768 && !u.moving) break;
    }
  }
  const scrap0 = sim.playerStatus(0).scrap;
  const xp0 = sim.playerStatus(0).hero?.xp ?? 0;
  const camp = campMap(tier).creepCamps![0]!;
  f = sim.frame;
  sim.applyBundle(bundle(f, [cmd(f, 0, 'AttackMove', { ids: army, x: camp.x, y: camp.y })]));
  sim.tick();
  const start = f;
  let end = start;
  for (f = sim.frame; f < start + 20 * 120; f++) {
    sim.applyBundle(bundle(f));
    sim.tick();
    end = f;
    if (sim.creeps.state[0] === CAMP_CLEARED) break;
    if (army.every((id) => (sim.getUnit(id)?.hp ?? 0) <= 0)) break;
  }
  const alive = army.filter((id) => {
    const u = sim.getUnit(id);
    return u !== null && u.kind !== 'corpse' && u.hp > 0;
  });
  const heroAlive = withHero && alive.includes(army.at(-1)!);
  const st = sim.playerStatus(0);
  return {
    cleared: sim.creeps.state[0] === CAMP_CLEARED,
    losses: army.length - alive.length,
    heroDied: withHero && !heroAlive,
    seconds: Math.round((end - start) / 2) / 10,
    scrapGain: st.scrap - scrap0,
    heroXpGain: (st.hero?.xp ?? 0) - xp0,
    sent: army.length,
  };
}
