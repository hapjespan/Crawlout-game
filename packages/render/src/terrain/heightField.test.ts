import { describe, expect, it } from 'vitest';
import { createGridTerrain, TerrainHeightField } from './heightField.js';

describe('TerrainHeightField', () => {
  it('returns the plane height on a sloped grid, between vertices too', () => {
    const t = createGridTerrain(32, 16, 2, (x, z) => 0.25 * x - 0.5 * z + 3);
    const hf = new TerrainHeightField(t.positions, t.indices);
    for (const [x, z] of [
      [0, 0],
      [1.3, 7.7],
      [31.9, 15.2],
      [17, 3],
    ] as const) {
      expect(hf.heightAt(x, z)).toBeCloseTo(0.25 * x - 0.5 * z + 3, 4);
    }
  });

  it('falls back outside the terrain', () => {
    const t = createGridTerrain(8, 8, 1, () => 2);
    const hf = new TerrainHeightField(t.positions, t.indices);
    expect(hf.heightAt(-1, 4, -7)).toBe(-7);
    expect(hf.heightAt(4, 9)).toBe(0);
    expect([hf.minX, hf.maxX, hf.minZ, hf.maxZ]).toEqual([0, 8, 0, 8]);
  });

  it('builds upward-facing triangles', () => {
    const t = createGridTerrain(2, 2, 1);
    const p = t.positions;
    const i = t.indices;
    for (let k = 0; k < i.length; k += 3) {
      const a = i[k]! * 3;
      const b = i[k + 1]! * 3;
      const c = i[k + 2]! * 3;
      const e1 = [p[b]! - p[a]!, p[b + 2]! - p[a + 2]!];
      const e2 = [p[c]! - p[a]!, p[c + 2]! - p[a + 2]!];
      // y of (e1 x e2) with y = 0 on both edges: e1.z * e2.x - e1.x * e2.z
      expect(e1[1]! * e2[0]! - e1[0]! * e2[1]!).toBeGreaterThan(0);
    }
  });
});
