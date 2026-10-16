import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { buildingTypeId, heroTypeId, unitTypeId } from '@crawlout/data';
import { loadGameDataFromDir } from '@crawlout/data/node';
import { inspect } from '../src/game/inspect.js';

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

  it('every loadout and building has a name that is not the raw key', () => {
    for (const l of data.loadouts) {
      const info = inspect(data, unitTypeId(l.id));
      expect(info.name).not.toBe('');
      expect(info.name).not.toBe(l.key);
    }
  });
});
