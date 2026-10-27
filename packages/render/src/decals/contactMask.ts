// Distance field of a building's ground contact, baked from its own mesh: the contact decal of a compound (a house
// with a water tower in a 21 m footprint) must darken where walls and legs meet the ground, not the whole footprint.
// The mesh's surface is sampled where it lies within CONTACT_SLAB meters of the ground (wall bases, legs, steps),
// splatted into a grid that covers the decal quad (footprint plus margin), and turned into a distance field in meters
// (stored as bytes over 0..maxDistance, bilinear filtering gives a smooth edge). Pure arrays in, bytes out.

/** Mesh surface higher than this above its ground (m) does not touch the ground: eaves, roofs, tank. */
export const CONTACT_SLAB = 1.1;

export interface ContactMaskInput {
  /** Vertex positions xyz in model space (ground at y 0, origin at the footprint center). */
  positions: ArrayLike<number>;
  /** Triangle indices, or null for a non-indexed list of triangles. */
  indices: ArrayLike<number> | null;
  /** Instance scale along x and z (data footprint over model footprint). */
  scaleX: number;
  scaleZ: number;
  /** Half size of the grid in meters: the decal's half size (footprint half plus margin). */
  halfX: number;
  halfZ: number;
  /** Texels per side. */
  size: number;
  /** Distances beyond this (m) store as 255. */
  maxDistance: number;
}

/**
 * Bytes (size x size, row 0 at -halfZ) with the distance in meters to the nearest ground contact of the mesh,
 * stored as round(min(d, maxDistance) / maxDistance * 255); 0 where the mesh touches the ground.
 */
export function bakeContactField(input: ContactMaskInput): Uint8Array {
  const { positions, indices, scaleX, scaleZ, halfX, halfZ, size, maxDistance } = input;
  const tx = (2 * halfX) / size;
  const tz = (2 * halfZ) / size;
  const covered = new Uint8Array(size * size);
  const triangles = (indices ? indices.length : positions.length / 3) / 3;
  const step = Math.min(tx, tz) * 0.5; // sample spacing on the surface, meters
  const at = (v: number, c: number): number => positions[v * 3 + c]!;
  const splat = (x: number, z: number): void => {
    const i = Math.floor((x + halfX) / tx);
    const j = Math.floor((z + halfZ) / tz);
    if (i >= 0 && i < size && j >= 0 && j < size) covered[j * size + i] = 1;
  };
  for (let t = 0; t < triangles; t++) {
    const a = indices ? indices[t * 3]! : t * 3;
    const b = indices ? indices[t * 3 + 1]! : t * 3 + 1;
    const c = indices ? indices[t * 3 + 2]! : t * 3 + 2;
    if (Math.min(at(a, 1), at(b, 1), at(c, 1)) > CONTACT_SLAB) continue;
    const ax = at(a, 0) * scaleX;
    const ay = at(a, 1);
    const az = at(a, 2) * scaleZ;
    const e1x = at(b, 0) * scaleX - ax;
    const e1y = at(b, 1) - ay;
    const e1z = at(b, 2) * scaleZ - az;
    const e2x = at(c, 0) * scaleX - ax;
    const e2y = at(c, 1) - ay;
    const e2z = at(c, 2) * scaleZ - az;
    const longest = Math.max(
      Math.hypot(e1x, e1y, e1z),
      Math.hypot(e2x, e2y, e2z),
      Math.hypot(e1x - e2x, e1y - e2y, e1z - e2z),
    );
    const n = Math.min(64, Math.max(1, Math.ceil(longest / step)));
    for (let i = 0; i <= n; i++)
      for (let j = 0; j <= n - i; j++) {
        const u = i / n;
        const v = j / n;
        if (ay + e1y * u + e2y * v > CONTACT_SLAB) continue;
        splat(ax + e1x * u + e2x * v, az + e1z * u + e2z * v);
      }
  }
  return distanceBytes(covered, size, tx, tz, maxDistance);
}

/** Two-pass chamfer distance (meters, anisotropic texels) from covered cells, as bytes over 0..maxDistance. */
export function distanceBytes(
  covered: Uint8Array,
  size: number,
  tx: number,
  tz: number,
  maxDistance: number,
): Uint8Array {
  const far = maxDistance * 4;
  const d = new Float32Array(size * size);
  for (let k = 0; k < d.length; k++) d[k] = covered[k] ? 0 : far;
  const diag = Math.hypot(tx, tz);
  const relax = (i: number, j: number, di: number, dj: number, w: number): void => {
    const ni = i + di;
    const nj = j + dj;
    if (ni < 0 || ni >= size || nj < 0 || nj >= size) return;
    const v = d[nj * size + ni]! + w;
    if (v < d[j * size + i]!) d[j * size + i] = v;
  };
  for (let j = 0; j < size; j++)
    for (let i = 0; i < size; i++) {
      relax(i, j, -1, 0, tx);
      relax(i, j, 0, -1, tz);
      relax(i, j, -1, -1, diag);
      relax(i, j, 1, -1, diag);
    }
  for (let j = size - 1; j >= 0; j--)
    for (let i = size - 1; i >= 0; i--) {
      relax(i, j, 1, 0, tx);
      relax(i, j, 0, 1, tz);
      relax(i, j, 1, 1, diag);
      relax(i, j, -1, 1, diag);
    }
  const out = new Uint8Array(size * size);
  for (let k = 0; k < out.length; k++) out[k] = Math.round(Math.min(1, d[k]! / maxDistance) * 255);
  return out;
}
