import { describe, expect, it } from 'vitest';
import { EVENT_TYPE, OWNER_NEUTRAL } from '@crawlout/protocol';
import {
  ORDER_ATTACK_MOVE,
  ORDER_BUILD,
  ORDER_CRAFT,
  ORDER_GATHER,
  createSim,
} from '../src/index.js';
import type { Sim, SimAiScript, SimConfig, SimMap } from '../src/index.js';
import { ROLES } from '@crawlout/data';
import { cellCenter, createOpenMap, testPlayers } from '../src/testing.js';
import { CONFIG, DATA, MILITIA, SCAV, bundle, cmd, typeByKey } from './helpers.js';

// De scripted AI na de speltest van 14 oktober (ai/*.json): bijbouwen bij de pop-cap, onderzoek uit het script,
// plunderaars verdelen over nodes (exclusief eerst), raids op claimpunten en pushes op het hoofdgebouw, en sparen
// voor het oplappen van de held. Elke test zet de rest van het script uit, zodat hij één regel toetst.

const WONING = typeByKey('woning');
const WERKPLAATS = typeByKey('werkplaats');
const CLAIMPAAL = typeByKey('claimpaal');
const PATROL = typeByKey('patrol');
const LAB = typeByKey('lab');
const TRAINING = typeByKey('trainingsfaciliteit');
const SENTINEL = typeByKey('sentinel');
const program = (letter: string) =>
  CONFIG.training.find((t) => t.special === 'SPECIAL'.indexOf(letter))!;
const techId = (key: string): number => DATA.tech.find((t) => t.key === key)!.id;
const BASE = CONFIG.aiScripts[0]!;

/** Een script dat niets doet behalve wat de test aanzet. */
const quiet: SimAiScript = {
  ...BASE,
  buildOrder: [],
  attackTimersTicks: [],
  militiaPermille: 0,
  militiaPermilleMax: 0,
  militiaPermillePerMin: 0,
  threatMilitiaPermille: 0,
  builders: 1,
  housingTypeId: 0,
  research: [],
  richBuilds: [],
  claimFromTicks: 1 << 30,
  claimFarFromTicks: 1 << 30,
  waveIntervalTicks: 1 << 30,
  waveJitterTicks: 0,
  robots: null,
  reserve: null,
  training: null,
};

function aiSim(
  script: Partial<SimAiScript>,
  map: SimMap = createOpenMap(64, 64),
  players = testPlayers(1, true),
): Sim {
  const config: SimConfig = { ...CONFIG, aiScripts: [{ ...quiet, ...script }] };
  return createSim({ seed: 5, players, map, config });
}

function play(sim: Sim, frames: number): { type: number; a: number; b: number }[] {
  const ev: { type: number; a: number; b: number }[] = [];
  for (let n = 0; n < frames; n++) {
    sim.applyBundle(bundle(sim.frame));
    sim.tick();
    for (let k = 0; k < sim.events.count; k++)
      ev.push({ type: sim.events.type[k]!, a: sim.events.a[k]!, b: sim.events.b[k]! });
  }
  return ev;
}

const unitsOf = (sim: Sim, owner: number) =>
  sim
    .entityIds()
    .map((id) => sim.getUnit(id)!)
    .filter((u) => u.owner === owner && u.kind === 'unit');

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
    sim.ps.tech[0] = 1 << techId('geweerrek');
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
        robots: { typeIds: [SENTINEL], fromTicks: 1 << 30, max: 0, countAsArmy, reservePop: 0 },
      });
      sim.spawnUnit({ typeId: SENTINEL, owner: 0, ...cellCenter(30, 30) }); // pop 4
      sim.setScrap(0, 3 * militiaCost);
      play(sim, 2);
      return recruiting(sim);
    };
    expect(run(false)).toBeGreaterThan(0);
    expect(run(true)).toBe(0);
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
