// Split from robots.test.ts to stay under the 5,000-token file limit.
import { typeByKey, CONFIG, BUILDER, SCAV, testInit, heroResearchCost } from './helpers.js';
import { STATS } from '@crawlout/data';
import { describe, it, expect } from 'vitest';
import { cellCenter, createOpenMap } from '../src/testing.js';
import { type Sim, createSim, HERO_DEAD } from '../src/index.js';
import {
  FACTORY,
  SENTINEL,
  WONING,
  idiv,
  now,
  open,
  play,
  research,
  techId,
  unitType,
} from './robots.helpers.js';

const TURRET = typeByKey('turret');

const LASER = typeByKey('turret_laser');

const TRAINING = typeByKey('trainingsfaciliteit');

const LAB = typeByKey('lab');

const buildingType = (typeId: number) => CONFIG.buildingTypes.find((b) => b.typeId === typeId)!;

const program = (letter: string) =>
  CONFIG.training.find((t) => t.special === STATS.indexOf(letter as (typeof STATS)[number]))!;

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

  it('Cancel of research refunds the price that was paid, not the current one (section 20, decision 5)', () => {
    const sim = createSim(testInit(5, createOpenMap(64, 64)));
    sim.setScrap(0, 1000);
    const lab = sim.spawnBuilding(LAB, 0, 40, 40, true);
    const t = CONFIG.techs[techId('raffinage')]!;
    now(sim, 0, 'Research', { techId: t.techId });
    const paid = heroResearchCost(t.scrapCost);
    expect(sim.playerStatus(0).scrap).toBe(1000 - paid);
    // the hero dies mid-research: the current price is now the full one
    sim.world.hp[sim.world.resolve(sim.ps.heroEnt[0]!)] = 0;
    play(sim, 1);
    expect(sim.ps.heroState[0]).toBe(HERO_DEAD);
    now(sim, 0, 'Cancel', { ids: [lab] });
    expect(sim.playerStatus(0).scrap).toBe(
      1000 - paid + idiv(paid * CONFIG.cancelRefundPermille, 1000),
    );
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
