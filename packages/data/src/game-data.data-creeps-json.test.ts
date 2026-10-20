// Split from game-data.test.ts to stay under the 5,000-token file limit.
import { describe, it, expect } from 'vitest';
import { loadGameData, type RawGameData, NEUTRAL_FACTION_ID, ROLES } from './loader.js';
import { metersToUnits, secondsToTicks } from './units.js';
import { raw } from './game-data.helpers.js';

// Creep camps (data 0.25.0; bevestigd in fase-0 sectie 23 besluit 5): data/creeps.json and ai/*.json creeps.
describe('data/creeps.json', () => {
  const data = loadGameData(raw());
  const creepsOf = (r: RawGameData) =>
    r.creeps as {
      units: { id: string; hp: number }[];
      tiers: {
        tier: number;
        units: { unitId: string }[];
        aggroRadiusM: number;
        leashRadiusM: number;
      }[];
      takeover?: unknown[];
    };

  it('appends the bandits after the faction loadouts, neutral, as militia without cost', () => {
    const bandits = data.loadouts.filter(
      (l) => l.factionId === NEUTRAL_FACTION_ID && !l.key.startsWith('survival_'),
    );
    expect(bandits.map((l) => l.key)).toEqual([
      'bandiet_dief',
      'bandiet_vechtjas',
      'bandiet_schutter',
      'bandiet_knokker',
      'bandiet_baas',
    ]);
    const first = data.loadouts.findIndex((l) => l.key === bandits[0]!.key);
    bandits.forEach((l, k) => {
      expect(l.id).toBe(first + k);
      expect(l.role).toBe(ROLES.indexOf('militia'));
      expect(l.scrapCost).toBe(0);
      expect(l.producedAt).toBe(-1);
    });
    expect(data.creeps.units).toEqual(bandits.map((l) => l.id));
    expect(data.creeps.names).toEqual([
      'Kruimeldief',
      'Vechtjas',
      'Schutter',
      'Knokker',
      'Bandietenbaas',
    ]);
  });

  it('converts the tiers to sim units, one entry per bandit, ascending tier', () => {
    expect(data.creeps.tiers.map((t) => t.tier)).toEqual([1, 2]);
    const low = data.creeps.tiers[0]!;
    const high = data.creeps.tiers[1]!;
    expect(low.units.length).toBeGreaterThan(0);
    expect(high.units.length).toBeGreaterThan(low.units.length);
    expect(low.aggroRadiusU).toBe(metersToUnits(6));
    expect(low.leashRadiusU).toBe(metersToUnits(14));
    expect(low.respawnTicks).toBe(0);
    expect(high.lootScrap).toBeGreaterThan(low.lootScrap);
    for (const t of data.creeps.tiers)
      for (const id of t.units) expect(data.loadouts[id]!.factionId).toBe(NEUTRAL_FACTION_ID);
  });

  it('the Dwellers clear camps from minute 10, the Raiders take them over from minute 1; the Dwellers against Raiders do not', () => {
    const raiders = data.factions.findIndex((f) => f.key === 'raiders');
    for (const a of data.aiScripts) {
      if (a.versusFactionId >= 0) {
        // ai/dwellers-vs-raiders.json: no camp runs (measured: with them the Raiders won none of 66)
        expect(a.creeps).toBeNull();
        continue;
      }
      expect(a.creeps).not.toBeNull();
      // data 0.27.0 (voorstel): the Raider AI takes its camps over from the start (data/creeps.json takeover)
      expect(a.creeps!.fromTicks).toBe(secondsToTicks(a.factionId === raiders ? 60 : 600));
      expect(a.creeps!.tiers.map((t) => t.tier)).toEqual([1, 2]);
    }
  });

  it('takeover (data 0.27.0): the Raiders take both tiers over, in sim units; a bad rule fails to load', () => {
    const raiders = data.factions.findIndex((f) => f.key === 'raiders');
    expect(data.creeps.takeover.map((r) => r.factionId)).toEqual([raiders]);
    const t = data.creeps.takeover[0]!.tiers;
    expect(t.map((x) => x.tier)).toEqual([1, 2]);
    for (const x of t) {
      expect(x.surrenderPermille).toBeGreaterThan(0);
      expect(x.surrenderPermille).toBeLessThan(1000);
      expect(x.minUnits).toBeGreaterThanOrEqual(1);
    }
    expect(t[0]!.yieldTicks).toBe(secondsToTicks(240));
    expect(t[0]!.surrenderPermille).toBe(300);
    const unknownTier = raw();
    creepsOf(unknownTier).takeover = [
      {
        faction: 'raiders',
        tiers: [{ tier: 9, surrenderHpPct: 30, minUnits: 3, yieldS: 0, yieldMax: 0 }],
      },
    ];
    expect(() => loadGameData(unknownTier)).toThrow(/onbekende tier 9/);
    const unknownFaction = raw();
    creepsOf(unknownFaction).takeover = [
      {
        faction: 'nomaden',
        tiers: [{ tier: 1, surrenderHpPct: 30, minUnits: 3, yieldS: 0, yieldMax: 0 }],
      },
    ];
    expect(() => loadGameData(unknownFaction)).toThrow(/onbekende factie 'nomaden'/);
    const twice = raw();
    creepsOf(twice).takeover = [
      {
        faction: 'raiders',
        tiers: [{ tier: 1, surrenderHpPct: 30, minUnits: 3, yieldS: 0, yieldMax: 0 }],
      },
      {
        faction: 'raiders',
        tiers: [{ tier: 2, surrenderHpPct: 30, minUnits: 3, yieldS: 0, yieldMax: 0 }],
      },
    ];
    expect(() => loadGameData(twice)).toThrow(/dubbele factie/);
  });

  it('without the file there are no camps and no bandits', () => {
    const r = raw();
    delete r.creeps;
    delete r.survival;
    const d = loadGameData(r);
    expect(d.creeps).toEqual({ units: [], names: [], tiers: [], takeover: [] });
    expect(d.loadouts.some((l) => l.factionId === NEUTRAL_FACTION_ID)).toBe(false);
  });

  it('refuses an unknown bandit, a duplicate id or tier, and a leash shorter than the aggro radius', () => {
    const unknown = raw();
    creepsOf(unknown).tiers[0]!.units[0]!.unitId = 'spook';
    expect(() => loadGameData(unknown)).toThrow(/onbekende bandiet 'spook'/);
    const dupId = raw();
    creepsOf(dupId).units[0]!.id = 'militie';
    expect(() => loadGameData(dupId)).toThrow(/dubbele id 'militie'/);
    const dupTier = raw();
    creepsOf(dupTier).tiers[1]!.tier = 1;
    expect(() => loadGameData(dupTier)).toThrow(/dubbele tier/);
    const leash = raw();
    creepsOf(leash).tiers[0]!.leashRadiusM = 2;
    expect(() => loadGameData(leash)).toThrow(/leashRadiusM/);
  });
});
