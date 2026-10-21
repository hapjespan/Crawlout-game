import { describe, it, expect } from 'vitest';
import { loadGameData, REPAIR_TARGETS } from './loader.js';
import { metersToUnits, secondsToTicks } from './units.js';
import { raw } from './raiders.helpers.js';

// Data 0.39.0 (sim 0.33.0, the Garde round B; proposal for the architect): Klerk, map power armour, Vertibird, techs.
describe('Garde: sim fields round B (data 0.39.0, proposal)', () => {
  const data = loadGameData(raw());
  const faction = data.factions.find((f) => f.key === 'garde')!;
  const loadout = (k: string) => data.loadouts.find((l) => l.key === k)!;
  const key = (id: number) => data.loadouts[id]!.key;

  it('techs: the 6 new Garde techs (idGroup 1) follow the 32 older ones, whose ids stay', () => {
    const keys = data.tech.map((t) => t.key);
    expect(keys.slice(32)).toEqual([
      'bergingsdienst',
      'drilboek',
      'klerkenschool',
      'laserkunde',
      'servo_kalibratie',
      'vertibird_programma',
    ]);
    // the techIds the recorded replays use (data 0.37.0 order)
    expect(keys.indexOf('fusiekernen')).toBe(5);
    expect(keys.indexOf('robotica')).toBe(19);
    expect(keys.indexOf('zuivere_stoffen')).toBe(31);
    for (const t of data.tech.slice(32)) expect(t.factionId).toBe(faction.id);
  });

  it('klerk: repairs vehicles and buildings and overloads the frames', () => {
    const k = loadout('klerk');
    expect(k.repair!.targets.map((t) => REPAIR_TARGETS[t])).toEqual(['vehicle', 'building']);
    expect(k.overload!.targets.map(key)).toEqual(['krachtpantser', 'plasmaridder']);
    expect(k.overload!.stunTicks).toBe(secondsToTicks(3));
    expect(loadout('initiate_wacht').overload).toBeNull();
  });

  it('vertibird: flies and carries 4', () => {
    const v = loadout('vertibird');
    expect(v.flying).toBe(true);
    expect(v.transport).toEqual({ capacity: 4, loadRangeU: metersToUnits(3) });
    expect(loadout('krachtpantser').flying).toBe(false);
  });

  it('map power armour: a krachtpantser at 2/3 for the others', () => {
    const m = faction.mapPowerArmor!;
    expect(key(m.loadoutId)).toBe('krachtpantser');
    expect(m.otherQualityPermille).toBe(670);
    expect(data.factions.find((f) => f.key === 'dwellers')!.mapPowerArmor).toBeNull();
  });

  it('rejects repair on a militia, a transport over 8 and an unknown overload target', () => {
    const bad = (k: string, edit: (l: Record<string, unknown>) => void) => {
      const r = raw();
      edit((r.loadouts as Record<string, unknown>[]).find((x) => x.id === k)!);
      return () => loadGameData(r);
    };
    const repair = { repairRateHpPerS: 1, rangeM: 1, seekRangeM: 1, targets: ['vehicle'] };
    expect(bad('initiate_wacht', (l) => (l.repair = repair))).toThrow(/technician/);
    expect(bad('vertibird', (l) => (l.transport = { capacity: 9, loadRangeM: 3 }))).toThrow();
    expect(
      bad('klerk', (l) => (l.overload = { targets: ['bestaat_niet'], stunS: 1, cooldownS: 1 })),
    ).toThrow(/bestaat_niet/);
  });
});
