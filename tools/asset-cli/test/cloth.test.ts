import { describe, expect, it } from 'vitest';
import { cullHiddenSkin, transferClothWeights } from '../src/cloth.js';

/** A unit quad in the y = `y` plane as two triangles, starting at vertex `base`. */
function quad(y: number): { positions: number[]; normals: number[]; indices: number[] } {
  return {
    positions: [0, y, 0, 1, y, 0, 1, y, 1, 0, y, 1],
    normals: [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0],
    indices: [0, 1, 2, 0, 2, 3],
  };
}

describe('cullHiddenSkin', () => {
  const build = (coverY: number) => {
    const skin = quad(0);
    const cover = quad(coverY);
    const positions = Float64Array.from([...skin.positions, ...cover.positions]);
    const normals = Float64Array.from([...skin.normals, ...cover.normals]);
    const weld = Int32Array.from({ length: 8 }, (_, i) => i);
    return {
      positions,
      normals,
      weld,
      skin: Uint32Array.from(skin.indices),
      cover: Uint32Array.from(cover.indices.map((i) => i + 4)),
    };
  };

  it('drops skin that a cover sheet within reach hides', () => {
    const { positions, normals, weld, skin, cover } = build(0.02);
    const keep = cullHiddenSkin(positions, normals, weld, skin, cover, { reach: 0.05, margin: 0 });
    expect([...keep]).toEqual([0, 0]);
  });

  it('keeps skin when the cover is further away than the reach', () => {
    const { positions, normals, weld, skin, cover } = build(0.2);
    const keep = cullHiddenSkin(positions, normals, weld, skin, cover, { reach: 0.05, margin: 0 });
    expect([...keep]).toEqual([1, 1]);
  });

  it('keeps everything without a cover', () => {
    const { positions, normals, weld, skin } = build(0.02);
    const keep = cullHiddenSkin(positions, normals, weld, skin, new Uint32Array(0), {
      reach: 0.05,
      margin: 0,
    });
    expect([...keep]).toEqual([1, 1]);
  });
});

describe('transferClothWeights', () => {
  it('gives a garment vertex the weights of the skin under it', () => {
    // Three skin vertices on bone 0, one garment vertex 1 cm above them on bone 1.
    const positions = Float64Array.from([0, 0, 0, 1, 0, 0, 0, 0, 1, 0.2, 0.01, 0.2]);
    const indices = Uint32Array.from([0, 1, 2]);
    const isBody = Uint8Array.from([1, 1, 1, 0]);
    const weld = Int32Array.from([0, 1, 2, 3]);
    const reps = [0, 1, 2, 3];
    const index = new Map(reps.map((r) => [r, r]));
    const solved = [Float64Array.from([1, 1, 1, 0]), Float64Array.from([0, 0, 0, 1])];
    const moved = transferClothWeights(
      positions,
      indices,
      isBody,
      weld,
      reps,
      index,
      new Map(),
      solved,
      { transfer: 0.1, smooth: 0 },
    );
    expect(moved).toBe(1);
    expect(solved[0]![3]).toBeCloseTo(1, 6);
    expect(solved[1]![3]).toBeCloseTo(0, 6);
    // The skin rows are left alone.
    expect(solved[0]![0]).toBe(1);
  });

  it('leaves a garment vertex out of reach on its own weights', () => {
    const positions = Float64Array.from([0, 0, 0, 1, 0, 0, 0, 0, 1, 0.2, 0.5, 0.2]);
    const solved = [Float64Array.from([1, 1, 1, 0]), Float64Array.from([0, 0, 0, 1])];
    const moved = transferClothWeights(
      positions,
      Uint32Array.from([0, 1, 2]),
      Uint8Array.from([1, 1, 1, 0]),
      Int32Array.from([0, 1, 2, 3]),
      [0, 1, 2, 3],
      new Map([
        [0, 0],
        [1, 1],
        [2, 2],
        [3, 3],
      ]),
      new Map(),
      solved,
      { transfer: 0.1, smooth: 0 },
    );
    expect(moved).toBe(0);
    expect(solved[1]![3]).toBe(1);
  });
});
