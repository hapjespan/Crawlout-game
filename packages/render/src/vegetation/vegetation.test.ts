import { describe, expect, it } from 'vitest';
import { buildGroundMap } from '../terrain/groundMap.js';
import { WATER_CELL } from '../water/waterMask.js';
import { grassTuft, reedClump, shrub, weed } from './vegetationMeshes.js';
import {
  CROSSING_TREE_CLEAR_M,
  FORD_CLEAR_M,
  INSTANCE_STRIDE,
  OBJECTIVE_SHRUB_CLEAR_M,
  OBJECTIVE_TREE_CLEAR_M,
  scatterVegetation,
  SPECIES,
} from './vegetationScatter.js';

// 160 m square: a river along x = 10..13, an impassable ridge strip along x = 100..103, flat elsewhere.
const N = 160;
const water = {
  w: N,
  h: N,
  data: Uint8Array.from({ length: N * N }, (_, i) =>
    i % N >= 10 && i % N <= 13 ? WATER_CELL.deep : WATER_CELL.land,
  ),
};
const passable = {
  w: N,
  h: N,
  data: Uint8Array.from({ length: N * N }, (_, i) => (i % N >= 100 && i % N <= 103 ? 0 : 1)),
};
const heightAt = (): number => 0;
const ground = buildGroundMap({
  bounds: { minX: 0, minZ: 0, maxX: N, maxZ: N },
  heightAt,
  water,
  margin: 8,
});
const scatter = (): ReturnType<typeof scatterVegetation> =>
  scatterVegetation({ ground, heightAt, water, passable });

const points = (d: Float32Array): [number, number][] => {
  const out: [number, number][] = [];
  for (let k = 0; k < d.length; k += INSTANCE_STRIDE) out.push([d[k]!, d[k + 1]!]);
  return out;
};

describe('vegetation scatter', () => {
  const result = scatter();

  it('is the same every time', () => {
    const again = scatter();
    for (const s of SPECIES)
      expect(Array.from(again.instances[s])).toEqual(Array.from(result.instances[s]));
    expect(again.trees).toEqual(result.trees);
  });

  it('grows grass, shrubs and reeds, and keeps everything on the map', () => {
    expect(result.instances.grass.length / INSTANCE_STRIDE).toBeGreaterThan(500);
    expect(result.instances.reed.length).toBeGreaterThan(0);
    for (const s of SPECIES)
      for (const [x, z] of points(result.instances[s])) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThan(N);
        expect(z).toBeGreaterThanOrEqual(0);
        expect(z).toBeLessThan(N);
      }
  });

  it('keeps grass out of the water and reeds at the bank', () => {
    for (const [x] of points(result.instances.grass)) expect(x < 10 || x >= 14).toBe(true);
    for (const [x] of points(result.instances.reed)) expect(x).toBeGreaterThan(7);
    for (const [x] of points(result.instances.reed)) expect(x).toBeLessThan(17);
  });

  it('puts grove trees on or against impassable ground, spaced apart', () => {
    expect(result.trees.length).toBeGreaterThan(0);
    for (const t of result.trees) {
      expect(t.x).toBeGreaterThan(98);
      expect(t.x).toBeLessThan(106);
      expect(t.asset).toMatch(/^tree_(oak|pine|bare)_0[1-3]$/);
    }
    for (const a of result.trees)
      for (const b of result.trees)
        if (a !== b) expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(3.39);
  });

  it('has no groves without a passability grid', () => {
    expect(scatterVegetation({ ground, heightAt, water }).trees).toEqual([]);
  });

  it('keeps trees and shrubs off an objective', () => {
    const flag = { x: 101.5, z: 80 };
    const r = scatterVegetation({ ground, heightAt, water, passable, keepClear: [flag] });
    expect(r.trees.length).toBeGreaterThan(0);
    for (const t of r.trees)
      expect(Math.hypot(t.x - flag.x, t.z - flag.z)).toBeGreaterThan(OBJECTIVE_TREE_CLEAR_M - 1);
    for (const s of ['shrubRound', 'shrubLow', 'shrubTall', 'reed'] as const)
      for (const [x, z] of points(r.instances[s]))
        expect(Math.hypot(x - flag.x, z - flag.z)).toBeGreaterThan(OBJECTIVE_SHRUB_CLEAR_M - 2);
  });
});

describe('vegetation at a land bridge', () => {
  // The river (x = 10..13) is broken by a land bridge at z = 76..82, framed by impassable cliffs at x = 4..20 along z = 20..140.
  const bridged = {
    w: N,
    h: N,
    data: water.data.map((v, i) => {
      const z = Math.floor(i / N);
      return z >= 76 && z < 82 ? WATER_CELL.land : v;
    }),
  };
  const cliffs = {
    w: N,
    h: N,
    data: passable.data.map((v, i) => {
      const x = i % N;
      const z = Math.floor(i / N);
      return (x >= 4 && x < 10) || (x > 13 && x <= 20) ? (z >= 20 && z < 140 ? 0 : v) : v;
    }),
  };
  const r = scatterVegetation({ ground, heightAt, water: bridged, passable: cliffs });

  it('grows no trees on or around the bridge, though its cliffs are impassable', () => {
    for (const t of r.trees)
      expect(Math.hypot(t.x - 11.5, t.z - 79)).toBeGreaterThan(CROSSING_TREE_CLEAR_M - 1);
    for (const s of ['shrubRound', 'shrubLow', 'shrubTall', 'reed'] as const)
      for (const [x, z] of points(r.instances[s]))
        expect(Math.hypot(x - 11.5, z - 79)).toBeGreaterThan(FORD_CLEAR_M - 2);
  });

  it('still grows groves along the rest of the cliffs', () => {
    expect(r.trees.some((t) => t.x < 24 && Math.abs(t.z - 79) > CROSSING_TREE_CLEAR_M + 2)).toBe(
      true,
    );
  });
});

describe('vegetation meshes', () => {
  const height = (g: ReturnType<typeof grassTuft>): number => {
    g.computeBoundingBox();
    return g.boundingBox!.max.y;
  };

  it('stands at real scale against a 1.8 m person', () => {
    expect(height(grassTuft())).toBeGreaterThan(0.25);
    expect(height(grassTuft())).toBeLessThan(0.5);
    expect(height(weed())).toBeLessThan(0.45);
    expect(height(shrub())).toBeGreaterThan(0.6);
    expect(height(shrub())).toBeLessThan(1.1);
    expect(height(reedClump())).toBeGreaterThan(1.1);
    expect(height(reedClump())).toBeLessThan(1.8);
  });

  it('carries the attributes the material reads, with unit normals', () => {
    for (const g of [grassTuft(), weed(), shrub(), reedClump()]) {
      for (const name of ['position', 'normal', 'color', 'flower'])
        expect(g.getAttribute(name)).toBeDefined();
      const n = g.getAttribute('normal');
      for (let i = 0; i < n.count; i++)
        expect(Math.hypot(n.getX(i), n.getY(i), n.getZ(i))).toBeCloseTo(1, 4);
    }
  });
});
