import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadGameData, type RawGameData } from './loader.js';
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
    for (const list of [data.factions, data.loadouts, data.buildings, data.tech, data.heroes, data.perks, data.aiScripts]) {
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
      for (const v of [l.hpI, l.damage, l.rangeU, l.speedUPT, l.cooldownTicks, l.scrapCost, l.craftTicks, l.popCost]) expect(Number.isInteger(v)).toBe(true);
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
    expect(data.buildings[data.tech.find((t) => t.key === 'raffinage')!.buildingId]!.key).toBe('lab');
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
    const reversed = { ...r, loadouts: [...(r.loadouts as unknown[])].reverse(), buildings: [...(r.buildings as unknown[])].reverse() };
    expect(loadGameData(reversed)).toEqual(a);
  });
});
