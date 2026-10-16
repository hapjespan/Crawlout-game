import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  AI_SITES,
  ARMOR_TYPES,
  BODY_TYPES,
  DAMAGE_TYPES,
  REPAIR_TARGETS,
  ROLES,
  STATS,
  convertDelta,
  convertDominance,
  cumulate,
  loadGameData,
  PROVIDES,
  type RawGameData,
} from './loader.js';
import { EffectStat, MapDef } from './schemas.js';
import { readDataDir } from './node.js';
import { metersToUnits, perSecondToMilliPerTick, secondsToTicks } from './units.js';

const dataDir = fileURLToPath(new URL('../../../data', import.meta.url));
const raw = (): RawGameData => readDataDir(dataDir);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe('data/ valideert', () => {
  const data = loadGameData(raw());

  it('bevat de Dwellers-slice in de verwachte aantallen', () => {
    expect(data.factions).toHaveLength(1);
    expect(data.loadouts.map((l) => l.key)).toEqual([
      'beveiligingsrobot',
      'bouwer',
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
    expect(data.buildings).toHaveLength(10);
    expect(data.tech).toHaveLength(14);
    expect(data.training).toHaveLength(7);
    expect(data.heroes).toHaveLength(1);
    expect(data.perks).toHaveLength(6);
    expect(data.aiScripts).toHaveLength(1);
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
      const keys = list.map((r) => r.key);
      expect(keys).toEqual([...keys].sort());
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
    for (const l of data.loadouts.filter((x) => x.key !== 'scavenger')) {
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
    });
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

describe('sprint 3: held, claims, cancel, militie', () => {
  const data = loadGameData(raw());
  const hero = data.heroes[0]!;

  it('rekent de xp-tabel per stap om naar cumulatieve integer-drempels', () => {
    expect(cumulate([100, 200, 300])).toEqual([100, 300, 600]);
    expect(hero.xpThresholds).toEqual([80, 200, 360, 560, 810, 1110]);
    expect(
      hero.xpThresholds.every(
        (x, i) => Number.isInteger(x) && (i === 0 || x > hero.xpThresholds[i - 1]!),
      ),
    ).toBe(true);
    expect(hero.naam).toBe('Opziener');
    expect(hero.xpPerKill).toBe(25);
    expect(hero.xpPerAssist).toBe(15);
    expect(hero.xpAssistRadiusU).toBe(15 * 256);
    expect(hero.xpPerDiscovery).toBe(50);
    expect(hero.revivePenaltyPermille).toBe(200);
    expect(hero.maxRevives).toBe(4);
  });

  it('rekent Lockdown om: radius in eenheden, duur in ticks, effecten in promille', () => {
    const lockdown = hero.abilities.find((a) => a.id === 'lockdown')!;
    expect(lockdown.rangeU).toBe(2560); // 10 m
    expect(lockdown.radiusU).toBe(1536); // 6 m
    expect(lockdown.durationTicks).toBe(160); // 8 s
    expect(lockdown.cooldownTicks).toBe(900); // 45 s
    expect(lockdown.effects).toEqual([
      { stat: 'speedPct', side: 'enemy', target: 'units', delta: -500 },
      { stat: 'damagePct', side: 'ally', target: 'alle', delta: 250 },
    ]);
  });

  it('levert cancelRefundPermille en militiaPermille', () => {
    expect(data.sim.cancelRefundPermille).toBe(1000);
    expect(data.aiScripts[0]!.militiaPermille).toBe(200);
    expect('aiMilitiaPermille' in data.sim).toBe(false); // vervallen in 0.6.0
    expect('claimTicks' in data.sim).toBe(false);
  });

  it('weigert ongeldige held-, ai- en sim-data', () => {
    const noXp = clone(raw());
    (noXp.heroes as { xpPerLevel: number[] }[])[0]!.xpPerLevel = [];
    expect(() => loadGameData(noXp)).toThrow(/xpPerLevel/);
    const fractional = clone(raw());
    (fractional.heroes as { xpPerLevel: number[] }[])[0]!.xpPerLevel = [100.5];
    expect(() => loadGameData(fractional)).toThrow(/xpPerLevel/);
    const noMilitia = clone(raw());
    delete (noMilitia.ai[0] as { militiaPct?: number }).militiaPct;
    expect(() => loadGameData(noMilitia)).toThrow(/militiaPct/);
    const badRefund = clone(raw());
    (badRefund.sim as { cancelRefundPct: number }).cancelRefundPct = 150;
    expect(() => loadGameData(badRefund)).toThrow(/cancelRefundPct/);
    const badEffect = clone(raw());
    (
      badEffect.heroes as { abilities: { effects: { stat: string }[] }[] }[]
    )[0]!.abilities[0]!.effects[0]!.stat = 'koekjesPct';
    expect(() => loadGameData(badEffect)).toThrow(/stat/);
  });

  it('heeft het hoofdgebouw als claimbron en hq, en een bouwbare claimpaal', () => {
    const hq = data.buildings.find((b) => b.key === 'hoofdgebouw')!;
    expect(hq.provides).toContain(PROVIDES.indexOf('hq'));
    expect(hq.provides).toContain(PROVIDES.indexOf('claim'));
    const paal = data.buildings.find((b) => b.key === 'claimpaal')!;
    expect(paal.provides).toEqual([PROVIDES.indexOf('claim')]);
    expect(paal.scrapCost).toBeGreaterThan(0);
    expect(data.sim.claimRadiusU).toBe(1536);
  });

  it('exclusiveRadiusM (data 0.19.0): 12 m, at least claimRadiusM', () => {
    const r = raw();
    expect(loadGameData(r).sim.exclusiveRadiusU).toBe(12 * 256);
    const sim = { ...(clone(r.sim) as object), exclusiveRadiusM: 5 };
    expect(() => loadGameData({ ...r, sim } as never)).toThrow(/exclusiveRadiusM/);
  });

  it('kan elke tech onderzoeken in een bouwbaar gebouw met toepasbare effecten', () => {
    const hqIndex = PROVIDES.indexOf('hq');
    const buildable = (b: number, seen = new Set<number>()): boolean => {
      const building = data.buildings[b]!;
      if (building.provides.includes(hqIndex) || seen.has(b)) return false;
      seen.add(b);
      return building.prereqTech.every((t) => buildable(data.tech[t]!.buildingId, seen));
    };
    for (const t of data.tech) {
      expect(buildable(t.buildingId), t.key).toBe(true);
      for (const e of t.effects) expect(EffectStat.options, t.key).toContain(e.stat);
    }
    // Loadouts met prereqTech (patrol, turret) worden bereikbaar via een onderzoekbare tech.
    for (const l of data.loadouts)
      for (const p of l.prereqTech) expect(buildable(data.tech[p]!.buildingId), l.key).toBe(true);
    for (const b of data.buildings)
      for (const p of b.prereqTech) expect(buildable(data.tech[p]!.buildingId), b.key).toBe(true);
  });

  it('gebruikt in perks alleen EffectStats uit de enum', () => {
    for (const p of data.perks)
      for (const e of p.effects) expect(EffectStat.options, p.key).toContain(e.stat);
  });
});

describe('sprint 4: turrets in data (besluit 8)', () => {
  const data = loadGameData(raw());
  const turret = data.buildings.find((b) => b.key === 'turret')!;
  const militie = data.loadouts.find((l) => l.key === 'militie')!;

  it('rekent de turret-velden om en geeft niet-turrets 0 en 0', () => {
    expect(turret.damage).toBe(12);
    expect(turret.damageType).toBe(militie.damageType);
    expect(turret.rangeU).toBe(metersToUnits(12));
    expect(turret.cooldownTicks).toBe(secondsToTicks(1));
    const turretIx = PROVIDES.indexOf('turret');
    for (const b of data.buildings.filter((x) => !x.provides.includes(turretIx))) {
      expect([b.damage, b.damageType, b.rangeU, b.cooldownTicks], b.key).toEqual([0, 0, 0, 0]);
    }
  });

  it('is iets sterker dan militie per schot en heeft meer bereik', () => {
    expect(turret.damage).toBeGreaterThan(militie.damage);
    expect(turret.rangeU).toBeGreaterThan(militie.rangeU);
  });

  it('weigert een turret zonder wapenvelden', () => {
    for (const field of ['damage', 'damageType', 'rangeM', 'cooldownS']) {
      const r = clone(raw());
      const t = (r.buildings as Record<string, unknown>[]).find((b) => b.id === 'turret')!;
      delete t[field];
      expect(() => loadGameData(r), field).toThrow();
    }
  });
});

describe('balans speltest 14 oktober: AI-script', () => {
  const data = loadGameData(raw());
  const ai = data.aiScripts[0]!;
  const ix = <T extends { key: string; id: number }>(list: T[], key: string): number =>
    list.find((x) => x.key === key)!.id;

  it('rekent het script om naar sim-eenheden en numerieke ids', () => {
    expect(ai.buildOrder.map((o) => AI_SITES[o.site])).toEqual([
      'hq',
      'hq',
      'claim',
      'front',
      'hq',
      'hq',
      'hq',
      'hq',
      'front',
    ]);
    expect(ai.buildOrder[8]).toEqual({
      atTick: secondsToTicks(840),
      buildingId: ix(data.buildings, 'turret_laser'),
      site: AI_SITES.indexOf('front'),
    });
    expect(ai.buildOrder[6]).toEqual({
      atTick: secondsToTicks(660),
      buildingId: ix(data.buildings, 'robotfabriek'),
      site: AI_SITES.indexOf('hq'),
    });
    expect(ai.buildOrder[2]).toEqual({
      atTick: secondsToTicks(150),
      buildingId: ix(data.buildings, 'werkplaats'),
      site: AI_SITES.indexOf('claim'),
    });
    expect(ai.research).toEqual(
      [
        'geweerrek',
        'raffinage',
        'composiet_pantser',
        'snelle_voeten',
        'bouwrobots',
        'lasergeleiding',
        'robotica',
        'lasertechniek',
        'sentinel_protocol',
        'turret_netwerk',
        'turret_schade',
        'turret_bereik',
      ].map((k) => ix(data.tech, k)),
    );
    expect(ai.armyLoadouts).toEqual([ix(data.loadouts, 'patrol'), ix(data.loadouts, 'militie')]);
    expect(ai.housingBuildingId).toBe(ix(data.buildings, 'woning'));
    expect(ai.richBuilds.map((o) => o.buildingId)).toEqual(
      ['turret', 'turret', 'turret_laser', 'turret_laser', 'turret_laser'].map((k) =>
        ix(data.buildings, k),
      ),
    );
    expect({
      min: ai.militiaPermille,
      max: ai.militiaPermilleMax,
      perMin: ai.militiaPermillePerMin,
      threat: ai.threatMilitiaPermille,
    }).toEqual({ min: 200, max: 600, perMin: 25, threat: 500 });
    expect(ai.attackTimersTicks).toEqual([secondsToTicks(480), secondsToTicks(720)]);
    expect([
      ai.waveIntervalTicks,
      ai.waveJitterTicks,
      ai.waveMaxWaitTicks,
      ai.pushFromTicks,
    ]).toEqual([3600, 1200, 1800, 28800]);
    expect([ai.claimFromTicks, ai.claimFarFromTicks, ai.researchFromTicks]).toEqual([
      1200, 19800, 3600,
    ]);
    expect(ai.richScrap).toBe(260);
    expect(ai.richBuilds.map((o) => AI_SITES[o.site])).toEqual([
      'front',
      'claim',
      'front',
      'claim',
      'front',
    ]);
    expect([ai.claimSafeRadiusU, ai.defendRadiusU, ai.rallyRadiusU]).toEqual([
      metersToUnits(30),
      metersToUnits(38),
      metersToUnits(6),
    ]);
    expect(AI_SITES[ai.rallySite]).toBe('front');
    expect(ai.allInWithoutNodes).toBe(true);
  });

  it('data 0.17.0: reserve, training and the robot army rules of the AI, in sim units', () => {
    const d = loadGameData(raw());
    const ai = d.aiScripts[0]!;
    expect(ai.reserve).toEqual({ fromTicks: 13200, minArmy: 12, robotsFirstFromTicks: 21600 });
    expect(ai.training!.fromTicks).toBe(14400);
    expect(ai.training!.sequence.map((t) => d.training[t]!.key)).toContain('training_uithouding');
    // a program listed n times is trained up to n points: never more than its maxPoints
    for (const t of new Set(ai.training!.sequence)) {
      const n = ai.training!.sequence.filter((x) => x === t).length;
      expect(n).toBeLessThanOrEqual(d.training[t]!.maxPoints);
    }
    expect(ai.robots).toMatchObject({ countAsArmy: true, reservePop: 12 });
    // without the optional blocks: null, and robots default to not counting and no reserved pop
    const bare = clone(raw());
    const a0 = bare.ai[0] as Record<string, unknown>;
    delete a0.reserve;
    delete a0.training;
    const r = a0.robots as Record<string, unknown>;
    delete r.countAsArmy;
    delete r.reservePop;
    const b = loadGameData(bare).aiScripts[0]!;
    expect(b.reserve).toBeNull();
    expect(b.training).toBeNull();
    expect(b.robots).toMatchObject({ countAsArmy: false, reservePop: 0 });
    const badTraining = clone(raw());
    (badTraining.ai[0] as { training: { sequence: string[] } }).training.sequence.push('yoga');
    expect(() => loadGameData(badTraining)).toThrow(/onbekende training 'yoga'/);
  });

  it('rallyPoint is weg uit het script (data 0.12.0): het strikte schema weigert het veld', () => {
    const old = clone(raw());
    (old.ai[0] as Record<string, unknown>).rallyPoint = { x: 64, y: 64 };
    expect(() => loadGameData(old)).toThrow();
  });

  it('weigert een onbekende tech, loadout of plaats en een leeg leger', () => {
    const badTech = clone(raw());
    (badTech.ai[0] as { research: string[] }).research.push('teleporter');
    expect(() => loadGameData(badTech)).toThrow(/onbekende tech 'teleporter'/);
    const badLoadout = clone(raw());
    (badLoadout.ai[0] as { armyLoadouts: string[] }).armyLoadouts = ['raketman'];
    expect(() => loadGameData(badLoadout)).toThrow(/onbekende loadout 'raketman'/);
    const noArmy = clone(raw());
    (noArmy.ai[0] as { armyLoadouts: string[] }).armyLoadouts = [];
    expect(() => loadGameData(noArmy)).toThrow(/armyLoadouts/);
    const badSite = clone(raw());
    (badSite.ai[0] as { buildOrder: { site?: string }[] }).buildOrder[0]!.site = 'dak';
    expect(() => loadGameData(badSite)).toThrow(/site/);
  });
});

describe('content-x (data 0.16.0): robots, technicus, vangnet', () => {
  const data = loadGameData(raw());
  const loadout = (key: string) => data.loadouts.find((l) => l.key === key)!;
  const building = (key: string) => data.buildings.find((b) => b.key === key)!;
  const tech = (key: string) => data.tech.find((t) => t.key === key)!;
  const dwellers = data.factions[0]!;
  const robots = data.loadouts.filter((l) => l.bodyType === BODY_TYPES.indexOf('robot'));

  it('heeft drie robots met bodyType robot, rol robot en producedAt robotfabriek', () => {
    expect(robots.map((l) => l.key).sort()).toEqual([
      'beveiligingsrobot',
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
    for (const l of data.loadouts.filter((x) => !robots.includes(x)))
      expect(l.producedAt, l.key).toBe(-1);
    expect(dwellers.uniqueUnits.map((u) => data.loadouts[u]!.key).sort()).toEqual([
      'beveiligingsrobot',
      'reparatiedrone',
      'sentinel',
    ]);
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
    // provides is een bitmasker van 8 bits (sim config): de lijst mag er geen negende waarde bij krijgen
    expect(PROVIDES.length).toBeLessThanOrEqual(8);
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
    const humanProduced = clone(raw());
    (humanProduced.loadouts as Record<string, unknown>[]).find(
      (l) => l.id === 'militie',
    )!.producedAt = 'robotfabriek';
    expect(() => loadGameData(humanProduced)).toThrow(/producedAt/);
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
    const mil = data.loadouts.filter((l) => l.role === ROLES.indexOf('militia'));
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
    const mil = data.loadouts.filter((l) => l.role === ROLES.indexOf('militia')).map((l) => l.key);
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
