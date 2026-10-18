import { describe, it, expect } from 'vitest';
import { loadGameData, BODY_TYPES, PROVIDES, ROLES, CAPTURE_TARGETS } from './loader.js';
import { EffectStat } from './schemas.js';
import { raw, records } from './raiders.helpers.js';
import type { Rec } from './raiders.helpers.js';

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
    // data 0.31.0: win route C, the Bouwproject (data/project.json); no Raider change
    // data 0.30.0: the Kooi 5x5 (0.29.0: the guard rule, the Raider fighters back to strength, the weak low camp;
    // 0.28.0: the Raider garrison, 0.27.0: camp takeover)
    expect(data.dataVersion).toBe('0.32.0');
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
    // een Kooi met 8 slaven biedt minstens 3 m2 per slaaf (data 0.30.0: 5x5, ontwerp Martien; was 9x9 en 8 m2)
    const kooi = building('kooi');
    expect((kooi.footprint.w * kooi.footprint.h) / kooi.cage!.capacity).toBeGreaterThanOrEqual(3);
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
