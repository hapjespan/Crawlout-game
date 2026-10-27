import { describe, expect, it } from 'vitest';
import { analyzeWater, parseWaterMask, WaterMaskError, type WaterMask } from './waterMask.js';
import { buildWaterGeometry } from './waterLayer.js';

/** A straight river along z, columns x0..x1 (inclusive), a ford over rows f0..f1. */
function river(w: number, h: number, x0: number, x1: number, f0 = -1, f1 = -1): WaterMask {
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = x0; x <= x1; x++) data[y * w + x] = y >= f0 && y <= f1 ? 2 : 1;
  return { w, h, data };
}

const placement = { minX: 0, minZ: 0, cell: 1 };
/** Left bank 2 m, right bank 3 m, sloping down along z by 1 m over the map; the river cells at 1 m. */
const ground = (x: number, z: number): number => (x < 10 ? 2 : x > 18 ? 3 : 1) - z / 64;

describe('parseWaterMask', () => {
  it('accepts a mask of 0, 1 and 2 and copies it', () => {
    const src = [0, 1, 2, 0, 0, 1];
    const m = parseWaterMask({ w: 3, h: 2, data: src });
    expect([...m.data]).toEqual(src);
    expect(m.data).toBeInstanceOf(Uint8Array);
  });

  it('refuses a wrong size, a wrong cell count and unknown values', () => {
    expect(() => parseWaterMask({ w: 0, h: 2, data: [] })).toThrow(WaterMaskError);
    expect(() => parseWaterMask({ w: 2.5, h: 2, data: [0, 0, 0, 0, 0] })).toThrow(WaterMaskError);
    expect(() => parseWaterMask({ w: 2, h: 2, data: [0, 0, 0] })).toThrow(/3 cells, expected 4/);
    expect(() => parseWaterMask({ w: 2, h: 1, data: [0, 3] })).toThrow(/cell 1 is 3/);
  });
});

describe('analyzeWater', () => {
  const mask = river(32, 64, 10, 18, 30, 33);
  const s = analyzeWater(mask, ground, placement);

  it('counts the water and the fords', () => {
    expect(s.cells).toBe(9 * 64);
    expect(s.shallowCells).toBe(9 * 4);
  });

  it('puts the water just below the lowest bank, never above it', () => {
    for (const y of [5, 40]) {
      const lowBank = 2 - (y + 0.5) / 64;
      const lv = s.level[y * 32 + 14]!;
      expect(lv).toBeLessThanOrEqual(lowBank - 0.14);
      expect(lv).toBeGreaterThan(lowBank - 0.4);
    }
    expect(Number.isNaN(s.level[5 * 32 + 2]!)).toBe(true); // land away from the river has no level
    expect(Number.isNaN(s.level[5 * 32 + 9]!)).toBe(false); // the bank ring does
  });

  it('cuts a bed under the water and leaves the land alone', () => {
    const y = 12.5;
    const lv = s.level[12 * 32 + 14]!;
    expect(s.bed(14.5, y, ground(14.5, y))).toBeLessThan(lv - 0.9); // deep in the middle
    expect(s.bed(10.5, y, ground(10.5, y))).toBeLessThan(lv); // still under water at the edge cell
    expect(s.bed(6.5, y, ground(6.5, y))).toBe(ground(6.5, y)); // land
    // A ford is shallow (a flat greybox at 10 m shows the cut itself).
    const fordBed = s.bed(14.5, 31.5, 10);
    expect(fordBed).toBeLessThan(s.level[31 * 32 + 14]! - 0.2);
    expect(fordBed).toBeGreaterThan(s.level[31 * 32 + 14]! - 0.5);
    // A bed the map already carved deeper stays.
    expect(s.bed(14.5, y, -5)).toBe(-5);
  });

  it('flows downstream along the river, faster over the ford, slower at the shore', () => {
    const f = (x: number, y: number): [number, number] => [
      s.flow[(y * 32 + x) * 2]!,
      s.flow[(y * 32 + x) * 2 + 1]!,
    ];
    const [mx, mz] = f(14, 20);
    expect(mz).toBeGreaterThan(0.5); // from z = 0 (higher) towards z = 63
    expect(Math.abs(mx)).toBeLessThan(0.2);
    expect(f(14, 31)[1]).toBeGreaterThan(mz); // ford
    expect(f(10, 20)[1]).toBeLessThan(mz); // shore cell
    expect(f(2, 20)).toEqual([0, 0]); // land
  });

  it('keeps a pond still', () => {
    const data = new Uint8Array(16 * 16);
    for (let y = 5; y < 10; y++) for (let x = 5; x < 10; x++) data[y * 16 + x] = 1;
    const pond = analyzeWater({ w: 16, h: 16, data }, () => 1, placement);
    expect(pond.flow.every((v) => v === 0)).toBe(true);
    expect(pond.level[7 * 16 + 7]).toBeCloseTo(0.85, 5);
  });

  it('builds one surface over the water and its bank ring, with depth and fords per vertex', () => {
    const built = buildWaterGeometry(s, (x, z) => s.bed(x, z, ground(x, z)))!;
    expect(built.quads).toBe((9 + 2) * 64);
    const info = built.geometry.getAttribute('wInfo');
    let maxDepth = 0;
    let maxFord = 0;
    for (let v = 0; v < info.count; v++) {
      expect(info.getX(v)).toBeGreaterThanOrEqual(0);
      maxDepth = Math.max(maxDepth, info.getX(v));
      maxFord = Math.max(maxFord, info.getY(v));
    }
    expect(maxDepth).toBeGreaterThan(0.9);
    expect(maxFord).toBe(1);
    expect(
      buildWaterGeometry(
        analyzeWater({ w: 4, h: 4, data: new Uint8Array(16) }, ground, placement),
        ground,
      ),
    ).toBeNull();
  });
});
