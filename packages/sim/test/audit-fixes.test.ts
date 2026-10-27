import { describe, expect, it } from 'vitest';
import { HERO_ALIVE, HERO_REVIVING, ORDER_CRAFT, createSim, type Sim } from '../src/index.js';
import { PHASE_CRAFT, PHASE_GO, PHASE_WORK } from '../src/ecs/world.js';
import { Census, takeCensus } from '../src/systems/census.js';
import { combatSystem } from '../src/systems/combat.js';
import { economySystem } from '../src/systems/economy.js';
import { heroSystem } from '../src/systems/hero.js';
import { cellCenter, createOpenMap, testPlayers } from '../src/testing.js';
import { WERKPLAATS, WONING, at, milType, play } from './gameplay.helpers.js';
import { DATA, MILITIA, REAL_CONFIG, SCAV, cmd, emptySim, testInit, typeByKey } from './helpers.js';

// Audit fixes (sim 0.38.1): each test fails on the code before the fix, except the lastHit one, which pins an invariant.

/** Takes every free entity slot; returns them so a test can give one back. */
function fillWorld(sim: Sim): number[] {
  const taken: number[] = [];
  for (let i = sim.world.alloc(); i >= 0; i = sim.world.alloc()) taken.push(i);
  return taken;
}

const census = (sim: Sim): Census => {
  const c = new Census();
  takeCensus(sim, c);
  return c;
};

describe('audit fixes', () => {
  it('Load refunds a paid retraining, like every other order', () => {
    const fid = (key: string) => DATA.factions.find((f) => f.key === key)!.id;
    const sim = createSim(
      {
        seed: 11,
        map: createOpenMap(),
        players: [
          { factionId: fid('garde'), ai: false },
          { factionId: fid('dwellers'), ai: false },
        ],
        config: REAL_CONFIG,
      },
      { start: false },
    );
    const w = sim.world;
    const c = (cx: number) => cellCenter(cx, 30);
    const vId = sim.spawnUnit({ typeId: typeByKey('vertibird'), owner: 0, ...c(30) });
    const uId = sim.spawnUnit({ typeId: typeByKey('initiate_wacht'), owner: 0, ...c(27) });
    const klerk = REAL_CONFIG.unitTypes.find((t) => t.typeId === typeByKey('klerk'))!;
    const u = w.resolve(uId);
    w.pushOrder(u, ORDER_CRAFT, klerk.typeId, 0, 0);
    w.phase[u] = PHASE_CRAFT; // paid, retraining
    sim.setScrap(0, 0);
    play(sim, 1, at(sim.frame, cmd(sim.frame, 0, 'Load', { ids: [uId], transportId: vId })));
    const refund = Math.trunc((klerk.scrapCost * REAL_CONFIG.cancelRefundPermille) / 1000);
    expect(refund).toBeGreaterThan(0);
    expect(sim.playerStatus(0).scrap).toBe(refund);
  });

  it('a settler waiting for scrap at a workshop that is destroyed does not pay or retrain', () => {
    const sim = emptySim();
    const w = sim.world;
    const ws = sim.spawnBuilding(WERKPLAATS, 0, 14, 4);
    const sId = sim.spawnUnit({ typeId: SCAV, owner: 0, ...cellCenter(14, 9) });
    const s = w.resolve(sId);
    sim.setScrap(0, 0);
    play(sim, 1, at(sim.frame, cmd(sim.frame, 0, 'SetRole', { ids: [sId], role: 'militia' })));
    for (let k = 0; k < 400 && w.phase[s] !== PHASE_WORK; k++) play(sim, 1);
    expect(w.phase[s]).toBe(PHASE_WORK); // at the workshop, short of scrap
    w.hp[w.resolve(ws)] = 0; // razed: cleanup (system 8) removes it this tick
    play(sim, 1);
    sim.setScrap(0, 1000);
    play(sim, milType.craftTicks + 20);
    expect(w.typeId[s]).toBe(SCAV);
    expect(w.typeId[s]).not.toBe(MILITIA);
    expect(w.phase[s]).toBe(PHASE_GO);
    expect(sim.playerStatus(0).scrap).toBe(1000);
  });

  it('a revive that finds the world full does not count as a revive', () => {
    const sim = createSim(testInit(5));
    const c = census(sim);
    sim.ps.heroState[0] = HERO_REVIVING;
    sim.ps.heroTimer[0] = 0;
    const revives = sim.ps.heroRevives[0]!;
    const taken = fillWorld(sim);
    heroSystem(sim, c);
    heroSystem(sim, c);
    expect(sim.ps.heroRevives[0]).toBe(revives);
    expect(sim.ps.heroState[0]).toBe(HERO_REVIVING);
    sim.world.free(taken.pop()!);
    heroSystem(sim, c);
    expect(sim.ps.heroRevives[0]).toBe(revives + 1);
    expect(sim.ps.heroState[0]).toBe(HERO_ALIVE);
  });

  it('lastHit (plunder) stays with the killer: nobody shoots a target that is already dead (isEnemy)', () => {
    const open = createOpenMap();
    const spawns = [...open.spawns, { ...open.spawns[0]!, x: 64 * 256, y: 110 * 256 }];
    const sim = emptySim(1, { ...open, spawns }, testPlayers(3));
    const w = sim.world;
    const a = w.resolve(sim.spawnUnit({ typeId: MILITIA, owner: 0, ...cellCenter(20, 20) }));
    const b = w.resolve(sim.spawnUnit({ typeId: MILITIA, owner: 1, ...cellCenter(22, 20) }));
    const t = w.resolve(sim.spawnUnit({ typeId: SCAV, owner: 2, ...cellCenter(21, 20) }));
    expect(a).toBeLessThan(b);
    for (const i of [a, b]) {
      w.target[i] = w.idOf(t);
      w.cooldown[i] = 0;
    }
    w.hp[t] = 1;
    combatSystem(sim);
    expect(w.hp[t]).toBeLessThanOrEqual(0);
    expect(w.cooldown[b]).toBe(0); // b held its fire
    expect(w.lastHit[t]).toBe(1); // owner 0 + 1: the first shot killed it
  });

  it('growth adds no pop when the new settler cannot be created', () => {
    const sim = createSim(testInit(5, createOpenMap()));
    sim.spawnBuilding(WONING, 0, 60, 60); // free beds
    const tpm = sim.config.ticksPerMinute * 1000;
    const c = census(sim);
    const pop0 = c.pop[0]!;
    const settlers0 = c.settlers[0]!;
    sim.ps.growth[0] = tpm;
    const taken = fillWorld(sim);
    economySystem(sim, c);
    expect(c.pop[0]).toBe(pop0);
    expect(c.settlers[0]).toBe(settlers0);
    // control: with room the same growth does add the settler
    sim.world.free(taken.pop()!);
    sim.ps.growth[0] = tpm;
    economySystem(sim, c);
    expect(c.settlers[0]).toBe(settlers0 + 1);
  });
});
