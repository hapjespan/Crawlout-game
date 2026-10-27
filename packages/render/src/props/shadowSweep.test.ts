import { describe, expect, it } from 'vitest';
import { Box3, Frustum, Matrix4, OrthographicCamera, Vector3 } from 'three/webgpu';
import { SUN_DIR } from '../lighting/lightRig.js';
import { SHADOW_SWEEP_SLACK, sweepAlongShadow } from './shadowSweep.js';

const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Box3 =>
  new Box3(new Vector3(x0, y0, z0), new Vector3(x1, y1, z1));

describe('sweepAlongShadow', () => {
  it('grows the box away from the sun by its height over the sun elevation, and by the slack', () => {
    const sun = new Vector3(0.6, 0.64, 0.48).normalize();
    const out = sweepAlongShadow(box(0, 0, 0, 10, 10, 10), sun, new Box3());
    const len = 10 / sun.y;
    // The sun is on the +x +z side, so the shadow runs to -x and -z.
    expect(out.min.x).toBeCloseTo(-sun.x * len - SHADOW_SWEEP_SLACK, 6);
    expect(out.min.z).toBeCloseTo(-sun.z * len - SHADOW_SWEEP_SLACK, 6);
    // The sun's own side only gets the slack.
    expect(out.max.x).toBeCloseTo(10 + SHADOW_SWEEP_SLACK, 6);
    expect(out.max.z).toBeCloseTo(10 + SHADOW_SWEEP_SLACK, 6);
  });

  it('mirrors for a sun on the other side', () => {
    const sun = new Vector3(-0.6, 0.64, -0.48).normalize();
    const out = sweepAlongShadow(box(0, 0, 0, 4, 4, 4), sun, new Box3());
    expect(out.max.x).toBeGreaterThan(4 + SHADOW_SWEEP_SLACK);
    expect(out.min.x).toBeCloseTo(-SHADOW_SWEEP_SLACK, 6);
  });

  it('keeps a flat box flat plus slack, and an empty box empty', () => {
    const flat = sweepAlongShadow(box(0, 1, 0, 2, 1, 2), SUN_DIR, new Box3());
    expect(flat.max.x - flat.min.x).toBeCloseTo(2 + 2 * SHADOW_SWEEP_SLACK, 6);
    expect(sweepAlongShadow(new Box3(), SUN_DIR, new Box3()).isEmpty()).toBe(true);
  });

  it('stays finite for a sun on the horizon', () => {
    const out = sweepAlongShadow(box(0, 0, 0, 1, 20, 1), new Vector3(1, 0, 0), new Box3());
    expect(Number.isFinite(out.min.x)).toBe(true);
    expect(out.max.x - out.min.x).toBeLessThan(200);
  });

  it('sees a tree outside the view on the shadow side, not one on the sun side', () => {
    // A view over the ground square x, z in [-10, 10], seen straight down. The sun stands on the -z side, so shadows run
    // towards +z: a 12 m tree 12 m beyond the -z edge reaches into the view with a 19 m shadow, one beyond +z does not.
    const cam = new OrthographicCamera(-10, 10, 10, -10, 1, 100);
    cam.up.set(0, 0, -1);
    cam.position.set(0, 50, 0);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld();
    const f = new Frustum().setFromProjectionMatrix(
      new Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse),
    );
    const sun = new Vector3(0, 0.64, -0.77).normalize();
    const tree = (z: number): Box3 => box(-1, 0, z, 1, 12, z + 2);
    const near = tree(-24);
    const far = tree(22);
    expect(f.intersectsBox(near)).toBe(false);
    expect(f.intersectsBox(far)).toBe(false);
    expect(f.intersectsBox(sweepAlongShadow(near, sun, new Box3()))).toBe(true);
    expect(f.intersectsBox(sweepAlongShadow(far, sun, new Box3()))).toBe(false);
  });
});
