import { describe, expect, it } from 'vitest';
import {
  buildingContact,
  buildingContactMargin,
  PROP_CONTACT_MIN_RADIUS,
  propContact,
} from './contact.js';
import { bakeContactField, distanceBytes } from './contactMask.js';
import { DECAL_SHAPE } from './decalLayer.js';

describe('building contact sizing', () => {
  it('grows with the footprint between 1.3 and 2.6 m', () => {
    expect(buildingContactMargin(1, 1)).toBe(1.3);
    expect(buildingContactMargin(21, 21)).toBe(2.6);
    expect(buildingContactMargin(5, 5)).toBeGreaterThan(buildingContactMargin(3, 3));
    // The short side decides: a long thin building does not get a huge ring.
    expect(buildingContactMargin(3, 30)).toBe(buildingContactMargin(3, 3));
  });

  it('gives a construction site a wider, dustier ring than a finished building', () => {
    const done = buildingContact(15, 13, false);
    const site = buildingContact(15, 13, true);
    expect(done.style.shape).toBe(DECAL_SHAPE.contact);
    expect(site.margin).toBeGreaterThan(done.margin);
    expect(site.style.fill).toBeGreaterThan(done.style.fill);
  });
});

describe('prop contact', () => {
  it('only large hard props get one: not trees, ground cover or small stones', () => {
    expect(propContact('rock', 1.5)).not.toBeNull();
    expect(propContact('crate', PROP_CONTACT_MIN_RADIUS)).not.toBeNull();
    expect(propContact('rock', PROP_CONTACT_MIN_RADIUS - 0.1)).toBeNull();
    expect(propContact('tree-leafy', 3)).toBeNull();
    expect(propContact('grass', 3)).toBeNull();
    expect(propContact('debris', 3)).toBeNull();
  });

  it('keeps the margin bounded', () => {
    expect(propContact('rock', 50)!.margin).toBe(1.8);
  });
});

describe('contact distance field', () => {
  const size = 32;

  it('measures meters to the nearest covered texel, anisotropic texels included', () => {
    const covered = new Uint8Array(size * size);
    covered[16 * size + 16] = 1;
    const bytes = distanceBytes(covered, size, 0.5, 0.5, 4);
    expect(bytes[16 * size + 16]).toBe(0);
    // Four texels along x = 2 m = half the 4 m range.
    expect(bytes[16 * size + 20]).toBe(Math.round((2 / 4) * 255));
    // Beyond the range it saturates.
    expect(bytes[0]).toBe(255);
  });

  it('bakes wall bases and legs but not what hangs above the slab', () => {
    // A vertical wall along z = 0 (0..2 m high) and a roof triangle 5 m up over z = 3..5.
    const positions = [-2, 0, 0, 2, 0, 0, 2, 2, 0, -2, 2, 0, 2, 5, 3, -2, 5, 3, -2, 5, 5];
    const indices = [0, 1, 2, 0, 2, 3, 4, 5, 6];
    const bytes = bakeContactField({
      positions,
      indices,
      scaleX: 1,
      scaleZ: 1,
      halfX: 4,
      halfZ: 4,
      size,
      maxDistance: 2,
    });
    const at = (x: number, z: number): number =>
      bytes[Math.floor((z + 4) / 0.25) * size + Math.floor((x + 4) / 0.25)]!;
    expect(at(0, 0)).toBe(0); // under the wall
    expect(at(0, 1)).toBeGreaterThan(0); // a meter in front of it
    expect(at(0, 1)).toBeLessThan(255);
    expect(at(0, 3.9)).toBe(255); // under the roof triangle: nothing touches the ground there
  });

  it('applies the instance scale to the mesh', () => {
    const positions = [0, 0, 1, 1, 0, 1, 1, 1, 1];
    const base = { positions, indices: null, scaleZ: 1, halfX: 4, halfZ: 4, size, maxDistance: 2 };
    const small = bakeContactField({ ...base, scaleX: 1 });
    const wide = bakeContactField({ ...base, scaleX: 3 });
    const at = (b: Uint8Array, x: number, z: number): number =>
      b[Math.floor((z + 4) / 0.25) * size + Math.floor((x + 4) / 0.25)]!;
    expect(at(small, 2.5, 1)).toBeGreaterThan(0);
    expect(at(wide, 2.5, 1)).toBe(0);
  });
});
