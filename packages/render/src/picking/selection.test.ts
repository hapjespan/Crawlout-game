import { describe, expect, it } from 'vitest';
import { Matrix4, PerspectiveCamera } from 'three/webgpu';
import { ENTITY_FLAG } from '@crawlout/protocol';
import { createInterpolatedFrame, type InterpolatedFrame } from '../snapshot/interpolate.js';
import { pickEntity, pickNearestOnScreen, PICK_CENTER_HEIGHT, selectInRect } from './selection.js';

function frameOf(
  units: { id: number; x: number; z: number; owner?: number; flags?: number }[],
): InterpolatedFrame {
  const f = createInterpolatedFrame(units.length);
  units.forEach((u, i) => {
    f.id[i] = u.id;
    f.x[i] = u.x;
    f.z[i] = u.z;
    f.owner[i] = u.owner ?? 0;
    f.flags[i] = u.flags ?? 0;
  });
  f.count = units.length;
  return f;
}

function topDown(): { viewProj: Matrix4 } {
  const cam = new PerspectiveCamera(60, 1, 0.1, 500);
  cam.position.set(0, 50, 0.001);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();
  cam.updateProjectionMatrix();
  return { viewProj: new Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse) };
}

describe('selectInRect', () => {
  const frame = frameOf([
    { id: 1, x: 0, z: 0 },
    { id: 2, x: 10, z: 0, owner: 1 },
    { id: 3, x: -10, z: -10 },
    { id: 4, x: 1, z: 1, flags: ENTITY_FLAG.dead },
  ]);
  const { viewProj } = topDown();

  it('selects units whose center projects into the rectangle, in any corner order', () => {
    expect(
      selectInRect(frame, viewProj.elements, 800, 800, { x0: 380, y0: 380, x1: 420, y1: 420 }),
    ).toEqual([1]);
    expect(
      selectInRect(frame, viewProj.elements, 800, 800, { x0: 800, y0: 800, x1: 0, y1: 0 }).sort(),
    ).toEqual([1, 2, 3]);
  });

  it('filters on owner and skips dead units unless asked', () => {
    expect(
      selectInRect(
        frame,
        viewProj.elements,
        800,
        800,
        { x0: 0, y0: 0, x1: 800, y1: 800 },
        { owner: 1 },
      ),
    ).toEqual([2]);
    expect(
      selectInRect(
        frame,
        viewProj.elements,
        800,
        800,
        { x0: 0, y0: 0, x1: 800, y1: 800 },
        { includeDead: true },
      ),
    ).toContain(4);
  });
});

describe('pickEntity', () => {
  const frame = frameOf([
    { id: 1, x: 0, z: 0 },
    { id: 2, x: 0, z: 5 },
    { id: 3, x: 3, z: 0, flags: ENTITY_FLAG.dead },
  ]);

  it('returns the nearest unit along the ray', () => {
    // Horizontal ray at chest height from far +Z towards -Z passes through unit 2, then unit 1.
    expect(pickEntity(frame, 0, PICK_CENTER_HEIGHT, 50, 0, 0, -1)).toBe(1);
    // From far -Z the first hit is unit 1 (index 0).
    expect(pickEntity(frame, 0, PICK_CENTER_HEIGHT, -50, 0, 0, 1)).toBe(0);
  });

  it('misses empty space and dead units', () => {
    expect(pickEntity(frame, 20, PICK_CENTER_HEIGHT, 50, 0, 0, -1)).toBe(-1);
    expect(pickEntity(frame, 3, 30, 0, 0, -1, 0)).toBe(-1);
  });
});

describe('pickNearestOnScreen', () => {
  // Unit 1 sits in the screen center of the top-down camera (see selectInRect), unit 2 further off.
  const frame = frameOf([
    { id: 1, x: 0, z: 0 },
    { id: 2, x: 10, z: 0 },
    { id: 3, x: 0.2, z: 0, flags: ENTITY_FLAG.dead },
  ]);
  const { viewProj } = topDown();

  it('picks the unit next to a click that just misses it', () => {
    expect(pickNearestOnScreen(frame, viewProj.elements, 800, 800, 410, 405)).toBe(0);
  });

  it('ignores clicks further away than the tolerance and dead units', () => {
    expect(pickNearestOnScreen(frame, viewProj.elements, 800, 800, 400, 600)).toBe(-1);
    expect(pickNearestOnScreen(frame, viewProj.elements, 800, 800, 410, 405, 4)).toBe(-1);
  });
});

describe('pickEntity with a building box', () => {
  // A 21 x 21 m building with its top at 14 m (house plus water tower), a unit and the camera of the RTS view.
  const HQ_HALF = 10.5 + 0.5;
  const HQ_TOP = 14;
  const hq = frameOf([
    { id: 1, x: 0, z: 0 },
    { id: 2, x: 40, z: 40 },
  ]);
  type Scratch = { radius: number; height: number; halfX?: number; halfZ?: number; top?: number };
  const shape = (i: number, out: Scratch) => {
    if (i !== 0) return null;
    out.radius = 10.5;
    out.height = 6;
    out.halfX = HQ_HALF;
    out.halfZ = HQ_HALF;
    out.top = HQ_TOP;
    return out;
  };

  /** Ray from an RTS-angle camera (pitch 55 degrees) at `dist` m through a world point. */
  function rayThrough(px: number, py: number, pz: number, dist = 60) {
    const pitch = (55 * Math.PI) / 180;
    const ox = 0;
    const oy = dist * Math.sin(pitch);
    const oz = dist * Math.cos(pitch);
    const len = Math.hypot(px - ox, py - oy, pz - oz);
    return [ox, oy, oz, (px - ox) / len, (py - oy) / len, (pz - oz) / len] as const;
  }

  it('hits the roof, the walls and the far corner that a sphere around the center misses', () => {
    for (const [x, y, z] of [
      [0, HQ_TOP, 0],
      [-9, HQ_TOP - 0.5, 9],
      [8, 1.5, 10.4],
      [-10, HQ_TOP - 0.2, -10],
    ] as const) {
      expect(pickEntity(hq, ...rayThrough(x, y, z), shape)).toBe(0);
    }
  });

  it('misses ground beside the building and the air behind and above it', () => {
    expect(pickEntity(hq, ...rayThrough(16, 0, 0), shape)).toBe(-1);
    expect(pickEntity(hq, ...rayThrough(0, 25, -15), shape)).toBe(-1);
  });

  it('works at the far zoom (140 m) as well', () => {
    expect(pickEntity(hq, ...rayThrough(0, HQ_TOP, 5, 140), shape)).toBe(0);
    expect(pickEntity(hq, ...rayThrough(10, 2, 10, 140), shape)).toBe(0);
  });

  it('prefers a unit that stands at the wall over the building behind it', () => {
    const f = frameOf([
      { id: 1, x: 0, z: 0 },
      { id: 2, x: 0, z: 11.5 }, // a builder at the front wall
    ]);
    const [ox, oy, oz, dx, dy, dz] = rayThrough(0, PICK_CENTER_HEIGHT, 11.5);
    expect(pickEntity(f, ox, oy, oz, dx, dy, dz, shape)).toBe(1);
  });

  it('does not let the box of one building leak into the next entity (shared scratch)', () => {
    const f = frameOf([
      { id: 1, x: 0, z: 0 },
      { id: 2, x: 30, z: 0 },
    ]);
    // entity 1 has no shape of its own: it is a unit sphere, not the box entity 0 left in the shared scratch
    expect(pickEntity(f, 36, 0.9, 0, -1, 0, 0, shape)).toBe(1);
    expect(pickEntity(f, 30, 8, 0, 0.0001, -1, 0, shape)).toBe(1);
    expect(pickEntity(f, 30, 8, 3, 0, -1, 0, shape)).toBe(-1);
  });
});
