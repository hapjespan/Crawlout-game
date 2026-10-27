// Split from game-data.test.ts to stay under the 5,000-token file limit.
import { describe, it, expect } from 'vitest';
import { loadGameData, cumulate, PROVIDES, AI_SITES } from './loader.js';
import { EffectStat } from './schemas.js';
import { metersToUnits, secondsToTicks } from './units.js';
import { clone, raw } from './game-data.helpers.js';

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

  it('exclusiveRadiusM (data 0.20.0): 12 m, at least claimRadiusM', () => {
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
