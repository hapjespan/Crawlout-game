import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Scene, Vector3, type BufferAttribute } from 'three/webgpu';
import { createGridTerrain } from './heightField.js';
import { TerrainLayer } from './terrainLayer.js';
import { computeOcclusion } from './terrainField.js';
import {
  FALLOFF_MAX,
  PLATFORM_MARGIN,
  platformWeight,
  shapePlatform,
  type PlatformSpec,
} from './terrainPlatforms.js';

const SLOPE = 0.3;
const hill = (x: number, z: number): number => SLOPE * x + 0.4 * Math.sin(z * 0.2);

function layer(size = 96): TerrainLayer {
  const l = new TerrainLayer(new Scene(), new Vector3(0.4, 0.8, 0.3), {
    chunks: { chunkSize: 16, levels: 2, farDistance: 120 },
  });
  l.set(createGridTerrain(size, size, 1, hill));
  return l;
}

const house = (id: number, x = 48, z = 48): PlatformSpec => ({ id, x, z, hx: 6, hz: 5 });

function cam(x: number, y: number, z: number, tx: number, tz: number): PerspectiveCamera {
  const c = new PerspectiveCamera(45, 16 / 9, 0.5, 2000);
  c.position.set(x, y, z);
  c.lookAt(tx, 0, tz);
  c.updateMatrixWorld();
  return c;
}

describe('platform weight and shape', () => {
  const p = house(1);
  const shape = { target: 10, falloff: 4 };
  it('is full on the footprint and its margin, eases to zero over the falloff', () => {
    expect(platformWeight(p, shape, 48, 48)).toBe(1);
    expect(platformWeight(p, shape, 54 + PLATFORM_MARGIN, 48)).toBe(1);
    expect(platformWeight(p, shape, 54 + PLATFORM_MARGIN + 2, 48)).toBeCloseTo(0.5, 5);
    expect(platformWeight(p, shape, 54 + PLATFORM_MARGIN + 4, 48)).toBe(0);
    expect(platformWeight(p, shape, 90, 90)).toBe(0);
  });

  it('takes the mean ground height and widens the border with the relief', () => {
    const l = layer();
    const f = (l as unknown as { field: Parameters<typeof shapePlatform>[0] }).field;
    const base = (l as unknown as { baseHeights: Float32Array }).baseHeights;
    const s = shapePlatform(f, base, house(1));
    // A plane's mean over a symmetric footprint is the center height (the sine adds a little).
    expect(s.target).toBeCloseTo(hill(48, 48), 0);
    expect(s.falloff).toBeGreaterThan(2.5);
    expect(s.falloff).toBeLessThanOrEqual(FALLOFF_MAX);
    const flat = shapePlatform(f, new Float32Array(base.length), house(1));
    expect(flat.falloff).toBeCloseTo(1.8, 5);
  });
});

describe('TerrainLayer.setPlatforms', () => {
  it('levels the ground under a footprint and leaves the far ground alone', () => {
    const l = layer();
    const before = l.heightAt(48, 48);
    const uphill = l.heightAt(56, 48);
    const outside = l.heightAt(80, 20);
    expect(l.setPlatforms([house(1)])).toBe(true);
    const top = l.heightAt(48, 48);
    for (const [x, z] of [
      [42, 43],
      [54, 53],
      [42, 53],
      [54, 43],
      [48, 48],
    ] as const)
      expect(l.heightAt(x, z)).toBeCloseTo(top, 4);
    expect(top).toBeCloseTo(before, 0);
    // A cut on the uphill side, a fill on the downhill side, then back to the ground.
    expect(l.heightAt(56, 48)).toBeLessThan(uphill);
    expect(l.heightAt(80, 20)).toBe(outside);
  });

  it('does nothing when the same platforms come again, and restores the ground when they go', () => {
    const l = layer();
    const base = (l as unknown as { baseHeights: Float32Array }).baseHeights.slice();
    const heights = (l as unknown as { field: { heights: Float32Array } }).field.heights;
    expect(l.setPlatforms([house(1), house(2, 20, 20)])).toBe(true);
    expect(l.setPlatforms([house(1), house(2, 20, 20)])).toBe(false);
    expect(Array.from(heights)).not.toEqual(Array.from(base));
    expect(l.setPlatforms([house(2, 20, 20)])).toBe(true); // the first goes
    expect(l.heightAt(48, 48)).toBeCloseTo(base[48 * 2 * 193 + 96] ?? 0, 4);
    expect(l.setPlatforms([])).toBe(true);
    expect(Array.from(heights)).toEqual(Array.from(base));
  });

  it('spreads a crowd of new platforms over calls when given a time budget, and the result is the same', () => {
    const many = [house(1, 20, 20), house(2, 20, 60), house(3, 60, 20), house(4, 60, 60)];
    const eager = layer();
    eager.setPlatforms(many);
    const slow = layer();
    expect(slow.setPlatforms(many, 0)).toBe(true); // a budget of 0 still does one region
    let calls = 1;
    while (slow.setPlatforms(many, 0)) calls++;
    expect(calls).toBeGreaterThan(1);
    expect(slow.setPlatforms(many, 0)).toBe(false);
    for (const p of many) expect(slow.heightAt(p.x, p.z)).toBeCloseTo(eager.heightAt(p.x, p.z), 5);
  });

  it('moves a platform: the old place is restored, the new one levelled', () => {
    const l = layer();
    const ground = l.heightAt(30, 30);
    l.setPlatforms([house(1, 30, 30)]);
    expect(l.heightAt(34, 30)).not.toBeCloseTo(hill(34, 30), 1);
    l.setPlatforms([house(1, 70, 60)]);
    expect(l.heightAt(30, 30)).toBeCloseTo(ground, 5);
    expect(l.heightAt(70, 60)).toBeCloseTo(l.heightAt(72, 62), 4);
  });

  it('keeps the occlusion of the changed region equal to a full recompute', () => {
    const l = layer();
    l.setPlatforms([house(1), house(2, 60, 30)]);
    const f = (
      l as unknown as { field: { occlusion: Float32Array; heights: Float32Array; nx: number } }
    ).field;
    const incremental = f.occlusion.slice();
    computeOcclusion(f as never);
    expect(Array.from(incremental)).toEqual(Array.from(f.occlusion));
  });

  it('rebuilds the chunk meshes that draw the changed ground', () => {
    const l = layer();
    const c = cam(40, 14, 30, 48, 48);
    for (let k = 0; k < 40; k++) l.update(c);
    l.setPlatforms([house(1)]);
    for (let k = 0; k < 40; k++) l.update(c);
    const tree = l.chunkTree!;
    expect(tree.drawn.length).toBeGreaterThan(0);
    const heights = (l as unknown as { field: { heights: Float32Array; nx: number; step: number } })
      .field;
    // Every drawn mesh agrees with the field at its vertices, so the ground is what the units stand on.
    for (const node of tree.drawn) {
      const pos = node.mesh!.geometry.getAttribute('position') as BufferAttribute;
      const grid =
        ((node.i1 - node.i0) / node.stride + 1) * ((node.j1 - node.j0) / node.stride + 1);
      for (let v = 0; v < grid; v += 7) {
        const i = Math.round(pos.getX(v) / heights.step);
        const j = Math.round(pos.getZ(v) / heights.step);
        expect(pos.getY(v)).toBeCloseTo(heights.heights[j * heights.nx + i]!, 4);
      }
    }
  });

  it('puts the platforms back on a new bed and drops them with a new terrain', () => {
    const l = layer();
    l.setPlatforms([house(1)]);
    l.setBed((x, z, h) => (Math.abs(x - 48) < 3 ? h - 1 : h));
    const top = l.heightAt(48, 48);
    expect(l.heightAt(44, 48)).toBeCloseTo(top, 4);
    l.setBed(null);
    expect(l.heightAt(48, 48)).toBeCloseTo(hill(48, 48), 0);
    l.set(createGridTerrain(96, 96, 1, () => 2));
    expect(l.heightAt(48, 48)).toBe(2);
  });
});
