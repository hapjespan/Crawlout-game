// Split from ai.test.ts to stay under the 5,000-token file limit.
import { grantTech } from '../src/techBits.js';
import { typeByKey, CONFIG, MILITIA } from './helpers.js';
import {
  type SimMap,
  ORDER_GATHER,
  ORDER_CRAFT,
  type Sim,
  type SimAiScript,
  ORDER_BUILD,
} from '../src/index.js';
import { createOpenMap, cellCenter } from '../src/testing.js';
import { describe, it, expect } from 'vitest';
import { ROLES } from '@crawlout/data';
import { CLAIMPAAL, WERKPLAATS, WONING, aiSim, play, techId, unitsOf } from './ai.helpers.js';

const LAB = typeByKey('lab');

const TRAINING = typeByKey('trainingsfaciliteit');

const SENTINEL = typeByKey('sentinel');

const program = (letter: string) =>
  CONFIG.training.find((t) => t.special === 'SPECIAL'.indexOf(letter))!;

/** Open map van 64 bij 64 met een rivier (een muur) op kolom x, van boven tot rij gapY; daaronder een oversteek. */
function riverMap(x: number, gapY: number): SimMap {
  const open = createOpenMap(64, 64);
  const passable = new Uint8Array(open.passable);
  for (let y = 1; y < gapY; y++) passable[y * 64 + x] = 0;
  return { ...open, passable };
}

describe('scripted AI op padafstand en zonder vast te lopen (xl-int)', () => {
  it('plunderaars kiezen de node met de kortste rit over land, niet de node die hemelsbreed het dichtst bij ligt', () => {
    // node A ligt 16 m van het hoofdgebouw aan de overkant van de rivier (de oversteek is 50 m verder), node B 28 m
    // verderop aan de eigen kant
    const map: SimMap = {
      ...riverMap(20, 56),
      scrapNodes: [
        { ...cellCenter(24, 8), amount: 5000 },
        { ...cellCenter(8, 36), amount: 5000 },
      ],
    };
    const sim = aiSim({ scavengersPerNode: 10 }, map);
    play(sim, 2);
    const b = sim.entityIds().find((id) => sim.getUnit(id)!.x === cellCenter(8, 36).x)!;
    const gather = unitsOf(sim, 0).filter((u) => u.order === ORDER_GATHER);
    expect(gather).toHaveLength(4);
    expect(gather.every((u) => u.orderTarget === b)).toBe(true);
  });

  it('claimt het punt dat over land het dichtst bij ligt; een onbereikbaar punt nooit', () => {
    const map: SimMap = {
      ...riverMap(20, 56),
      claimPoints: [
        { ...cellCenter(26, 10), kind: 0 }, // hemelsbreed dichtbij, over land ver
        { ...cellCenter(8, 40), kind: 0 },
      ],
    };
    const sim = aiSim({ claimFromTicks: 0, claimSafeRadius: 200 * 256 }, map);
    play(sim, 2);
    const posts = sim
      .entityIds()
      .map((id) => sim.getUnit(id)!)
      .filter((u) => u.typeId === CLAIMPAAL);
    expect(posts).toHaveLength(1);
    expect(Math.abs(posts[0]!.x - cellCenter(8, 40).x)).toBeLessThanOrEqual(6 * 256);
    expect(Math.abs(posts[0]!.y - cellCenter(8, 40).y)).toBeLessThanOrEqual(6 * 256);
    // een punt achter een gesloten muur bestaat voor de AI niet
    const closed = riverMap(20, 64);
    const only: SimMap = { ...closed, claimPoints: [{ ...cellCenter(26, 10), kind: 0 }] };
    const sim2 = aiSim({ claimFromTicks: 0, claimSafeRadius: 200 * 256 }, only);
    play(sim2, 2);
    expect(sim2.entityIds().some((id) => sim2.getUnit(id)!.typeId === CLAIMPAAL)).toBe(false);
  });

  it('een gesloopte werkplaats komt terug, vóór de rest van de bouwvolgorde; tot hij betaald is, spaart hij', () => {
    const sim = aiSim({
      buildOrder: [{ atTick: 0, typeId: WERKPLAATS }],
      housingTypeId: WONING,
      housingFreeBeds: 10,
    });
    // de werkplaats uit de bouwvolgorde was er al en is weg
    sim.ps.aiBuild[0] = 1;
    const cost = CONFIG.buildingTypes.find((b) => b.typeId === WERKPLAATS)!.scrapCost;
    sim.setScrap(0, cost - 1);
    play(sim, 3);
    // geen woning: hij spaart voor de werkplaats
    expect(sim.entityIds().some((id) => sim.getUnit(id)!.typeId === WONING)).toBe(false);
    sim.setScrap(0, cost);
    play(sim, 1);
    expect(sim.entityIds().some((id) => sim.getUnit(id)!.typeId === WERKPLAATS)).toBe(true);
  });

  it('zonder bouwer: met een werkplaats schoolt hij een bewoner om (ook militie), zonder werkplaats levert de groei een bouwer en herbouwt hij', () => {
    // met werkplaats, zonder plunderaars en bouwers: de militie wordt bouwer
    const a = aiSim({});
    a.spawnBuilding(WERKPLAATS, 0, 16, 4, true);
    a.setScrap(0, 100);
    for (const u of unitsOf(a, 0)) if (u.typeId !== MILITIA) a.world.hp[a.world.resolve(u.id)] = 0;
    play(a, 3);
    const mil = unitsOf(a, 0).find((u) => u.typeId === MILITIA)!;
    expect(mil.order).toBe(ORDER_CRAFT);
    // zonder werkplaats en zonder bouwer: de volgende bewoner uit de groei is een bouwer en die zet de werkplaats neer
    const b = aiSim({ buildOrder: [{ atTick: 0, typeId: WERKPLAATS }] });
    b.ps.aiBuild[0] = 1;
    b.setScrap(0, 500);
    for (const u of unitsOf(b, 0))
      if (u.role === ROLES.indexOf('builder')) b.world.hp[b.world.resolve(u.id)] = 0;
    play(b, 2);
    expect(unitsOf(b, 0).some((u) => u.role === ROLES.indexOf('builder'))).toBe(false);
    const per = Math.ceil(CONFIG.ticksPerMinute / CONFIG.factions[0]!.housingGrowthPerMin);
    play(b, per + 2);
    expect(unitsOf(b, 0).some((u) => u.role === ROLES.indexOf('builder'))).toBe(true);
    expect(b.entityIds().some((id) => b.getUnit(id)!.typeId === WERKPLAATS)).toBe(true);
  });
});

// Data 0.17.0: the AI through the tech tree (reserve, training, robots in the army, pop kept free for robots).
describe('scripted AI: budget rules for the tech tree (data 0.17.0)', () => {
  const raffinage = techId('raffinage');
  /** Scrap below the research price (the hero passive makes it cheaper) but above a militia recruit. */
  const militiaCost = CONFIG.unitTypes.find((u) => u.typeId === MILITIA)!.scrapCost;
  const recruiting = (sim: Sim) => unitsOf(sim, 0).filter((u) => u.order === ORDER_CRAFT).length;
  const setup = (script: Partial<SimAiScript>): Sim => {
    const sim = aiSim({
      militiaPermille: 1000,
      militiaPermilleMax: 1000,
      armyTypeIds: [MILITIA],
      research: [raffinage],
      researchFromTicks: 0,
      ...script,
    });
    sim.spawnBuilding(WERKPLAATS, 0, 16, 4, true);
    sim.spawnBuilding(LAB, 0, 40, 4, true);
    return sim;
  };

  it('reserve: saves for the next research when only scrap is missing; recruiting only spends what is above it', () => {
    // without reserve the militia takes the scrap and the research never comes round
    const free = setup({});
    free.setScrap(0, 3 * militiaCost);
    play(free, 2);
    expect(recruiting(free)).toBeGreaterThan(0);
    // with reserve (army 0 >= minArmy 0, no threat) it keeps the scrap for raffinage
    const saving = setup({ reserve: { fromTicks: 0, minArmy: 0, robotsFirstFromTicks: 1 << 30 } });
    saving.setScrap(0, 3 * militiaCost);
    play(saving, 2);
    expect(recruiting(saving)).toBe(0);
    saving.setScrap(0, 1000);
    play(saving, 1);
    expect(saving.world.research.some((r) => r === raffinage + 1)).toBe(true);
    // below minArmy it does not save
    const weak = setup({ reserve: { fromTicks: 0, minArmy: 5, robotsFirstFromTicks: 1 << 30 } });
    weak.setScrap(0, 3 * militiaCost);
    play(weak, 2);
    expect(recruiting(weak)).toBeGreaterThan(0);
  });

  it('robots.countAsArmy: the pop of the robots counts toward reserve.minArmy', () => {
    const run = (countAsArmy: boolean): number => {
      const sim = setup({
        reserve: { fromTicks: 0, minArmy: 4, robotsFirstFromTicks: 1 << 30 },
        robots: {
          typeIds: [SENTINEL],
          fromTicks: 1 << 30,
          max: 0,
          countAsArmy,
          reservePop: 0,
          builders: null,
        },
      });
      sim.spawnUnit({ typeId: SENTINEL, owner: 0, ...cellCenter(30, 30) }); // pop 4
      sim.setScrap(0, 3 * militiaCost);
      play(sim, 2);
      return recruiting(sim);
    };
    expect(run(false)).toBeGreaterThan(0);
    expect(run(true)).toBe(0);
  });

  it('robots.builders (data 0.26.0): keeps max builder robots from the factory and builds with them', () => {
    const BOT = typeByKey('bouwrobot');
    const bot = CONFIG.unitTypes.find((u) => u.typeId === BOT)!;
    const sim = aiSim({
      buildOrder: [{ atTick: bot.craftTicks + 40, typeId: WONING, site: 0 }],
      robots: {
        typeIds: [SENTINEL],
        fromTicks: 1 << 30,
        max: 0,
        countAsArmy: false,
        reservePop: 0,
        builders: { typeId: BOT, max: 1, fromTicks: 0 },
      },
    });
    grantTech(sim.ps, 0, techId('raffinage'));
    grantTech(sim.ps, 0, techId('robotica'));
    sim.spawnBuilding(typeByKey('robotfabriek'), 0, 40, 30, true);
    // no human builder: only the robot can follow the build order
    for (const u of unitsOf(sim, 0).filter((u) => u.role === ROLES.indexOf('builder')))
      sim.destroyEntity(u.id);
    sim.setScrap(0, 2000);
    play(sim, 2);
    expect(sim.queue(0)).toMatchObject([{ kind: 'produce', id: bot.loadoutId }]);
    play(sim, bot.craftTicks + 60);
    const bots = unitsOf(sim, 0).filter((u) => u.typeId === BOT);
    expect(bots).toHaveLength(1);
    // max 1: no second one
    expect(sim.queue(0).filter((q) => q.kind === 'produce')).toEqual([]);
    // the build order goes to the builder robot
    expect(sim.getUnit(bots[0]!.id)).toMatchObject({ order: ORDER_BUILD });
    // a lost builder robot is replaced
    sim.destroyEntity(bots[0]!.id);
    play(sim, 2);
    expect(sim.queue(0)).toMatchObject([{ kind: 'produce', id: bot.loadoutId }]);
  });

  it('training: runs the sequence in order, a program listed n times up to n points, only with the reserve condition', () => {
    const E = program('E');
    const S = program('S');
    const sim = aiSim({
      reserve: { fromTicks: 0, minArmy: 0, robotsFirstFromTicks: 1 << 30 },
      training: { programIds: [E.programId, S.programId, E.programId], fromTicks: 10 },
    });
    sim.setScrap(0, 5000);
    sim.spawnBuilding(TRAINING, 0, 40, 30, true);
    play(sim, 10);
    expect(sim.playerStatus(0).trained).toEqual([0, 0, 0, 0, 0, 0, 0]);
    play(sim, 2);
    expect(sim.queue(0)[0]).toMatchObject({ kind: 'train', id: E.programId });
    play(sim, E.trainTicks + S.trainTicks + E.trainTicks + E.trainTicksStep + 10);
    expect(sim.playerStatus(0).trained).toEqual([1, 0, 2, 0, 0, 0, 0]);
    play(sim, 200);
    expect(sim.playerStatus(0).trained).toEqual([1, 0, 2, 0, 0, 0, 0]);
    // without the reserve condition (army below minArmy) it does not train
    const lazy = aiSim({
      reserve: { fromTicks: 0, minArmy: 1000, robotsFirstFromTicks: 1 << 30 },
      training: { programIds: [E.programId], fromTicks: 0 },
    });
    lazy.setScrap(0, 5000);
    lazy.spawnBuilding(TRAINING, 0, 40, 30, true);
    play(lazy, 5);
    expect(lazy.queue(0)).toEqual([]);
  });

  it('robots.reservePop: no housing beyond popCapMax minus reservePop beds', () => {
    const beds = (sim: Sim) => sim.playerStatus(0).beds;
    const run = (reservePop: number): Sim => {
      const sim = aiSim(
        {
          housingTypeId: WONING,
          housingFreeBeds: 1000,
          robots: {
            typeIds: [SENTINEL],
            fromTicks: 1 << 30,
            max: 0,
            countAsArmy: false,
            reservePop,
            builders: null,
          },
        },
        createOpenMap(192, 192),
      );
      sim.setScrap(0, 100000);
      play(sim, 8000);
      return sim;
    };
    const max = CONFIG.popCapMax;
    expect(beds(run(0))).toBeGreaterThanOrEqual(max);
    const kept = run(20);
    expect(beds(kept)).toBeGreaterThanOrEqual(max - 20 - 5);
    expect(beds(kept)).toBeLessThan(max - 20 + 5);
  });
});
