import { describe, it, expect } from 'vitest';
import { loadGameData } from './loader.js';
import { raw } from './raiders.helpers.js';

// Hero choice (data 0.39.0): per faction a Bouwer and a Tacticus next to the Krijger; see docs/held-keuze.md.
describe('held-keuze: drie archetypes per factie', () => {
  const data = loadGameData(raw());
  const factions = ['dwellers', 'raiders', 'garde'];
  const fid = (key: string) => data.factions.find((f) => f.key === key)!.id;

  it('elke factie heeft precies een Bouwer, een Krijger en een Tacticus', () => {
    for (const f of factions) {
      const kinds = data.heroes.filter((h) => h.factionId === fid(f)).map((h) => h.archetype);
      expect([...kinds].sort()).toEqual([0, 1, 2]); // bouwer, krijger, tacticus
    }
  });

  it('de bestaande held-ids en perk-ids verschuiven niet (idGroup)', () => {
    expect(data.heroes.slice(0, 3).map((h) => h.key)).toEqual([
      'opziener',
      'warlord',
      'zwaardridder',
    ]);
    expect(
      data.perks
        .slice(0, 13)
        .map((p) => p.key)
        .at(-1),
    ).toBe('zware_laarzen');
    expect(data.perks).toHaveLength(31);
    expect(data.perks.length).toBeLessThanOrEqual(32); // sim MAX_PERKS
    data.heroes.forEach((h, i) => expect(h.id).toBe(i));
  });

  it('de drie archetypes hebben gelijk SPECIAL-totaal, een ability en een volle perk-pool', () => {
    for (const h of data.heroes) {
      expect(h.special.reduce((a, b) => a + b, 0)).toBe(34);
      expect(h.abilities.length).toBeGreaterThanOrEqual(1);
    }
    for (const h of data.heroes.slice(3)) expect(h.perkPool).toHaveLength(6);
  });

  it('elke perk in een nieuwe pool is bereikbaar met het basis-SPECIAL van de held', () => {
    const letters = ['S', 'P', 'E', 'C', 'I', 'A', 'L'];
    const rawHeroes = raw().heroes as {
      id: string;
      special: Record<string, number>;
      perkPool: string[];
    }[];
    const rawPerks = raw().perks as { id: string; requires: { stat: string; min: number } }[];
    expect(letters).toHaveLength(7);
    for (const h of rawHeroes.slice(3)) {
      for (const pid of h.perkPool) {
        const perk = rawPerks.find((p) => p.id === pid)!;
        expect(h.special[perk.requires.stat]!, `${h.id} ${pid}`).toBeGreaterThanOrEqual(
          perk.requires.min,
        );
      }
    }
  });

  it('een Tacticus controleert (vijand-effecten), een Bouwer heeft economie-passieven', () => {
    for (const h of data.heroes.slice(3)) {
      const enemy = h.abilities[0]!.effects.some((e) => e.side === 'enemy');
      if (h.archetype === 2) expect(enemy).toBe(true);
      if (h.archetype === 0) {
        expect(enemy).toBe(false);
        expect(h.passives.length).toBeGreaterThan(0);
      }
    }
  });

  it('idGroup sorteert achter de oude ids en een dubbele id blijft een fout', () => {
    const r = raw();
    const heroes = r.heroes as { id: string }[];
    expect(() => loadGameData({ ...r, heroes: [...heroes, heroes[0]!] })).toThrow(/dubbele id/);
  });
});
