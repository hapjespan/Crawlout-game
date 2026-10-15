import { describe, expect, it } from 'vitest';
import {
  AlbedoLayoutError,
  albedoUv,
  foldUnit,
  mirroredAlbedoLayout,
  orientUv,
  validateAlbedoLayout,
  type TerrainAlbedoLayout,
} from './albedoLayout.js';

/** packages/map sourceCell, continuous: target (u, v) to source. */
const SOURCE_CELL: Record<number, (u: number, v: number) => [number, number]> = {
  0: (u, v) => [u, v],
  1: (u, v) => [1 - u, v],
  2: (u, v) => [u, 1 - v],
  3: (u, v) => [1 - u, 1 - v],
  4: (u, v) => [v, u],
  5: (u, v) => [1 - v, u],
  6: (u, v) => [v, 1 - u],
  7: (u, v) => [1 - v, 1 - u],
};

const sum = (taps: { w: number }[]): number => taps.reduce((a, t) => a + t.w, 0);
/** Weighted mean source uv of the taps (smooth fields only change smoothly). */
const mean = (taps: { u: number; v: number; w: number }[]): [number, number] => [
  taps.reduce((a, t) => a + t.u * t.w, 0),
  taps.reduce((a, t) => a + t.v * t.w, 0),
];

describe('albedo layout', () => {
  it('orients like packages/map sourceCell', () => {
    for (let o = 0; o < 8; o++)
      for (const [u, v] of [
        [0.1, 0.7],
        [0.9, 0.2],
      ] as const) {
        const [a, b] = orientUv(o, u, v);
        const [ea, eb] = SOURCE_CELL[o]!(u, v);
        expect(a).toBeCloseTo(ea, 9);
        expect(b).toBeCloseTo(eb, 9);
      }
  });

  it('continues a tile mirrored past its edges', () => {
    expect(foldUnit(0.3)).toBeCloseTo(0.3, 9);
    expect(foldUnit(-0.1)).toBeCloseTo(0.1, 9);
    expect(foldUnit(1.1)).toBeCloseTo(0.9, 9);
    expect(foldUnit(2.3)).toBeCloseTo(0.3, 9);
  });

  const map: TerrainAlbedoLayout = {
    tileSize: 128,
    cols: 3,
    rows: 3,
    blendHalfWidth: 8,
    tiles: [0, 1, 2, 4, -1, 7, 1, 2, 3].map((o) =>
      o < 0
        ? { orientation: 5, pointMirror: { seam: 'horizontal' as const, halfWidth: 8 } }
        : { orientation: o },
    ),
  };

  it('weights always sum to one: one tap mid-tile, up to four near a corner, two more on a mirror seam', () => {
    expect(albedoUv(map, 40, 40)).toHaveLength(1);
    expect(albedoUv(map, 128.5, 128.5)).toHaveLength(4);
    expect(albedoUv(map, 192, 192)).toHaveLength(2); // the middle tile's seam
    for (const [x, z] of [
      [3, 3],
      [126, 64],
      [130, 250],
      [255, 129],
      [192, 190],
      [383, 383],
    ] as const)
      expect(sum(albedoUv(map, x, z))).toBeCloseTo(1, 9);
  });

  it('samples the point-mirrored half of the middle tile turned 180 degrees', () => {
    const a = albedoUv(map, 128 + 20, 128 + 30);
    const b = albedoUv(map, 256 - 20, 256 - 30);
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    const [ua, va] = [a[0]!.u, a[0]!.v];
    const [ub, vb] = [b[0]!.u, b[0]!.v];
    expect(ub).toBeCloseTo(ua, 9);
    expect(vb).toBeCloseTo(va, 9);
  });

  it('tiles the source mirrored over bounds without a map layout, seamless at the borders', () => {
    const l = mirroredAlbedoLayout({ minX: 0, minZ: 0, maxX: 384, maxZ: 384 }, 128);
    expect(l).toMatchObject({ cols: 3, rows: 3 });
    validateAlbedoLayout(l);
    for (const z of [10, 128, 200]) {
      const left = mean(albedoUv(l, 127.999, z));
      const right = mean(albedoUv(l, 128.001, z));
      expect(right[0]).toBeCloseTo(left[0], 3);
      expect(right[1]).toBeCloseTo(left[1], 3);
    }
  });

  it('refuses layouts it cannot draw', () => {
    expect(() => validateAlbedoLayout({ ...map, tiles: map.tiles.slice(1) })).toThrow(AlbedoLayoutError);
    expect(() => validateAlbedoLayout({ ...map, cols: 6, rows: 6 })).toThrow(/at most/);
    expect(() =>
      validateAlbedoLayout({ ...map, tiles: map.tiles.map(() => ({ orientation: 9 })) }),
    ).toThrow(/orientation/);
    expect(() => validateAlbedoLayout({ ...map, blendHalfWidth: 100 })).toThrow(/blendHalfWidth/);
  });
});
