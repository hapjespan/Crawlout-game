import { describe, expect, it } from 'vitest';
import { generateGroundLayers } from './groundLayers.js';
import { buildGroundMap, distanceField } from './groundMap.js';

const SIZE = 64;
const layers = generateGroundLayers(SIZE, 7);

describe('ground layers', () => {
  it('is deterministic and depends on the seed', () => {
    const again = generateGroundLayers(SIZE, 7);
    expect(Array.from(again.relief)).toEqual(Array.from(layers.relief));
    expect(Array.from(generateGroundLayers(SIZE, 8).relief)).not.toEqual(Array.from(layers.relief));
  });

  it('fills every channel over its whole range, means inside it', () => {
    for (const img of [layers.relief, layers.tone])
      for (let c = 0; c < 4; c++) {
        let lo = 255;
        let hi = 0;
        for (let i = c; i < img.length; i += 4) {
          lo = Math.min(lo, img[i]!);
          hi = Math.max(hi, img[i]!);
        }
        expect(hi - lo).toBeGreaterThan(150);
      }
    for (const m of layers.reliefMean) {
      expect(m).toBeGreaterThan(0.05);
      expect(m).toBeLessThan(0.95);
    }
  });

  it('tiles: the step over the wrap is like the steps inside the tile', () => {
    for (let c = 1; c < 4; c++) {
      let inner = 0;
      let seam = 0;
      const at = (x: number, y: number): number => layers.relief[(y * SIZE + x) * 4 + c]!;
      for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE - 1; x++) inner += Math.abs(at(x, y) - at(x + 1, y));
        seam += Math.abs(at(SIZE - 1, y) - at(0, y));
      }
      expect(seam / SIZE).toBeLessThan((inner / (SIZE * (SIZE - 1))) * 2.5);
    }
  });
});

describe('ground map', () => {
  it('measures the distance to marked cells', () => {
    const marked = new Uint8Array(25);
    marked[12] = 1; // the middle of 5 x 5
    const d = distanceField(marked, 5, 5);
    expect(d[12]).toBe(0);
    expect(d[13]).toBe(1);
    expect(d[0]).toBeCloseTo(2 * Math.SQRT2, 6);
  });

  it('is wet at the water, grows over less on a ridge, and marks the ridge', () => {
    // 32 m square, a ridge along x = 24, water in the column x = 2.
    const water = {
      w: 32,
      h: 32,
      data: Uint8Array.from({ length: 32 * 32 }, (_, i) => (i % 32 === 2 ? 1 : 0)),
    };
    const map = buildGroundMap({
      bounds: { minX: 0, minZ: 0, maxX: 32, maxZ: 32 },
      heightAt: (x) => Math.max(0, 3 - Math.abs(x - 24)),
      water,
    });
    const px = (x: number, z: number, c: number): number => map.data[(z * map.w + x) * 4 + c]!;
    expect(px(2, 16, 0)).toBe(255);
    expect(px(20, 16, 0)).toBeLessThan(px(4, 16, 0));
    expect(px(24, 16, 2)).toBeGreaterThan(200); // ridge
    expect(px(12, 16, 2)).toBeGreaterThan(110); // flat, about 0.5
    expect(px(12, 16, 2)).toBeLessThan(145);
  });
});
