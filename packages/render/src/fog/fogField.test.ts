import { describe, expect, it } from 'vitest';
import { FOG, fogAt, type FogMask } from '@crawlout/protocol';
import { FOG_BLUR_PASSES, FogField, blurFogChannels, decodeFogMask, fogGrain } from './fogField.js';
import { FOG_LOOK, fogLook } from './fogOfWar.js';

/** A mask of w x h cells from a picture: '#' visible, '+' explored only, '.' unexplored. */
function maskOf(rows: readonly string[]): FogMask {
  const h = rows.length;
  const w = rows[0]!.length;
  const bytes = Math.ceil((w * h) / 8);
  const explored = new Uint8Array(bytes);
  const visible = new Uint8Array(bytes);
  rows.forEach((row, cy) =>
    [...row].forEach((ch, cx) => {
      const c = cy * w + cx;
      if (ch === '#') visible[c >> 3]! |= 1 << (c & 7);
      if (ch === '#' || ch === '+') explored[c >> 3]! |= 1 << (c & 7);
    }),
  );
  return { frame: 1, playerId: 0, cellsW: w, cellsH: h, cellUnits: 512, explored, visible };
}

describe('decodeFogMask', () => {
  it('reads both bitsets into visible and explored bytes, visible implying explored', () => {
    const mask = maskOf(['#+.', '.#+']);
    const out = new Uint8Array(12);
    decodeFogMask(mask, out);
    const cell = (cx: number, cy: number): number[] => [
      out[(cy * 3 + cx) * 2]!,
      out[(cy * 3 + cx) * 2 + 1]!,
    ];
    expect(cell(0, 0)).toEqual([255, 255]);
    expect(cell(1, 0)).toEqual([0, 255]);
    expect(cell(2, 0)).toEqual([0, 0]);
    expect(cell(1, 1)).toEqual([255, 255]);
  });

  it('agrees with protocol fogAt on every cell, also when a row crosses a byte boundary', () => {
    const mask = maskOf(['#+.#+.#+.#', '.#+.#+.#+.', '+.#+.#+.#+']);
    const out = new Uint8Array(mask.cellsW * mask.cellsH * 2);
    decodeFogMask(mask, out);
    for (let cy = 0; cy < mask.cellsH; cy++)
      for (let cx = 0; cx < mask.cellsW; cx++) {
        const i = (cy * mask.cellsW + cx) * 2;
        const state = fogAt(mask, cx, cy);
        expect(out[i]).toBe(state === FOG.visible ? 255 : 0);
        expect(out[i + 1]).toBe(state === FOG.unexplored ? 0 : 255);
      }
  });
});

describe('blurFogChannels', () => {
  it('keeps a uniform field, spreads a single cell symmetrically and conserves its mass away from the edge', () => {
    const w = 7;
    const h = 7;
    const src = new Uint8Array(w * h * 2);
    src[(3 * w + 3) * 2] = 255;
    const tmp = new Float32Array(src.length);
    const out = new Float32Array(src.length);
    blurFogChannels(src, w, h, tmp, out);
    const at = (x: number, y: number): number => out[(y * w + x) * 2]!;
    expect(at(3, 3)).toBeCloseTo(255 * 0.25, 5);
    expect(at(2, 3)).toBeCloseTo(255 * 0.125, 5);
    expect(at(2, 3)).toBeCloseTo(at(4, 3), 5);
    expect(at(3, 2)).toBeCloseTo(at(3, 4), 5);
    expect(at(2, 2)).toBeCloseTo(255 / 16, 5);
    let sum = 0;
    for (let i = 0; i < out.length; i += 2) sum += out[i]!;
    expect(sum).toBeCloseTo(255, 3);

    const flat = new Uint8Array(w * h * 2).fill(200);
    blurFogChannels(flat, w, h, tmp, out);
    for (const v of out) expect(v).toBeCloseTo(200, 4);
  });

  it('may blur in place', () => {
    const w = 5;
    const h = 5;
    const src = new Uint8Array(w * h * 2);
    src[(2 * w + 2) * 2] = 255;
    const tmp = new Float32Array(src.length);
    const separate = new Float32Array(src.length);
    blurFogChannels(src, w, h, tmp, separate);
    const inPlace = Float32Array.from(src);
    blurFogChannels(inPlace, w, h, tmp, inPlace);
    expect(Array.from(inPlace)).toEqual(Array.from(separate));
  });
});

describe('fogGrain', () => {
  it('is deterministic, fills the whole range softly and is not flat', () => {
    const a = new Uint8Array(32 * 32);
    const b = new Uint8Array(32 * 32);
    fogGrain(32, 32, a);
    fogGrain(32, 32, b);
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(Math.max(...a) - Math.min(...a)).toBeGreaterThan(100);
  });
});

describe('FogField', () => {
  const pic = ['.....', '..#..', '.....'];

  it('shows the first mask at once: visible cell, explored ring, unexplored rest', () => {
    const f = new FogField();
    expect(f.setMask(maskOf(pic))).toBe('resized');
    expect(f.width).toBe(5);
    expect(f.height).toBe(3);
    expect(f.data.length).toBe(5 * 3 * 4);
    const texel = (cx: number, cy: number): number[] =>
      Array.from(f.data.slice((cy * 5 + cx) * 4, (cy * 5 + cx) * 4 + 4));
    const middle = texel(2, 1);
    expect(middle[0]).toBeGreaterThan(30); // a lone cell, blurred twice: about 36, the peak
    expect(middle[1]).toBeGreaterThanOrEqual(middle[0]!);
    expect(texel(0, 0)[0]).toBeLessThan(6); // the blur reaches two cells at most
    expect(texel(0, 0)[0]).toBeLessThan(middle[0]! / 4);
    expect(texel(2, 1)[3]).toBe(255);
    for (let c = 0; c < 15; c++) expect(f.data[c * 4 + 1]).toBeGreaterThanOrEqual(f.data[c * 4]!);
  });

  it('keeps the blur symmetric about the visible cell', () => {
    const f = new FogField();
    f.setMask(
      maskOf(['.......', '.......', '.......', '...#...', '.......', '.......', '.......']),
    );
    const v = (x: number, y: number): number => f.data[(y * 7 + x) * 4]!;
    expect(v(2, 3)).toBe(v(4, 3));
    expect(v(3, 2)).toBe(v(3, 4));
    expect(v(3, 3)).toBeGreaterThan(v(2, 3));
    expect(v(2, 3)).toBeGreaterThan(v(1, 3));
    expect(FOG_BLUR_PASSES).toBeGreaterThanOrEqual(1);
  });

  it('reports an identical mask as the same, a different one as changed', () => {
    const f = new FogField();
    f.setMask(maskOf(pic));
    expect(f.setMask(maskOf(pic))).toBe('same');
    expect(f.setMask(maskOf(['.....', '...#.', '.....']))).toBe('changed');
  });

  it('fades to a new mask instead of jumping, then settles and stops uploading', () => {
    const f = new FogField(9);
    f.setMask(maskOf(pic));
    const peak = f.data[(1 * 5 + 2) * 4]!;
    f.setMask(maskOf(['.....', '.....', '.....']));
    expect(f.isSettled).toBe(false);
    expect(f.data[(1 * 5 + 2) * 4]).toBe(peak); // nothing moves until step()
    expect(f.step(0.05)).toBe(true);
    const mid = f.data[(1 * 5 + 2) * 4]!;
    expect(mid).toBeLessThan(peak);
    expect(mid).toBeGreaterThan(0);
    let steps = 0;
    while (f.step(0.05) && steps++ < 200);
    expect(steps).toBeLessThan(200);
    expect(f.data[(1 * 5 + 2) * 4]).toBe(0);
    expect(f.isSettled).toBe(true);
    expect(f.step(0.05)).toBe(false);
  });

  it('does not fade backwards: visibility rises monotonically towards a newly seen cell', () => {
    const f = new FogField(9);
    f.setMask(maskOf(['.....', '.....', '.....']));
    f.setMask(maskOf(pic));
    let last = f.data[(1 * 5 + 2) * 4]!;
    for (let i = 0; i < 30; i++) {
      f.step(0.04);
      const now = f.data[(1 * 5 + 2) * 4]!;
      expect(now).toBeGreaterThanOrEqual(last);
      last = now;
    }
    expect(last).toBeGreaterThan(30);
  });

  it('keeps explored once seen: visible to explored-only leaves G, drops R', () => {
    const f = new FogField();
    f.setMask(maskOf(pic));
    f.setMask(maskOf(['.....', '..+..', '.....']));
    let steps = 0;
    while (f.step(0.05) && steps++ < 200);
    const i = (1 * 5 + 2) * 4;
    expect(f.data[i]).toBeLessThan(30);
    expect(f.data[i + 1]).toBeGreaterThan(f.data[i]!);
  });

  it('resizes with the grid and bumps the generation (a new texture)', () => {
    const f = new FogField();
    f.setMask(maskOf(pic));
    const g = f.generation;
    expect(f.setMask(maskOf(['....', '....']))).toBe('resized');
    expect(f.generation).toBe(g + 1);
    expect(f.data.length).toBe(4 * 2 * 4);
  });
});

describe('fogLook', () => {
  const lit: [number, number, number] = [0.6, 0.4, 0.2];
  const luma = (c: readonly number[]): number => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
  const chroma = (c: readonly number[]): number => Math.max(...c) - Math.min(...c);

  it('leaves a visible fragment as it is', () => {
    const c = fogLook(lit, 1, 1, 0.5);
    for (let i = 0; i < 3; i++) expect(c[i]).toBeCloseTo(lit[i]!, 6);
  });

  it('dims and desaturates the explored', () => {
    const c = fogLook(lit, 0, 1, 0.5);
    expect(luma(c)).toBeLessThan(luma(lit) * 0.7);
    expect(chroma(c) / luma(c)).toBeLessThan((chroma(lit) / luma(lit)) * 0.5);
  });

  it('turns the unexplored near-black, a trace of the relief remaining', () => {
    const c = fogLook(lit, 0, 0, 0.5);
    expect(Math.max(...c)).toBeLessThan(0.05);
    const brighter = fogLook([1.2, 0.8, 0.4], 0, 0, 0.5);
    expect(luma(brighter)).toBeGreaterThan(luma(c));
    expect(luma(fogLook(lit, 0, 0, 1))).toBeGreaterThan(luma(fogLook(lit, 0, 0, 0)));
  });

  it('puts the three states in order', () => {
    expect(luma(fogLook(lit, 1, 1, 0.5))).toBeGreaterThan(luma(fogLook(lit, 0, 1, 0.5)));
    expect(luma(fogLook(lit, 0, 1, 0.5))).toBeGreaterThan(luma(fogLook(lit, 0, 0, 0.5)));
  });

  it('a map-knowledge material keeps the explored look in the unexplored', () => {
    expect(fogLook(lit, 0, 0, 0.5, true)).toEqual(fogLook(lit, 0, 1, 0.5));
    expect(FOG_LOOK.unexploredHaze).toBeLessThan(0.5);
  });
});
