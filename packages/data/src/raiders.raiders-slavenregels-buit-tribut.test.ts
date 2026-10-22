// Split from raiders.test.ts to stay under the 5,000-token file limit.
import { describe, it, expect } from 'vitest';
import { loadGameData, STATS } from './loader.js';
import { metersToUnits, secondsToTicks } from './units.js';
import { raw } from './raiders.helpers.js';

describe('Raiders: slavenregels, buit, tribute en chems', () => {
  const data = loadGameData(raw());
  const faction = data.factions.find((f) => f.key === 'raiders')!;
  const techKey = (id: number): string => data.tech[id]!.key;

  it('slavenregels: roven buiten de basisradius, bevrijding na 3 s, opstand bij te weinig bewakers (data 0.29.0)', () => {
    const s = faction.slaves!;
    expect(s.minDistanceFromOwnerBaseU).toBe(metersToUnits(36));
    // de basisradius is groter dan een bouwrange (sim.json placement.buildRangeM 10) plus de turret van de Dwellers
    expect(s.minDistanceFromOwnerBaseU).toBeGreaterThan(data.sim.placement.buildRangeU);
    expect(s.liberation).toEqual({
      touchTicks: secondsToTicks(3),
      touchRangeU: metersToUnits(2),
      guardRadiusU: metersToUnits(12),
      freedSpeedPermille: 250,
    });
    // Martien, 18 oktober: een Kooi naast de scrap: 1 bewaker; geen Kooi dichtbij: 2 op 5; bewaakmodus op de scrap: 1 op 5 ("een bewaker op een scrapbron dekt 3 slaven. = 5 efficiënter dan 2 los")
    expect(s.revolt).toEqual({
      cageNearU: metersToUnits(15),
      guardRadiusU: metersToUnits(12),
      cageGuards: 1,
      guardModeSlavesPerGuard: 5,
      noCageGuards: 2,
      noCageSlaves: 5,
      escapeU: metersToUnits(30),
      graceTicks: secondsToTicks(40),
      emptyGraceTicks: secondsToTicks(15),
      escapePermille: 500,
      repeatTicks: secondsToTicks(25),
    });
    expect(s.revolt.emptyGraceTicks).toBeLessThan(s.revolt.graceTicks);
    // bewaakmodus op de node is efficiënter dan losse vechters (1 op 5 tegen 2 op 5): nooit meer, en vanaf 3 slaven minder
    for (let n = 1; n <= 8; n++)
      expect(Math.ceil(n / s.revolt.guardModeSlavesPerGuard)).toBeLessThanOrEqual(
        Math.ceil((n * s.revolt.noCageGuards) / s.revolt.noCageSlaves),
      );
    expect(Math.ceil(3 / s.revolt.guardModeSlavesPerGuard)).toBeLessThan(
      Math.ceil((3 * s.revolt.noCageGuards) / s.revolt.noCageSlaves),
    );
    // een Kooi dichtbij ligt binnen de werkstraal van de Kooi, en een bewaker in bewaakmodus (sim.json guard.standM)
    // staat binnen de bewaakstraal
    const kooi = data.buildings.find((b) => b.key === 'kooi')!;
    expect(s.revolt.cageNearU).toBeLessThanOrEqual(kooi.cage!.workRadiusU);
    expect(data.sim.guard.standU).toBeLessThanOrEqual(s.revolt.guardRadiusU);
    expect(data.sim.guard.leashU).toBeGreaterThanOrEqual(data.sim.guard.standU);
  });

  it('buit en tribute: bonus via afpersing, depots dubbel', () => {
    expect(faction.plunder).toEqual({
      buildingLootPermille: 300,
      depotLootMultiplierPermille: 2000,
      carryLootPermille: 1000,
      bonusTech: data.tech.find((t) => t.key === 'afpersing')!.id,
      bonusPermille: 250,
    });
    expect(faction.tribute).toEqual({
      claimKind: 'settlement',
      scrapPerMin: 20,
      bonusTech: data.tech.find((t) => t.key === 'afpersing')!.id,
      bonusPermille: 500,
    });
  });

  it('chems: Psycho (schade) en Jet (snelheid), allebei met een crash erna en zonder verslaving', () => {
    expect(faction.chems.map((c) => c.key)).toEqual(['psycho', 'jet']);
    const [psycho, jet] = faction.chems as [(typeof faction.chems)[0], (typeof faction.chems)[0]];
    const stat = (list: typeof psycho.effects, s: string, target: string) =>
      list.find((e) => e.stat === s && e.target === target)?.delta ?? 0;
    expect(stat(psycho.effects, 'damagePct', 'alle')).toBeGreaterThan(0);
    expect(stat(psycho.crash, 'damagePct', 'alle')).toBeLessThan(0);
    expect(stat(psycho.crash, 'speedPct', 'alle')).toBeLessThan(0);
    expect(stat(jet.effects, 'speedPct', 'alle')).toBeGreaterThan(0);
    expect(stat(jet.crash, 'speedPct', 'alle')).toBeLessThan(0);
    // SPECIAL-kanaal: de chem tilt de held tijdelijk (Strength voor Psycho, Agility voor Jet)
    expect(psycho.effects).toContainEqual({ stat: 'S', target: 'held', delta: 2 });
    expect(jet.effects).toContainEqual({ stat: 'A', target: 'held', delta: 2 });
    for (const c of faction.chems) {
      expect(c.activeTicks, c.key).toBeGreaterThan(0);
      expect(c.crashTicks, c.key).toBeGreaterThan(0);
      expect(c.cooldownTicks, c.key).toBeGreaterThan(0);
      // geen verslaving: elk effect van de crash eindigt met de crash, en elke chem heeft een duidelijke prijs
      expect(
        c.crash.some((e) => e.delta < 0),
        c.key,
      ).toBe(true);
      expect(c.crashTicks, c.key).toBeLessThan(c.activeTicks + secondsToTicks(5));
      expect(c.refined, c.key).toEqual({
        requiresTech: data.tech.find((t) => t.key === 'zuivere_stoffen')!.id,
        activePermille: 300,
        crashPermille: -300,
      });
    }
    expect(techKey(psycho.requiresTech)).toBe('psycho');
    expect(techKey(jet.requiresTech)).toBe('jet');
    // elke SPECIAL-letter in een chem is een bestaande letter
    for (const c of faction.chems)
      for (const e of [...c.effects, ...c.crash])
        if (e.stat.length === 1) expect(STATS).toContain(e.stat);
  });
});

describe('Raiders: Warlord', () => {
  const data = loadGameData(raw());
  const warlord = data.heroes.find((h) => h.key === 'warlord')!;
  const opziener = data.heroes.find((h) => h.key === 'opziener')!;

  it('is een Krijger met SPECIAL op het niveau van de Opziener en een intimidatie-aura', () => {
    expect(warlord.archetype).toBe(1); // krijger
    const total = (h: typeof warlord) => h.special.reduce((a, b) => a + b, 0);
    expect(total(warlord)).toBe(total(opziener));
    expect(warlord.aura!.radiusU).toBe(metersToUnits(10));
    expect(warlord.aura!.effects.every((e) => e.side === 'enemy' && e.delta < 0)).toBe(true);
    expect(warlord.maxRevives).toBe(4);
    expect(warlord.revivePenaltyPermille).toBe(200);
    expect(opziener.aura).toBeNull(); // de Opziener is ongewijzigd
    expect(opziener.baseLoadoutId).toBe(-1);
    expect(opziener.xpPerCapture).toBe(0);
  });

  it('ability Raid: een punt op bereik, eigen units sneller en sterker', () => {
    const raid = warlord.abilities.find((a) => a.id === 'raid')!;
    expect(raid.rangeU).toBe(metersToUnits(14));
    expect(raid.radiusU).toBe(metersToUnits(10));
    expect(raid.durationTicks).toBe(secondsToTicks(7));
    expect(raid.effects).toContainEqual({
      stat: 'speedPct',
      side: 'ally',
      target: 'units',
      delta: 350,
    });
    expect(raid.effects).toContainEqual({
      stat: 'damagePct',
      side: 'ally',
      target: 'units',
      delta: 200,
    });
  });

  it('levelt het snelst: elke xp-drempel en elke xp-bron is gunstiger dan bij de Opziener', () => {
    expect(warlord.xpThresholds.length).toBe(opziener.xpThresholds.length);
    warlord.xpThresholds.forEach((t, i) => expect(t).toBeLessThan(opziener.xpThresholds[i]!));
    expect(warlord.xpPerKill).toBeGreaterThan(opziener.xpPerKill);
    expect(warlord.xpPerAssist).toBeGreaterThan(opziener.xpPerAssist);
    expect(warlord.xpPerDiscovery).toBeGreaterThan(opziener.xpPerDiscovery);
    expect(warlord.xpPerCapture).toBeGreaterThan(0);
  });

  it('perks: Nederlandse naam, smaaktekst, eisen binnen het basis-SPECIAL, minstens een per levelstap', () => {
    const pool = warlord.perkPool.map((id) => data.perks[id]!);
    expect(pool.length).toBeGreaterThanOrEqual(warlord.xpThresholds.length);
    expect(data.perks.length).toBeLessThanOrEqual(32); // sim MAX_PERKS
    for (const p of pool) {
      expect(p.naam.length, p.key).toBeGreaterThan(3);
      expect(p.flavourText.length, p.key).toBeGreaterThan(20);
      expect(
        warlord.special[p.requires.stat]!,
        `${p.key} vereist ${STATS[p.requires.stat]}`,
      ).toBeGreaterThanOrEqual(p.requires.min);
      expect(p.effects.length, p.key).toBeGreaterThan(0);
    }
    // geen perk van de Dwellers in de pool van de Warlord en andersom
    const dwellerPool = new Set(opziener.perkPool);
    for (const id of warlord.perkPool) expect(dwellerPool.has(id)).toBe(false);
  });
});

describe('Raiders: AI-script', () => {
  const data = loadGameData(raw());
  const raiders = data.factions.find((f) => f.key === 'raiders')!;
  const ai = data.aiScripts.find((a) => a.key === 'raiders-basic')!;
  const dwellerAi = data.aiScripts.find((a) => a.key === 'dwellers-basic')!;
  // data 0.24.0: the Dweller AI plays this script against the Raiders
  const versusAi = data.aiScripts.find((a) => a.key === 'dwellers-vs-raiders')!;

  it('raiders-basic hoort bij de factie en elk id bestaat', () => {
    expect(ai.factionId).toBe(raiders.id);
    const loadoutIds = new Set(data.loadouts.map((l) => l.id));
    const plan = ai.raidPlan!;
    expect(plan).not.toBeNull();
    for (const m of plan.fighterMix) expect(loadoutIds.has(m.loadoutId)).toBe(true);
    expect(loadoutIds.has(plan.harass!.loadoutId)).toBe(true);
    expect(loadoutIds.has(plan.slaveRaids!.slaverLoadoutId)).toBe(true);
    expect(data.loadouts[plan.harass!.loadoutId]!.key).toBe('buggy');
    expect(data.loadouts[plan.slaveRaids!.slaverLoadoutId]!.key).toBe('slaver');
    // geen robots en geen training: de Raiders hebben ze niet. Data 0.23.0 (sim 0.18.0, gemeten): wel een reserve voor
    // het onderzoek
    expect(ai.robots).toBeNull();
    expect(ai.training).toBeNull();
    expect(ai.reserve).not.toBeNull();
    // en de Dwellers hebben geen raidPlan
    expect(dwellerAi.raidPlan).toBeNull();
  });

  it('is vroege agressie: eerder aanvallen, eerder claimen en eerder pushen dan de Dweller-AI', () => {
    expect(ai.attackTimersTicks[0]!).toBeLessThan(dwellerAi.attackTimersTicks[0]!);
    expect(ai.claimFromTicks).toBeLessThan(dwellerAi.claimFromTicks);
    // data 0.28.0 (sim 0.23.0, speltest H1, gemeten): de verre claims vallen nu 10 s na die van de Dweller-AI (1000 tegen
    // 990 s; 940 tot 985 lagen op een van de twee seedsets buiten de balans), maar nog voor de dominantie-push
    expect(ai.claimFarFromTicks).toBeLessThan(ai.raidPlan!.dominancePush.fromTicks);
    expect(ai.waveIntervalTicks).toBeLessThan(dwellerAi.waveIntervalTicks);
    // data 0.24.0 (sim 0.19.0, gemeten): de push op het hoofdgebouw is laat (de vroege push won niet meer tegen een
    // Dweller die zijn hoofdgebouw eerst verdedigt), maar nog altijd voor die van de Dweller-AI tegen de Raiders
    expect(ai.pushFromTicks).toBeLessThan(versusAi.pushFromTicks);
    expect(versusAi.versusFactionId).toBe(raiders.id);
    expect(versusAi.defendHqFirst).toBe(true);
    expect(versusAi.liberate).not.toBeNull();
    // data 0.23.0 (sim 0.18.0, gemeten): eerst staalplaten (betere vechters voor de vroege push), de buggies na de
    // autosloperij (zijn onderzoek buggy_chassis volgt uit de bouwvolgorde, de AI onderzoekt de keten zelf)
    const firstResearch = data.tech[ai.research[0]!]!.key;
    expect(firstResearch).toBe('staalplaten');
    const garage = data.buildings.find((b) => b.key === 'autosloperij')!.id;
    const garageAt = ai.buildOrder.find((o) => o.buildingId === garage)!.atTick;
    expect(garageAt).toBeLessThanOrEqual(ai.raidPlan!.harass!.fromTicks);
    // data 0.27.0 (gemeten, voorstel): eerst de kampen overnemen (vanaf minuut 1), dan de slavenroof (minuut 6, na de
    // eerste golf: een vroege roof zonder de kampen langs de weg ving tot 578 slaven in 66 potjes en won 80 procent);
    // dominantie-push na de eerste golf
    expect(ai.creeps!.fromTicks).toBeLessThan(ai.attackTimersTicks[0]!);
    expect(ai.raidPlan!.slaveRaids!.fromTicks).toBeGreaterThan(ai.creeps!.fromTicks);
    expect(ai.raidPlan!.dominancePush.fromTicks).toBeGreaterThan(ai.attackTimersTicks[0]!);
    // data 0.24.0 (sim 0.19.0, gemeten): dominantie is de route, het kamp bij de claimpunten komt ruim voor de push
    expect(ai.raidPlan!.dominancePush.fromTicks).toBeLessThan(ai.pushFromTicks);
  });

  it('houdt bewakers thuis (anders opstand): minstens wat een Kooi-groep vraagt', () => {
    const revolt = raiders.slaves!.revolt;
    expect(ai.raidPlan!.garrison.minFighters).toBeGreaterThanOrEqual(revolt.cageGuards);
    // de eerste golf is groter dan het garnizoen: er is iets om heen te sturen
    expect(ai.waveMinArmy).toBeGreaterThan(ai.raidPlan!.garrison.minFighters);
    // de bouwvolgorde begint met twee tenten en een Kooi (bedden voor de vroege push, dan slavenopslag; data 0.23.0),
    // in tijdsvolgorde
    const keys = ai.buildOrder.map((o) => data.buildings[o.buildingId]!.key);
    expect(keys.slice(0, 3)).toEqual(['tent', 'tent', 'kooi']);
    const times = ai.buildOrder.map((o) => o.atTick);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });
});
