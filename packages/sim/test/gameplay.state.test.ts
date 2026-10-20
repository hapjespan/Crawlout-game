// Split from gameplay.test.ts to stay under the 5,000-token file limit.
import { describe, it, expect } from 'vitest';
import { testInit, BUILDER, cmd, envOf, runFrames, DATA } from './helpers.js';
import { createTestMap, testPlayers, cellCenter } from '../src/testing.js';
import {
  createSim,
  deserialize,
  type SimWorkerOutbound,
  createSimWorkerCore,
  ORDER_GATHER,
} from '../src/index.js';
import {
  OWNER_NEUTRAL,
  EVENT_TYPE,
  readSnapshotHeader,
  snapshotLayout,
  ANIM,
} from '@crawlout/protocol';
import { WONING, at, play } from './gameplay.helpers.js';

describe('state', () => {
  it('serialize/deserialize midden in een potje met gebouwen, bouwplaatsen, lijken en flow fields: zelfde hash, zelfde vervolg', () => {
    const init = testInit(13, createTestMap(), testPlayers(2, true));
    const sim = createSim(init);
    const builder = sim
      .entityIds()
      .find((id) => sim.getUnit(id)!.typeId === BUILDER && sim.getUnit(id)!.owner === 0)!;
    const p = cellCenter(16, 14);
    play(sim, 1, at(0, cmd(0, 0, 'Build', { ids: [builder], typeId: WONING, x: p.x, y: p.y })));
    for (const stop of [40, 333, 1200]) {
      play(sim, stop - sim.frame);
      const copy = deserialize(sim.serialize(), envOf(init));
      expect(copy.hash()).toBe(sim.hash());
      expect(runFrames(copy, 300)).toEqual(
        runFrames(deserialize(sim.serialize(), envOf(init)), 300),
      );
    }
  });

  it('weigert een state met andere spelers (ai-vlag in de envHash)', () => {
    const sim = createSim(testInit(14));
    expect(() =>
      deserialize(sim.serialize(), envOf(testInit(14, createTestMap(), testPlayers(2, true)))),
    ).toThrow(/envHash/);
  });

  it('playerStatus en de query in de worker-schil', () => {
    const out: SimWorkerOutbound[] = [];
    const core = createSimWorkerCore({ post: (m) => out.push(m) });
    core.receive({ kind: 'query', playerId: 0 });
    expect(out.pop()!.kind).toBe('error');
    core.receive({ kind: 'init', init: testInit(15) });
    core.receive({ kind: 'query', playerId: 1 });
    const st = out.pop()!;
    expect(st).toEqual({
      kind: 'status',
      frame: 0,
      status: {
        playerId: 1,
        scrap: DATA.factions[0]!.startScrap,
        settlers: 6,
        pop: 6,
        popCap: 6,
        beds: 6,
        hero: {
          heroId: 0,
          level: 1,
          xp: 0,
          xpNext: DATA.heroes[0]!.xpThresholds[0],
          special: DATA.heroes[0]!.special,
          perks: [],
          pendingPerks: 0,
          revivesLeft: 4,
          state: 'alive',
          reviveTicksLeft: 0,
          entityId: core
            .sim!.entityIds()
            .find(
              (id) => core.sim!.getUnit(id)!.kind === 'hero' && core.sim!.getUnit(id)!.owner === 1,
            ),
          abilityCooldownTicks: [0],
        },
        techs: [],
        queue: [],
        robotPop: 0,
        trained: [0, 0, 0, 0, 0, 0, 0],
        chems: [],
        dominance: {
          pointsHeld: 0,
          pointsRequired: createTestMap().dominance.pointsRequired,
          ticksHeld: 0,
          ticksRequired: createTestMap().dominance.ticks,
          leader: { playerId: 0, pointsHeld: 0, ticksHeld: 0 },
        },
        // protocol 0.10.0 (voorstel): the claim state of every claim point, for the ring in the HUD
        claimPoints: core
          .sim!.entityIds()
          .filter((id) => core.sim!.getUnit(id)!.kind === 'claimPoint')
          .map((pointId) => ({
            pointId,
            owner: OWNER_NEUTRAL,
            beacon: false,
            activity: 'none',
            by: OWNER_NEUTRAL,
            progressPermille: 0,
            frozen: false,
          })),
        // protocol 0.14.0 (voorstel): the creep camps of the map (none on the test map)
        camps: [],
        slaveGroups: [], // protocol 0.15.0 (voorstel): the Dwellers have no slaves
        project: null, // protocol 0.16.0 (voorstel): no Bouwproject on the test map
        survival: null, // protocol 0.17.0: not a survival run
      },
      winner: null,
    });
    core.receive({ kind: 'query', playerId: 7 });
    expect(out.pop()!.kind).toBe('error');
  });

  it('presentatie: een bouwplaats heeft anim build en animT als voortgang', () => {
    const sim = createSim(testInit(16));
    const builder = sim
      .entityIds()
      .find((id) => sim.getUnit(id)!.typeId === BUILDER && sim.getUnit(id)!.owner === 0)!;
    const p = cellCenter(16, 14);
    const ev = play(
      sim,
      200,
      at(0, cmd(0, 0, 'Build', { ids: [builder], typeId: WONING, x: p.x, y: p.y })),
    );
    const site = ev.find((e) => e.type === EVENT_TYPE.buildingPlaced)!.a;
    const buf = sim.writeSnapshot();
    const h = readSnapshotHeader(buf);
    const L = snapshotLayout(h.entityCount, h.eventCount);
    const k = Array.from(new Uint32Array(buf, L.entity.id, h.entityCount)).indexOf(site);
    expect(new Uint8Array(buf, L.entity.anim, h.entityCount)[k]).toBe(ANIM.build);
    expect(new Uint16Array(buf, L.entity.animT, h.entityCount)[k]).toBeGreaterThan(0);
    expect(sim.getUnit(builder)!.order).not.toBe(ORDER_GATHER);
  });
});
