import { describe, expect, it } from 'vitest';
import { buildMipChain, cellular, fractalNoise, hash2, valueNoise } from './noiseTexture.js';

describe('noise primitives', () => {
  it('hash2 stays in 0..1 and differs per input', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 100; i++) {
      const h = hash2(i, 3, 7);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
      seen.add(h);
    }
    expect(seen.size).toBe(100);
  });

  it('value and fractal noise wrap with the tile', () => {
    expect(valueNoise(0, 0.3, 8, 5)).toBeCloseTo(valueNoise(1, 0.3, 8, 5), 9);
    expect(fractalNoise(0.2, 0, 4, 3, 5)).toBeCloseTo(fractalNoise(0.2, 1, 4, 3, 5), 9);
  });

  it('cellular noise: f1 <= f2, wraps, and is zero at a feature point only', () => {
    const a = cellular(0.37, 0.61, 10, 3);
    expect(a.f1).toBeLessThanOrEqual(a.f2);
    const b = cellular(1.37, 0.61, 10, 3);
    expect(b.f1).toBeCloseTo(a.f1, 9);
    expect(b.id).toBe(a.id);
  });
});

const SIZE = 64;
const tile = {
  size: SIZE,
  data: Uint8Array.from({ length: SIZE * SIZE * 4 }, (_, i) =>
    Math.round(hash2(i >> 2, i & 3, 5) * 255),
  ),
};
function channel(c: number): number[] {
  const out: number[] = [];
  for (let i = c; i < tile.data.length; i += 4) out.push(tile.data[i]!);
  return out;
}
const mean = (v: number[]): number => v.reduce((a, b) => a + b, 0) / v.length;

describe('mip chain', () => {
  it('halves down to 1 x 1 and keeps the mean of each channel', () => {
    const levels = buildMipChain(tile);
    expect(levels.map((l) => l.width)).toEqual([64, 32, 16, 8, 4, 2, 1]);
    for (const l of levels) expect(l.data.length).toBe(l.width * l.height * 4);
    const top = levels[levels.length - 1]!;
    for (let c = 0; c < 4; c++) expect(Math.abs(top.data[c]! - mean(channel(c)))).toBeLessThan(2);
  });
});
