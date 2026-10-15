import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  AI_SITES,
  convertDelta,
  convertDominance,
  cumulate,
  loadGameData,
  PROVIDES,
  type RawGameData,
} from './loader.js';
import { EffectStat, MapDef } from './schemas.js';
import { readDataDir } from './node.js';
import { metersToUnits, secondsToTicks } from './units.js';

const dataDir = fileURLToPath(new URL('../../../data', import.meta.url));
const raw = (): RawGameData => readDataDir(dataDir);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe('data/ valideert', () => {
  const data = loadGameData(raw());

  it('bevat de Dwellers-slice in de verwachte aantallen', () => {
    expect(data.factions).toHaveLength(1);
    expect(data.loadouts.map((l) => l.key)).toEqual(['bouwer', 'militie', 'patrol', 'scavenger']);
    expect(data.buildings).toHaveLength(8);
    expect(data.tech).toHaveLength(6);
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
        gatherRingU: 0,
      },
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
    for (const b of data.buildings.filter((x) => x.key !== 'turret')) {
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
    ]);
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
      ].map((k) => ix(data.tech, k)),
    );
    expect(ai.armyLoadouts).toEqual([ix(data.loadouts, 'patrol'), ix(data.loadouts, 'militie')]);
    expect(ai.housingBuildingId).toBe(ix(data.buildings, 'woning'));
    expect(ai.richBuilds.every((o) => o.buildingId === ix(data.buildings, 'turret'))).toBe(true);
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
    expect(ai.richScrap).toBe(300);
    expect(ai.richBuilds.map((o) => AI_SITES[o.site])).toEqual([
      'front',
      'claim',
      'front',
      'hq',
      'claim',
    ]);
    expect([ai.claimSafeRadiusU, ai.defendRadiusU, ai.rallyRadiusU]).toEqual([
      metersToUnits(30),
      metersToUnits(38),
      metersToUnits(6),
    ]);
    expect(AI_SITES[ai.rallySite]).toBe('front');
    expect(ai.allInWithoutNodes).toBe(true);
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
