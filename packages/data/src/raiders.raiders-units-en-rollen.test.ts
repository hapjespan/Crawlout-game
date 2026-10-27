// Split from raiders.test.ts to stay under the 5,000-token file limit.
import { describe, it, expect } from 'vitest';
import { loadGameData, ROLES, BODY_TYPES, ARMOR_TYPES, PROVIDES } from './loader.js';
import { secondsToTicks, metersToUnits } from './units.js';
import { raw } from './raiders.helpers.js';

describe('Raiders: units en rollen', () => {
  const data = loadGameData(raw());
  const faction = data.factions.find((f) => f.key === 'raiders')!;
  const loadout = (key: string) => data.loadouts.find((l) => l.key === key)!;
  const mine = data.loadouts.filter((l) => l.factionId === faction.id);
  const slaves = mine.filter((l) => l.slave);
  const dwellerMilitia = data.loadouts.find((l) => l.key === 'militie')!;

  it('slaven werken en vechten nooit: role scavenger of builder, damage 0, nooit gebouwd', () => {
    expect(slaves.map((l) => l.key).sort()).toEqual(['slaaf', 'slaaf_bouwer']);
    for (const l of slaves) {
      expect([ROLES.indexOf('scavenger'), ROLES.indexOf('builder')]).toContain(l.role);
      expect(l.damage, l.key).toBe(0);
      expect(l.bodyType, l.key).toBe(BODY_TYPES.indexOf('human'));
      expect(l.producedAt, l.key).toBe(-1);
      expect(l.capture, l.key).toBeNull();
      expect(l.aura, l.key).toBeNull();
    }
    expect(loadout('slaaf').gatherAmount).toBe(5);
    expect(loadout('slaaf').gatherTicks).toBe(secondsToTicks(12));
    expect(loadout('slaaf_bouwer').gatherAmount).toBe(0);
    // het slaafloadout is wat de sim als bewoner en als verzamelaar kiest voor deze factie
    expect(faction.slaves!.capturedLoadoutId).toBe(loadout('slaaf').id);
  });

  it('Raiders werken nooit: alleen slaven verzamelen of bouwen', () => {
    for (const l of mine.filter((x) => !x.slave)) {
      expect(l.gatherAmount, l.key).toBe(0);
      expect(l.role, l.key).toBe(ROLES.indexOf('militia'));
    }
    for (const l of data.loadouts.filter((x) => x.factionId === 0))
      expect(l.slave, l.key).toBe(false);
  });

  it('de start geeft een paar slaven, een bouwer en vechters; geen groei van bewoners', () => {
    const start = new Map(
      faction.startUnits.map((s) => [data.loadouts[s.loadoutId]!.key, s.count]),
    );
    expect(start.get('slaaf')).toBeGreaterThanOrEqual(2);
    expect(start.get('slaaf_bouwer')).toBeGreaterThanOrEqual(1);
    const fighters = [...start.entries()].filter(([k]) => !k.startsWith('slaaf'));
    expect(fighters.reduce((n, [, c]) => n + c, 0)).toBeGreaterThanOrEqual(3);
    // de slaven van de start passen in het kamp (cage.capacity) zodat ze meteen werken
    const camp = data.buildings.find((b) => b.key === 'raiderkamp')!;
    expect((start.get('slaaf') ?? 0) + (start.get('slaaf_bouwer') ?? 0)).toBeLessThanOrEqual(
      camp.cage!.capacity,
    );
    expect(faction.housingGrowthPerMin).toBe(0);
  });

  it('unieke units: Slaver (capture), Chem-dealer (buff-aura) en Buggy (harass)', () => {
    expect(faction.uniqueUnits.map((u) => data.loadouts[u]!.key).sort()).toEqual([
      'buggy',
      'chemdealer',
      'slaver',
    ]);
    const slaver = loadout('slaver');
    expect(slaver.capture).toEqual({
      rangeU: metersToUnits(2.5),
      captureTicks: secondsToTicks(3),
      targets: [0, 1],
      maxHpPermille: 400,
    });
    expect(slaver.capture!.rangeU).toBeGreaterThan(slaver.rangeU / 2);
    const dealer = loadout('chemdealer');
    expect(dealer.aura!.radiusU).toBe(metersToUnits(9));
    expect(dealer.aura!.chems).toEqual([0, 1]); // psycho, jet: indices in faction.chems
    expect(dealer.aura!.trigger).toBe('gevecht');
    expect(dealer.prereqTech.map((t) => data.tech[t]!.key)).toEqual(['chemie']);
    const buggy = loadout('buggy');
    expect(buggy.bodyType).toBe(BODY_TYPES.indexOf('vehicle'));
    expect(buggy.producedAt).toBe(data.buildings.find((b) => b.key === 'autosloperij')!.id);
    expect(buggy.speedUPT).toBeGreaterThan(2 * dwellerMilitia.speedUPT); // harass: veel sneller
    expect(buggy.rangeU).toBeGreaterThan(dwellerMilitia.rangeU); // net meer bereik dan het pijppistool
    expect(buggy.rangeU).toBeLessThan(data.buildings.find((b) => b.key === 'turret')!.rangeU);
    expect(buggy.popCost).toBeGreaterThan(1);
  });

  it('basisvechters: pijpgeweer en melee, honden en molotovs, schadetypen volgens de damage-matrix', () => {
    expect(loadout('plunderaar').damageType).toBe(0); // ballistic
    expect(loadout('plunderaar').rangeU).toBeGreaterThan(metersToUnits(5));
    expect(loadout('knuppelaar').damageType).toBe(2); // melee
    expect(loadout('knuppelaar').rangeU).toBeLessThan(metersToUnits(3));
    expect(loadout('molotovgooier').damageType).toBe(3); // fire
    expect(loadout('hond').bodyType).toBe(BODY_TYPES.indexOf('beast'));
    expect(loadout('hond').damageType).toBe(2);
    for (const l of mine.filter((x) => !x.slave && x.damage > 0))
      expect(data.damageMatrix[l.damageType]!.length).toBe(ARMOR_TYPES.length);
    // tempo midden en staal: geen heavy of robot, medium vanaf de tech staalplaten
    for (const l of mine) {
      expect(l.armorType, l.key).toBeLessThanOrEqual(ARMOR_TYPES.indexOf('medium'));
      expect(l.armorType, l.key).not.toBe(ARMOR_TYPES.indexOf('robot'));
    }
    expect(loadout('plunderaar_staal').armorType).toBe(ARMOR_TYPES.indexOf('medium'));
    expect(loadout('plunderaar_staal').prereqTech.map((t) => data.tech[t]!.key)).toEqual([
      'staalplaten',
    ]);
    expect(loadout('plunderaar').speedUPT).toBeLessThanOrEqual(dwellerMilitia.speedUPT);
  });

  it('de held heeft een militia-sjabloon dat nergens gebouwd wordt (de sim vindt zijn basis zonder wijziging)', () => {
    const base = loadout('warlord_basis');
    expect(base.role).toBe(ROLES.indexOf('militia'));
    expect(base.prereqTech).toEqual([]);
    expect(base.producedAt).toBe(-1);
    // fromData kiest per rol het goedkoopste loadout zonder prereqTech en zonder producedAt: dat is hier het sjabloon
    const candidates = mine.filter(
      (l) => l.role === ROLES.indexOf('militia') && l.prereqTech.length === 0 && l.producedAt < 0,
    );
    expect(candidates.map((l) => l.key)).toEqual(['warlord_basis']);
    // en geen enkel ander loadout van de factie is een bron van vrije militia: alle vechters komen uit een gebouw
    for (const l of mine.filter(
      (x) => x.role === ROLES.indexOf('militia') && x.key !== 'warlord_basis',
    ))
      expect(l.producedAt, l.key).toBeGreaterThanOrEqual(0);
  });

  it('vangnet: tenten leveren een plunderaar zolang er minder dan 5 vechters zijn', () => {
    expect(faction.safetyNet).toEqual({
      threshold: 5,
      action: 'tenten_instroom',
      intervalTicks: secondsToTicks(30),
      maxArrivals: 10,
      loadoutId: loadout('plunderaar').id,
    });
    const tent = data.buildings.find((b) => b.key === 'tent')!;
    expect(tent.provides).toContain(PROVIDES.indexOf('tent'));
    expect(loadout('plunderaar').producedAt).toBe(tent.id);
    expect(loadout('plunderaar').prereqTech).toEqual([]);
  });
});

describe('Raiders: gebouwen', () => {
  const data = loadGameData(raw());
  const faction = data.factions.find((f) => f.key === 'raiders')!;
  const building = (key: string) => data.buildings.find((b) => b.key === key)!;
  const mine = data.buildings.filter((b) => b.factionId === faction.id);

  it('heeft hoofdgebouw, tenten, Kooi, plundermarkt, chemlab, turret-equivalent en claimpost', () => {
    expect(mine.map((b) => b.key).sort()).toEqual([
      'autosloperij',
      'chemlab',
      'kooi',
      'mitrailleursnest',
      'plundermarkt',
      'plunderpost',
      'raiderkamp',
      'tent',
    ]);
    const hqs = mine.filter((b) => b.provides.includes(PROVIDES.indexOf('hq')));
    expect(hqs.map((b) => b.key)).toEqual(['raiderkamp']);
    expect(building('plundermarkt').provides).toEqual([PROVIDES.indexOf('depot')]);
    expect(building('chemlab').provides).toEqual([PROVIDES.indexOf('chemlab')]);
    // de claimpost is het enige claimgebouw dat geen hoofdgebouw is (de sim kiest het goedkoopste)
    const claims = mine.filter(
      (b) =>
        b.provides.includes(PROVIDES.indexOf('claim')) &&
        !b.provides.includes(PROVIDES.indexOf('hq')),
    );
    expect(claims.map((b) => b.key)).toEqual(['plunderpost']);
    // het turret-equivalent heeft de wapenvelden die de sim van een turret eist, en geen netwerk
    const nest = building('mitrailleursnest');
    expect(nest.provides).toEqual([PROVIDES.indexOf('turret')]);
    expect(nest.damage).toBeGreaterThan(0);
    expect(nest.rangeU).toBeGreaterThan(0);
    expect(nest.cooldownTicks).toBeGreaterThan(0);
    expect(nest.network).toBeNull();
  });

  it('Kooi: aan de rand van de basis, met transitietijd en werkgebied; het kamp is zelf een Kooi', () => {
    const kooi = building('kooi');
    const camp = building('raiderkamp');
    expect(kooi.provides).toEqual([PROVIDES.indexOf('kooi')]);
    expect(kooi.cage).toEqual({
      capacity: 8,
      transitionTicks: secondsToTicks(20),
      workRadiusU: metersToUnits(45),
    });
    expect(camp.cage).not.toBeNull();
    expect(camp.provides).toContain(PROVIDES.indexOf('kooi'));
    // plaatsing: buiten het kamp zelf (halve breedtes plus een gang) en niet verder dan een bouwrange van de basis
    const minGap = (camp.footprint.w + kooi.footprint.w) / 2;
    expect(kooi.placement!.minFromHqU).toBeGreaterThan(metersToUnits(minGap));
    expect(kooi.placement!.maxFromHqU).toBeGreaterThan(kooi.placement!.minFromHqU);
    expect(kooi.placement!.maxFromHqU).toBeLessThanOrEqual(metersToUnits(40));
    expect(kooi.cage!.workRadiusU).toBeGreaterThanOrEqual(kooi.placement!.maxFromHqU);
    // alleen een gebouw met provides kooi heeft cage
    for (const b of mine)
      expect(b.cage !== null, b.key).toBe(b.provides.includes(PROVIDES.indexOf('kooi')));
  });

  it('balansintentie: goedkoper en zwakker dan de Dwellers (vroeg sterk, laat fragiel)', () => {
    const w = (key: string) => data.buildings.find((b) => b.key === key)!;
    expect(building('raiderkamp').hpI).toBeLessThan(w('hoofdgebouw').hpI);
    expect(building('raiderkamp').armorType).toBeLessThan(w('hoofdgebouw').armorType);
    expect(building('tent').buildTicks).toBeLessThan(w('woning').buildTicks);
    expect(building('tent').scrapCost).toBeLessThan(w('woning').scrapCost);
    expect(building('mitrailleursnest').hpI).toBeLessThan(w('turret').hpI);
    expect(building('mitrailleursnest').rangeU).toBeLessThan(w('turret').rangeU);
    expect(building('plunderpost').hpI).toBeLessThan(w('claimpaal').hpI);
    expect(building('plunderpost').scrapCost).toBeLessThan(w('claimpaal').scrapCost);
    // en de zwerm: per scrap meer man dan de Dwellers
    const raiderFighter = data.loadouts.find((l) => l.key === 'plunderaar')!;
    const dwellerFighter = data.loadouts.find((l) => l.key === 'militie')!;
    expect(raiderFighter.scrapCost).toBeLessThan(dwellerFighter.scrapCost);
    expect(raiderFighter.craftTicks).toBeLessThanOrEqual(dwellerFighter.craftTicks);
    // en nooit meer hp dan de beveiligingsrobot van de Dwellers: geen late tank
    const tank = data.loadouts.find((l) => l.key === 'beveiligingsrobot')!;
    for (const l of data.loadouts.filter((x) => x.factionId === faction.id))
      expect(l.hpI, l.key).toBeLessThan(tank.hpI / 2);
  });
});
