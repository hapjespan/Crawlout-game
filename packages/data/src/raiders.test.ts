import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ARMOR_TYPES,
  BODY_TYPES,
  CAPTURE_TARGETS,
  PROVIDES,
  ROLES,
  STATS,
  loadGameData,
  type RawGameData,
} from './loader.js';
import { EffectStat } from './schemas.js';
import { readDataDir } from './node.js';
import { metersToUnits, secondsToTicks } from './units.js';

// Raiders (data 0.21.0; bevestigd in fase-0 sectie 23 besluit 2): de tweede factie als data, schema en loader.
// De sim speelt de Raiders nog niet; deze tests leggen vast dat de data klopt en wat de sim straks mag aannemen.

const dataDir = fileURLToPath(new URL('../../../data', import.meta.url));
const raw = (): RawGameData => readDataDir(dataDir);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
type Rec = Record<string, unknown>;
const records = (r: RawGameData, key: 'loadouts' | 'buildings' | 'factions' | 'heroes' | 'tech') =>
  r[key] as Rec[];

// Een vaste bovengrens van de sim (packages/sim config.ts MAX_FOOTPRINT, MAX_TECHS, MAX_PERKS, MAX_SPEED)
const MAX_FOOTPRINT = 32;
const MAX_SPEED_MPS = 10; // MAX_SPEED = 0,5 m per tick = 10 m/s

describe('Raiders: de factie laadt', () => {
  const rawData = raw();
  const data = loadGameData(rawData);
  const faction = data.factions.find((f) => f.key === 'raiders')!;
  const dwellers = data.factions.find((f) => f.key === 'dwellers')!;
  const loadout = (key: string) => data.loadouts.find((l) => l.key === key)!;
  const building = (key: string) => data.buildings.find((b) => b.key === key)!;
  const techKey = (id: number): string => data.tech[id]!.key;
  const mine = <T extends { factionId: number }>(list: T[]): T[] =>
    list.filter((r) => r.factionId === faction.id);

  it('heeft factie raiders met chems als SPECIAL-kanaal en de Raider-lichamen', () => {
    expect(faction.naam).toBe('Raiders (De Horde)');
    expect(faction.specialChannel).toBe('chems');
    expect(faction.bodyTypes).toEqual(
      ['human', 'beast', 'vehicle'].map((b) => BODY_TYPES.indexOf(b as 'human')),
    );
    expect(faction.robotRules).toBeNull();
    expect(faction.housingGrowthPerMin).toBe(0);
    expect(data.dataVersion).toBe('0.28.0'); // data 0.28.0: the Raider garrison (0.27.0: camp takeover)
    // Dwellers ongewijzigd: nog altijd training en geen Raider-blokken
    expect(dwellers.specialChannel).toBe('training');
    expect(dwellers.slaves).toBeNull();
    expect(dwellers.plunder).toBeNull();
    expect(dwellers.tribute).toBeNull();
    expect(dwellers.chems).toEqual([]);
  });

  it('nieuwe enum-waarden staan achteraan zodat bestaande indices gelijk blijven', () => {
    expect(BODY_TYPES.slice(0, 2)).toEqual(['human', 'robot']);
    expect(BODY_TYPES.slice(2)).toEqual(['beast', 'vehicle']);
    expect(PROVIDES.slice(8)).toEqual(['tent', 'kooi', 'depot', 'chemlab']);
    expect(PROVIDES.length).toBeLessThanOrEqual(16); // het bitmasker van de sim
    expect(ROLES).toEqual(['scavenger', 'builder', 'militia', 'technician', 'robot']); // geen nieuwe rol nodig
    expect(CAPTURE_TARGETS).toEqual(['wanderer', 'resident']);
  });

  it('elke referentie lost op en blijft binnen de factie (units, gebouwen, techs, held, AI)', () => {
    const own = new Set(mine(data.loadouts).map((l) => l.id));
    for (const u of faction.uniqueUnits)
      expect(own.has(u), `uniek ${data.loadouts[u]!.key}`).toBe(true);
    const ownBuildings = new Set(mine(data.buildings).map((b) => b.id));
    for (const b of faction.uniqueBuildings) expect(ownBuildings.has(b)).toBe(true);
    for (const s of faction.startUnits) expect(own.has(s.loadoutId)).toBe(true);
    expect(own.has(faction.safetyNet.loadoutId)).toBe(true);
    const ownTech = new Set(mine(data.tech).map((t) => t.id));
    for (const l of mine(data.loadouts)) {
      for (const t of l.prereqTech) expect(ownTech.has(t), `${l.key} -> ${techKey(t)}`).toBe(true);
      if (l.producedAt >= 0) expect(ownBuildings.has(l.producedAt), l.key).toBe(true);
    }
    for (const b of mine(data.buildings))
      for (const t of b.prereqTech) expect(ownTech.has(t), b.key).toBe(true);
    for (const t of mine(data.tech)) {
      expect(ownBuildings.has(t.buildingId), t.key).toBe(true);
      for (const p of t.prereqTech) expect(ownTech.has(p), t.key).toBe(true);
    }
    const hero = mine(data.heroes)[0]!;
    expect(hero.baseLoadoutId).toBe(loadout('warlord_basis').id);
    expect(own.has(hero.baseLoadoutId)).toBe(true);
    const ai = mine(data.aiScripts)[0]!;
    for (const b of ai.buildOrder) expect(ownBuildings.has(b.buildingId)).toBe(true);
    for (const b of ai.richBuilds) expect(ownBuildings.has(b.buildingId)).toBe(true);
    for (const t of ai.research) expect(ownTech.has(t)).toBe(true);
    for (const l of ai.armyLoadouts) expect(own.has(l)).toBe(true);
    expect(ownBuildings.has(ai.housingBuildingId)).toBe(true);
  });

  it('kosten zijn groter dan 0, behalve de gratis slaven, het held-sjabloon en het startgebouw', () => {
    const free = new Set(['slaaf', 'slaaf_bouwer', 'warlord_basis']);
    for (const l of mine(data.loadouts)) {
      if (!free.has(l.key)) {
        expect(l.scrapCost, l.key).toBeGreaterThan(0);
        expect(l.craftTicks, l.key).toBeGreaterThan(0);
      } else {
        expect(l.scrapCost, l.key).toBe(0);
      }
      expect(l.hpI, l.key).toBeGreaterThan(0);
      expect(l.popCost, l.key).toBeGreaterThan(0);
      expect(l.speedUPT, l.key).toBeGreaterThan(0);
      expect(l.speedUPT, l.key).toBeLessThanOrEqual(
        Math.trunc((MAX_SPEED_MPS * 256) / 20) /* eenheden per tick */,
      );
    }
    for (const b of mine(data.buildings)) {
      expect(b.hpI, b.key).toBeGreaterThan(0);
      if (b.key === 'raiderkamp') {
        expect(b.scrapCost).toBe(0);
        expect(b.buildTicks).toBe(0);
      } else {
        expect(b.scrapCost, b.key).toBeGreaterThan(0);
        expect(b.buildTicks, b.key).toBeGreaterThan(0);
      }
    }
    for (const t of mine(data.tech)) {
      expect(t.scrapCost, t.key).toBeGreaterThan(0);
      expect(t.researchTicks, t.key).toBeGreaterThan(0);
    }
    for (const c of faction.chems) expect(c.doseScrap, c.key).toBeGreaterThan(0);
    expect(faction.startScrap).toBeGreaterThan(0);
  });

  it('footprints zijn oneven, binnen de sim-grens en op echte schaal (karakters van 1,8 m)', () => {
    for (const b of mine(data.buildings)) {
      const { w, h } = b.footprint;
      expect(w % 2, `${b.key} w`).toBe(1);
      expect(h % 2, `${b.key} h`).toBe(1);
      expect(Math.max(w, h), b.key).toBeLessThanOrEqual(MAX_FOOTPRINT);
      // een gebouw waar karakters bij kunnen (deur 2,1 m): niet kleiner dan 3 x 3, behalve de claimpost
      expect(Math.min(w, h), b.key).toBeGreaterThanOrEqual(3);
    }
    // het kamp is groter dan een tent en kleiner dan het bronhuis van de Dwellers; een tent biedt minstens 7 m2 per bed
    const camp = building('raiderkamp').footprint;
    const dwellerHq = building('hoofdgebouw').footprint;
    expect(camp.w * camp.h).toBeLessThan(dwellerHq.w * dwellerHq.h);
    expect(camp.w).toBeGreaterThanOrEqual(15);
    const tent = building('tent');
    expect((tent.footprint.w * tent.footprint.h) / tent.beds).toBeGreaterThanOrEqual(7);
    // het turret-equivalent is groter dan de turret van de Dwellers (zandzakken eromheen), de claimpost niet
    expect(building('mitrailleursnest').footprint.w).toBeGreaterThan(
      building('turret').footprint.w,
    );
    // een Kooi met 8 slaven biedt minstens 8 m2 per slaaf
    const kooi = building('kooi');
    expect((kooi.footprint.w * kooi.footprint.h) / kooi.cage!.capacity).toBeGreaterThanOrEqual(8);
  });

  it('elk Raider-record heeft een _comment, een zichtstraal en manifest-ids raider_*', () => {
    for (const key of ['loadouts', 'buildings', 'tech', 'heroes', 'factions'] as const) {
      for (const r of records(rawData, key).filter(
        (x) => x.faction === 'raiders' || x.id === 'raiders',
      )) {
        expect(typeof r._comment, `${key} ${String(r.id)}`).toBe('string');
        expect((r._comment as string).length, `${key} ${String(r.id)}`).toBeGreaterThan(40);
      }
    }
    for (const r of records(rawData, 'loadouts').filter((x) => x.faction === 'raiders')) {
      expect(typeof r.sightM, String(r.id)).toBe('number');
      expect(r.sightM as number, String(r.id)).toBeGreaterThan(0);
      for (const manifest of Object.values((r.visuals as { meshSlots: Rec }).meshSlots))
        expect(manifest, String(r.id)).toMatch(/^raider_/);
    }
    for (const r of records(rawData, 'buildings').filter((x) => x.faction === 'raiders')) {
      expect(typeof r.sightM, String(r.id)).toBe('number');
      expect(r.sightM as number, String(r.id)).toBeGreaterThan(0);
      expect((r.visuals as { mesh: string }).mesh, String(r.id)).toMatch(/^raider_building_/);
    }
    const hero = records(rawData, 'heroes').find((h) => h.faction === 'raiders')!;
    expect(hero.naam).toBe('Warlord');
  });

  it('tech: 12 tot 15 Raider-techs, alle ketens bouwbaar, chems en molotovs, honden en buggy erbij', () => {
    const techs = mine(data.tech);
    expect(techs.length).toBeGreaterThanOrEqual(12);
    expect(techs.length).toBeLessThanOrEqual(15);
    expect(data.tech.length).toBeLessThanOrEqual(32); // sim MAX_TECHS
    const keys = techs.map((t) => t.key);
    for (const k of ['chemie', 'psycho', 'jet', 'molotovs', 'honden_africhten', 'buggy_chassis'])
      expect(keys, k).toContain(k);
    const hqIndex = PROVIDES.indexOf('hq');
    const buildable = (b: number, seen = new Set<number>()): boolean => {
      const bd = data.buildings[b]!;
      if (bd.provides.includes(hqIndex) || seen.has(b)) return false;
      seen.add(b);
      return bd.prereqTech.every((t) => buildable(data.tech[t]!.buildingId, seen));
    };
    for (const t of techs) {
      expect(buildable(t.buildingId), t.key).toBe(true);
      for (const e of t.effects) expect(EffectStat.options, t.key).toContain(e.stat);
    }
    for (const l of mine(data.loadouts))
      for (const p of l.prereqTech) expect(buildable(data.tech[p]!.buildingId), l.key).toBe(true);
    for (const b of mine(data.buildings))
      for (const p of b.prereqTech) expect(buildable(data.tech[p]!.buildingId), b.key).toBe(true);
    // geen cirkel in de keten (elke tech heeft een lagere diepte dan zijn opvolgers)
    const depth = (id: number, seen = new Set<number>()): number => {
      expect(seen.has(id), `cirkel bij ${techKey(id)}`).toBe(false);
      seen.add(id);
      const t = data.tech[id]!;
      return 1 + Math.max(0, ...t.prereqTech.map((p) => depth(p, new Set(seen))));
    };
    for (const t of techs) expect(depth(t.id)).toBeLessThanOrEqual(4);
  });

  it('elk effect-doel van de Raider-techs, perks, held, chems en aura bestaat en gebruikt een bekende stat', () => {
    const known = new Set([
      'alle',
      'held',
      ...data.loadouts.map((l) => l.key),
      ...data.buildings.map((b) => b.key),
    ]);
    const chemEffects = faction.chems.flatMap((c) => [...c.effects, ...c.crash]);
    const all = [
      ...mine(data.tech).flatMap((t) => t.effects),
      ...mine(data.heroes).flatMap((h) => h.passives),
      ...chemEffects,
    ];
    for (const e of all) {
      expect(known.has(e.target), `${e.stat} -> ${e.target}`).toBe(true);
      expect(EffectStat.options).toContain(e.stat);
    }
    const hero = mine(data.heroes)[0]!;
    for (const id of hero.perkPool)
      for (const e of data.perks[id]!.effects)
        expect(known.has(e.target), `${data.perks[id]!.key} -> ${e.target}`).toBe(true);
    // een ability en de aura gebruiken alleen stats die de sim voor een zone kan toepassen (fromData AURA_STATS)
    for (const e of [...hero.abilities.flatMap((a) => a.effects), ...hero.aura!.effects])
      expect(['speedPct', 'damagePct']).toContain(e.stat);
  });
});

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

describe('Raiders: slavenregels, buit, tribute en chems', () => {
  const data = loadGameData(raw());
  const faction = data.factions.find((f) => f.key === 'raiders')!;
  const techKey = (id: number): string => data.tech[id]!.key;

  it('slavenregels: roven buiten de basisradius, bevrijding na 3 s, opstand bij te weinig garnizoen', () => {
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
    expect(s.revolt).toEqual({
      garrisonRadiusU: metersToUnits(30),
      slavesPerGuard: 3,
      minGuards: 1,
      graceTicks: secondsToTicks(40),
      emptyGraceTicks: secondsToTicks(15),
      escapePermille: 500,
      repeatTicks: secondsToTicks(25),
    });
    expect(s.revolt.emptyGraceTicks).toBeLessThan(s.revolt.graceTicks);
    // het garnizoen staat binnen de werkstraal van een Kooi: wie slaven beschermt, beschermt hun werk
    const kooi = data.buildings.find((b) => b.key === 'kooi')!;
    expect(s.revolt.garrisonRadiusU).toBeLessThanOrEqual(kooi.cage!.workRadiusU);
    // genoeg slaven op een Kooi om het garnizoen te laten tellen: capaciteit gedeeld door slavesPerGuard
    expect(Math.ceil(kooi.cage!.capacity / s.revolt.slavesPerGuard)).toBeGreaterThanOrEqual(
      s.revolt.minGuards,
    );
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
    expect(loadoutIds.has(plan.harass.loadoutId)).toBe(true);
    expect(loadoutIds.has(plan.slaveRaids.slaverLoadoutId)).toBe(true);
    expect(data.loadouts[plan.harass.loadoutId]!.key).toBe('buggy');
    expect(data.loadouts[plan.slaveRaids.slaverLoadoutId]!.key).toBe('slaver');
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
    expect(garageAt).toBeLessThanOrEqual(ai.raidPlan!.harass.fromTicks);
    // data 0.27.0 (gemeten, voorstel): eerst de kampen overnemen (vanaf minuut 1), dan de slavenroof (minuut 6, na de
    // eerste golf: een vroege roof zonder de kampen langs de weg ving tot 578 slaven in 66 potjes en won 80 procent);
    // dominantie-push na de eerste golf
    expect(ai.creeps!.fromTicks).toBeLessThan(ai.attackTimersTicks[0]!);
    expect(ai.raidPlan!.slaveRaids.fromTicks).toBeGreaterThan(ai.creeps!.fromTicks);
    expect(ai.raidPlan!.dominancePush.fromTicks).toBeGreaterThan(ai.attackTimersTicks[0]!);
    // data 0.24.0 (sim 0.19.0, gemeten): dominantie is de route, het kamp bij de claimpunten komt ruim voor de push
    expect(ai.raidPlan!.dominancePush.fromTicks).toBeLessThan(ai.pushFromTicks);
  });

  it('houdt een garnizoen thuis (anders opstand): minstens het benodigde minimum van de slavenregels', () => {
    const revolt = raiders.slaves!.revolt;
    expect(ai.raidPlan!.garrison.minFighters).toBeGreaterThanOrEqual(revolt.minGuards);
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

describe('Raiders: schema weigert ongeldige data', () => {
  const rec = (r: RawGameData, key: 'loadouts' | 'buildings' | 'factions' | 'heroes', id: string) =>
    records(r, key).find((x) => x.id === id)!;

  it('ai (data 0.24.0): hoogstens één script per factie en tegenstander, versus is een bestaande factie', () => {
    const vs = (r: RawGameData): Rec =>
      (r.ai as Rec[]).find((a) => a.id === 'dwellers-vs-raiders')!;
    const twice = clone(raw());
    twice.ai.push({ ...vs(twice), id: 'dwellers-vs-raiders-2' });
    expect(() => loadGameData(twice)).toThrow(/one script per faction and versus/);
    const unknown = clone(raw());
    vs(unknown).versus = 'garde';
    expect(() => loadGameData(unknown)).toThrow(/onbekende factie 'garde'/);
    const bad = clone(raw());
    vs(bad).liberate = { minFree: 0, units: 3, radiusM: 70 };
    expect(() => loadGameData(bad)).toThrow(/minFree/);
  });

  it('slaaf: vecht niet, is een arbeider en wordt niet gebouwd', () => {
    const fights = clone(raw());
    rec(fights, 'loadouts', 'slaaf').damage = 3;
    expect(() => loadGameData(fights)).toThrow(/damage/);
    const militia = clone(raw());
    rec(militia, 'loadouts', 'slaaf').role = 'militia';
    expect(() => loadGameData(militia)).toThrow(/role/);
    const built = clone(raw());
    rec(built, 'loadouts', 'slaaf').producedAt = 'tent';
    expect(() => loadGameData(built)).toThrow(/producedAt/);
    const slaverSlave = clone(raw());
    rec(slaverSlave, 'loadouts', 'slaaf').capture = {
      rangeM: 1,
      captureS: 1,
      targets: ['wanderer'],
      maxHpPct: 10,
    };
    expect(() => loadGameData(slaverSlave)).toThrow(/slave|capture/);
  });

  it('Kooi: cage hoort bij provides kooi en andersom; placement heeft min onder max', () => {
    const noCage = clone(raw());
    delete rec(noCage, 'buildings', 'kooi').cage;
    expect(() => loadGameData(noCage)).toThrow(/cage/);
    const strayCage = clone(raw());
    rec(strayCage, 'buildings', 'tent').cage = { capacity: 1, transitionS: 1, workRadiusM: 1 };
    expect(() => loadGameData(strayCage)).toThrow(/cage/);
    const badPlacement = clone(raw());
    rec(badPlacement, 'buildings', 'kooi').placement = { minFromHqM: 30, maxFromHqM: 10 };
    expect(() => loadGameData(badPlacement)).toThrow(/maxFromHqM/);
  });

  it('chems: verplicht bij het kanaal chems, onbekende tech, chem of doel worden geweigerd', () => {
    const none = clone(raw());
    delete rec(none, 'factions', 'raiders').chems;
    expect(() => loadGameData(none)).toThrow(/chems/);
    const stray = clone(raw());
    rec(stray, 'factions', 'dwellers').chems = (
      rec(raw(), 'factions', 'raiders').chems as unknown[]
    ).slice();
    expect(() => loadGameData(stray)).toThrow(/chems/);
    const badTech = clone(raw());
    ((rec(badTech, 'factions', 'raiders').chems as Rec[])[0] as Rec).requiresTech = 'bestaat_niet';
    expect(() => loadGameData(badTech)).toThrow(/bestaat_niet/);
    const badDealer = clone(raw());
    (rec(badDealer, 'loadouts', 'chemdealer').aura as Rec).chems = ['heroine'];
    expect(() => loadGameData(badDealer)).toThrow(/heroine/);
    const noCrash = clone(raw());
    ((rec(noCrash, 'factions', 'raiders').chems as Rec[])[0] as Rec).crash = [];
    expect(() => loadGameData(noCrash)).toThrow(/crash/);
  });

  it('vangnet, buit, tribute en slavenregels: verplichte velden en bonus-paren', () => {
    for (const field of ['intervalS', 'maxArrivals', 'loadoutId']) {
      const r = clone(raw());
      delete (rec(r, 'factions', 'raiders').safetyNet as Rec)[field];
      expect(() => loadGameData(r), field).toThrow(field);
    }
    const lonelyBonus = clone(raw());
    delete (rec(lonelyBonus, 'factions', 'raiders').plunder as Rec).bonusPct;
    expect(() => loadGameData(lonelyBonus)).toThrow(/bonusPct/);
    const lonelyTribute = clone(raw());
    delete (rec(lonelyTribute, 'factions', 'raiders').tribute as Rec).bonusTech;
    expect(() => loadGameData(lonelyTribute)).toThrow(/bonusPct|bonusTech/);
    const unknownCaptured = clone(raw());
    (rec(unknownCaptured, 'factions', 'raiders').slaves as Rec).capturedLoadoutId = 'spook';
    expect(() => loadGameData(unknownCaptured)).toThrow(/spook/);
    const overPct = clone(raw());
    ((rec(overPct, 'factions', 'raiders').slaves as Rec).revolt as Rec as Rec).escapePct = 150;
    expect(() => loadGameData(overPct)).toThrow(/escapePct/);
    const unknownField = clone(raw());
    (rec(unknownField, 'factions', 'raiders').slaves as Rec).onbekend = 1;
    expect(() => loadGameData(unknownField)).toThrow(/slaves|onbekend|Unrecognized/i);
  });

  it('held en AI: onbekend basis-loadout of roof-loadout wordt geweigerd', () => {
    const badBase = clone(raw());
    rec(badBase, 'heroes', 'warlord').baseLoadoutId = 'bestaat_niet';
    expect(() => loadGameData(badBase)).toThrow(/bestaat_niet/);
    const emptyAura = clone(raw());
    (rec(emptyAura, 'heroes', 'warlord').aura as Rec).effects = [];
    expect(() => loadGameData(emptyAura)).toThrow(/effects/);
    const badPlan = clone(raw());
    const ai = (badPlan.ai as Rec[]).find((a) => a.id === 'raiders-basic')!;
    ((ai.raidPlan as Rec).harass as Rec).loadoutId = 'raketman';
    expect(() => loadGameData(badPlan)).toThrow(/raketman/);
    const noSlaverPlan = clone(raw());
    const ai2 = (noSlaverPlan.ai as Rec[]).find((a) => a.id === 'raiders-basic')!;
    delete (ai2.raidPlan as Rec).garrison;
    expect(() => loadGameData(noSlaverPlan)).toThrow(/garrison/);
  });

  it('de loader blijft deterministisch en omgekeerde invoervolgorde geeft gelijke uitvoer', () => {
    const a = loadGameData(raw());
    const r = raw();
    const b = loadGameData({
      ...r,
      factions: [...(r.factions as unknown[])].reverse(),
      loadouts: [...(r.loadouts as unknown[])].reverse(),
      buildings: [...(r.buildings as unknown[])].reverse(),
      tech: [...(r.tech as unknown[])].reverse(),
      heroes: [...(r.heroes as unknown[])].reverse(),
      perks: [...(r.perks as unknown[])].reverse(),
      ai: [...r.ai].reverse(),
    });
    expect(b).toEqual(a);
  });
});
