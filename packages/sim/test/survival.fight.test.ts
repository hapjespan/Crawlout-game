import { describe, expect, it } from 'vitest';
import { ORDER_ATTACK, ORDER_ATTACK_MOVE, ORDER_SLOTS } from '../src/ecs/world.js';
import type { Sim } from '../src/index.js';
import { DATA, MILITIA, bundle, cmd, typeByKey } from './helpers.js';
import { SURVIVAL, fastWaves, hordeOf, runTo, survivalSim, wave } from './survivalHarness.js';

// Survival co-op (sim 0.28.0; bug Martien 19 October, "plunderaars kunnen niet aanvallen"): Raider and Dweller fighters
// fight the wave units on their own, on an explicit Attack and on an AttackMove, and a kill pays the loot.

const RAIDERS = DATA.factions.find((f) => f.key === 'raiders')!.id;
const DWELLERS = DATA.factions.find((f) => f.key === 'dwellers')!.id;
const FIGHTERS = [
  { name: 'Dweller militia', faction: DWELLERS, typeId: MILITIA },
  { name: 'Raider plunderaar', faction: RAIDERS, typeId: typeByKey('plunderaar') },
  { name: 'Raider knuppelaar', faction: RAIDERS, typeId: typeByKey('knuppelaar') },
];

/** One ghoul spawned at frame 2, and a fighter of player 0 placed `m` metres east of it (vision runs one tick). */
function setup(faction: number, typeId: number, m: number): { sim: Sim; g: number; f: number } {
  const sim = survivalSim(
    [{ factionId: faction, ai: false }],
    fastWaves([wave(2, 1), wave(100000, 1)]),
  );
  runTo(sim, 3);
  const [gi] = hordeOf(sim);
  const w = sim.world;
  const f = sim.spawnUnit({ typeId, owner: 0, x: w.x[gi!]! + m * 256, y: w.y[gi!]! });
  runTo(sim, sim.frame + 1);
  return { sim, g: w.idOf(gi!), f };
}

const headOrder = (sim: Sim, id: number): number => {
  const i = sim.world.resolve(id);
  return sim.world.ordType[i * ORDER_SLOTS + sim.world.ordHead[i]!]!;
};

/** Runs until the ghoul is dead (at most 30 s); returns whether it died. */
function untilDead(sim: Sim, g: number): boolean {
  for (
    let k = 0;
    k < 600 && sim.world.resolve(g) >= 0 && sim.world.hp[sim.world.resolve(g)]! > 0;
    k++
  )
    runTo(sim, sim.frame + 1);
  return sim.world.resolve(g) < 0 || sim.world.hp[sim.world.resolve(g)]! <= 0;
}

describe('survival: players fight the waves', () => {
  for (const ft of FIGHTERS) {
    it(`${ft.name}: accepts an Attack on a wave unit and kills it for loot`, () => {
      // 12 m: in sight (14 m), outside aggro range (10 m), so only the command gives the target
      const { sim, g, f } = setup(ft.faction, ft.typeId, 12);
      const scrap = sim.ps.scrap[0]!;
      sim.applyBundle(bundle(sim.frame, [cmd(sim.frame, 0, 'Attack', { ids: [f], target: g })]));
      sim.tick();
      expect(headOrder(sim, f)).toBe(ORDER_ATTACK);
      expect(sim.world.target[sim.world.resolve(f)]).toBe(g);
      expect(untilDead(sim, g)).toBe(true);
      runTo(sim, sim.frame + 1);
      expect(sim.ps.scrap[0]! - scrap).toBe(SURVIVAL.lootScrap[0]);
    });

    it(`${ft.name}: kills a wave unit on an AttackMove and on its own`, () => {
      const a = setup(ft.faction, ft.typeId, 12);
      const w = a.sim.world;
      const gi = w.resolve(a.g);
      a.sim.applyBundle(
        bundle(a.sim.frame, [
          cmd(a.sim.frame, 0, 'AttackMove', { ids: [a.f], x: w.x[gi]!, y: w.y[gi]! }),
        ]),
      );
      a.sim.tick();
      expect(headOrder(a.sim, a.f)).toBe(ORDER_ATTACK_MOVE);
      expect(untilDead(a.sim, a.g)).toBe(true);
      // idle, without any command: the ghoul walks up and the fighter shoots back
      const b = setup(ft.faction, ft.typeId, 6);
      expect(untilDead(b.sim, b.g)).toBe(true);
    });
  }
});
