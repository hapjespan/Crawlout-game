// Safe normalisation of terrain normals. A normal that is zero, tiny or not finite (a vertex only degenerate triangles
// touch, the sum of two opposite normals at a seam, NaN from a bad height) turns `normalize` into 0 / 0 = NaN, and
// every term built on it (slope = 1 - N.y, the toon ramp, the triplanar weights w0 / (w0.x + w0.y + w0.z), the shadow
// lookup offset) turns NaN with it: black or flickering pixels in some views. So terrain normals are made safe at the
// source, in the geometry (sanitizeNormals) and again in the shader (safeNormalNode), and both fall back to straight up.
import type { BufferAttribute, BufferGeometry, Node } from 'three/webgpu';
import { dot, float, inverseSqrt, max, select, vec3 } from 'three/tsl';

/** Squared length under which a normal counts as zero. */
export const NORMAL_MIN_LENGTH_SQ = 1e-8;

/** Normalises (x, y, z) into `out`; a zero, tiny or non-finite vector becomes straight up (0, 1, 0). Returns whether it had to fall back. */
export function safeNormalize(
  x: number,
  y: number,
  z: number,
  out: { x: number; y: number; z: number },
): boolean {
  const l2 = x * x + y * y + z * z;
  if (!(l2 > NORMAL_MIN_LENGTH_SQ) || !Number.isFinite(l2)) {
    out.x = 0;
    out.y = 1;
    out.z = 0;
    return true;
  }
  const inv = 1 / Math.sqrt(l2);
  out.x = x * inv;
  out.y = y * inv;
  out.z = z * inv;
  return false;
}

/** TSL form of safeNormalize: the same fallback, no branch (a NaN input compares false and falls back too). */
export function safeNormalNode(n: Node<'vec3'>): Node<'vec3'> {
  const l2 = dot(n, n);
  const unit = n.mul(inverseSqrt(max(l2, float(NORMAL_MIN_LENGTH_SQ))));
  return select(l2.greaterThan(NORMAL_MIN_LENGTH_SQ), unit, vec3(0, 1, 0));
}

/** Makes every normal of a geometry unit length and finite (zero and non-finite ones point up). Returns how many fell back. */
export function sanitizeNormals(geometry: BufferGeometry): number {
  const normals = geometry.getAttribute('normal') as BufferAttribute | undefined;
  if (!normals) return 0;
  const v = { x: 0, y: 0, z: 0 };
  let fallbacks = 0;
  for (let i = 0; i < normals.count; i++) {
    if (safeNormalize(normals.getX(i), normals.getY(i), normals.getZ(i), v)) fallbacks++;
    normals.setXYZ(i, v.x, v.y, v.z);
  }
  if (fallbacks > 0) normals.needsUpdate = true;
  return fallbacks;
}
