import { typeByKey, SCAV, MILITIA, CONFIG, BUILDER } from './helpers.js';
import type { Sim } from '../src/index.js';
import { describe, expect, it } from 'vitest';
import { cellCenter } from '../src/testing.js';
import { ENTITY_NONE } from '@crawlout/protocol';
import { ROLES } from '@crawlout/data';
import {
  FACTORY,
  SENTINEL,
  WONING,
  idiv,
  now,
  open,
  play,
  research,
  unitType,
} from './robots.helpers.js';

const BEACON = typeByKey('radiobaken');

const WERKPLAATS = typeByKey('werkplaats');

const GUARD = typeByKey('beveiligingsrobot');

const DRONE = typeByKey('reparatiedrone');

const TECHNICUS = typeByKey('technicus');

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
    expect(sim.playerStatus(0).noBedPop).toBe(guard.popCost);
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
    expect(st.noBedPop).toBe(guard.popCost);
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
    expect(st.pop + (st.noBedPop ?? 0)).toBe(CONFIG.popCapMax);
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
