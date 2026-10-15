import { describe, expect, it } from 'vitest';
import {
  composeTiles,
  rotate180,
  sourceCell,
  symmetrize,
  type TerrainSpec,
} from '../src/gen/terrain.js';
import {
  carveRiver,
  isqrtFast,
  WATER_DEEP,
  WATER_SHALLOW,
  type RiverSpec,
} from '../src/gen/river.js';
import { buildForest, FOREST_BORDER, FOREST_GROVE } from '../src/gen/forest.js';

const n = 32;
const spec: TerrainSpec = {
  source: 'x',
  orientation: 5,
  seam: { kind: 'horizontal', halfWidthCells: 4 },
  smoothPasses: 0,
  heightCurve: [{ fromM: 0, gain: 1 }],
  maxSlopePermille: 625,
  minCliffCells: 1,
  minPocketCells: 1,
};
const field = (() => {
  const cm = new Int32Array(n * n);
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) cm[j * n + i] = i * 37 + j * 11 + ((i * j) & 7) * 13;
  return { w: n, h: n, cm };
})();
const tiles = {
  k: 3 as const,
  blendHalfWidthCells: 4 as const,
  outer: [
    { tx: 0, ty: 0, orientation: 0 },
    { tx: 1, ty: 0, orientation: 1 },
    { tx: 2, ty: 0, orientation: 6 },
    { tx: 0, ty: 1, orientation: 4 },
  ],
};

describe('tegels', () => {
  const centre = symmetrize(field, spec, n);
  const { size, cm } = composeTiles(field, spec, tiles, centre);

  it('maakt een veld van k x n en is exact puntsymmetrisch', () => {
    expect(size).toBe(3 * n);
    for (let i = 0; i < size * size; i++) expect(cm[i]).toBe(cm[size * size - 1 - i]);
  });

  it('ver van de tegelgrenzen is elke tegel zijn eigen bron: middentegel het middenveld, buitentegels georiënteerd', () => {
    const at = (x: number, y: number): number => cm[y * size + x] as number;
    expect(at(n + 16, n + 16)).toBe(centre[16 * n + 16]);
    expect(at(10, 12)).toBe(field.cm[12 * n + 10]); // tegel (0,0), oriëntatie 0
    const [si, sj] = sourceCell(6, 12, 10, n); // tegel (2,0), lokale cel (12,10)
    expect(at(2 * n + 12, 10)).toBe(field.cm[sj * n + si]);
    // Tegel (0,2) is tegel (2,0) 180 graden gedraaid.
    const [ri, rj] = sourceCell(rotate180(6), 12, 10, n);
    expect(at(12, 2 * n + 10)).toBe(field.cm[rj * n + ri]);
  });

  it('mengt over de grens zonder sprong groter dan het bronverloop', () => {
    let maxStep = 0;
    for (let y = 0; y < size; y++)
      for (let x = 1; x < size; x++)
        maxStep = Math.max(
          maxStep,
          Math.abs((cm[y * size + x] as number) - (cm[y * size + x - 1] as number)),
        );
    let srcMax = 0;
    for (let i = 0; i < field.cm.length; i++) srcMax = Math.max(srcMax, field.cm[i] as number);
    // Een harde naad zou een sprong van de orde van het hele bronbereik geven.
    expect(maxStep).toBeLessThan(srcMax / 3);
  });

  it('weigert een tegel buiten de A-helft of een ontbrekende oriëntatie', () => {
    expect(() =>
      composeTiles(
        field,
        spec,
        { ...tiles, outer: [...tiles.outer.slice(1), { tx: 2, ty: 2, orientation: 0 }] },
        centre,
      ),
    ).toThrow(/A-helft/);
    expect(() =>
      composeTiles(field, spec, { ...tiles, outer: tiles.outer.slice(1) }, centre),
    ).toThrow(/oriëntatie/);
  });
});

describe('rivier', () => {
  it('isqrtFast is de integer-wortel', () => {
    for (let v = 0; v < 5000; v++) {
      const r = isqrtFast(v);
      expect(r * r).toBeLessThanOrEqual(v);
      expect((r + 1) * (r + 1)).toBeGreaterThan(v);
    }
    expect(isqrtFast(2147395600)).toBe(46340);
  });

  const N = 96;
  const river: RiverSpec = {
    points: [
      { x: 40, y: -8, r: 3 },
      { x: 30, y: 20, r: 4 },
      { x: 44, y: 40, r: 3 },
    ],
    centreR: 3,
    smoothRounds: 3,
    crossings: [
      { x: 31, y: 20, kind: 'ford', halfLengthM: 3.5 },
      { x: 48, y: 48, kind: 'bridge', halfLengthM: 4 },
    ],
    bedEdgeCm: 30,
    bedMaxCm: 90,
    fordDepthCm: 15,
    bankBaseCm: 10,
    beachSlopeCmPerM: 25,
    beachLengthM: 4,
    wallSlopeCmPerM: 120,
    bankReachM: 10,
  };
  const cm = new Int32Array(N * N).fill(300);
  const r = carveRiver(cm, N, river);

  it('is puntsymmetrisch, snijdt de bedding onder 0 en laat de landbrug staan', () => {
    for (let i = 0; i < N * N; i++) {
      expect(r.mask[i]).toBe(r.mask[N * N - 1 - i]);
      expect(cm[i]).toBe(cm[N * N - 1 - i]);
      if (r.mask[i] !== 0) expect(cm[i]).toBeLessThan(0);
      if (r.bridge[i] === 1) expect(cm[i]).toBe(300);
    }
    let deep = 0;
    let shallow = 0;
    for (const v of r.mask) {
      if (v === WATER_DEEP) deep++;
      if (v === WATER_SHALLOW) shallow++;
    }
    expect(deep).toBeGreaterThan(300);
    expect(shallow).toBeGreaterThan(20);
    expect(r.crossings.map((c) => c.kind)).toEqual(['ford', 'ford', 'bridge']);
  });

  it('oevers lopen op als strand en wand, en het terrein wordt nooit opgehoogd', () => {
    for (let i = 0; i < N * N; i++) expect(cm[i]).toBeLessThanOrEqual(300);
    // Op de oever (0 tot 4 m van het water) ligt het strand: 10 cm plus 25 cm per meter.
    let beach = 0;
    for (let i = 0; i < N * N; i++) {
      const e = r.edgeDist[i] as number;
      if (r.mask[i] === 0 && r.bridge[i] === 0 && e >= 0 && e < 3 * 16) {
        expect(cm[i]).toBeLessThanOrEqual(10 + 25 * 3);
        beach++;
      }
    }
    expect(beach).toBeGreaterThan(100);
  });
});

describe('bos', () => {
  const N = 128;
  const f = buildForest(N, N, {
    seed: 3,
    minDepthM: 12,
    maxDepthM: 20,
    groves: [{ x: 40, y: 50, radius: 6 }],
  }).forest;

  it('de bosrand is 12 tot 20 cellen diep, puntsymmetrisch en heeft een bosje met zijn spiegel', () => {
    for (let i = 0; i < N * N; i++) expect(f[i]).toBe(f[N * N - 1 - i]);
    for (let x = 30; x < N - 30; x++) {
      let d = 0;
      while (f[d * N + x] === FOREST_BORDER) d++;
      expect(d).toBeGreaterThanOrEqual(12);
      expect(d).toBeLessThanOrEqual(20);
    }
    expect(f[50 * N + 40]).toBe(FOREST_GROVE);
    expect(f[(N - 1 - 50) * N + (N - 1 - 40)]).toBe(FOREST_GROVE);
    expect(f[64 * N + 64]).toBe(0);
  });
});
