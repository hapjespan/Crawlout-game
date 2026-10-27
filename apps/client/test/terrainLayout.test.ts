import { describe, expect, it } from 'vitest';
import { RUSTBELT_SPEC, type TerrainSpec } from '@crawlout/map';
import { albedoUv, validateAlbedoLayout, type TerrainAlbedoLayout } from '@crawlout/render';
// The map's own composition (not part of its public API): the layout must reproduce it exactly.
import { composeTiles, symmetrize } from '../../../packages/map/src/gen/terrain.js';
import {
  albedoLayoutForMap,
  albedoLayoutFromSpec,
  rockDemoAlbedoLayout,
  xlDemoAlbedoLayout,
} from '../src/render/terrainLayout.js';

/** A rough source field in centimeters, so every orientation and mirror reads differently. */
function field(n: number): Int32Array {
  const cm = new Int32Array(n * n);
  let s = 12345;
  for (let i = 0; i < cm.length; i++) {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    cm[i] = s % 1000;
  }
  return cm;
}

/** The layout's value at the middle of map cell (x, y): the weighted source cells its taps land on. */
function sampled(
  layout: TerrainAlbedoLayout,
  cm: Int32Array,
  n: number,
  x: number,
  y: number,
): number {
  let v = 0;
  for (const t of albedoUv(layout, x + 0.5, y + 0.5)) {
    const i = Math.min(n - 1, Math.max(0, Math.round(t.u * n - 0.5)));
    const j = Math.min(n - 1, Math.max(0, Math.round(t.v * n - 0.5)));
    v += t.w * cm[j * n + i]!;
  }
  return v;
}

describe('albedo layout of a map', () => {
  it('reproduces packages/map composeTiles, point mirror and blended borders included', () => {
    const n = 32;
    const cm = field(n);
    const spec: TerrainSpec = {
      ...RUSTBELT_SPEC.terrain!,
      smoothPasses: 0,
      seam: { kind: 'horizontal', halfWidthCells: 4 },
      tiles: { ...RUSTBELT_SPEC.terrain!.tiles!, blendHalfWidthCells: 4 },
    };
    const source = { w: n, h: n, cm };
    const composed = composeTiles(source, spec, spec.tiles!, symmetrize(source, spec, n));
    const layout = albedoLayoutFromSpec(spec, n);
    validateAlbedoLayout(layout);
    const size = composed.size;
    let worst = 0;
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++)
        worst = Math.max(
          worst,
          Math.abs(sampled(layout, cm, n, x, y) - composed.cm[y * size + x]!),
        );
    // The map blends with integer weights (1/256); values run 0..1000 cm.
    expect(worst).toBeLessThan(8);
  });

  it('covers the other seam kinds of the middle tile', () => {
    const n = 16;
    const cm = field(n);
    const source = { w: n, h: n, cm };
    for (const kind of ['vertical', 'diagonal', 'antidiagonal'] as const)
      for (const orientation of [0, 3, 5, 6]) {
        const spec = {
          ...RUSTBELT_SPEC.terrain!,
          orientation,
          smoothPasses: 0,
          seam: { kind, halfWidthCells: 2 as const },
          tiles: undefined,
        };
        const expected = symmetrize(source, spec, n);
        const layout = albedoLayoutFromSpec(spec, n);
        for (let y = 0; y < n; y++)
          for (let x = 0; x < n; x++)
            expect(Math.abs(sampled(layout, cm, n, x, y) - expected[y * n + x]!)).toBeLessThan(8);
      }
  });

  it('has the Rustbelt XL layout: 3 x 3 tiles of 128 m', () => {
    const layout = albedoLayoutForMap('rustbelt')!;
    expect(layout).toMatchObject({ tileSize: 128, cols: 3, rows: 3, blendHalfWidth: 8 });
    expect(layout.tiles[4]!.pointMirror).toEqual({ seam: 'horizontal', halfWidth: 8 });
    expect(albedoLayoutForMap('unknown')).toBeNull();
  });

  it('matches the render demo XL map: the demo tile mirrored on odd columns and rows', () => {
    const n = 16;
    const cm = field(n);
    const demo = rockDemoAlbedoLayout(n);
    const xl = xlDemoAlbedoLayout(n);
    for (let j = 0; j < 3 * n; j++)
      for (let i = 0; i < 3 * n; i++) {
        const ti = Math.floor(i / n);
        const tj = Math.floor(j / n);
        const li = ti % 2 === 1 ? n - 1 - (i % n) : i % n;
        const lj = tj % 2 === 1 ? n - 1 - (j % n) : j % n;
        expect(sampled(xl, cm, n, i, j)).toBeCloseTo(sampled(demo, cm, n, li, lj), 6);
      }
  });
});
