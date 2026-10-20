import { describe, it, expect } from 'vitest';
import { loadGameData, NEUTRAL_FACTION_ID, convertDelta, convertDominance } from './loader.js';
import { metersToUnits, secondsToTicks } from './units.js';
import { MapDef } from './schemas.js';
import { clone, raw } from './game-data.helpers.js';

describe('data/ valideert', () => {
  const data = loadGameData(raw());

  it('bevat de Dwellers-slice in de verwachte aantallen (en de Raiders erbij, data 0.21.0)', () => {
    expect(data.factions.map((f) => f.key)).toEqual(['dwellers', 'garde', 'raiders']);
    const dwellers = (r: { factionId: number }): boolean => r.factionId === 0;
    expect(data.loadouts.filter(dwellers).map((l) => l.key)).toEqual([
      'beveiligingsrobot',
      'bouwer',
      'bouwrobot',
      'geweer_leer',
      'militie',
      'patrol',
      'reparatiedrone',
      'scavenger',
      'sentinel',
      'shotgun_composiet',
      'shotgun_leer',
      'slagwapen_composiet',
      'slagwapen_leer',
      'technicus',
    ]);
    expect(data.buildings.filter(dwellers)).toHaveLength(10);
    expect(data.tech.filter(dwellers)).toHaveLength(14);
    expect(data.training).toHaveLength(7);
    expect(data.heroes.filter(dwellers)).toHaveLength(1);
    // data 0.24.0: the default script and the one against the Raiders (versus)
    expect(data.aiScripts.filter(dwellers)).toHaveLength(2);
    expect(data.aiScripts.filter(dwellers).filter((a) => a.versusFactionId < 0)).toHaveLength(1);
    // totalen met de Raiders; de sim kent hoogstens 32 techs en 32 perks
    // 25 faction loadouts (data 0.26.0: the bouwrobot) plus the 5 bandits of the creep camps (data 0.25.0; 0.29.0: the
    // two weak ones of the low camp)
    // data 0.33.0: plus the 6 hostile units of survival (data/survival/units.json)
    expect(data.loadouts).toHaveLength(43);
    expect(data.loadouts.filter((l) => l.factionId === NEUTRAL_FACTION_ID)).toHaveLength(11);
    // 18 faction buildings plus the 7 of the Garde (data 0.37.0) plus (data 0.31.0, win route C) a restored and a ruin type per part of the strip mall
    expect(data.buildings).toHaveLength(18 + 7 + 2 * 4);
    expect(data.buildings.filter((b) => b.factionId === NEUTRAL_FACTION_ID)).toHaveLength(8);
    expect(data.tech).toHaveLength(38); // data 0.39.0: 6 Garde techs in idGroup 1
    // data 0.38.0: the Paladin-Commander of the Garde (id zwaardridder, after warlord)
    expect(data.heroes).toHaveLength(3);
    expect(data.perks).toHaveLength(13);
    expect(data.aiScripts).toHaveLength(4); // data 0.38.0: garde-basic
    expect(data.dataVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('geeft numerieke ids op gesorteerde string-id', () => {
    for (const list of [
      data.factions,
      data.loadouts,
      data.buildings,
      data.tech,
      data.heroes,
      data.perks,
      data.training,
      data.aiScripts,
    ]) {
      list.forEach((record, i) => expect(record.id).toBe(i));
      // the bandits of the creep camps (data 0.25.0) follow the faction loadouts, in the order of creeps.json
      // techs (data 0.39.0): sorted within each idGroup; the 6 of group 1 follow the 32 of group 0
      const groups = list === data.tech ? [list.slice(0, 32), list.slice(32)] : [list];
      for (const g of groups) {
        const keys = g
          .filter((r) => !('factionId' in r) || r.factionId !== NEUTRAL_FACTION_ID)
          .map((r) => r.key);
        expect(keys).toEqual([...keys].sort());
      }
    }
  });

  it('heeft een volledige damage-matrix in promille', () => {
    expect(data.damageMatrix).toHaveLength(4);
    for (const row of data.damageMatrix) {
      expect(row).toHaveLength(5);
      for (const cell of row) expect(Number.isInteger(cell)).toBe(true);
    }
    expect(data.damageMatrix[0]![2]).toBe(750); // ballistic tegen medium: 75 procent
  });

  it('heeft elke loadout-waarde als integer in sim-eenheden', () => {
    for (const l of data.loadouts) {
      for (const v of [
        l.hpI,
        l.damage,
        l.rangeU,
        l.speedUPT,
        l.cooldownTicks,
        l.scrapCost,
        l.craftTicks,
        l.popCost,
      ])
        expect(Number.isInteger(v)).toBe(true);
    }
  });
});

describe('omrekening naar sim-eenheden', () => {
  it('rekent de richtwaarden van contract 3 om (militie met pipe pistol)', () => {
    const militie = loadGameData(raw()).loadouts.find((l) => l.key === 'militie')!;
    expect(militie.hpI).toBe(60);
    expect(militie.rangeU).toBe(2048); // 8 m
    expect(militie.cooldownTicks).toBe(20); // 1,0 s
    expect(militie.damage).toBe(8);
  });

  it('rekent snelheid, bouwtijd en procenten om', () => {
    const data = loadGameData(raw());
    expect(data.loadouts.find((l) => l.key === 'militie')!.speedUPT).toBe(38); // 3 m/s: 768 per s, 38 per tick (afgekapt)
    expect(data.buildings.find((b) => b.key === 'woning')!.buildTicks).toBe(400);
    expect(data.heroes[0]!.revivePenaltyPermille).toBe(200);
    expect(data.tech.find((t) => t.key === 'lasergeleiding')!.effects).toEqual([
      { stat: 'damagePct', target: 'turret', delta: 200 },
      { stat: 'rangeM', target: 'turret', delta: 256 },
      { stat: 'damagePct', target: 'turret_laser', delta: 200 },
      { stat: 'rangeM', target: 'turret_laser', delta: 256 },
    ]);
    expect(metersToUnits(8)).toBe(2048);
    expect(secondsToTicks(1)).toBe(20);
  });

  it('lost referenties op naar numerieke ids', () => {
    const data = loadGameData(raw());
    const patrol = data.loadouts.find((l) => l.key === 'patrol')!;
    expect(data.tech[patrol.prereqTech[0]!]!.key).toBe('geweerrek');
    expect(data.buildings[data.tech.find((t) => t.key === 'raffinage')!.buildingId]!.key).toBe(
      'lab',
    );
  });
});

describe('sprint 2: gather, maxRevives, dominance, effect-stats', () => {
  const data = loadGameData(raw());

  it('rekent gather om: 6 scrap per 13 s wordt 260 ticks (balans speltest 14 oktober)', () => {
    const scavenger = data.loadouts.find((l) => l.key === 'scavenger')!;
    expect(scavenger.gatherAmount).toBe(6);
    expect(scavenger.gatherTicks).toBe(260);
    for (const l of data.loadouts.filter((x) => x.factionId === 0 && x.key !== 'scavenger')) {
      expect(l.gatherAmount).toBe(0);
      expect(l.gatherTicks).toBe(0);
    }
  });

  it('levert maxRevives als integer', () => {
    expect(data.heroes[0]!.maxRevives).toBe(4);
  });

  it('weigert een niet-geheel gatherAmount en een onbekende effect-stat', () => {
    const a = raw();
    (a.loadouts as { gatherAmount: number }[])[0]!.gatherAmount = 2.5;
    expect(() => loadGameData(a)).toThrow(/gatherAmount/);
    const b = raw();
    (b.perks as { effects: { stat: string }[] }[])[0]!.effects[0]!.stat = 'onzin';
    expect(() => loadGameData(b)).toThrow(/stat/);
  });

  it('rekent effect-deltas om op suffix; SPECIAL-letters blijven ruw', () => {
    expect(convertDelta('hpPct', 10)).toBe(100);
    expect(convertDelta('rangeM', 1)).toBe(256);
    expect(convertDelta('S', 2)).toBe(2);
  });

  it('rekent dominance om naar ticks en valideert het MapDef-veld', () => {
    expect(convertDominance({ pointsRequired: 1000, minutes: 10 })).toEqual({
      pointsRequired: 1000,
      ticks: 12000,
    });
    const map = JSON.parse(
      JSON.stringify({
        id: 'm',
        size: { w: 8, h: 8 },
        heightmap: 'h',
        passability: 'p',
        scrapNodes: [],
        claimPoints: [],
        spawns: [],
        creepCamps: [],
      }),
    );
    expect(MapDef.safeParse(map).success).toBe(false); // dominance is verplicht
    expect(
      MapDef.safeParse({ ...map, dominance: { pointsRequired: 1000, minutes: 10 } }).success,
    ).toBe(true);
    expect(
      MapDef.safeParse({ ...map, dominance: { pointsRequired: 0, minutes: 10 } }).success,
    ).toBe(false);
    expect(
      MapDef.safeParse({ ...map, dominance: { pointsRequired: 1000, minutes: 10, x: 1 } }).success,
    ).toBe(false);
  });
});

describe('sim-tuning', () => {
  it('rekent sim.json om naar integers', () => {
    expect(loadGameData(raw()).sim).toEqual({
      unitRadiusU: 96,
      arriveRadiusU: 64,
      separationPermille: 500,
      pathSectorCells: 32,
      pathEntranceMaxCells: 4,
      pathCacheCells: 1048576,
      walkAnimStep: 2048,
      aggroRangeU: 2560,
      interactRangeU: 512,
      claimRadiusU: 1536,
      popCapMax: 50,
      corpseTicks: 40,
      cancelRefundPermille: 1000,
      specialStrengthDamagePermille: 100,
      specialPerceptionRangeU: 64,
      specialEnduranceHpPermille: 250,
      specialCharismaGrowthPermille: 50,
      specialIntelligenceResearchPermille: -30,
      specialAgilitySpeedPermille: 30,
      specialLuckCritPermille: 20,
      critDamagePermille: 1000,
      builderAutoHelpRadiusU: 3072,
      formation: {
        gapU: 64,
        widthPermille: 2000,
        slackU: 192,
        directRangeU: 5120,
        gatherRingU: 256,
      },
      placement: {
        clearanceU: 256,
        depotClearanceU: 256,
        buildRangeU: 2560,
        claimBuildRangeU: 1280,
      },
      autoGatherRadiusU: 10240,
      exclusiveRadiusU: 3072,
      heroClaimTicks: 3600,
      contestFlipTicks: 240,
      vision: { cellU: 512 },
      guard: { standU: 1280, leashU: 3584 },
      baseDefense: {
        survival: true,
        skirmish: false,
        radiusU: 10240,
        calmTicks: 160,
      },
    });
  });

  it('fog of war (data 0.22.0): sight radii resolve from sightM or the sim.json vision defaults', () => {
    const data = loadGameData(raw());
    const l = (key: string) => data.loadouts.find((x) => x.key === key)!;
    const b = (key: string) => data.buildings.find((x) => x.key === key)!;
    expect(l('scavenger').sightU).toBe(14 * 256); // vision.unitSightM
    expect(l('sentinel').sightU).toBe(32 * 256); // own sightM
    expect(data.heroes[0]!.sightU).toBe(16 * 256); // vision.heroSightM
    expect(b('woning').sightU).toBe(10 * 256); // vision.buildingSightM
    expect(b('hoofdgebouw').sightU).toBe(12 * 256);
    expect(b('claimpaal').sightU).toBe(8 * 256);
    expect(b('turret').sightU).toBe(b('turret').rangeU + 2 * 256); // rangeM + vision.turretSightExtraM
    const r = raw();
    const sim = r.sim as Record<string, unknown>;
    expect(() =>
      loadGameData({ ...r, sim: { ...sim, vision: { ...(sim['vision'] as object), cellM: 3 } } }),
    ).toThrow();
  });

  it('padvinding: sectorzijde een macht van 2 (4..64), ingang hoogstens de sectorzijde', () => {
    const r = raw();
    const sim = (patch: object): unknown => ({
      ...r,
      sim: { ...(clone(r.sim) as object), ...patch },
    });
    expect(() => loadGameData(sim({ pathSectorCells: 24 }) as never)).toThrow(/pathSectorCells/);
    expect(() => loadGameData(sim({ pathSectorCells: 128 }) as never)).toThrow(/pathSectorCells/);
    expect(() =>
      loadGameData(sim({ pathSectorCells: 16, pathEntranceMaxCells: 17 }) as never),
    ).toThrow(/pathEntranceMaxCells/);
    expect(
      loadGameData(sim({ pathSectorCells: 8, pathEntranceMaxCells: 8 }) as never).sim,
    ).toMatchObject({ pathSectorCells: 8, pathEntranceMaxCells: 8 });
  });

  it('placement (data 0.18.0): clearanceM at least one cell, depotClearanceM at least clearanceM', () => {
    const r = raw();
    const placement = (patch: object): unknown => ({
      ...r,
      sim: {
        ...(clone(r.sim) as object),
        placement: { ...(clone((r.sim as { placement: object }).placement) as object), ...patch },
      },
    });
    expect(() => loadGameData(placement({ clearanceM: 0.5 }) as never)).toThrow(/clearanceM/);
    expect(() => loadGameData(placement({ clearanceM: 3, depotClearanceM: 2 }) as never)).toThrow(
      /depotClearanceM/,
    );
    expect(
      loadGameData(placement({ clearanceM: 2, depotClearanceM: 4 }) as never).sim.placement,
    ).toMatchObject({ clearanceU: 512, depotClearanceU: 1024 });
  });

  it('weigert een onbekend veld in sim.json', () => {
    const r = raw();
    expect(() => loadGameData({ ...r, sim: { ...(clone(r.sim) as object), extra: 1 } })).toThrow(
      /sim\.json/,
    );
  });
});

describe('validatie', () => {
  it('weigert een onbekend veld', () => {
    const r = raw();
    const loadouts = clone(r.loadouts) as Record<string, unknown>[];
    loadouts[0]!.onbekend = 1;
    expect(() => loadGameData({ ...r, loadouts })).toThrow(/loadouts\.json/);
  });

  it('weigert een onbekend veld in de damage-matrix', () => {
    const r = raw();
    const damageMatrix = { ...(clone(r.damageMatrix) as object), plasma: {} };
    expect(() => loadGameData({ ...r, damageMatrix })).toThrow(/damage-matrix\.json/);
  });

  it('weigert een dangling referentie', () => {
    const r = raw();
    const loadouts = clone(r.loadouts) as { prereqTech: string[] }[];
    loadouts[0]!.prereqTech = ['bestaat_niet'];
    expect(() => loadGameData({ ...r, loadouts })).toThrow(/bestaat_niet/);
  });

  it('weigert een dubbele id en een ongeldige versie', () => {
    const r = raw();
    const perks = clone(r.perks) as unknown[];
    expect(() => loadGameData({ ...r, perks: [...perks, perks[0]] })).toThrow(/dubbele id/);
    expect(() => loadGameData({ ...r, version: 'x' })).toThrow(/VERSION/);
  });
});

describe('determinisme', () => {
  it('geeft bij twee keer laden gelijke output, ook bij andere invoervolgorde', () => {
    const a = loadGameData(raw());
    const b = loadGameData(raw());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const r = raw();
    const reversed = {
      ...r,
      loadouts: [...(r.loadouts as unknown[])].reverse(),
      buildings: [...(r.buildings as unknown[])].reverse(),
    };
    expect(loadGameData(reversed)).toEqual(a);
  });
});
