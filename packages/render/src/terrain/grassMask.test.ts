import { describe, expect, it } from 'vitest';
import { propCategoryOf } from '../props/propCategory.js';
import { buildGrassMask } from './grassMask.js';

const bounds = { minX: 0, minZ: 0, maxX: 64, maxZ: 64 };
const at = (m: NonNullable<ReturnType<typeof buildGrassMask>>, x: number, z: number): number =>
  m.data[Math.floor((z / m.sizeZ) * m.h) * m.w + Math.floor((x / m.sizeX) * m.w)]!;

describe('grass density mask', () => {
  it('is null without grass or plant props', () => {
    expect(buildGrassMask([{ asset: 'rock_set2_01', x: 10, y: 10 }], propCategoryOf, bounds)).toBeNull();
    expect(buildGrassMask([], propCategoryOf, bounds)).toBeNull();
  });

  it('is dense where grass clusters, empty far away and fades in between', () => {
    const props = Array.from({ length: 40 }, (_, i) => ({
      asset: 'grass_patch_01',
      x: 20 + (i % 5),
      y: 20 + Math.floor(i / 5) * 0.5,
    }));
    const m = buildGrassMask(props, propCategoryOf, bounds)!;
    expect(at(m, 22, 22)).toBeGreaterThan(230);
    expect(at(m, 60, 60)).toBe(0);
    expect(at(m, 30, 22)).toBeLessThan(at(m, 22, 22));
    expect(at(m, 30, 22)).toBeGreaterThan(0);
  });

  it('counts a plant for less than a grass patch and ignores trees', () => {
    const one = (asset: string) =>
      Math.max(...buildGrassMask([{ asset, x: 32, y: 32 }], propCategoryOf, bounds)?.data ?? [0]);
    expect(one('plant_01')).toBeGreaterThan(0);
    expect(one('plant_01')).toBeLessThan(one('grass_patch_01'));
    expect(one('tree_oak_01')).toBe(0);
  });
});
