import { describe, expect, it } from 'vitest';
import {
  buildMipChain,
  cellular,
  DETAIL_SIZE,
  fractalNoise,
  generateDetailTexels,
  GRIT_SPREAD,
  hash2,
  valueNoise,
} from './detailTexture.js';

const SIZE = 64;
const tile = generateDetailTexels(SIZE, 1);

function channel(c: number): number[] {
  const out: number[] = [];
  for (let i = c; i < tile.data.length; i += 4) out.push(tile.data[i]!);
  return out;
}
const mean = (v: number[]): number => v.reduce((a, b) => a + b, 0) / v.length;

describe('detail texture generation', () => {
  it('is deterministic and depends on the seed', () => {
    const again = generateDetailTexels(SIZE, 1);
    expect(Array.from(again.data)).toEqual(Array.from(tile.data));
    const other = generateDetailTexels(SIZE, 2);
    expect(Array.from(other.data)).not.toEqual(Array.from(tile.data));
  });

  it('has the declared size and layout', () => {
    expect(tile.size).toBe(SIZE);
    expect(tile.data.length).toBe(SIZE * SIZE * 4);
    expect(DETAIL_SIZE & (DETAIL_SIZE - 1)).toBe(0);
  });

  it('keeps the grit around 0.5 with the fixed spread, and the normal and macro channels usable', () => {
    const grit = channel(0);
    expect(mean(grit)).toBeGreaterThan(120);
    expect(mean(grit)).toBeLessThan(136);
    const sd = Math.sqrt(mean(grit.map((g) => (g - mean(grit)) ** 2)));
    expect(sd / 255).toBeGreaterThan(GRIT_SPREAD * 0.8);
    expect(sd / 255).toBeLessThan(GRIT_SPREAD * 1.2);
    // The normal channels are centered on flat (128).
    expect(Math.abs(mean(channel(1)) - 128)).toBeLessThan(6);
    expect(Math.abs(mean(channel(2)) - 128)).toBeLessThan(6);
    // The macro channel spans its whole range.
    const macro = channel(3);
    expect(Math.min(...macro)).toBe(0);
    expect(Math.max(...macro)).toBe(255);
  });

  it('tiles: the step over the wrap is no larger than the steps inside the tile', () => {
    for (const c of [0, 3]) {
      let inner = 0;
      let seam = 0;
      for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE - 1; x++)
          inner = Math.max(
            inner,
            Math.abs(tile.data[(y * SIZE + x) * 4 + c]! - tile.data[(y * SIZE + x + 1) * 4 + c]!),
          );
        seam = Math.max(
          seam,
          Math.abs(tile.data[(y * SIZE + SIZE - 1) * 4 + c]! - tile.data[y * SIZE * 4 + c]!),
        );
      }
      expect(seam).toBeLessThanOrEqual(inner);
    }
  });
});

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

describe('mip chain', () => {
  it('halves down to 1 x 1 and keeps the mean of each channel', () => {
    const levels = buildMipChain(tile);
    expect(levels.map((l) => l.width)).toEqual([64, 32, 16, 8, 4, 2, 1]);
    for (const l of levels) expect(l.data.length).toBe(l.width * l.height * 4);
    const top = levels[levels.length - 1]!;
    for (let c = 0; c < 4; c++) expect(Math.abs(top.data[c]! - mean(channel(c)))).toBeLessThan(2);
  });
});
