import { describe, expect, it } from 'vitest';
import { parseWaterMask } from '@crawlout/render';
import { riverAt, XL_SIZE, XL_TREES, xlWorld } from '../src/render/xlWorld.js';

describe('xlWorld (render demo ?xl)', () => {
  const world = xlWorld({ n: 128, heights: new Float32Array(128 * 128).fill(2) });
  const { data, w } = world.water;

  it('is 384 m with a valid water mask', () => {
    expect(world.size).toBe(XL_SIZE);
    expect(() => parseWaterMask(world.water)).not.toThrow();
  });

  it('has a river of 6 to 10 m across with three fords', () => {
    const across = (y: number): number =>
      data.subarray(y * w, (y + 1) * w).filter((v) => v > 0).length;
    for (const y of [10, 100, 250, 370]) {
      // A row cuts a slanted river longer than its width.
      const width = across(y) / Math.sqrt(1 + riverAt(y + 0.5).slope ** 2);
      expect(width).toBeGreaterThanOrEqual(5);
      expect(width).toBeLessThanOrEqual(11);
    }
    let fords = 0;
    for (let y = 0; y < XL_SIZE; y++) {
      const ford = data.subarray(y * w, (y + 1) * w).includes(2);
      const before = y > 0 && data.subarray((y - 1) * w, y * w).includes(2);
      if (ford && !before) fords++;
    }
    expect(fords).toBe(3);
  });

  it('has 6000 trees on land and a dense border', () => {
    const trees = world.props.filter((p) => p.asset.startsWith('tree'));
    expect(trees.length).toBe(XL_TREES);
    for (const t of trees) {
      const r = riverAt(t.y);
      expect(Math.abs(t.x - r.x)).toBeGreaterThan(r.half);
    }
    const border = trees.filter((t) => Math.min(t.x, t.y, XL_SIZE - t.x, XL_SIZE - t.y) < 12);
    expect(border.length).toBeGreaterThan(1500);
  });
});
