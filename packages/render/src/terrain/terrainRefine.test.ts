import { describe, expect, it } from 'vitest';
import { createGridTerrain, TerrainHeightField, type TerrainGeometry } from './heightField.js';
import { heightFieldNormals, refineTerrain } from './terrainRefine.js';

/** A greybox like packages/map makes: one quad per 1 m cell with its own 4 vertices and a flat cell color. */
function greybox(
  n: number,
  height: (cx: number, cz: number) => number,
  color: (cx: number, cz: number) => [number, number, number],
): TerrainGeometry {
  const positions = new Float32Array(n * n * 12);
  const colors = new Uint8Array(n * n * 12);
  const indices = new Uint32Array(n * n * 6);
  let v = 0;
  let k = 0;
  for (let z = 0; z < n; z++)
    for (let x = 0; x < n; x++) {
      const first = v;
      for (const [qx, qz] of [
        [x, z],
        [x + 1, z],
        [x, z + 1],
        [x + 1, z + 1],
      ] as const) {
        positions.set([qx, height(qx, qz), qz], v * 3);
        colors.set(color(x, z), v * 3);
        v++;
      }
      indices.set([first, first + 2, first + 1, first + 1, first + 2, first + 3], k);
      k += 6;
    }
  return { positions, colors, indices };
}

const step = (x: number): number => (x >= 8 ? 4 : 0); // a 4 m cliff along x = 8

describe('refineTerrain', () => {
  const src = greybox(
    16,
    (x) => step(x),
    (x) => (x < 8 ? [150, 128, 94] : [78, 72, 68]),
  );
  const hf = new TerrainHeightField(src.positions, src.indices);
  const out = refineTerrain(src, hf, { subdivide: 2 });

  it('makes one shared-vertex grid at half a meter over the same bounds', () => {
    expect(out.positions.length / 3).toBe(33 * 33);
    expect(out.indices.length / 3).toBe(32 * 32 * 2);
    expect(out.positions[0]).toBe(0);
    expect(out.positions[out.positions.length - 3]).toBe(16);
    const fine = new TerrainHeightField(out.positions, out.indices, 1);
    expect(fine.heightAt(3.3, 5)).toBeCloseTo(0, 5);
    expect(fine.heightAt(12, 5)).toBeCloseTo(4, 5);
  });

  it('never overshoots at a cliff and keeps the base heights', () => {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 1; i < out.positions.length; i += 3) {
      lo = Math.min(lo, out.positions[i]!);
      hi = Math.max(hi, out.positions[i]!);
    }
    expect(lo).toBeGreaterThanOrEqual(0);
    expect(hi).toBeLessThanOrEqual(4);
  });

  it('gives smooth normals: up on the flat, tilted on the cliff', () => {
    const n = out.normals!;
    const at = (i: number, j: number): number => (j * 33 + i) * 3;
    expect(n[at(2, 10) + 1]).toBeCloseTo(1, 5);
    expect(n[at(16, 10) + 1]).toBeLessThan(0.7); // x = 8
    expect(n[at(16, 10)]).toBeLessThan(0); // facing -x, down the cliff
  });

  it('blends the cell colors and darkens the foot of the cliff', () => {
    const c = out.colors as Float32Array;
    const at = (i: number, j: number): number => (j * 33 + i) * 3;
    expect(c[at(2, 10)]).toBeCloseTo(150 / 255, 2);
    expect(c[at(30, 10)]).toBeCloseTo(78 / 255, 2);
    const occ = out.occlusion!;
    expect(occ[10 * 33 + 2]).toBeCloseTo(1, 5); // open flat ground far from the cliff
    expect(occ[10 * 33 + 15]).toBeLessThan(0.9); // just below it
    expect(occ[10 * 33 + 30]).toBeCloseTo(1, 5); // on top
  });

  it('keeps the mesh with subdivide 0 and only adds normals', () => {
    const kept = refineTerrain(src, hf, { subdivide: 0 });
    expect(kept.positions).toBe(src.positions);
    expect(kept.normals!.length).toBe(src.positions.length);
  });

  it('computes height-field normals on a plane', () => {
    const t = createGridTerrain(8, 8, 1, (x) => 0.5 * x);
    const plane = new TerrainHeightField(t.positions, t.indices);
    const n = heightFieldNormals(t.positions, (x, z) => plane.heightAt(x, z, 0));
    const i = (4 * 9 + 4) * 3;
    expect(n[i]).toBeCloseTo(-0.5 / Math.hypot(0.5, 1), 4);
    expect(n[i + 1]).toBeCloseTo(1 / Math.hypot(0.5, 1), 4);
  });
});
