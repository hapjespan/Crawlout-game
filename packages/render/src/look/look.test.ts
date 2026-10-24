import { describe, expect, it } from 'vitest';
import { WASTELAND, linearOf, TEAM_COLORS } from '../palette.js';
import { PROP_CATEGORIES } from '../props/propCategory.js';
import { GRADE, TEAM_GRADE, gradeRgb } from './grade.js';
import {
  SURFACES,
  SURFACE_KINDS,
  fitAlbedo,
  fitLuma,
  lumaOf,
  surfaceIndex,
  surfaceKindOfCategory,
  surfaceKindOfMaterial,
  surfaceOfIndex,
} from './surfaces.js';

const chroma = (c: readonly number[]): number => {
  const l = lumaOf(c[0]!, c[1]!, c[2]!);
  return Math.max(...c.map((v) => Math.abs(v - l)));
};

describe('world grade', () => {
  it('leaves a color alone at strength 0', () => {
    expect(gradeRgb([0.3, 0.2, 0.1], 0)).toEqual([0.3, 0.2, 0.1].map((v) => expect.closeTo(v, 6)));
  });

  it('warms a grey and keeps the luminance at the pivot', () => {
    const [r, g, b] = gradeRgb([0.16, 0.16, 0.16]);
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
    expect(lumaOf(r, g, b)).toBeCloseTo(0.16, 2);
  });

  it('desaturates a saturated color and widens the contrast around the pivot', () => {
    const c: [number, number, number] = [0.1, 0.3, 0.8];
    const graded = gradeRgb(c);
    // Same luminance contrast factor on every channel: compare the chroma per unit of luminance.
    expect(chroma(graded) / lumaOf(...graded)).toBeLessThan(chroma(c) / lumaOf(...c));
    expect(gradeRgb([0.04, 0.04, 0.04])[1]).toBeLessThan(0.04);
    expect(gradeRgb([0.6, 0.6, 0.6])[1]).toBeGreaterThan(0.6);
    expect(GRADE.saturation).toBeLessThan(1);
  });

  it('scales a dark albedo instead of dragging it towards black', () => {
    // The Klerk's coat: sRGB (44, 25, 14), the darkest large surface in the game. The old straight-line contrast
    // (pivot + (c - pivot) * contrast) returned 0.0131 for its red, less than half of it, and the whole coat read
    // as black whatever its texture said.
    const coat: [number, number, number] = [0.0265, 0.0097, 0.0048];
    const line = GRADE.pivot + (coat[0] - GRADE.pivot) * GRADE.contrast;
    const graded = gradeRgb(coat);
    expect(line / coat[0]).toBeLessThan(0.55); // what the straight line did
    expect(graded[0] / coat[0]).toBeGreaterThan(0.75); // what the log curve does
    expect(graded[0]).toBeLessThan(coat[0]); // still darkened: the grade still adds contrast
  });

  it('never goes negative', () => {
    for (const c of [
      [0, 0, 0],
      [0.9, 0, 0],
      [0, 0.01, 1],
    ] as const)
      for (const v of gradeRgb(c)) expect(v).toBeGreaterThanOrEqual(0);
  });

  it('grades the team color less than the world, so it stays the saturated accent', () => {
    const team = linearOf(TEAM_COLORS[0]!);
    const full = gradeRgb(team, 1);
    const light = gradeRgb(team, TEAM_GRADE);
    expect(chroma(light) / lumaOf(...light)).toBeGreaterThan(chroma(full) / lumaOf(...full));
  });
});

describe('surface recipes', () => {
  it('has a physically plausible recipe per kind', () => {
    for (const kind of SURFACE_KINDS) {
      const r = SURFACES[kind];
      expect(r.albedo[0]).toBeGreaterThan(0.01);
      expect(r.albedo[1]).toBeLessThan(0.8);
      expect(r.albedo[0]).toBeLessThan(r.albedo[1]);
      expect(r.roughness).toBeGreaterThanOrEqual(0.4);
      expect(r.roughness).toBeLessThanOrEqual(1);
      expect(r.metalness).toBeGreaterThanOrEqual(0);
      expect(r.metalness).toBeLessThanOrEqual(1);
      // The typical tint sits inside the kind's own albedo range.
      const l = lumaOf(...linearOf(r.tint));
      expect(l).toBeGreaterThanOrEqual(r.albedo[0] * 0.9);
      expect(l).toBeLessThanOrEqual(r.albedo[1] * 1.1);
    }
  });

  it('keeps the wasteland palette dusty: low chroma in every palette color', () => {
    for (const hex of Object.values(WASTELAND)) {
      const c = linearOf(hex);
      expect(chroma(c) / Math.max(lumaOf(...c), 1e-3)).toBeLessThan(0.9);
    }
  });

  it('indexes kinds both ways, wood for an unknown index', () => {
    for (const kind of SURFACE_KINDS) expect(surfaceOfIndex(surfaceIndex(kind))).toBe(kind);
    expect(surfaceOfIndex(99)).toBe('wood');
  });

  it('reads the kind from the asset-cli material names of the house kit', () => {
    expect(surfaceKindOfMaterial('frame_wood')).toBe('wood');
    expect(surfaceKindOfMaterial('plank_grey')).toBe('wood');
    expect(surfaceKindOfMaterial('wall_paint')).toBe('wood');
    expect(surfaceKindOfMaterial('roof')).toBe('roofing');
    expect(surfaceKindOfMaterial('metal')).toBe('paintedMetal');
    expect(surfaceKindOfMaterial('team_trim')).toBe('paintedMetal');
    expect(surfaceKindOfMaterial('wall_proxy')).toBe('wood');
    expect(surfaceKindOfMaterial('rusty_barrel')).toBe('rustMetal');
  });

  it('gives every prop category a kind', () => {
    for (const c of PROP_CATEGORIES) expect(SURFACE_KINDS).toContain(surfaceKindOfCategory(c));
    expect(surfaceKindOfCategory('rock')).toBe('rock');
    expect(surfaceKindOfCategory('tree-leafy')).toBe('foliage');
  });

  it('soft-limits luminance into the range: unchanged inside, monotone and bounded outside', () => {
    const [lo, hi] = SURFACES.wood.albedo;
    const mid = (lo + hi) / 2;
    expect(fitLuma(mid, 'wood')).toBeCloseTo(mid, 6);
    expect(fitLuma(5, 'wood')).toBeLessThanOrEqual(hi);
    expect(fitLuma(5, 'wood')).toBeGreaterThan(fitLuma(hi, 'wood'));
    expect(fitLuma(0, 'wood')).toBeGreaterThanOrEqual(lo - 1e-9);
    let prev = -1;
    for (let l = 0; l <= 1; l += 0.01) {
      const v = fitLuma(l, 'wood');
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('keeps the hue when it brings a color into the range', () => {
    const [r, g, b] = fitAlbedo([0.8, 0.4, 0.2], 'wood');
    expect(r / g).toBeCloseTo(2, 5);
    expect(g / b).toBeCloseTo(2, 5);
    expect(lumaOf(r, g, b)).toBeLessThanOrEqual(SURFACES.wood.albedo[1]);
  });
});
