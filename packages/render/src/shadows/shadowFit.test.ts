import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three/webgpu';
import { SUN_DIR } from '../lighting/lightRig.js';
import {
  fitShadowFrustum,
  lightBasis,
  MIN_SIDE,
  quantizeSide,
  SIZE_STEP,
  type ShadowFitInput,
  type Vec3,
} from './shadowFit.js';
import { pcfRadius, RADIUS_TEXELS } from './sunShadow.js';

/** An RTS camera looking at (tx, 0, tz) from `distance` at `pitch` degrees, yaw 45 degrees like the game's. */
function rtsInput(
  tx: number,
  tz: number,
  distance: number,
  pitch: number,
  mapSize = 4096,
): ShadowFitInput {
  const cam = new PerspectiveCamera(45, 16 / 9, 0.5, 2000);
  const p = (pitch * Math.PI) / 180;
  const yaw = Math.PI / 4;
  const h = distance * Math.cos(p);
  cam.position.set(tx + Math.sin(yaw) * h, distance * Math.sin(p), tz + Math.cos(yaw) * h);
  cam.lookAt(tx, 0, tz);
  cam.updateMatrixWorld();
  const corners = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([x, y]) => new Vector3(x, y, 1).unproject(cam).sub(cam.position));
  return {
    eye: cam.position.clone(),
    corners,
    groundLo: -2,
    groundHi: 6,
    maxDistance: 520,
    sunDir: SUN_DIR,
    mapSize,
  };
}

function toLight(fit: ReturnType<typeof fitShadowFrustum>, sun: Vec3, p: Vec3): Vec3 {
  const b = lightBasis(sun);
  const r = { x: p.x - fit.position.x, y: p.y - fit.position.y, z: p.z - fit.position.z };
  const dot = (a: Vec3, c: Vec3): number => a.x * c.x + a.y * c.y + a.z * c.z;
  return { x: dot(r, b.x), y: dot(r, b.y), z: -dot(r, b.z) };
}

describe('fitShadowFrustum', () => {
  it('covers the visible ground at base zoom with a tight rectangle', () => {
    const fit = fitShadowFrustum(rtsInput(100, 100, 40, 55));
    for (const p of fit.points) {
      const l = toLight(fit, SUN_DIR, p);
      expect(l.x).toBeGreaterThanOrEqual(fit.left);
      expect(l.x).toBeLessThanOrEqual(fit.right);
      expect(l.y).toBeGreaterThanOrEqual(fit.bottom);
      expect(l.y).toBeLessThanOrEqual(fit.top);
      expect(l.z).toBeGreaterThan(fit.near);
      expect(l.z).toBeLessThan(fit.far);
    }
    // Far tighter than the old fixed 2 x 46 m square: the view at 40 m spans well under 150 m either way.
    expect(fit.right - fit.left).toBeLessThan(150);
    expect(fit.top - fit.bottom).toBeLessThan(150);
    expect(fit.texelX).toBeLessThan(0.04);
  });

  it('reaches towards the sun for casters taller than the ground', () => {
    const input = rtsInput(100, 100, 40, 55);
    const fit = fitShadowFrustum({ ...input, casterHeight: 30 });
    const top = toLight(fit, SUN_DIR, { x: 100, y: input.groundHi + 25, z: 100 });
    expect(top.z).toBeGreaterThan(fit.near);
  });

  it('grows with the zoom but stops at maxDistance', () => {
    const near = fitShadowFrustum(rtsInput(100, 100, 40, 55));
    const far = fitShadowFrustum(rtsInput(100, 100, 384, 74));
    expect(far.right - far.left).toBeGreaterThan(near.right - near.left);
    for (const p of far.points) {
      const eye = rtsInput(100, 100, 384, 74).eye;
      expect(Math.hypot(p.x - eye.x, p.y - eye.y, p.z - eye.z)).toBeLessThanOrEqual(520 + 1e-6);
    }
  });

  it('snaps to whole texels, so a small pan keeps the texel grid', () => {
    const a = fitShadowFrustum(rtsInput(100, 100, 60, 58));
    const b = fitShadowFrustum(rtsInput(100.37, 99.81, 60, 58));
    expect(b.right - b.left).toBeCloseTo(a.right - a.left, 9);
    const k = (b.left - a.left) / a.texelX;
    expect(Math.abs(k - Math.round(k))).toBeLessThan(1e-6);
    const j = (b.bottom - a.bottom) / a.texelY;
    expect(Math.abs(j - Math.round(j))).toBeLessThan(1e-6);
  });

  it('keeps the light camera in one place (absolute light space)', () => {
    const a = fitShadowFrustum(rtsInput(0, 0, 40, 55));
    const b = fitShadowFrustum(rtsInput(300, 200, 120, 66));
    expect(b.position).toEqual(a.position);
  });

  it('clamps rays that miss the ground (looking at the horizon) at maxDistance', () => {
    const input = rtsInput(0, 0, 40, 55);
    const fit = fitShadowFrustum({
      ...input,
      corners: [{ x: 1, y: 0.2, z: 0 }, ...input.corners.slice(1)],
    });
    expect(fit.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.z))).toBe(true);
  });
});

describe('shadow helpers', () => {
  it('lightBasis is orthonormal with z towards the sun', () => {
    const b = lightBasis(SUN_DIR);
    const dot = (a: Vec3, c: Vec3): number => a.x * c.x + a.y * c.y + a.z * c.z;
    expect(dot(b.x, b.y)).toBeCloseTo(0, 9);
    expect(dot(b.x, b.z)).toBeCloseTo(0, 9);
    expect(dot(b.z, SUN_DIR)).toBeCloseTo(1, 9);
    expect(lightBasis({ x: 0, y: 1, z: 0 }).x).toEqual({ x: 1, y: 0, z: 0 });
  });

  it('quantizeSide rounds up onto the size ladder', () => {
    expect(quantizeSide(1)).toBe(MIN_SIDE);
    for (const s of [17, 50, 99.9, 400]) {
      const q = quantizeSide(s);
      expect(q).toBeGreaterThanOrEqual(s);
      expect(q).toBeLessThan(s * SIZE_STEP + 1e-9);
    }
  });

  it('pcfRadius aims at a fixed penumbra within its texel range', () => {
    expect(pcfRadius(0.001)).toBe(RADIUS_TEXELS[1]);
    expect(pcfRadius(1)).toBe(RADIUS_TEXELS[0]);
    expect(pcfRadius(0.07)).toBeCloseTo(2, 5);
  });
});
