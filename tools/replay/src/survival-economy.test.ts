import { describe, expect, it } from 'vitest';
import type { CommandEnvelope } from '@crawlout/protocol';
import { hqOf } from '@crawlout/sim';
import type { Sim } from '@crawlout/sim';
import { ROLE_MILITIA, SitePlanner } from './bot.part1.js';
import { base, building, loadout, startOf } from './fixtures-def.part1.js';
import { raidersVsDwellers } from './fixtures-def.part2.js';
import { gameData } from './env.js';

// Survival co-op economy (sim 0.28.0, data 0.34.0; bug Martien 19 October: "in de modus voor waves kun je niets
// bouwen of trainen want er zijn geen scrap-plekken"). Solo on Rustbelt XL (slot 0, whose zone held no map node):
// the fixed zone nodes of the data lie in the zone, the start gatherers bring scrap in within 2 minutes, and the
// player places a building and trains a unit, as Dwellers and as Raiders (the Raiderkamp is a cage).

const TWO_MIN = 2400;

function solo(faction: 'dwellers' | 'raiders', seed: number) {
  const r = base('rustbelt', seed, [false]);
  r.settings = { ...r.settings, mode: 'survival' };
  return startOf(faction === 'raiders' ? raidersVsDwellers(r) : r);
}

let seq = 0;
function step(sim: Sim, cmds: Omit<CommandEnvelope, 'frame' | 'seq'>[] = []): void {
  const frame = sim.frame;
  sim.applyBundle({
    frame,
    commands: cmds.map((c) => ({ ...c, frame, seq: seq++ }) as CommandEnvelope),
  });
  sim.tick();
}

const ownBuildings = (sim: Sim, typeId: number, done: boolean): number[] =>
  sim.entityIds().filter((id) => {
    const u = sim.getUnit(id)!;
    return (
      u.kind === 'building' && u.owner === 0 && u.typeId === typeId && (!done || u.buildState === 2)
    );
  });

const nearestNode = (sim: Sim, nodes: number[], x: number, y: number): number =>
  [...nodes].sort((a, b) => {
    const ua = sim.getUnit(a)!;
    const ub = sim.getUnit(b)!;
    return (ua.x - x) ** 2 + (ua.y - y) ** 2 - ((ub.x - x) ** 2 + (ub.y - y) ** 2) || a - b;
  })[0]!;

describe('survival zone scrap on Rustbelt XL', () => {
  it('gives every slot the same nodes, outside the HQ footprint and within the cage work radius', () => {
    for (const faction of ['dwellers', 'raiders']) {
      const r = base('rustbelt', 1800, [false, false, false, false]);
      r.settings = { ...r.settings, mode: 'survival' };
      r.players = r.players.map((pl) => ({ ...pl, faction }));
      const st = startOf(r);
      const sim = st.sim;
      const zs = gameData().data.survival!.zoneScrap;
      const work = gameData().data.buildings.find((b) => b.key === 'raiderkamp')!.cage!.workRadiusU;
      sim.map.survival!.zones.forEach((z, p) => {
        const hq = hqOf(sim, p);
        const bt = sim.buildingType(sim.world.typeId[hq]!)!;
        const near = st.nodes
          .map((id) => sim.getUnit(id)!)
          .filter((u) => (u.x - z.x) ** 2 + (u.y - z.y) ** 2 <= z.radius ** 2);
        expect(near.map((u) => u.maxHp)).toEqual(zs.map((n) => n.amount));
        for (const u of near) {
          const dx = Math.abs(u.x - sim.world.x[hq]!);
          const dy = Math.abs(u.y - sim.world.y[hq]!);
          expect(Math.max(dx - bt.footprintW * 128, dy - bt.footprintH * 128)).toBeGreaterThan(512);
          expect(Math.hypot(dx, dy)).toBeLessThan(work);
        }
      });
    }
  });
});

describe('survival economy, solo slot 0 on Rustbelt XL', () => {
  for (const faction of ['dwellers', 'raiders'] as const) {
    it(`${faction}: scrap comes in within 2 minutes, a building goes up and a unit is trained`, () => {
      const st = solo(faction, 1801);
      const sim = st.sim;
      const z = sim.map.survival!.zones[0]!;
      const inZone = st.nodes.filter((id) => {
        const u = sim.getUnit(id)!;
        return (u.x - z.x) ** 2 + (u.y - z.y) ** 2 <= z.radius ** 2;
      });
      expect(inZone.length).toBeGreaterThanOrEqual(3);

      const hq = sim.getUnit(sim.world.idOf(hqOf(sim, 0)))!;
      const node = nearestNode(sim, inZone, hq.x, hq.y);
      step(sim, [{ playerId: 0, type: 'Gather', payload: { ids: st.scav[0]!, nodeId: node } }]);
      let gained = 0;
      let prev = sim.ps.scrap[0]!;
      const track = (): void => {
        const now = sim.ps.scrap[0]!;
        if (now > prev) gained += now - prev;
        prev = now;
      };

      const key = faction === 'raiders' ? 'tent' : 'werkplaats';
      const typeId = building(key);
      const spot = new SitePlanner(sim).find(0, key, 'hq');
      expect(spot).not.toBeNull();
      step(sim, [
        { playerId: 0, type: 'Build', payload: { ids: st.builder[0]!, typeId, ...spot! } },
      ]);
      track();
      while (sim.frame < TWO_MIN) {
        step(sim);
        track();
      }
      expect(gained).toBeGreaterThan(0);
      expect(ownBuildings(sim, typeId, false)).toHaveLength(1);

      // training: Raiders produce a plunderaar in the finished tent, Dwellers retrain a gatherer as militia at the
      // finished werkplaats (both cost scrap and take time; the new fighter must stand at the end)
      const trained = (): number =>
        sim.entityIds().filter((id) => {
          const u = sim.getUnit(id)!;
          if (u.kind !== 'unit' || u.owner !== 0) return false;
          return faction === 'raiders'
            ? u.loadoutId === loadout('plunderaar')
            : u.role === ROLE_MILITIA;
        }).length;
      const before = trained();
      let ordered = false;
      while (sim.frame < TWO_MIN + 2400 && trained() === before) {
        const done = ownBuildings(sim, typeId, true);
        if (!ordered && done.length > 0) {
          ordered = true;
          step(sim, [
            faction === 'raiders'
              ? {
                  playerId: 0,
                  type: 'Produce',
                  payload: { buildingId: done[0]!, loadoutId: loadout('plunderaar') },
                }
              : {
                  playerId: 0,
                  type: 'SetRole',
                  payload: { ids: [st.scav[0]![0]!], role: 'militia' },
                },
          ]);
        } else step(sim);
      }
      expect(ordered).toBe(true);
      expect(trained()).toBe(before + 1);
    });
  }
});
