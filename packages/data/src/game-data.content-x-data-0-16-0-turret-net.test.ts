// Split from game-data.test.ts to stay under the 5,000-token file limit.
import { describe, it, expect } from 'vitest';
import {
  loadGameData,
  PROVIDES,
  DAMAGE_TYPES,
  ROLES,
  ARMOR_TYPES,
  convertDelta,
  STATS,
  BODY_TYPES,
} from './loader.js';
import { metersToUnits, secondsToTicks } from './units.js';
import { EffectStat } from './schemas.js';
import { clone, raw } from './game-data.helpers.js';

describe('content-x (data 0.16.0): turret-netwerk, uitrusting in tiers, held-passieven, training', () => {
  const data = loadGameData(raw());
  const loadout = (key: string) => data.loadouts.find((l) => l.key === key)!;
  const building = (key: string) => data.buildings.find((b) => b.key === key)!;
  const tech = (key: string) => data.tech.find((t) => t.key === key)!;
  const techKey = (id: number): string => data.tech[id]!.key;

  it('laserturret: tier 2, energy, achter lasertechniek in het lab', () => {
    const laser = building('turret_laser');
    const turret = building('turret');
    expect(laser.provides).toEqual([PROVIDES.indexOf('turret')]);
    expect(laser.damageType).toBe(DAMAGE_TYPES.indexOf('energy'));
    expect(laser.damage).toBeGreaterThan(turret.damage);
    expect(laser.rangeU).toBeGreaterThan(turret.rangeU);
    expect(laser.scrapCost).toBeGreaterThan(turret.scrapCost);
    expect(laser.prereqTech.map(techKey)).toEqual(['lasertechniek']);
    expect(data.buildings[tech('lasertechniek').buildingId]!.key).toBe('lab');
    expect(laser.visuals.mesh).toBe('dweller_building_turret_laser');
  });

  it('turret-upgrades via lab-techs gelden voor beide turrets', () => {
    for (const key of ['lasergeleiding', 'turret_schade', 'turret_bereik']) {
      expect(data.buildings[tech(key).buildingId]!.key, key).toBe('lab');
      const targets = new Set(tech(key).effects.map((e) => e.target));
      expect([...targets].sort(), key).toEqual(['turret', 'turret_laser']);
    }
    expect(tech('turret_schade').effects.map((e) => [e.stat, e.delta])).toEqual([
      ['damagePct', 150],
      ['damagePct', 150],
    ]);
    expect(tech('turret_bereik').effects.map((e) => [e.stat, e.delta])).toEqual([
      ['rangeM', metersToUnits(2)],
      ['rangeM', metersToUnits(2)],
    ]);
  });

  it('netwerkbonus: straal, procent per turret en maximum, achter de tech turret_netwerk', () => {
    for (const key of ['turret', 'turret_laser']) {
      expect(building(key).network, key).toEqual({
        requiresTech: tech('turret_netwerk').id,
        radiusU: metersToUnits(16),
        damagePermillePerTurret: 60,
        maxDamagePermille: 300,
      });
    }
    expect(tech('turret_netwerk').effects).toEqual([]);
    expect(tech('turret_netwerk').prereqTech.map(techKey)).toEqual(['lasertechniek']);
    for (const b of data.buildings.filter((x) => !x.provides.includes(PROVIDES.indexOf('turret'))))
      expect(b.network, b.key).toBeNull();
  });

  it('weigert een netwerk op een gebouw zonder turret en een onbekende netwerk-tech', () => {
    const onHouse = clone(raw());
    (onHouse.buildings as Record<string, unknown>[]).find((b) => b.id === 'woning')!.network = {
      requiresTech: 'turret_netwerk',
      radiusM: 10,
      damagePctPerTurret: 5,
      maxDamagePct: 20,
    };
    expect(() => loadGameData(onHouse)).toThrow(/network/);
    const badTech = clone(raw());
    (
      (badTech.buildings as Record<string, unknown>[]).find((b) => b.id === 'turret')!
        .network as Record<string, unknown>
    ).requiresTech = 'onzin';
    expect(() => loadGameData(badTech)).toThrow(/onzin/);
  });

  it('uitrusting in tiers: vier wapens, twee pantsers, alles een eigen loadout met prereqTech', () => {
    const mil = data.loadouts.filter(
      (l) => l.factionId === 0 && l.role === ROLES.indexOf('militia'),
    );
    expect(mil.map((l) => l.key).sort()).toEqual([
      'geweer_leer',
      'militie',
      'patrol',
      'shotgun_composiet',
      'shotgun_leer',
      'slagwapen_composiet',
      'slagwapen_leer',
    ]);
    const weapons = new Set(mil.map((l) => l.weapon));
    expect([...weapons].sort()).toEqual([
      'geweer',
      'patrolgeweer',
      'pipe_pistol',
      'shotgun',
      'slagwapen',
    ]);
    for (const l of mil.filter((x) => x.key.endsWith('_leer')))
      expect(l.armorType, l.key).toBe(ARMOR_TYPES.indexOf('none'));
    for (const l of mil.filter((x) => x.key.endsWith('_composiet') || x.key === 'patrol'))
      expect(l.armorType, l.key).toBe(ARMOR_TYPES.indexOf('medium'));
    expect(loadout('slagwapen_leer').damageType).toBe(DAMAGE_TYPES.indexOf('melee'));
    expect(loadout('shotgun_leer').rangeU).toBeLessThan(loadout('militie').rangeU);
    for (const l of mil.filter((x) => x.key.endsWith('_composiet')))
      expect(l.prereqTech.map(techKey), l.key).toContain('composiet_pantser');
    // een composiet-variant is duurder en trager dan zijn leer-variant (pantser kost iets)
    for (const w of ['shotgun', 'slagwapen']) {
      expect(loadout(`${w}_composiet`).scrapCost).toBeGreaterThan(loadout(`${w}_leer`).scrapCost);
      expect(loadout(`${w}_composiet`).speedUPT).toBeLessThan(loadout(`${w}_leer`).speedUPT);
    }
    // bestaande loadouts zijn niet gewijzigd
    expect(loadout('militie').armorType).toBe(ARMOR_TYPES.indexOf('light'));
    expect(loadout('patrol').prereqTech.map(techKey)).toEqual(['geweerrek']);
  });

  it('snelle_voeten en composiet_pantser raken elke militia-loadout van de factie', () => {
    const mil = data.loadouts
      .filter((l) => l.factionId === 0 && l.role === ROLES.indexOf('militia'))
      .map((l) => l.key);
    for (const key of ['snelle_voeten', 'composiet_pantser'])
      expect(
        tech(key)
          .effects.map((e) => e.target)
          .sort(),
        key,
      ).toEqual([...mil].sort());
  });

  it('held-passieven: upgrades goedkoper en turrets sterker, omgerekend', () => {
    const passives = data.heroes[0]!.passives;
    expect(passives).toContainEqual({ stat: 'researchCostPct', target: 'alle', delta: -150 });
    for (const target of ['turret', 'turret_laser']) {
      expect(passives).toContainEqual({ stat: 'damagePct', target, delta: 100 });
      expect(passives).toContainEqual({ stat: 'rangeM', target, delta: metersToUnits(1) });
    }
    expect(EffectStat.options).toContain('researchCostPct');
    expect(convertDelta('researchCostPct', -15)).toBe(-150);
  });

  it('elk effect-doel van tech, perks en held-passieven bestaat (de sim weigert onbekende doelen)', () => {
    const known = new Set([
      'alle',
      'held',
      ...data.loadouts.map((l) => l.key),
      ...data.buildings.map((b) => b.key),
    ]);
    const all = [
      ...data.tech.flatMap((t) => t.effects.map((e) => [t.key, e.target] as const)),
      ...data.perks.flatMap((p) => p.effects.map((e) => [p.key, e.target] as const)),
      ...data.heroes.flatMap((h) => h.passives.map((e) => [h.key, e.target] as const)),
    ];
    for (const [owner, target] of all)
      expect(known.has(target), `${owner} -> ${target}`).toBe(true);
    for (const h of data.heroes)
      for (const e of h.passives) if (e.stat === 'researchCostPct') expect(e.target).toBe('alle');
  });

  it('trainingsprogramma: een per SPECIAL-letter, omgerekend, binnen het plafond van 10', () => {
    expect(data.training.map((t) => STATS[t.special]).sort()).toEqual([...STATS].sort());
    const training = building('trainingsfaciliteit');
    const hero = data.heroes[0]!;
    for (const t of data.training) {
      expect(t.buildingId, t.key).toBe(training.id);
      expect(training.provides, t.key).toContain(PROVIDES.indexOf('training'));
      expect(t.factionId, t.key).toBe(0);
      expect(t.pointsPerRun, t.key).toBe(1);
      expect(t.maxPoints, t.key).toBeGreaterThanOrEqual(1);
      expect(hero.special[t.special]! + t.maxPoints, t.key).toBeLessThanOrEqual(10);
    }
    const kracht = data.training.find((t) => t.key === 'training_kracht')!;
    expect(kracht).toMatchObject({
      scrapCost: 100,
      scrapCostStep: 60,
      trainTicks: secondsToTicks(40),
      trainTicksStep: secondsToTicks(20),
      maxPoints: 3,
    });
    expect(data.factions[0]!.specialChannel).toBe('training');
  });

  it('weigert ongeldige trainingsdata', () => {
    const badLetter = clone(raw());
    (badLetter.training as Record<string, unknown>[])[0]!.special = 'X';
    expect(() => loadGameData(badLetter)).toThrow(/training\.json/);
    const badBuilding = clone(raw());
    (badBuilding.training as Record<string, unknown>[])[0]!.building = 'bestaat_niet';
    expect(() => loadGameData(badBuilding)).toThrow(/bestaat_niet/);
    const unknownField = clone(raw());
    (unknownField.training as Record<string, unknown>[])[0]!.onbekend = 1;
    expect(() => loadGameData(unknownField)).toThrow(/training\.json/);
    const noMax = clone(raw());
    (noMax.training as Record<string, unknown>[])[0]!.maxPoints = 0;
    expect(() => loadGameData(noMax)).toThrow(/maxPoints/);
  });

  it('blijft binnen de grenzen van de sim: hoogstens 32 techs, loadout-ids onder het held-blok', () => {
    expect(data.tech.length).toBeLessThanOrEqual(32); // sim MAX_TECHS: bitset per speler
    expect(data.loadouts.length).toBeLessThan(999); // typeId-ruimte 1..999
    expect(data.buildings.length).toBeLessThan(1024);
  });

  it('AI-robots: bestaande loadouts, hoogstens bouwers maal robotsPerTechnician', () => {
    const ai = data.aiScripts[0]!;
    expect(ai.robots).not.toBeNull();
    for (const l of ai.robots!.sequence)
      expect(data.loadouts[l]!.bodyType).toBe(BODY_TYPES.indexOf('robot'));
    expect(ai.robots!.fromTicks).toBe(secondsToTicks(840));
    expect(ai.robots!.max).toBeLessThanOrEqual(
      ai.builders * data.factions[0]!.robotRules!.robotsPerTechnician,
    );
    const bad = clone(raw());
    ((bad.ai[0] as Record<string, unknown>).robots as { sequence: string[] }).sequence = [
      'raketman',
    ];
    expect(() => loadGameData(bad)).toThrow(/onbekende loadout 'raketman'/);
  });

  it('is deterministisch: twee keer laden geeft gelijke uitvoer, ook bij omgekeerde invoervolgorde', () => {
    const a = loadGameData(raw());
    const r = raw();
    const b = loadGameData({
      ...r,
      loadouts: [...(r.loadouts as unknown[])].reverse(),
      training: [...(r.training as unknown[])].reverse(),
      tech: [...(r.tech as unknown[])].reverse(),
    });
    expect(b).toEqual(a);
  });
});
