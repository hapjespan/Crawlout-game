import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { buildingTypeId, heroTypeId, unitTypeId } from '@crawlout/data';
import { loadGameDataFromDir } from '@crawlout/data/node';
import { inspect, takeoverHint } from '../src/game/inspect.js';

const data = loadGameDataFromDir(fileURLToPath(new URL('../../../data', import.meta.url)));
const loadout = (key: string) => data.loadouts.find((l) => l.key === key)!;

describe('inspect (enemy selection)', () => {
  it('names an enemy unit in Dutch with its owner, weapon and armour', () => {
    const info = inspect(data, unitTypeId(loadout('militie').id));
    expect(info.name).toBe('Militie');
    expect(info.ownerLabel).toBe('Vijand (Dwellers)');
    expect(info.detail).toMatch(/^Wapen: Pipe pistol \(ballistisch\) · Pantser: /);
  });

  it('names robots and the hero', () => {
    expect(inspect(data, unitTypeId(loadout('beveiligingsrobot').id)).name).toBe(
      'Beveiligingsrobot',
    );
    expect(inspect(data, unitTypeId(loadout('sentinel').id)).name).toBe('Sentinel');
    const hero = inspect(data, heroTypeId(0));
    expect(hero.name).toBe('Opziener');
    expect(hero.detail).toBeNull();
  });

  it('names an enemy building and gives it no weapon line', () => {
    const lab = data.buildings.find((b) => b.key === 'lab')!;
    const info = inspect(data, buildingTypeId(lab.id));
    expect(info.name).toBe('Lab');
    expect(info.detail).toBeNull();
  });

  it('shows a bandit of a creep camp as neutral (data 0.25.0): "Neutraal · Bandiet", its own name', () => {
    const boss = inspect(data, unitTypeId(loadout('bandiet_baas').id));
    expect(boss.ownerLabel).toBe('Neutraal · Bandiet');
    expect(boss.name).toBe('Bandietenbaas');
    expect(boss.detail).toMatch(/^Wapen: Scrap revolver \(ballistisch\) · Pantser: middel$/);
    expect(inspect(data, unitTypeId(loadout('bandiet_schutter').id)).name).toBe('Schutter');
  });

  it('every loadout and building has a name that is not the raw key', () => {
    for (const l of data.loadouts) {
      const info = inspect(data, unitTypeId(l.id));
      expect(info.name).not.toBe('');
      expect(info.name).not.toBe(l.key);
    }
  });
});

describe('takeoverHint (camp takeover, data 0.27.0; PlayerStatus.camps, protocol 0.14.0)', () => {
  const raiders = data.factions.findIndex((f) => f.key === 'raiders');
  const dwellers = data.factions.findIndex((f) => f.key === 'dwellers');
  const camp = (over: object = {}) => ({
    camp: 0,
    x: 10_000,
    y: 10_000,
    tier: 1,
    state: 'bandits' as const,
    owner: 255,
    takeover: true,
    ...over,
  });
  const far = camp({ camp: 1, x: 90_000, y: 90_000, takeover: true, state: 'taken' as const });

  it('tells a Raider how to take the nearest camp over, from the data', () => {
    const rule = data.creeps.takeover.find((r) => r.factionId === raiders)!.tiers[0]!;
    const hint = takeoverHint(data, raiders, [camp(), far], 10_200, 9_900);
    expect(hint).toMatch(/^Overnemen: /);
    expect(hint).toContain(`minstens ${rule.minUnits} eigen eenheden`);
    expect(hint).toContain(`tot ${rule.surrenderPermille / 10}%`);
  });

  it('says nothing to the Dwellers, for a taken or cleared camp, or without camp status', () => {
    expect(takeoverHint(data, dwellers, [camp({ takeover: false })], 10_000, 10_000)).toBeNull();
    expect(takeoverHint(data, raiders, [camp(), far], 89_000, 89_000)).toBeNull();
    expect(takeoverHint(data, raiders, [camp({ state: 'cleared' })], 10_000, 10_000)).toBeNull();
    expect(takeoverHint(data, raiders, undefined, 10_000, 10_000)).toBeNull();
    expect(takeoverHint(data, undefined, [camp()], 10_000, 10_000)).toBeNull();
  });
});
