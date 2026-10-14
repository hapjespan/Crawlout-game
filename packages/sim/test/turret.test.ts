import { describe, expect, it } from 'vitest';
import { ENTITY_FLAG, EVENT_TYPE } from '@crawlout/protocol';
import type { CommandEnvelope } from '@crawlout/protocol';
import { MAX_ABILITIES, createSim } from '../src/index.js';
import type { Sim, SimConfig } from '../src/index.js';
import { cellCenter, createOpenMap, testPlayers } from '../src/testing.js';
import { BUILDER, CONFIG, DATA, MILITIA, SCAV, bundle, cmd, emptySim, testInit, typeByKey } from './helpers.js';

// Turrets (besluit 8, fase-0 sectie 14), de AI die de prereqTech van zijn bouworder onderzoekt, en Cancel op het
// hoofdgebouw tijdens onderzoek en oplappen.

const TURRET = typeByKey('turret');
const WONING = typeByKey('woning');
const WERKPLAATS = typeByKey('werkplaats');
const HQ = typeByKey('hoofdgebouw');
const turretType = CONFIG.buildingTypes.find((b) => b.typeId === TURRET)!;
const scavType = CONFIG.unitTypes.find((u) => u.typeId === SCAV)!;
const techId = (key: string): number => DATA.tech.find((t) => t.key === key)!.id;
const idiv = (a: number, b: number): number => Math.trunc(a / b);
const mult = (armor: number): number => CONFIG.damageMatrix[turretType.damageType]![armor]!;

interface Ev {
  type: number;
  a: number;
  b: number;
}

function play(sim: Sim, frames: number, script: Map<number, CommandEnvelope[]> = new Map()): Ev[] {
  const events: Ev[] = [];
  for (let n = 0; n < frames; n++) {
    const f = sim.frame;
    sim.applyBundle(bundle(f, script.get(f) ?? []));
    sim.tick();
    for (let k = 0; k < sim.events.count; k++) events.push({ type: sim.events.type[k]!, a: sim.events.a[k]!, b: sim.events.b[k]! });
  }
  return events;
}
const at = (frame: number, ...cmds: CommandEnvelope[]): Map<number, CommandEnvelope[]> => new Map([[frame, cmds]]);
const shotsBy = (ev: Ev[], a: number): Ev[] => ev.filter((e) => e.type === EVENT_TYPE.shotFired && e.a === a);
const open = (): Sim => emptySim(1, createOpenMap(64, 64));

/** Turret van speler 0 met footprint op (20, 20)..(21, 21); midden op (21, 21) in meters. */
function withTurret(sim: Sim, done = true): number {
  const t = sim.spawnBuilding(TURRET, 0, 20, 20, done);
  expect(t).not.toBe(0);
  return t;
}

describe('turrets', () => {
  it('data: de turret heeft een wapen, andere gebouwen niet', () => {
    expect(turretType).toMatchObject({ damage: 12, range: 12 * 256, cooldown: 20 });
    expect(CONFIG.buildingTypes.find((b) => b.typeId === WONING)!.damage).toBe(0);
  });

  it('een voltooide turret schiet zelf op een vijand binnen range: schade maal matrix, cooldown, shotFired en hit', () => {
    const sim = open();
    const turret = withTurret(sim);
    const enemy = sim.spawnUnit({ typeId: SCAV, owner: 1, ...cellCenter(28, 21) }); // 7 m van het midden
    const ev = play(sim, 1);
    const dmg = idiv(12 * mult(scavType.armorType), 1000);
    expect(sim.getUnit(enemy)!.hp).toBe(scavType.maxHp - dmg);
    expect(shotsBy(ev, turret)).toEqual([{ type: EVENT_TYPE.shotFired, a: turret, b: enemy }]);
    expect(ev).toContainEqual({ type: EVENT_TYPE.hit, a: enemy, b: turret });
    expect(sim.getUnit(turret)!.target).toBe(enemy);
    // flags.inCombat in de snapshot zolang hij een doel heeft
    expect(sim.world.flags[sim.world.resolve(turret)]! & ENTITY_FLAG.inCombat).toBe(ENTITY_FLAG.inCombat);
    // cooldownTicks later het volgende schot, niet eerder
    expect(shotsBy(play(sim, turretType.cooldown - 1), turret)).toHaveLength(0);
    expect(shotsBy(play(sim, 1), turret)).toHaveLength(1);
  });

  it('een bouwplaats schiet niet; zodra hij af is wel', () => {
    const sim = open();
    const site = withTurret(sim, false);
    sim.spawnUnit({ typeId: SCAV, owner: 1, ...cellCenter(28, 21) });
    expect(shotsBy(play(sim, 40), site)).toHaveLength(0);
    const builder = sim.spawnUnit({ typeId: BUILDER, owner: 0, ...cellCenter(19, 21) });
    const mid = cellCenter(21, 21);
    let ev: Ev[] = [];
    ev = play(sim, turretType.buildTicks + 60, at(sim.frame, cmd(sim.frame, 0, 'Build', { ids: [builder], typeId: TURRET, ...mid })));
    expect(ev.some((e) => e.type === EVENT_TYPE.buildingDone && e.a === site)).toBe(true);
    expect(shotsBy(ev, site).length).toBeGreaterThan(0);
  });

  it('niets buiten range, nooit eigen units of neutrale entities', () => {
    const sim = emptySim(1, { ...createOpenMap(64, 64), scrapNodes: [{ ...cellCenter(25, 21), amount: 500 }] });
    sim.start();
    const turret = sim.spawnBuilding(TURRET, 0, 20, 20, true);
    sim.spawnUnit({ typeId: SCAV, owner: 1, ...cellCenter(36, 21) }); // 15 m: buiten range
    sim.spawnUnit({ typeId: SCAV, owner: 0, ...cellCenter(24, 21) });
    expect(shotsBy(play(sim, 60), turret)).toHaveLength(0);
    expect(sim.getUnit(turret)!.target).toBe(0);
  });

  it('kiest de dichtstbijzijnde vijandelijke unit voor een gebouw, en houdt zijn doel tot het buiten range is', () => {
    const sim = open();
    const turret = withTurret(sim);
    const house = sim.spawnBuilding(WONING, 1, 24, 20, true);
    const far = sim.spawnUnit({ typeId: SCAV, owner: 1, ...cellCenter(21, 31) }); // 10 m
    const near = sim.spawnUnit({ typeId: SCAV, owner: 1, ...cellCenter(21, 28) }); // 7 m
    play(sim, 1);
    expect(sim.getUnit(turret)!.target).toBe(near);
    sim.destroyEntity(near);
    play(sim, turretType.cooldown);
    expect(sim.getUnit(turret)!.target).toBe(far);
    sim.destroyEntity(far);
    play(sim, turretType.cooldown);
    expect(sim.getUnit(turret)!.target).toBe(house);
  });

  it('tech-effecten op het turrettype (lasergeleiding: +20% schade, +1 m range)', () => {
    const sim = open();
    sim.ps.tech[0] = (1 << techId('raffinage')) | (1 << techId('lasergeleiding'));
    const turret = withTurret(sim);
    const enemy = sim.spawnUnit({ typeId: SCAV, owner: 1, ...cellCenter(33, 21) }); // 12 m + rand: alleen met de +1 m
    play(sim, 1);
    expect(sim.getUnit(enemy)!.hp).toBe(scavType.maxHp - idiv(idiv(12 * 1200, 1000) * mult(scavType.armorType), 1000));
    expect(sim.getUnit(turret)!.target).toBe(enemy);
  });

  it('Lockdown (eigen units en turrets +25% schade) werkt op een turret in de zone', () => {
    const sim = createSim(testInit(3, createOpenMap(64, 64)));
    withTurret(sim);
    const enemy = sim.spawnUnit({ typeId: SCAV, owner: 1, ...cellCenter(28, 21) });
    const mid = cellCenter(21, 21);
    sim.ps.zoneX[0 * MAX_ABILITIES] = mid.x;
    sim.ps.zoneY[0 * MAX_ABILITIES] = mid.y;
    sim.ps.zoneTicks[0 * MAX_ABILITIES] = 100;
    play(sim, 1);
    expect(sim.getUnit(enemy)!.hp).toBe(scavType.maxHp - idiv(idiv(12 * 1250, 1000) * mult(scavType.armorType), 1000));
  });

  it('een vijandelijke turret valt aan en sneuvelt; militie kiest hem als doel', () => {
    const sim = open();
    const turret = withTurret(sim);
    const army = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((k) => sim.spawnUnit({ typeId: MILITIA, owner: 1, ...cellCenter(30 + (k >> 3), 16 + (k & 7)) }));
    const ev = play(sim, 2000, at(0, cmd(0, 1, 'Attack', { ids: army, target: turret })));
    expect(sim.getUnit(turret)).toBeNull();
    expect(shotsBy(ev, turret).length).toBeGreaterThan(5);
    expect(ev.some((e) => e.type === EVENT_TYPE.death && e.a === turret && e.b === TURRET)).toBe(true);
  });
});

describe('AI onderzoekt de prereqTech van zijn bouworder', () => {
  const aiConfig = (order: { atTick: number; typeId: number }[]): SimConfig => ({
    ...CONFIG,
    // alleen de bouwvolgorde: de rest van het script (balans speltest 14 oktober) staat uit
    aiScripts: [
      {
        ...CONFIG.aiScripts[0]!,
        buildOrder: order,
        attackTimersTicks: [],
        waveIntervalTicks: 1 << 30,
        builders: 1,
        housingTypeId: 0,
        research: [],
        richBuilds: [],
        claimFromTicks: 1 << 30,
        claimFarFromTicks: 1 << 30,
      },
    ],
  });

  it('geweerrek in de werkplaats zodra hij het kan betalen, daarna bouwt hij de turret', () => {
    const sim = createSim({ seed: 9, players: testPlayers(1, true), map: createOpenMap(64, 64), config: aiConfig([{ atTick: 0, typeId: TURRET }]) });
    sim.setScrap(0, 0);
    const ws = sim.spawnBuilding(WERKPLAATS, 0, 16, 4, true);
    play(sim, 50);
    expect(sim.world.research[sim.world.resolve(ws)]).toBe(0); // geen scrap: wachten, niet overslaan
    expect(sim.ps.aiBuild[0]).toBe(0);
    const tech = CONFIG.techs[techId('geweerrek')]!;
    // ruim scrap: de AI schoolt met een werkplaats ook om tot militie
    sim.setScrap(0, tech.scrapCost + 1000);
    play(sim, 1);
    expect(sim.world.research[sim.world.resolve(ws)]).toBe(techId('geweerrek') + 1);
    expect(sim.playerStatus(0).scrap).toBe(1000);
    const ev = play(sim, tech.researchTicks + 40);
    expect(sim.researched(0)).toContain(techId('geweerrek'));
    expect(ev.some((e) => e.type === EVENT_TYPE.buildingPlaced && e.b === TURRET)).toBe(true);
    expect(sim.ps.aiBuild[0]).toBe(1);
  });

  it('een keten: lasergeleiding vraagt eerst raffinage; zonder lab slaat hij de order over', () => {
    const LAB = typeByKey('lab');
    const sim = createSim({ seed: 9, players: testPlayers(1, true), map: createOpenMap(64, 64), config: aiConfig([{ atTick: 0, typeId: TURRET }, { atTick: 0, typeId: WONING }]) });
    // turret zonder werkplaats: overslaan, door naar de woning
    play(sim, 2);
    expect(sim.ps.aiBuild[0]).toBe(2);
    // tech-keten via applyCommand-validatie: Research op lasergeleiding mag pas na raffinage
    const sim2 = createSim({
      seed: 9,
      players: testPlayers(1, true),
      map: createOpenMap(64, 64),
      config: {
        ...aiConfig([{ atTick: 0, typeId: TURRET }]),
        buildingTypes: CONFIG.buildingTypes.map((b) => (b.typeId === TURRET ? { ...b, prereqTech: [techId('lasergeleiding')] } : b)),
      },
    });
    sim2.setScrap(0, 5000);
    const lab = sim2.spawnBuilding(LAB, 0, 16, 4, true);
    play(sim2, 1);
    expect(sim2.world.research[sim2.world.resolve(lab)]).toBe(techId('raffinage') + 1);
    play(sim2, CONFIG.techs[techId('raffinage')]!.researchTicks + 2);
    expect(sim2.world.research[sim2.world.resolve(lab)]).toBe(techId('lasergeleiding') + 1);
  });
});

describe('Cancel op het hoofdgebouw', () => {
  it('stopt zowel onderzoek als oplappen, elk met teruggave', () => {
    // in de data onderzoekt het hoofdgebouw niets; deze config laat geweerrek in het hoofdgebouw lopen
    const config: SimConfig = { ...CONFIG, techs: CONFIG.techs.map((t) => (t.techId === techId('geweerrek') ? { ...t, buildingTypeId: HQ } : t)) };
    const sim = createSim({ seed: 4, players: testPlayers(2), map: createOpenMap(64, 64), config });
    const hq = sim.entityIds().find((id) => sim.getUnit(id)!.typeId === HQ && sim.getUnit(id)!.owner === 0)!;
    const hero = CONFIG.heroes[0]!;
    // de held sneuvelt (testhulp), oplappen loopt
    sim.world.hp[sim.world.resolve(sim.ps.heroEnt[0]!)] = 0;
    play(sim, 1);
    const tech = config.techs[techId('geweerrek')]!;
    sim.setScrap(0, hero.reviveScrap + tech.scrapCost);
    play(sim, 1, at(sim.frame, cmd(sim.frame, 0, 'Recruit', { buildingId: hq }), cmd(sim.frame, 0, 'Research', { techId: tech.techId })));
    expect(sim.playerStatus(0)).toMatchObject({ scrap: 0, hero: { state: 'reviving' } });
    expect(sim.world.research[sim.world.resolve(hq)]).toBe(tech.techId + 1);
    play(sim, 1, at(sim.frame, cmd(sim.frame, 0, 'Cancel', { ids: [hq] })));
    expect(sim.world.research[sim.world.resolve(hq)]).toBe(0);
    expect(sim.playerStatus(0)).toMatchObject({ scrap: idiv((hero.reviveScrap + tech.scrapCost) * CONFIG.cancelRefundPermille, 1000), hero: { state: 'dead' } });
  });
});
