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
      'initiate_bouwer', 'initiate_wacht', 'initiate_zoeker', 'klerk', 'krachtpantser', 'plasmaridder', 'vertibird',
    ]);
    expect(data.tech.filter((t) => t.factionId === faction.id).length).toBe(4);
    expect(data.buildings.filter((b) => b.factionId === faction.id).length).toBe(7);
  });

  it('de Dwellers en Raiders blijven geladen', () => {
    expect(data.factions.map((f) => f.key).sort()).toEqual(['dwellers', 'garde', 'raiders']);
  });
});
