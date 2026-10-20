import { describe, it, expect } from 'vitest';
import { loadGameData, BODY_TYPES, ARMOR_TYPES, PROVIDES } from './loader.js';
import { secondsToTicks } from './units.js';
import { raw } from './raiders.helpers.js';

// De Garde (data 0.37.0): de derde factie als data. De sim speelt haar nog niet; zie docs/garde.md.
describe('Garde: data laadt', () => {
  const data = loadGameData(raw());
  const faction = data.factions.find((f) => f.key === 'garde')!;
  const mine = data.loadouts.filter((l) => l.factionId === faction.id);
  const loadout = (key: string) => data.loadouts.find((l) => l.key === key)!;

  it('de factie bestaat met tech-kanaal en vangnet via de Bastion (provides tent)', () => {
    expect(faction).toBeDefined();
    expect(faction.specialChannel).toBe('tech');
    expect(faction.uniqueUnits.length).toBe(3);
    expect(faction.uniqueBuildings.length).toBe(3);
    const hq = data.buildings.find((b) => b.key === 'bastion')!;
    expect(hq.provides).toContain(PROVIDES.indexOf('hq'));
    expect(hq.provides).toContain(PROVIDES.indexOf('tent'));
    expect(faction.safetyNet.intervalTicks).toBe(secondsToTicks(90));
  });

  it('startunits bestaan en zijn van de Garde', () => {
    for (const s of faction.startUnits) {
      expect(data.loadouts[s.loadoutId]?.factionId).toBe(faction.id);
    }
  });

  it('krachtpantser: heavy, 3 pop, vehicle, traag; frames kosten meer dan de Raider-plunderaar', () => {
    const frame = loadout('krachtpantser');
    const plunderaar = loadout('plunderaar');
    expect(frame.armorType).toBe(ARMOR_TYPES.indexOf('heavy'));
    expect(frame.bodyType).toBe(BODY_TYPES.indexOf('vehicle'));
    expect(frame.popCost).toBe(3);
    expect(frame.speedUPT).toBeLessThan(plunderaar.speedUPT);
    expect(frame.scrapCost).toBeGreaterThan(plunderaar.scrapCost);
  });

  it('alle Garde-unieke units en gebouwen, techs en loadouts verwijzen naar bestaande data', () => {
    expect(mine.map((l) => l.key).sort()).toEqual([
      'initiate_bouwer',
      'initiate_wacht',
      'initiate_zoeker',
      'klerk',
      'krachtpantser',
      'plasmaridder',
      'vertibird',
    ]);
    expect(data.tech.filter((t) => t.factionId === faction.id).length).toBe(10);
    expect(data.buildings.filter((b) => b.factionId === faction.id).length).toBe(7);
  });

  it('de Dwellers en Raiders blijven geladen', () => {
    expect(data.factions.map((f) => f.key).sort()).toEqual(['dwellers', 'garde', 'raiders']);
  });
});

// Data 0.38.0 (sim 0.32.0, proposal for the architect): the fields the sim needs for the Garde round A.
describe('Garde: sim fields (data 0.38.0, proposal)', () => {
  const data = loadGameData(raw());
  const faction = data.factions.find((f) => f.key === 'garde')!;
  const key = (id: number) => data.loadouts[id]!.key;

  it('veterancy: the Initiate-wacht climbs to Ridder and Paladin, in permille', () => {
    const v = faction.veterancy!;
    expect(v.loadouts.map(key)).toEqual(['initiate_wacht']);
    expect(v.ranks.map((r) => [r.key, r.kills])).toEqual([
      ['ridder', 3],
      ['paladin', 8],
    ]);
    expect(v.ranks[0]!.hpPermille).toBe(250);
    expect(data.factions.find((f) => f.key === 'dwellers')!.veterancy).toBeNull();
  });

  it('fusion cores: the smederij crafts them after fusiekernen; every frame takes one', () => {
    const fc = faction.fusionCores!;
    expect(data.buildings[fc.buildingId]!.key).toBe('smederij');
    expect(fc.craftTicks).toBe(secondsToTicks(20));
    expect(fc.prereqTech.map((t) => data.tech[t]!.key)).toEqual(['fusiekernen']);
    const cores = (k: string) => data.loadouts.find((l) => l.key === k)!.fusionCores;
    expect([cores('krachtpantser'), cores('plasmaridder'), cores('initiate_wacht')]).toEqual([
      1, 1, 0,
    ]);
  });

  it('the Paladin-Commander sorts after the Warlord, with the armour aura (damageTakenPct)', () => {
    expect(data.heroes.map((h) => h.key)).toEqual(['opziener', 'warlord', 'zwaardridder']);
    const h = data.heroes[2]!;
    expect(h.factionId).toBe(faction.id);
    expect(h.naam).toBe('Paladin-Commander');
    expect(key(h.baseLoadoutId)).toBe('krachtpantser');
    expect(h.aura!.effects[0]!.stat).toBe('damageTakenPct');
  });

  it('garde-basic: a raid plan without harass and slave raids, with free workers', () => {
    const a = data.aiScripts.find((s) => s.key === 'garde-basic')!;
    expect(a.factionId).toBe(faction.id);
    expect(a.raidPlan!.harass).toBeNull();
    expect(a.raidPlan!.slaveRaids).toBeNull();
    expect(a.raidPlan!.workers).toEqual({ scavengers: 12 });
    expect(a.raidPlan!.mixInOrder).toBe(true);
    const raiders = data.aiScripts.find((s) => s.key === 'raiders-basic')!;
    expect(raiders.raidPlan!.workers).toBeNull();
    expect(raiders.raidPlan!.mixInOrder).toBe(false);
  });

  it('rejects ranks without ascending kills and an unknown core building', () => {
    const bad = (edit: (f: Record<string, unknown>) => void) => {
      const r = raw();
      const f = (r.factions as Record<string, unknown>[]).find((x) => x.id === 'garde')!;
      edit(f);
      return () => loadGameData(r);
    };
    expect(
      bad((f) => {
        (f.veterancy as { ranks: { kills: number }[] }).ranks[1]!.kills = 3;
      }),
    ).toThrow(/ascending/);
    expect(
      bad((f) => {
        (f.fusionCores as { building: string }).building = 'bestaat_niet';
      }),
    ).toThrow(/bestaat_niet/);
  });
});
