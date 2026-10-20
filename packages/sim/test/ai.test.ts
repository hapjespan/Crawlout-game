import { grantTech } from '../src/techBits.js';
import { typeByKey, CONFIG, SCAV, bundle, cmd, MILITIA } from './helpers.js';
import { describe, it, expect } from 'vitest';
import { EVENT_TYPE, OWNER_NEUTRAL } from '@crawlout/protocol';
import { createOpenMap, cellCenter, testPlayers } from '../src/testing.js';
import {
  type SimMap,
  ORDER_GATHER,
  ORDER_CRAFT,
  type Sim,
  ORDER_ATTACK_MOVE,
  ORDER_BUILD,
} from '../src/index.js';
import { CLAIMPAAL, WERKPLAATS, WONING, aiSim, play, techId, unitsOf } from './ai.helpers.js';

const PATROL = typeByKey('patrol');

describe('scripted AI (balans speltest 14 oktober)', () => {
  it('bouwt een woning zodra er housingFreeBeds of minder vrije bedden zijn, één tegelijk', () => {
    const sim = aiSim({ housingTypeId: WONING, housingFreeBeds: 1 });
    sim.setScrap(0, 1000);
    // start: 6 bewoners op 6 bedden van het hoofdgebouw, dus 0 vrij
    const ev = play(sim, 2);
    const placed = ev.filter((e) => e.type === EVENT_TYPE.buildingPlaced && e.b === WONING);
    expect(placed).toHaveLength(1);
    play(sim, 50);
    expect(sim.entityIds().filter((id) => sim.getUnit(id)!.typeId === WONING)).toHaveLength(1);
  });

  it('onderzoekt de techs uit research in volgorde, vanaf researchFromTicks', () => {
    const sim = aiSim({
      research: [techId('snelle_voeten'), techId('geweerrek')],
      researchFromTicks: 100,
    });
    sim.setScrap(0, 5000);
    const ws = sim.spawnBuilding(WERKPLAATS, 0, 20, 4, true);
    play(sim, 99);
    expect(sim.world.research[sim.world.resolve(ws)]).toBe(0);
    play(sim, 2);
    expect(sim.world.research[sim.world.resolve(ws)]).toBe(techId('snelle_voeten') + 1);
    play(sim, CONFIG.techs[techId('snelle_voeten')]!.researchTicks + 2);
    expect(sim.researched(0)).toContain(techId('snelle_voeten'));
    expect(sim.world.research[sim.world.resolve(ws)]).toBe(techId('geweerrek') + 1);
  });

  it('verdeelt plunderaars: hoogstens scavengersPerNode per node, een node bij een eigen claimpunt eerst', () => {
    const open = createOpenMap(64, 64);
    // twee nodes: een vlak bij de spawn, een verder weg naast het claimpunt
    const map: SimMap = {
      ...open,
      scrapNodes: [
        { ...cellCenter(14, 8), amount: 5000 },
        { ...cellCenter(30, 26), amount: 5000 },
      ],
      claimPoints: [{ ...cellCenter(30, 30), kind: 1 }],
    };
    const sim = aiSim({ scavengersPerNode: 3 }, map);
    // het claimpunt wordt van speler 0
    sim.spawnBuilding(CLAIMPAAL, 0, 31, 30, true);
    play(sim, 1);
    const pt = sim.entityIds().find((id) => sim.getUnit(id)!.kind === 'claimPoint')!;
    expect(sim.getUnit(pt)!.owner).toBe(0);
    // de plunderaars kregen in frame 0 al werk (toen was het punt nog neutraal): Stop, dan verdeelt de AI opnieuw
    const scavs = unitsOf(sim, 0)
      .filter((u) => u.typeId === SCAV)
      .map((u) => u.id);
    sim.applyBundle(bundle(sim.frame, [cmd(sim.frame, 0, 'Stop', { ids: scavs })]));
    sim.tick();
    play(sim, 2);
    const nodes = sim.entityIds().filter((id) => sim.getUnit(id)!.kind === 'scrapNode');
    const far = nodes.find((id) => sim.getUnit(id)!.x === cellCenter(30, 26).x)!;
    const near = nodes.find((id) => id !== far)!;
    const gather = unitsOf(sim, 0).filter((u) => u.order === ORDER_GATHER);
    expect(gather).toHaveLength(4); // de vier start-plunderaars
    expect(gather.filter((u) => u.orderTarget === far)).toHaveLength(3); // exclusief eerst, tot de grens
    expect(gather.filter((u) => u.orderTarget === near)).toHaveLength(1);
  });

  it('schoolt plunderaars om tot het eerste leger-loadout waarvoor de techs er zijn', () => {
    const sim = aiSim({
      militiaPermille: 500,
      militiaPermilleMax: 500,
      armyTypeIds: [PATROL, MILITIA],
    });
    sim.setScrap(0, 5000);
    sim.spawnBuilding(WERKPLAATS, 0, 16, 4, true);
    play(sim, 2);
    const crafting = unitsOf(sim, 0).filter((u) => u.order === ORDER_CRAFT);
    expect(crafting.length).toBeGreaterThan(0);
    // zonder geweerrek geen patrol: militie
    play(sim, 400);
    expect(unitsOf(sim, 0).some((u) => u.typeId === MILITIA)).toBe(true);
    expect(unitsOf(sim, 0).some((u) => u.typeId === PATROL)).toBe(false);
    grantTech(sim.ps, 0, techId('geweerrek'));
    // boven richScrap schoolt hij bestaande militie om naar patrol
    play(sim, 600);
    expect(unitsOf(sim, 0).some((u) => u.typeId === PATROL)).toBe(true);
  });

  it('een raid gaat naar het claimpunt van de vijand en keert terug zodra het punt neutraal is; een push naar de spawn', () => {
    const map: SimMap = {
      ...createOpenMap(64, 64),
      claimPoints: [{ ...cellCenter(40, 40), kind: 1 }],
    };
    const run = (
      pushFromTicks: number,
    ): { target: { x: number; y: number }; sim: Sim; army: number[] } => {
      const sim = aiSim(
        {
          attackTimersTicks: [10],
          waveMinArmy: 2,
          waveArmyGrowth: 0,
          pushMinArmy: 2,
          pushFromTicks,
          allInWithoutNodes: false,
        },
        map,
        testPlayers(2, false).map((p, i) => ({ ...p, ai: i === 0 })),
      );
      const army = [0, 1, 2].map((k) =>
        sim.spawnUnit({ typeId: MILITIA, owner: 0, ...cellCenter(20 + k, 20) }),
      );
      sim.spawnBuilding(CLAIMPAAL, 1, 41, 40, true);
      play(sim, 11);
      const u = sim.getUnit(army[0]!)!;
      expect(u.order).toBe(ORDER_ATTACK_MOVE);
      return {
        target: {
          x: sim.world.ordX[sim.world.currentOrder(sim.world.resolve(army[0]!))]!,
          y: sim.world.ordY[sim.world.currentOrder(sim.world.resolve(army[0]!))]!,
        },
        sim,
        army,
      };
    };
    const raid = run(1 << 30);
    expect(raid.target).toEqual(cellCenter(40, 40));
    // het punt valt (de claimpaal weg): de raid keert terug naar het verzamelpunt
    const post = raid.sim.entityIds().find((id) => raid.sim.getUnit(id)!.typeId === CLAIMPAAL)!;
    raid.sim.world.hp[raid.sim.world.resolve(post)] = 0;
    play(raid.sim, 3);
    const pt = raid.sim.entityIds().find((id) => raid.sim.getUnit(id)!.kind === 'claimPoint')!;
    expect(raid.sim.getUnit(pt)!.owner).toBe(OWNER_NEUTRAL);
    const back = raid.sim.world.currentOrder(raid.sim.world.resolve(raid.army[0]!));
    expect(raid.sim.world.ordX[back]).not.toBe(cellCenter(40, 40).x);
    const push = run(0);
    expect(push.target).toEqual(map.spawns[1]);
  });

  it('claimt eerst het punt aan de eigen kant, ook ver weg en met escorte; het midden pas vanaf claimFarFromTicks', () => {
    // het midden (32,32) ligt dichter bij het hoofdgebouw (8,8) dan het punt aan de eigen kant (8,44), maar is van niemand
    const own = cellCenter(8, 44);
    const map: SimMap = {
      ...createOpenMap(64, 64),
      claimPoints: [
        { ...cellCenter(32, 32), kind: 1 },
        { ...own, kind: 0 },
      ],
    };
    const posts = (sim: Sim): { x: number; y: number }[] =>
      sim
        .entityIds()
        .map((id) => sim.getUnit(id)!)
        .filter((u) => u.typeId === CLAIMPAAL && u.owner === 0);
    const near = (u: { x: number; y: number }, c: { x: number; y: number }): boolean =>
      Math.abs(u.x - c.x) <= 6 * 256 && Math.abs(u.y - c.y) <= 6 * 256;
    const players = testPlayers(2, false).map((p, i) => ({ ...p, ai: i === 0 }));
    const sim = aiSim({ claimFromTicks: 0, claimSafeRadius: 10 * 256 }, map, players);
    play(sim, 2);
    const p = posts(sim);
    expect(p).toHaveLength(1);
    expect(near(p[0]!, own)).toBe(true);
    // verder dan claimSafeRadius: de militie zonder taak gaat als escorte mee
    expect(
      unitsOf(sim, 0)
        .filter((u) => u.typeId === MILITIA)
        .every((u) => u.order === ORDER_ATTACK_MOVE),
    ).toBe(true);
    // het midden komt pas na claimFarFromTicks
    play(sim, 600);
    expect(posts(sim).some((u) => near(u, cellCenter(32, 32)))).toBe(false);
    const later = aiSim({ claimFromTicks: 0, claimFarFromTicks: 0, builders: 1 }, map, players);
    play(later, 2);
    play(later, 1200);
    expect(posts(later).some((u) => near(u, cellCenter(32, 32)))).toBe(true);
  });

  it('een raid neemt een bouwer mee die een claimpaal bij het punt zet, en wacht en spaart tot hij die kan betalen', () => {
    const map: SimMap = {
      ...createOpenMap(64, 64),
      claimPoints: [{ ...cellCenter(40, 40), kind: 1 }],
    };
    const sim = aiSim(
      { attackTimersTicks: [10], waveMinArmy: 2, waveArmyGrowth: 0, allInWithoutNodes: false },
      map,
      testPlayers(2, false).map((p, i) => ({ ...p, ai: i === 0 })),
    );
    const army = [0, 1].map((k) =>
      sim.spawnUnit({ typeId: MILITIA, owner: 0, ...cellCenter(20 + k, 20) }),
    );
    sim.spawnBuilding(CLAIMPAAL, 1, 41, 40, true);
    sim.setScrap(0, 0);
    const goal = (): number => {
      const i = sim.world.resolve(army[0]!);
      return sim.getUnit(army[0]!)!.order === ORDER_ATTACK_MOVE
        ? sim.world.ordX[sim.world.currentOrder(i)]!
        : -1;
    };
    play(sim, 20);
    // geen scrap voor een claimpaal: de raid wacht (de militie verzamelt bij het hoofdgebouw)
    expect(goal()).not.toBe(cellCenter(40, 40).x);
    sim.setScrap(0, CONFIG.buildingTypes.find((b) => b.typeId === CLAIMPAAL)!.scrapCost);
    play(sim, 1);
    expect(goal()).toBe(cellCenter(40, 40).x);
    const site = sim
      .entityIds()
      .map((id) => sim.getUnit(id)!)
      .find((u) => u.typeId === CLAIMPAAL && u.owner === 0);
    expect(site).toBeDefined();
    expect(Math.abs(site!.x - cellCenter(40, 40).x)).toBeLessThanOrEqual(6 * 256);
    expect(unitsOf(sim, 0).some((u) => u.order === ORDER_BUILD && u.orderTarget === site!.id)).toBe(
      true,
    );
    expect(sim.playerStatus(0).scrap).toBe(0);
  });

  it('spaart voor het oplappen van een gesneuvelde held en lapt hem op zodra het kan', () => {
    const sim = aiSim({ housingTypeId: WONING, housingFreeBeds: 10 });
    const hero = sim.entityIds().find((id) => sim.getUnit(id)!.kind === 'hero')!;
    sim.world.hp[sim.world.resolve(hero)] = 0;
    sim.setScrap(0, 0);
    play(sim, 2);
    sim.setScrap(0, CONFIG.heroes[0]!.reviveScrap - 1);
    play(sim, 3);
    expect(sim.playerStatus(0).hero!.state).toBe('dead');
    // geen woning: hij spaart
    expect(sim.entityIds().some((id) => sim.getUnit(id)!.typeId === WONING)).toBe(false);
    sim.setScrap(0, CONFIG.heroes[0]!.reviveScrap + 10);
    play(sim, 1);
    expect(sim.playerStatus(0).hero!.state).toBe('reviving');
  });
});
