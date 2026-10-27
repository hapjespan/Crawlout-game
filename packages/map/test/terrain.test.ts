import { describe, expect, it } from 'vitest';
import {
  applyHeightCurve,
  closeDiagonalLeaks,
  dropSmallComponents,
  parseHeightfield,
  passabilityFromSlope,
  sourceCell,
  symmetrize,
  type TerrainSpec,
} from '../src/gen/terrain.js';

const N = 32;
const baseSpec: TerrainSpec = {
  source: 'x',
  orientation: 0,
  seam: { kind: 'horizontal', halfWidthCells: 4 },
  smoothPasses: 0,
  heightCurve: [{ fromM: 0, gain: 1 }],
  maxSlopePermille: 625,
  minCliffCells: 1,
  minPocketCells: 1,
};
const ramp = (): { w: number; h: number; cm: Int32Array } => {
  const cm = new Int32Array(N * N);
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) cm[j * N + i] = i * 37 + j * 11 + ((i * j) & 7);
  return { w: N, h: N, cm };
};

describe('terrein: bronveld', () => {
  it('parseHeightfield leest crawlout-heightfield/1 in centimeters en weigert andere formaten', () => {
    const text = JSON.stringify({
      format: 'crawlout-heightfield/1',
      w: 2,
      h: 1,
      metersPerCell: 1,
      heights: [0.01, 26.25],
    });
    expect(Array.from(parseHeightfield(text).cm)).toEqual([1, 2625]);
    expect(() => parseHeightfield('{"format":"nee"}')).toThrow(/formaat/);
    expect(() => parseHeightfield(text.replace('"w":2', '"w":3'))).toThrow(/w\*h/);
  });

  it('sourceCell: elke oriëntatie is een bijectie op het veld', () => {
    for (let o = 0; o < 8; o++) {
      const seen = new Set<number>();
      for (let j = 0; j < 4; j++)
        for (let i = 0; i < 4; i++) {
          const [a, b] = sourceCell(o, i, j, 4);
          seen.add(b * 4 + a);
        }
      expect(seen.size).toBe(16);
    }
    expect(() => sourceCell(8, 0, 0, 4)).toThrow();
  });
});

describe('terrein: symmetrie en naad', () => {
  it('symmetrize is exact puntsymmetrisch voor elke naadsoort en oriëntatie', () => {
    for (const kind of ['horizontal', 'vertical', 'diagonal', 'antidiagonal'] as const)
      for (const orientation of [0, 3, 5]) {
        const out = symmetrize(
          ramp(),
          { ...baseSpec, orientation, smoothPasses: 1, seam: { kind, halfWidthCells: 8 } },
          N,
        );
        for (let j = 0; j < N; j++)
          for (let i = 0; i < N; i++)
            expect(out[j * N + i], `${kind} ${orientation} (${i},${j})`).toBe(
              out[(N - 1 - j) * N + (N - 1 - i)],
            );
      }
  });

  it('ver van de naad is het veld de bron, aan de andere kant de gedraaide kopie', () => {
    const field = ramp();
    const out = symmetrize(field, baseSpec, N);
    // Rij 2 ligt in de noordhelft (blijft), rij 29 is de gespiegelde kopie.
    expect(out[2 * N + 5]).toBe(field.cm[2 * N + 5]);
    expect(out[29 * N + 26]).toBe(field.cm[2 * N + 5]);
  });

  it('weigert een bronveld met de verkeerde maat', () => {
    expect(() => symmetrize({ w: 8, h: 8, cm: new Int32Array(64) }, baseSpec, N)).toThrow(
      /past niet/,
    );
  });
});

describe('terrein: hoogtecurve en helling', () => {
  it('applyHeightCurve schaalt per bereik en is doorlopend op de knikpunten', () => {
    const curve = [
      { fromM: 0, gain: 0.5 },
      { fromM: 10, gain: 0.25 },
    ];
    const out = applyHeightCurve(Int32Array.from([0, 500, 1000, 1400, 2000]), curve);
    expect(Array.from(out)).toEqual([0, 250, 500, 600, 750]);
    expect(() => applyHeightCurve(new Int32Array(1), [{ fromM: 1, gain: 1 }])).toThrow(/fromM 0/);
  });

  it('cellen steiler dan de drempel zijn klif, vlakkere hellingen blijven begaanbaar', () => {
    const cm = new Int32Array(N * N);
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++)
        cm[j * N + i] = i < 16 ? i * 50 : i < 18 ? 800 + (i - 16) * 90 : 980; // 0,5 m per m, dan 0,9 m per m
    const pass = passabilityFromSlope(cm, N, {
      maxSlopePermille: 625,
      minCliffCells: 1,
      minPocketCells: 1,
    });
    expect(pass[10 * N + 5]).toBe(1); // 0,5 m per m: begaanbaar
    expect(pass[10 * N + 17]).toBe(0); // 0,9 m per m: klif
    expect(pass[10 * N + 30]).toBe(1);
  });

  it('dropSmallComponents ruimt spikkels en zakken op, closeDiagonalLeaks sluit diagonale gaten', () => {
    const g = new Uint8Array(16).fill(1);
    g[5] = 0; // enkele klifcel
    dropSmallComponents(g, 4, 0, 8, 2);
    expect(g[5]).toBe(1);
    const h = new Uint8Array(16).fill(0);
    h[5] = 1; // enkele open cel in blokkade
    dropSmallComponents(h, 4, 1, 4, 2);
    expect(h[5]).toBe(0);
    const leak = new Uint8Array([0, 1, 1, 0]);
    closeDiagonalLeaks(leak, 2);
    expect(Array.from(leak)).toEqual([0, 0, 0, 0]);
  });
});
