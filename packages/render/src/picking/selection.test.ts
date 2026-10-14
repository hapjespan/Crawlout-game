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
