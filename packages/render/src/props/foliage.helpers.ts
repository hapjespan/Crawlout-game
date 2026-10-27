// Split from foliage.test.ts to stay under the 5,000-token file limit.
import type { DecalLayer } from '../decals/decalLayer.js';
import { Vector3, PerspectiveCamera } from 'three/webgpu';

export const heightAt = (): number => 0;

export function fakeDecals(): DecalLayer {
  return { push: () => {}, pushContact: () => {} } as unknown as DecalLayer;
}

export function camera(at: Vector3, lookAt: Vector3): PerspectiveCamera {
  const c = new PerspectiveCamera(45, 1, 0.5, 800);
  c.position.copy(at);
  c.lookAt(lookAt);
  c.updateMatrixWorld();
  return c;
}
