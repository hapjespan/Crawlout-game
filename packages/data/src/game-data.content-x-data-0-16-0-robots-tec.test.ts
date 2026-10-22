// Split from game-data.test.ts to stay under the 5,000-token file limit.
import { describe, it, expect } from 'vitest';
import {
  loadGameData,
  BODY_TYPES,
  ROLES,
  ARMOR_TYPES,
  REPAIR_TARGETS,
  DAMAGE_TYPES,
  PROVIDES,
} from './loader.js';
import { metersToUnits, perSecondToMilliPerTick, secondsToTicks } from './units.js';
import { clone, raw } from './game-data.helpers.js';

describe('content-x (data 0.16.0): robots, technicus, vangnet', () => {
  const data = loadGameData(raw());
  const loadout = (key: string) => data.loadouts.find((l) => l.key === key)!;
  const building = (key: string) => data.buildings.find((b) => b.key === key)!;
  const tech = (key: string) => data.tech.find((t) => t.key === key)!;
  const dwellers = data.factions[0]!;
  const robots = data.loadouts.filter((l) => l.bodyType === BODY_TYPES.indexOf('robot'));

  it('heeft vier robots met bodyType robot, rol robot en producedAt robotfabriek (data 0.26.0: de bouwrobot)', () => {
    expect(robots.map((l) => l.key).sort()).toEqual([
      'beveiligingsrobot',
      'bouwrobot',
      'reparatiedrone',
      'sentinel',
    ]);
    for (const l of robots) {
      expect(l.role, l.key).toBe(ROLES.indexOf('robot'));
      expect(l.armorType, l.key).toBe(ARMOR_TYPES.indexOf('robot'));
      expect(l.producedAt, l.key).toBe(building('robotfabriek').id);
      expect(l.gatherAmount, l.key).toBe(0);
      expect(l.prereqTech.length, l.key).toBeGreaterThan(0);
      expect(l.visuals.meshSlots.body, l.key).toMatch(/^dweller_robot_/);
    }
    for (const l of data.loadouts.filter((x) => x.factionId === 0 && !robots.includes(x)))
      expect(l.producedAt, l.key).toBe(-1);
    expect(dwellers.uniqueUnits.map((u) => data.loadouts[u]!.key).sort()).toEqual([
      'beveiligingsrobot',
      'reparatiedrone',
      'sentinel',
    ]);
  });

  it('bouwrobot (data 0.26.0, voorstel): bouwt als een bouwer, steviger, vecht niet, achter robotica', () => {
    const bot = loadout('bouwrobot');
    const bouwer = loadout('bouwer');
    expect(bot.canBuild).toBe(true);
    expect(bot.role).toBe(ROLES.indexOf('robot'));
    expect(bot.hpI).toBeGreaterThan(2 * bouwer.hpI);
    expect(bot.speedUPT).toBeLessThanOrEqual(bouwer.speedUPT);
    expect(bot.damage).toBe(0);
    expect(bot.rangeU).toBe(0);
    expect(bot.popCost).toBe(1);
    expect(bot.prereqTech.map((t) => data.tech[t]!.key)).toEqual(['robotica']);
    expect(bot.visuals.meshSlots.body).toBe('dweller_robot_builder');
    // only the bouwrobot can build without role builder
    expect(data.loadouts.filter((l) => l.canBuild).map((l) => l.key)).toEqual(['bouwrobot']);
    // the tech bouwrobots speeds him up like the bouwer
    expect(tech('bouwrobots').effects.map((e) => e.target)).toEqual(['bouwer', 'bouwrobot']);
  });

  it('canBuild alleen op een robot, robots.builders alleen naar een bouwrobot (data 0.26.0)', () => {
    const r = raw();
    const loadouts = clone(r.loadouts) as Array<Record<string, unknown>>;
    loadouts.find((l) => l.id === 'bouwer')!.canBuild = true;
    expect(() => loadGameData({ ...r, loadouts })).toThrow(/canBuild/);
    const ai = clone(r.ai) as Array<Record<string, unknown>>;
    const script = ai.find((a) => a.id === 'dwellers-basic')! as {
      robots: { builders: { loadoutId: string } };
    };
    script.robots.builders.loadoutId = 'beveiligingsrobot';
    expect(() => loadGameData({ ...r, ai })).toThrow(/bouwrobot/);
  });

  it('beveiligingsrobot: tank, traag en veel hp', () => {
    const guard = loadout('beveiligingsrobot');
    const militie = loadout('militie');
    expect(guard.hpI).toBeGreaterThan(5 * militie.hpI);
    expect(guard.speedUPT).toBeLessThan(militie.speedUPT);
    expect(guard.repair).toBeNull();
    expect(guard.siege).toBeNull();
  });

  it('reparatiedrone: repareert eigen gebouwen en robots, rekent hp per seconde om naar duizendsten per tick', () => {
    const drone = loadout('reparatiedrone');
    expect(drone.damage).toBe(0);
    expect(drone.repair).toEqual({
      milliHpPerTick: 500, // 10 hp/s: 0,5 hp per tick
      rangeU: metersToUnits(4),
      seekRangeU: metersToUnits(14),
      targets: [REPAIR_TARGETS.indexOf('building'), REPAIR_TARGETS.indexOf('robot')],
    });
    expect(perSecondToMilliPerTick(12)).toBe(600);
    expect(drone.repair!.seekRangeU).toBeGreaterThan(drone.repair!.rangeU);
  });

  it('sentinel: belegering, groot bereik, bonus tegen gebouwen, laat via een tech', () => {
    const sentinel = loadout('sentinel');
    const turret = building('turret');
    expect(sentinel.siege).toEqual({ vsBuildingsPermille: 1500, buildingsFirst: true });
    expect(sentinel.rangeU).toBeGreaterThan(2 * turret.rangeU);
    expect(sentinel.damageType).toBe(DAMAGE_TYPES.indexOf('energy'));
    expect(sentinel.prereqTech.map((t) => data.tech[t]!.key)).toEqual(['sentinel_protocol']);
    const chain = tech('sentinel_protocol')
      .prereqTech.map((t) => data.tech[t]!.key)
      .sort();
    expect(chain).toEqual(['lasergeleiding', 'robotica']);
    expect(tech('sentinel_protocol').researchTicks).toBeGreaterThanOrEqual(secondsToTicks(60));
  });

  it('robotfabriek: eigen gebouw achter robotica, oneven footprint, zonder nieuwe provides-bit', () => {
    const f = building('robotfabriek');
    expect(f.prereqTech.map((t) => data.tech[t]!.key)).toEqual(['robotica']);
    expect(f.footprint.w % 2).toBe(1);
    expect(f.footprint.h % 2).toBe(1);
    expect(f.visuals.mesh).toBe('dweller_building_robotfactory');
    // provides is een bitmasker van 16 bits (sim config, fase-0 sectie 20 besluit 3): hoogstens 16 waarden, nieuwe achteraan
    expect(PROVIDES.length).toBeLessThanOrEqual(16);
    expect(PROVIDES.slice(0, 8)).toEqual([
      'werkplaats',
      'huisvesting',
      'claim',
      'turret',
      'beacon',
      'lab',
      'hq',
      'training',
    ]);
    expect(dwellers.uniqueBuildings.map((b) => data.buildings[b]!.key)).toContain('robotfabriek');
  });

  it('technicus-regel: 1 technicus of bouwer per 4 robots, ongedekt half tempo', () => {
    expect(dwellers.bodyTypes).toContain(BODY_TYPES.indexOf('robot'));
    expect(dwellers.robotRules).toEqual({
      robotsPerTechnician: 4,
      technicianRoles: [ROLES.indexOf('technician'), ROLES.indexOf('builder')],
      robotPenaltyPermille: 500,
    });
    for (const r of dwellers.robotRules!.technicianRoles)
      expect(
        data.loadouts.some((l) => l.role === r && l.bodyType === BODY_TYPES.indexOf('human')),
      ).toBe(true);
    expect(loadout('technicus').role).toBe(ROLES.indexOf('technician'));
    expect(loadout('technicus').bodyType).toBe(BODY_TYPES.indexOf('human'));
  });

  it('nieuwe rollen staan achteraan zodat bestaande role-indices gelijk blijven', () => {
    expect(ROLES.slice(0, 3)).toEqual(['scavenger', 'builder', 'militia']);
    expect(ROLES.slice(3)).toEqual(['technician', 'robot']);
  });

  it('radiobaken-vangnet: drempel, interval, maximum en de aankomende bewoner', () => {
    expect(dwellers.safetyNet).toEqual({
      threshold: 3,
      action: 'radiobaken_instroom',
      intervalTicks: secondsToTicks(40),
      maxArrivals: 12,
      loadoutId: loadout('scavenger').id,
    });
    const beacon = building('radiobaken');
    expect(beacon.provides).toEqual([PROVIDES.indexOf('beacon')]);
    expect(loadout('scavenger').bodyType).toBe(BODY_TYPES.indexOf('human'));
  });

  it('weigert ongeldige robot-, vangnet- en fabrieksdata', () => {
    const noProduced = clone(raw());
    delete (noProduced.loadouts as Record<string, unknown>[]).find((l) => l.id === 'sentinel')!
      .producedAt;
    expect(() => loadGameData(noProduced)).toThrow(/producedAt/);
    // data 0.21.0: producedAt is toegestaan voor een ander lichaam dan een robot (Raider-vechters uit een tent)
    const humanProduced = clone(raw());
    (humanProduced.loadouts as Record<string, unknown>[]).find(
      (l) => l.id === 'militie',
    )!.producedAt = 'robotfabriek';
    expect(() => loadGameData(humanProduced)).not.toThrow();
    const humanRepair = clone(raw());
    (humanRepair.loadouts as Record<string, unknown>[]).find((l) => l.id === 'militie')!.repair = {
      repairRateHpPerS: 1,
      rangeM: 1,
      seekRangeM: 1,
      targets: ['robot'],
    };
    expect(() => loadGameData(humanRepair)).toThrow(/repair/);
    const wrongRole = clone(raw());
    (wrongRole.loadouts as Record<string, unknown>[]).find((l) => l.id === 'sentinel')!.role =
      'militia';
    expect(() => loadGameData(wrongRole)).toThrow(/role/);
    const badProducedAt = clone(raw());
    (badProducedAt.loadouts as Record<string, unknown>[]).find(
      (l) => l.id === 'sentinel',
    )!.producedAt = 'bestaat_niet';
    expect(() => loadGameData(badProducedAt)).toThrow(/bestaat_niet/);
    for (const field of ['intervalS', 'maxArrivals', 'loadoutId']) {
      const r = clone(raw());
      delete ((r.factions as Record<string, unknown>[])[0]!.safetyNet as Record<string, unknown>)[
        field
      ];
      expect(() => loadGameData(r), field).toThrow(field);
    }
    const noRules = clone(raw());
    delete (noRules.factions as Record<string, unknown>[])[0]!.robotRules;
    expect(() => loadGameData(noRules)).toThrow(/robotRules/);
    const badPenalty = clone(raw());
    (
      (badPenalty.factions as Record<string, unknown>[])[0]!.robotRules as Record<string, unknown>
    ).robotPenaltyPct = 120;
    expect(() => loadGameData(badPenalty)).toThrow(/robotPenaltyPct/);
  });
});
