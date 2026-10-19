import { describe, it, expect } from 'vitest';
import { loadGameData, NEUTRAL_FACTION_ID, type RawGameData } from './loader.js';
import { SURVIVAL_RANKS } from './schemas.js';
import { clone, raw } from './game-data.helpers.js';

// Survival co-op (data 0.33.0; voorstel, ter bevestiging door de architect): data/survival/.
type RawWaves = {
  waves: { atS: number; spawns: { unit: string; count: number }[] }[];
  edges: { id: string }[];
  buildZones: { nearEdge: string }[];
  scaling: { players: number }[];
  win: { surviveWave: number };
  zoneScrap: { nodes: { distM: number }[] };
};
type RawSurvivalShape = { units: { units: unknown[] }; waves: RawWaves };
const withEdit = (edit: (s: RawSurvivalShape) => void): RawGameData => {
  const r = clone(raw());
  edit(r.survival as RawSurvivalShape);
  return r;
};

describe('data/survival', () => {
  const data = loadGameData(raw());
  const survival = data.survival!;

  it('appends the six hostile loadouts after the creep bandits, neutral and free', () => {
    const keys = [
      'survival_ghoul',
      'survival_ghoul_runner',
      'survival_mutant',
      'survival_mutant_brute',
      'survival_klauwbeest',
      'survival_behemoth',
    ];
    const hostile = survival.units.map((id) => data.loadouts[id]!);
    expect(hostile.map((l) => l.key)).toEqual(keys);
    expect(survival.units[0]).toBe(data.creeps.units[data.creeps.units.length - 1]! + 1);
    hostile.forEach((l, k) => {
      expect(l.id).toBe(survival.units[0]! + k);
      expect(l.factionId).toBe(NEUTRAL_FACTION_ID);
      expect(l.scrapCost).toBe(0);
      expect(l.visuals.meshSlots.body).toBe(keys[k]);
    });
    expect(survival.ranks.map((r) => SURVIVAL_RANKS[r])).toEqual([
      'normal',
      'normal',
      'normal',
      'normal',
      'miniboss',
      'boss',
    ]);
  });

  it('has 15 waves, a mini-boss in wave 8 and the Behemoth in wave 15 starting before minute 31', () => {
    expect(survival.waves.map((w) => w.wave)).toEqual(Array.from({ length: 15 }, (_, k) => k + 1));
    const lastMinutes = survival.waves[14]!.atTicks / 20 / 60;
    expect(lastMinutes).toBeGreaterThan(25);
    expect(lastMinutes).toBeLessThan(31);
    const has = (wave: number, key: string): boolean =>
      survival.waves[wave - 1]!.spawns.some((e) => data.loadouts[e.unit]!.key === key);
    expect(has(8, 'survival_klauwbeest')).toBe(true);
    expect(has(15, 'survival_behemoth')).toBe(true);
    expect(survival.winWave).toBe(15);
  });

  it('scales for 1 to 4 players, ascending, and has a build zone per slot', () => {
    expect(survival.scaling).toHaveLength(4);
    expect(survival.scaling[0]).toEqual({
      countPermille: 1000,
      hpPermille: 1000,
      damagePermille: 1000,
    });
    for (let k = 1; k < 4; k++)
      expect(survival.scaling[k]!.countPermille).toBeGreaterThan(
        survival.scaling[k - 1]!.countPermille,
      );
    expect(survival.buildZones.map((z) => z.slot)).toEqual([0, 1, 2, 3]);
    expect(survival.edges.map((e) => e.key)).toEqual(['noord', 'oost', 'zuid', 'west']);
  });

  it('has fixed scrap nodes per build zone inside the zone, in sim units (data 0.34.0)', () => {
    expect(survival.zoneScrap.length).toBeGreaterThanOrEqual(2);
    for (const n of survival.zoneScrap) {
      expect(n.distU).toBeGreaterThan(0);
      expect(n.distU).toBeLessThan(survival.buildZones[0]!.radiusU);
      expect(n.angle).toBeGreaterThanOrEqual(0);
      expect(n.angle).toBeLessThan(65536);
      expect(n.amount).toBeGreaterThan(0);
    }
    // 45 degrees is an eighth of a turn
    expect(survival.zoneScrap[0]!.angle).toBe(8192);
  });

  it('leaves the rest of the data unchanged when survival is absent', () => {
    const r = clone(raw());
    delete r.survival;
    const without = loadGameData(r);
    expect(without.survival).toBeNull();
    expect(without.loadouts.length).toBe(data.loadouts.length - 6);
  });

  it('rejects broken survival data', () => {
    const rejects = (edit: (s: RawSurvivalShape) => void, message: RegExp): void =>
      expect(() => loadGameData(withEdit(edit))).toThrow(message);
    rejects((s) => (s.waves.waves[0]!.spawns[0]!.unit = 'nope'), /onbekende vijand/);
    rejects((s) => s.waves.waves.pop(), /surviveWave/);
    rejects((s) => (s.waves.waves[1]!.atS = 1), /oplopen/);
    rejects((s) => (s.waves.buildZones[0]!.nearEdge = 'x'), /onbekende rand/);
    rejects((s) => (s.waves.scaling[1]!.players = 3), /spelers 2/);
    rejects((s) => (s.waves.waves[14]!.atS = 5000), /buiten/);
    rejects((s) => (s.waves.zoneScrap.nodes[0]!.distM = 45), /niet binnen de zone/);
    rejects((s) => ((s.waves as unknown as { extra: number }).extra = 1), /extra/);
  });
});
