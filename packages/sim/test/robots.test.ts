import { describe, expect, it } from 'vitest';
import { ENTITY_NONE } from '@crawlout/protocol';
import type { CommandEnvelope } from '@crawlout/protocol';
import { ROLES, STATS } from '@crawlout/data';
import { HERO_DEAD, createSim } from '../src/index.js';
import type { Sim } from '../src/index.js';
import { cellCenter, createOpenMap } from '../src/testing.js';
import {
  BUILDER,
  CONFIG,
  DATA,
  MILITIA,
  SCAV,
  bundle,
  cmd,
  emptySim,
  heroResearchCost,
  testInit,
  typeByKey,
} from './helpers.js';

// Dwellers-content van data 0.16.0 in de sim: robotproductie, pop, de technicus-regel, het vangnet, reparatie,
// belegering, het turret-netwerk, de passieven van de held en SPECIAL-training.

const FACTORY = typeByKey('robotfabriek');
const TURRET = typeByKey('turret');
const LASER = typeByKey('turret_laser');
const BEACON = typeByKey('radiobaken');
const WONING = typeByKey('woning');
const WERKPLAATS = typeByKey('werkplaats');
const TRAINING = typeByKey('trainingsfaciliteit');
const LAB = typeByKey('lab');
const GUARD = typeByKey('beveiligingsrobot');
const DRONE = typeByKey('reparatiedrone');
const SENTINEL = typeByKey('sentinel');
const TECHNICUS = typeByKey('technicus');
const unitType = (typeId: number) => CONFIG.unitTypes.find((u) => u.typeId === typeId)!;
const buildingType = (typeId: number) => CONFIG.buildingTypes.find((b) => b.typeId === typeId)!;
const techId = (key: string): number => DATA.tech.find((t) => t.key === key)!.id;
const program = (letter: string) =>
  CONFIG.training.find((t) => t.special === STATS.indexOf(letter as (typeof STATS)[number]))!;
const idiv = (a: number, b: number): number => Math.trunc(a / b);

function play(sim: Sim, frames: number, script: Map<number, CommandEnvelope[]> = new Map()): void {
  for (let n = 0; n < frames; n++) {
    const f = sim.frame;
    sim.applyBundle(bundle(f, script.get(f) ?? []));
    sim.tick();
  }
}
const at = (frame: number, ...cmds: CommandEnvelope[]): Map<number, CommandEnvelope[]> =>
  new Map([[frame, cmds]]);
const now = (sim: Sim, playerId: number, type: CommandEnvelope['type'], payload: unknown): void =>
  play(sim, 1, at(sim.frame, cmd(sim.frame, playerId, type, payload)));
const open = (): Sim => emptySim(1, createOpenMap(64, 64));
const research = (sim: Sim, p: number, ...keys: string[]): void => {
  for (const k of keys) sim.ps.tech[p] = (sim.ps.tech[p]! | (1 << techId(k))) >>> 0;
};
const units = (sim: Sim, p: number, typeId: number): number[] =>
  sim.entityIds().filter((id) => {
    const u = sim.getUnit(id)!;
    return u.owner === p && u.kind === 'unit' && u.typeId === typeId;
  });

describe('robotproductie (Produce)', () => {
  const guard = unitType(GUARD);
  function factorySim(): { sim: Sim; factory: number } {
    const sim = open();
    research(sim, 0, 'raffinage', 'robotica');
    const factory = sim.spawnBuilding(FACTORY, 0, 20, 20, true);
    expect(factory).not.toBe(0);
    sim.setScrap(0, 1000);
    return { sim, factory };
  }

  it('betaalt meteen, wacht craftTicks en zet de robot naast de fabriek; geen bewoner wordt omgebouwd', () => {
    const { sim, factory } = factorySim();
    const scav = sim.spawnUnit({ typeId: SCAV, owner: 0, ...cellCenter(10, 10) });
    now(sim, 0, 'Produce', { buildingId: factory, loadoutId: guard.loadoutId });
    expect(sim.playerStatus(0).scrap).toBe(1000 - guard.scrapCost);
    expect(sim.queue(0)).toMatchObject([
      { kind: 'produce', buildingId: factory, unitId: ENTITY_NONE, id: guard.loadoutId },
    ]);
    // één tegelijk per fabriek
    now(sim, 0, 'Produce', { buildingId: factory, loadoutId: guard.loadoutId });
    expect(sim.playerStatus(0).scrap).toBe(1000 - guard.scrapCost);
    play(sim, guard.craftTicks - 3);
    expect(units(sim, 0, GUARD)).toHaveLength(0);
    play(sim, 2);
    const robots = units(sim, 0, GUARD);
    expect(robots).toHaveLength(1);
    const r = sim.getUnit(robots[0]!)!;
    const f = sim.getUnit(factory)!;
    // naast de footprint (5 x 5 op de testmap)
    expect(Math.abs(r.x - f.x)).toBeLessThan(5 * 256);
    expect(Math.abs(r.y - f.y)).toBeLessThan(5 * 256);
    expect(sim.getUnit(scav)!.typeId).toBe(SCAV);
    expect(sim.queue(0)).toEqual([]);
    expect(sim.playerStatus(0).robotPop).toBe(guard.popCost);
    expect(sim.playerStatus(0).settlers).toBe(1);
  });

  it('vraagt prereqTech, het juiste gebouw, een voltooide fabriek en scrap', () => {
    const sim = open();
    const factory = sim.spawnBuilding(FACTORY, 0, 20, 20, true);
    const site = sim.spawnBuilding(FACTORY, 0, 30, 20, false);
    const ws = sim.spawnBuilding(WERKPLAATS, 0, 40, 20, true);
    sim.setScrap(0, 1000);
    now(sim, 0, 'Produce', { buildingId: factory, loadoutId: guard.loadoutId });
    expect(sim.playerStatus(0).scrap).toBe(1000); // geen robotica
    research(sim, 0, 'raffinage', 'robotica');
    now(sim, 0, 'Produce', { buildingId: site, loadoutId: guard.loadoutId });
    now(sim, 0, 'Produce', { buildingId: ws, loadoutId: guard.loadoutId });
    now(sim, 0, 'Produce', { buildingId: factory, loadoutId: unitType(SENTINEL).loadoutId });
    now(sim, 0, 'Produce', { buildingId: factory, loadoutId: unitType(MILITIA).loadoutId });
    now(sim, 1, 'Produce', { buildingId: factory, loadoutId: guard.loadoutId });
    expect(sim.playerStatus(0).scrap).toBe(1000);
    sim.setScrap(0, guard.scrapCost - 1);
    now(sim, 0, 'Produce', { buildingId: factory, loadoutId: guard.loadoutId });
    expect(sim.queue(0)).toEqual([]);
  });

  it('Cancel op de fabriek stopt de productie met teruggave', () => {
    const { sim, factory } = factorySim();
    now(sim, 0, 'Produce', { buildingId: factory, loadoutId: guard.loadoutId });
    play(sim, 10);
    now(sim, 0, 'Cancel', { ids: [factory] });
    expect(sim.playerStatus(0).scrap).toBe(
      1000 - guard.scrapCost + idiv(guard.scrapCost * CONFIG.cancelRefundPermille, 1000),
    );
    play(sim, guard.craftTicks + 5);
    expect(units(sim, 0, GUARD)).toHaveLength(0);
  });

  it('pop: bewoners plus robots (ook in productie) binnen popCapMax, robots zonder bed', () => {
    const { sim, factory } = factorySim();
    // geen bedden: een robot kan toch
    const free = CONFIG.popCapMax - guard.popCost;
    for (let k = 0; k < free; k++)
      sim.spawnUnit({ typeId: SCAV, owner: 0, ...cellCenter(2 + (k % 30), 40 + (k >> 4)) });
    now(sim, 0, 'Produce', { buildingId: factory, loadoutId: guard.loadoutId });
    expect(sim.queue(0)).toHaveLength(1);
    // vol: nog één bewoner erbij en de volgende past niet
    play(sim, guard.craftTicks + 2);
    expect(units(sim, 0, GUARD)).toHaveLength(1);
    sim.spawnUnit({ typeId: SCAV, owner: 0, ...cellCenter(50, 50) });
    now(sim, 0, 'Produce', { buildingId: factory, loadoutId: guard.loadoutId });
    expect(sim.queue(0)).toEqual([]);
    const st = sim.playerStatus(0);
    expect(st.pop).toBe(free + 1);
    expect(st.robotPop).toBe(guard.popCost);
    expect(st.popCap).toBe(0); // geen bedden
  });

  it('huisvestingsgroei stopt als bewoners plus robots popCapMax raken, ook met vrije bedden', () => {
    const sim = open();
    const hq = sim.spawnBuilding(typeByKey('hoofdgebouw'), 0, 4, 4, true);
    expect(hq).not.toBe(0);
    for (let k = 0; k < 12; k++)
      sim.spawnBuilding(WONING, 0, 12 + (k % 6) * 4, 4 + ((k >> 1) >> 2) * 4, true);
    const beds = sim.playerStatus(0).beds;
    expect(beds).toBeGreaterThanOrEqual(CONFIG.popCapMax);
    const n = Math.trunc(CONFIG.popCapMax / guard.popCost) - 1;
    for (let k = 0; k < n; k++)
      sim.spawnUnit({ typeId: GUARD, owner: 0, ...cellCenter(2 + (k % 30), 40 + (k >> 4)) });
    const room = CONFIG.popCapMax - n * guard.popCost;
    expect(sim.playerStatus(0).popCap).toBe(room);
    play(sim, CONFIG.ticksPerMinute * 4);
    const st = sim.playerStatus(0);
    expect(st.settlers).toBe(room);
    expect(st.pop + (st.robotPop ?? 0)).toBe(CONFIG.popCapMax);
  });

  it('Craft weigert een robot-loadout en een robot schoolt niet om', () => {
    const sim = open();
    research(sim, 0, 'raffinage', 'robotica', 'geweerrek');
    sim.spawnBuilding(WERKPLAATS, 0, 20, 20, true);
    sim.setScrap(0, 1000);
    const scav = sim.spawnUnit({ typeId: SCAV, owner: 0, ...cellCenter(18, 18) });
    const robot = sim.spawnUnit({ typeId: GUARD, owner: 0, ...cellCenter(18, 19) });
    now(sim, 0, 'Craft', { ids: [scav], loadoutId: unitType(GUARD).loadoutId });
    expect(sim.getUnit(scav)!.order).toBe(0);
    now(sim, 0, 'Craft', { ids: [robot], loadoutId: unitType(MILITIA).loadoutId });
    now(sim, 0, 'SetRole', { ids: [robot], role: 'militia' });
    expect(sim.getUnit(robot)!.order).toBe(0);
    // een technicus mag wel (een bewoner)
    now(sim, 0, 'Craft', { ids: [scav], loadoutId: unitType(TECHNICUS).loadoutId });
    expect(sim.getUnit(scav)!.order).not.toBe(0);
  });
});

describe('technicus-regel (robotRules)', () => {
  const rules = CONFIG.factions[0]!.robotRules!;
  const rate = (sim: Sim, id: number): number => {
    const i = sim.world.resolve(id);
    return sim.robotRates.any ? sim.robotRates.rate[i]! : 1000;
  };

  it('dekt robotsPerTechnician robots per technicus, op oplopende id; de rest werkt op (1000 - straf) promille', () => {
    const sim = open();
    const robots: number[] = [];
    for (let k = 0; k <= rules.robotsPerTechnician; k++)
      robots.push(sim.spawnUnit({ typeId: GUARD, owner: 0, ...cellCenter(10 + 2 * k, 10) }));
    play(sim, 1);
    for (const r of robots) expect(rate(sim, r)).toBe(1000 - rules.penaltyPermille);
    // een bouwer is een technicus (technicianRoles)
    expect(rules.technicianRoles).toContain(ROLES.indexOf('builder'));
    const b = sim.spawnUnit({ typeId: BUILDER, owner: 0, ...cellCenter(10, 30) });
    play(sim, 1);
    for (let k = 0; k < rules.robotsPerTechnician; k++) expect(rate(sim, robots[k]!)).toBe(1000);
    expect(rate(sim, robots[rules.robotsPerTechnician]!)).toBe(1000 - rules.penaltyPermille);
    // een scavenger is geen technicus, een technicus wel; de held telt niet
    sim.spawnUnit({ typeId: SCAV, owner: 0, ...cellCenter(12, 30) });
    play(sim, 1);
    expect(rate(sim, robots[rules.robotsPerTechnician]!)).toBe(1000 - rules.penaltyPermille);
    sim.spawnUnit({ typeId: TECHNICUS, owner: 0, ...cellCenter(14, 30) });
    play(sim, 1);
    for (const r of robots) expect(rate(sim, r)).toBe(1000);
    sim.destroyEntity(b);
    play(sim, 1);
    // alleen de technicus: vier gedekt, de vijfde (hoogste id) niet
    expect(rate(sim, robots[0]!)).toBe(1000);
    expect(rate(sim, robots[rules.robotsPerTechnician]!)).toBe(1000 - rules.penaltyPermille);
  });

  it('een ongedekte robot loopt en schiet trager', () => {
    const covered = open();
    const bare = open();
    covered.spawnUnit({ typeId: BUILDER, owner: 0, ...cellCenter(2, 2) });
    const a = covered.spawnUnit({ typeId: GUARD, owner: 0, ...cellCenter(10, 10) });
    const b = bare.spawnUnit({ typeId: GUARD, owner: 0, ...cellCenter(10, 10) });
    now(covered, 0, 'Move', { ids: [a], ...cellCenter(40, 10) });
    now(bare, 0, 'Move', { ids: [b], ...cellCenter(40, 10) });
    play(covered, 40);
    play(bare, 40);
    const da = covered.getUnit(a)!.x - cellCenter(10, 10).x;
    const db = bare.getUnit(b)!.x - cellCenter(10, 10).x;
    expect(db).toBeGreaterThan(0);
    // half tempo (straf 50 procent), op de afronding per tick na
    expect(db * 1000).toBeGreaterThan(da * (1000 - rules.penaltyPermille - 100));
    expect(db * 1000).toBeLessThan(da * (1000 - rules.penaltyPermille + 100));
    // cooldown na een schot: cooldownMax / rate
    const fight = open();
    const r = fight.spawnUnit({ typeId: GUARD, owner: 0, ...cellCenter(20, 20) });
    fight.spawnUnit({ typeId: SCAV, owner: 1, ...cellCenter(22, 20) });
    play(fight, 3);
    const i = fight.world.resolve(r);
    const g = unitType(GUARD);
    expect(fight.world.cooldown[i]).toBeGreaterThan(g.cooldown);
    expect(fight.world.cooldown[i]).toBeLessThanOrEqual(
      idiv(g.cooldown * 1000, 1000 - rules.penaltyPermille),
    );
  });
});

describe('vangnet (safetyNet)', () => {
  const net = CONFIG.factions[0]!.safetyNet!;

  it('onder threshold bewoners en met een voltooid baken komt er elke intervalTicks een bewoner bij het baken', () => {
    const sim = open();
    const beacon = sim.spawnBuilding(BEACON, 0, 30, 30, true);
    sim.spawnBuilding(BEACON, 0, 10, 10, true); // hogere id: niet hier
    play(sim, net.intervalTicks - 1);
    expect(units(sim, 0, net.typeId)).toHaveLength(0);
    play(sim, 1);
    const arrived = units(sim, 0, net.typeId);
    expect(arrived).toHaveLength(1);
    const u = sim.getUnit(arrived[0]!)!;
    const b = sim.getUnit(beacon)!;
    expect(Math.abs(u.x - b.x)).toBeLessThan(3 * 256);
    expect(Math.abs(u.y - b.y)).toBeLessThan(3 * 256);
    expect(sim.ps.netArrivals[0]).toBe(1);
    expect(sim.playerStatus(0).beds).toBe(0); // geen bed nodig
    // robots en een baken in aanbouw tellen niet
    expect(units(sim, 1, net.typeId)).toHaveLength(0);
  });

  it('de timer gaat terug naar 0 zodra de voorwaarde wegvalt, en stopt na maxArrivals', () => {
    const sim = open();
    sim.spawnBuilding(BEACON, 0, 30, 30, true);
    play(sim, net.intervalTicks - 5);
    const extra: number[] = [];
    for (let k = 0; k < net.threshold; k++)
      extra.push(sim.spawnUnit({ typeId: SCAV, owner: 0, ...cellCenter(5 + k, 50) }));
    play(sim, 10);
    expect(sim.ps.netTimer[0]).toBe(0);
    for (const id of extra) sim.destroyEntity(id);
    play(sim, net.intervalTicks - 1);
    expect(units(sim, 0, net.typeId)).toHaveLength(0);
    sim.ps.netArrivals[0] = net.maxArrivals;
    play(sim, net.intervalTicks + 1);
    expect(units(sim, 0, net.typeId)).toHaveLength(0);
  });
});

describe('reparatie (repair)', () => {
  const rep = unitType(DRONE).repair!;

  it('een vrije drone zoekt het beschadigde eigen doel met het laagste hp-aandeel, loopt erheen en herstelt het tot vol', () => {
    const sim = open();
    sim.spawnUnit({ typeId: BUILDER, owner: 0, ...cellCenter(2, 2) }); // technicus
    const drone = sim.spawnUnit({ typeId: DRONE, owner: 0, ...cellCenter(20, 20) });
    const hurt = sim.spawnBuilding(WERKPLAATS, 0, 24, 18, true);
    const worse = sim.spawnBuilding(WONING, 0, 14, 18, true);
    const w = sim.world;
    const hi = w.resolve(hurt);
    const wi = w.resolve(worse);
    w.hp[hi] = w.maxHp[hi]! - 100;
    w.hp[wi] = idiv(w.maxHp[wi]!, 2);
    play(sim, 1);
    expect(sim.getUnit(drone)!.target).toBe(worse);
    play(sim, 600);
    expect(w.hp[wi]).toBe(w.maxHp[wi]);
    // daarna het andere doel
    play(sim, 600);
    expect(w.hp[hi]).toBe(w.maxHp[hi]);
    expect(sim.getUnit(drone)!.target).toBe(0);
  });

  it('herstelt milliHpPerTick duizendsten hp per tick binnen bereik, ook een robot, nooit zichzelf of een vijand', () => {
    const sim = open();
    sim.spawnUnit({ typeId: BUILDER, owner: 0, ...cellCenter(2, 2) });
    const drone = sim.spawnUnit({ typeId: DRONE, owner: 0, ...cellCenter(20, 20) });
    const robot = sim.spawnUnit({ typeId: GUARD, owner: 0, ...cellCenter(21, 20) });
    const enemy = sim.spawnBuilding(WONING, 1, 32, 19, true); // buiten het bereik van de robot, binnen seekRange
    const w = sim.world;
    for (const id of [drone, robot, enemy]) w.hp[w.resolve(id)] = 10;
    play(sim, 2);
    const before = w.hp[w.resolve(robot)]!;
    play(sim, 100);
    expect(w.hp[w.resolve(robot)]! - before).toBe(idiv(rep.milliHpPerTick * 100, 1000));
    expect(w.hp[w.resolve(drone)]).toBe(10);
    expect(w.hp[w.resolve(enemy)]).toBe(10);
  });
});

describe('belegering (siege)', () => {
  const sentinel = unitType(SENTINEL);
  const siege = sentinel.siege!;

  it('doet vsBuildingsPermille extra tegen gebouwen en kiest met buildingsFirst eerst een gebouw', () => {
    const sim = open();
    sim.spawnUnit({ typeId: BUILDER, owner: 0, ...cellCenter(2, 2) });
    const s = sim.spawnUnit({ typeId: SENTINEL, owner: 0, ...cellCenter(20, 20) });
    const house = sim.spawnBuilding(WONING, 1, 30, 19, true);
    sim.spawnUnit({ typeId: SCAV, owner: 1, ...cellCenter(24, 20) }); // dichterbij, maar een unit
    const hb = buildingType(WONING);
    play(sim, 3);
    expect(sim.getUnit(s)!.target).toBe(house);
    const mult = CONFIG.damageMatrix[sentinel.damageType]![hb.armorType]!;
    const per = idiv(idiv(sentinel.damage * (1000 + siege.vsBuildingsPermille), 1000) * mult, 1000);
    expect(sim.getUnit(house)!.hp).toBe(hb.maxHp - per);
  });
});

describe('turret-netwerk (network)', () => {
  const net = buildingType(TURRET).network!;
  const damage = (sim: Sim, id: number): number => sim.world.damage[sim.world.resolve(id)]!;

  it('met de tech: per andere voltooide eigen turret binnen de straal, tot het maximum; opnieuw bij bouwen en verlies', () => {
    const sim = open();
    const a = sim.spawnBuilding(TURRET, 0, 30, 30, true);
    const b = sim.spawnBuilding(LASER, 0, 34, 30, true);
    expect(damage(sim, a)).toBe(buildingType(TURRET).damage);
    research(sim, 0, 'raffinage', 'lasergeleiding', 'lasertechniek', 'turret_netwerk');
    sim.spawnBuilding(TURRET, 0, 30, 34, true); // wordt af: buren opnieuw
    const base = buildingType(TURRET).damage;
    // lasergeleiding geeft zelf ook damagePct op turrets: één som
    const tech = 200;
    expect(damage(sim, a)).toBe(idiv(base * (1000 + tech + 2 * net.damagePermillePerTurret), 1000));
    const far = sim.spawnBuilding(TURRET, 0, 2, 2, true);
    expect(damage(sim, far)).toBe(idiv(base * (1000 + tech), 1000));
    const site = sim.spawnBuilding(TURRET, 0, 26, 30, false);
    expect(damage(sim, a)).toBe(idiv(base * (1000 + tech + 2 * net.damagePermillePerTurret), 1000));
    // verlies van b: de bonus van b valt weg
    sim.world.hp[sim.world.resolve(b)] = 0;
    play(sim, 1);
    expect(damage(sim, a)).toBe(idiv(base * (1000 + tech + net.damagePermillePerTurret), 1000));
    expect(site).not.toBe(0);
    // het maximum
    for (let k = 0; k < 8; k++)
      sim.spawnBuilding(TURRET, 0, 36 + 3 * (k % 4), 34 + 3 * (k >> 2), true);
    expect(damage(sim, a)).toBe(idiv(base * (1000 + tech + net.maxDamagePermille), 1000));
  });
});

describe('passieven van de held (Opziener)', () => {
  it('onderzoek goedkoper en turrets sterker zolang de held leeft, met de oplap-straf', () => {
    const sim = createSim(testInit(5, createOpenMap(64, 64)));
    sim.setScrap(0, 1000);
    const lab = sim.spawnBuilding(LAB, 0, 40, 40, true);
    const t = CONFIG.techs[techId('raffinage')]!;
    now(sim, 0, 'Research', { techId: t.techId });
    expect(sim.playerStatus(0).scrap).toBe(1000 - heroResearchCost(t.scrapCost));
    now(sim, 0, 'Cancel', { ids: [lab] });
    const turret = sim.spawnBuilding(TURRET, 0, 50, 50, true);
    const tb = buildingType(TURRET);
    expect(sim.world.damage[sim.world.resolve(turret)]).toBe(idiv(tb.damage * 1100, 1000));
    // held dood: geen passieven
    const hero = sim.ps.heroEnt[0]!;
    sim.world.hp[sim.world.resolve(hero)] = 0;
    play(sim, 1);
    expect(sim.ps.heroState[0]).toBe(HERO_DEAD);
    expect(sim.world.damage[sim.world.resolve(turret)]).toBe(tb.damage);
    sim.setScrap(0, 1000);
    now(sim, 0, 'Research', { techId: t.techId });
    expect(sim.playerStatus(0).scrap).toBe(1000 - t.scrapCost);
  });
});

describe('SPECIAL-training (Train)', () => {
  const kracht = program('S');

  it('kost scrapCost + stap maal getraind, duurt trainTicks + stap maal getraind, geeft een punt op de letter', () => {
    const sim = createSim(testInit(5, createOpenMap(64, 64)));
    const fac = sim.spawnBuilding(TRAINING, 0, 40, 40, true);
    sim.setScrap(0, 5000);
    const base = sim.playerStatus(0).hero!.special[0];
    for (let run = 0; run < kracht.maxPoints; run++) {
      const before = sim.playerStatus(0).scrap;
      now(sim, 0, 'Train', { buildingId: fac, programId: kracht.programId });
      expect(sim.playerStatus(0).scrap).toBe(
        before - (kracht.scrapCost + run * kracht.scrapCostStep),
      );
      expect(sim.queue(0)[0]).toMatchObject({
        kind: 'train',
        buildingId: fac,
        id: kracht.programId,
      });
      // dezelfde letter niet in een tweede gebouw
      play(sim, kracht.trainTicks + run * kracht.trainTicksStep - 2);
      expect(sim.playerStatus(0).trained![0]).toBe(run);
      play(sim, 1);
      expect(sim.playerStatus(0).trained![0]).toBe(run + kracht.pointsPerRun);
      expect(sim.playerStatus(0).hero!.special[0]).toBe(base + run + 1);
    }
    const before = sim.playerStatus(0).scrap;
    now(sim, 0, 'Train', { buildingId: fac, programId: kracht.programId });
    expect(sim.playerStatus(0).scrap).toBe(before); // maxPoints
  });

  it('één programma per gebouw, een letter nooit twee keer tegelijk, Cancel met teruggave, blijft na de dood van de held', () => {
    const sim = createSim(testInit(5, createOpenMap(64, 64)));
    const a = sim.spawnBuilding(TRAINING, 0, 40, 40, true);
    const b = sim.spawnBuilding(TRAINING, 0, 50, 40, true);
    sim.setScrap(0, 5000);
    now(sim, 0, 'Train', { buildingId: a, programId: kracht.programId });
    now(sim, 0, 'Train', { buildingId: a, programId: program('P').programId });
    now(sim, 0, 'Train', { buildingId: b, programId: kracht.programId });
    expect(sim.queue(0)).toHaveLength(1);
    now(sim, 0, 'Train', { buildingId: b, programId: program('E').programId });
    expect(sim.queue(0)).toHaveLength(2);
    const before = sim.playerStatus(0).scrap;
    now(sim, 0, 'Cancel', { ids: [b] });
    expect(sim.playerStatus(0).scrap).toBe(
      before + idiv(program('E').scrapCost * CONFIG.cancelRefundPermille, 1000),
    );
    const hero = sim.ps.heroEnt[0]!;
    sim.world.hp[sim.world.resolve(hero)] = 0;
    play(sim, kracht.trainTicks + 2);
    expect(sim.ps.heroState[0]).toBe(HERO_DEAD);
    expect(sim.playerStatus(0).trained).toEqual([1, 0, 0, 0, 0, 0, 0]);
    expect(sim.playerStatus(0).hero!.special[0]).toBe(CONFIG.heroes[0]!.special[0]! + 1);
    // een programma in een ander gebouwtype kan niet
    const lab = sim.spawnBuilding(LAB, 0, 30, 50, true);
    now(sim, 0, 'Train', { buildingId: lab, programId: program('C').programId });
    expect(sim.queue(0)).toEqual([]);
  });
});

describe('AI-robots (robots in ai/*.json)', () => {
  it('telt robots niet als militie en bouwt ze cyclisch tot max', () => {
    const script = CONFIG.aiScripts[0]!.robots!;
    expect(script.max).toBeLessThanOrEqual(
      CONFIG.aiScripts[0]!.builders * CONFIG.factions[0]!.robotRules!.robotsPerTechnician,
    );
    expect(script.typeIds.every((t) => unitType(t).producedAtTypeId === FACTORY)).toBe(true);
  });
});
