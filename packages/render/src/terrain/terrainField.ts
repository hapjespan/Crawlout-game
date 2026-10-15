// The refined terrain as a regular grid of samples (render only): what terrainRefine.ts used to turn straight into one
// mesh, kept as arrays so the chunked terrain (terrainChunks.ts) can cut it into chunks at several resolutions, and so
// height lookups and picking are O(1) on a grid instead of a search through a million triangles.
//   - heights: the source surface on a base grid (baseStep, 1 m), Catmull-Rom bicubic in between on the fine grid
//     (subdivide samples per base step), clamped to the four surrounding base heights so cliffs never overshoot;
//   - colors: the source vertex colors at each sample (barycentric on the source triangle), sRGB bytes;
//   - occlusion: how much sky the surrounding terrain hides (8 directions, 1.5 and 4 m out), 1 open.
// A grid cell is split along its shorter diagonal in height (ridges stay ridges); GridHeightField and every chunk use
// that same split, so what stands on the ground matches what is drawn at the finest level.
import { Color } from 'three/webgpu';
import type { TerrainGeometry, TerrainHeightField, TerrainHit } from './heightField.js';

/** What height lookups need: TerrainHeightField (arbitrary triangles) and GridHeightField (a field) both fit. */
export interface HeightSource {
  readonly minX: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxZ: number;
  /** Height at (x, z), or `fallback` outside. */
  heightAt(x: number, z: number, fallback?: number): number;
  /** Lowest and highest height, meters. */
  heightRange(): [number, number];
}

export interface TerrainField {
  minX: number;
  minZ: number;
  /** Meters between two samples. */
  step: number;
  /** Samples per axis. */
  nx: number;
  nz: number;
  /** nx * nz heights, row by row (index j * nx + i, j along z). */
  heights: Float32Array;
  /** sRGB rgb bytes per sample, or null when the source has no colors. */
  colors: Uint8Array | null;
  /** Sky occlusion per sample, 1 open, lower in hollows. */
  occlusion: Float32Array;
}

export interface TerrainFieldOptions {
  /** Fine samples per base step. Default 2 (0.5 m on the 1 m greybox). */
  subdivide?: number;
  /** Spacing of the base samples, meters. Default 1. */
  baseStep?: number;
  /** Upper bound on samples; the subdivision drops until it fits. Default 4.2 million (a 1 km map at 0.5 m). */
  maxSamples?: number;
}

const OCCLUSION_RADII = [1.5, 4] as const;
/** How strongly a horizon angle darkens (per unit of tangent), and the floor. */
const OCCLUSION_GAIN = 0.55;
const OCCLUSION_MIN = 0.55;
export const FIELD_MAX_SAMPLES = 4_200_000;

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 +
      (p2 - p0) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (3 * p1 - p0 - 3 * p2 + p3) * t3)
  );
}

/** Resamples the surface `hf` (of `src`) into a field over its bounds. */
export function buildTerrainField(
  src: TerrainGeometry,
  hf: TerrainHeightField,
  opts: TerrainFieldOptions = {},
): TerrainField {
  const sub = Math.max(1, Math.floor(opts.subdivide ?? 2));
  const base = opts.baseStep ?? 1;
  const maxSamples = opts.maxSamples ?? FIELD_MAX_SAMPLES;
  const spanX = hf.maxX - hf.minX;
  const spanZ = hf.maxZ - hf.minZ;
  const nbx = Math.max(1, Math.round(spanX / base));
  const nbz = Math.max(1, Math.round(spanZ / base));
  let s = sub;
  while (s > 1 && (nbx * s + 1) * (nbz * s + 1) > maxSamples) s--;
  const bx = spanX / nbx;
  const bz = spanZ / nbz;
  const H = new Float32Array((nbx + 1) * (nbz + 1));
  for (let j = 0; j <= nbz; j++)
    for (let i = 0; i <= nbx; i++)
      H[j * (nbx + 1) + i] = hf.heightAt(hf.minX + i * bx, hf.minZ + j * bz, 0);
  const at = (i: number, j: number): number =>
    H[Math.min(nbz, Math.max(0, j)) * (nbx + 1) + Math.min(nbx, Math.max(0, i))]!;

  const nx = nbx * s + 1;
  const nz = nbz * s + 1;
  const heights = new Float32Array(nx * nz);
  const col = [0, 0, 0, 0];
  for (let j = 0; j < nz; j++) {
    const gj = Math.min(nbz - 1, Math.floor(j / s));
    const tz = j / s - gj;
    for (let i = 0; i < nx; i++) {
      const gi = Math.min(nbx - 1, Math.floor(i / s));
      const tx = i / s - gi;
      for (let k = 0; k < 4; k++)
        col[k] = catmullRom(
          at(gi - 1, gj - 1 + k),
          at(gi, gj - 1 + k),
          at(gi + 1, gj - 1 + k),
          at(gi + 2, gj - 1 + k),
          tx,
        );
      const h = catmullRom(col[0]!, col[1]!, col[2]!, col[3]!, tz);
      const a = at(gi, gj);
      const b = at(gi + 1, gj);
      const c = at(gi, gj + 1);
      const d = at(gi + 1, gj + 1);
      heights[j * nx + i] = Math.min(Math.max(h, Math.min(a, b, c, d)), Math.max(a, b, c, d));
    }
  }
  const step = bx / s;
  const field: TerrainField = {
    minX: hf.minX,
    minZ: hf.minZ,
    step,
    nx,
    nz,
    heights,
    colors: src.colors ? sampleColors(src, hf, hf.minX, hf.minZ, step, nx, nz) : null,
    occlusion: new Float32Array(nx * nz),
  };
  computeOcclusion(field);
  return field;
}

/** Source vertex colors at each sample, blended in linear light, stored as sRGB bytes. */
function sampleColors(
  src: TerrainGeometry,
  hf: TerrainHeightField,
  minX: number,
  minZ: number,
  step: number,
  nx: number,
  nz: number,
): Uint8Array {
  const c = src.colors!;
  const scale = c instanceof Uint8Array ? 1 / 255 : 1;
  // Linear rgb of every source vertex, once.
  const lin = new Float32Array(c.length);
  const tmp = new Color();
  for (let v = 0; v < c.length; v += 3) {
    tmp.setRGB(c[v]! * scale, c[v + 1]! * scale, c[v + 2]! * scale, 'srgb');
    lin[v] = tmp.r;
    lin[v + 1] = tmp.g;
    lin[v + 2] = tmp.b;
  }
  const out = new Uint8Array(nx * nz * 3);
  const hit: TerrainHit = { tri: 0, u: 0, v: 0, y: 0 };
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const o = (j * nx + i) * 3;
      // Inset a hair so border samples still find their triangle.
      const x = Math.min(hf.maxX - 1e-4, Math.max(hf.minX + 1e-4, minX + i * step));
      const z = Math.min(hf.maxZ - 1e-4, Math.max(hf.minZ + 1e-4, minZ + j * step));
      if (hf.locate(x, z, hit)) {
        const [a, b, cc] = hf.corners(hit.tri);
        const w0 = 1 - hit.u - hit.v;
        tmp.setRGB(
          lin[a * 3]! * w0 + lin[b * 3]! * hit.u + lin[cc * 3]! * hit.v,
          lin[a * 3 + 1]! * w0 + lin[b * 3 + 1]! * hit.u + lin[cc * 3 + 1]! * hit.v,
          lin[a * 3 + 2]! * w0 + lin[b * 3 + 2]! * hit.u + lin[cc * 3 + 2]! * hit.v,
        );
        tmp.getRGB(tmp, 'srgb');
        out[o] = Math.round(tmp.r * 255);
        out[o + 1] = Math.round(tmp.g * 255);
        out[o + 2] = Math.round(tmp.b * 255);
      } else {
        out[o] = 140;
        out[o + 1] = 128;
        out[o + 2] = 107;
      }
    }
  }
  return out;
}

/** Sky occlusion from the field's heights: mean positive horizon tangent over 8 directions at two radii. */
export function computeOcclusion(field: TerrainField): void {
  const { nx, nz, heights, step, occlusion } = field;
  const h = (i: number, j: number): number =>
    heights[Math.min(nz - 1, Math.max(0, j)) * nx + Math.min(nx - 1, Math.max(0, i))]!;
  const offsets: [number, number, number][] = [];
  for (const r of OCCLUSION_RADII)
    for (let k = 0; k < 8; k++)
      offsets.push([
        Math.round((Math.cos((k * Math.PI) / 4) * r) / step),
        Math.round((Math.sin((k * Math.PI) / 4) * r) / step),
        r,
      ]);
  const n = offsets.length;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const h0 = heights[j * nx + i]!;
      let sum = 0;
      for (const [di, dj, r] of offsets) sum += Math.max(0, (h(i + di, j + dj) - h0) / r);
      occlusion[j * nx + i] = Math.max(OCCLUSION_MIN, 1 - (OCCLUSION_GAIN * sum) / n);
    }
  }
}

/** True when the cell whose low corner is sample (i, j) splits along a-d (low corner to high corner). */
export function splitsAlongAD(heights: Float32Array, nx: number, i: number, j: number): boolean {
  const a = j * nx + i;
  return (
    Math.abs(heights[a]! - heights[a + nx + 1]!) <= Math.abs(heights[a + 1]! - heights[a + nx]!)
  );
}

/** O(1) height lookup on a field, on the same triangles the finest chunks draw. */
export class GridHeightField implements HeightSource {
  readonly minX: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxZ: number;

  constructor(readonly field: TerrainField) {
    this.minX = field.minX;
    this.minZ = field.minZ;
    this.maxX = field.minX + (field.nx - 1) * field.step;
    this.maxZ = field.minZ + (field.nz - 1) * field.step;
  }

  heightAt(x: number, z: number, fallback = 0): number {
    const f = this.field;
    if (x < this.minX || x > this.maxX || z < this.minZ || z > this.maxZ) return fallback;
    const gx = (x - f.minX) / f.step;
    const gz = (z - f.minZ) / f.step;
    const i = Math.min(f.nx - 2, Math.floor(gx));
    const j = Math.min(f.nz - 2, Math.floor(gz));
    if (i < 0 || j < 0) return f.heights[0] ?? fallback; // a field of one sample
    const fx = gx - i;
    const fz = gz - j;
    const H = f.heights;
    const o = j * f.nx + i;
    const a = H[o]!;
    const b = H[o + 1]!;
    const c = H[o + f.nx]!;
    const d = H[o + f.nx + 1]!;
    if (Math.abs(a - d) <= Math.abs(b - c)) {
      // Triangles a-c-d (fz >= fx) and a-d-b.
      return fz >= fx ? a + fz * (c - a) + fx * (d - c) : a + fx * (b - a) + fz * (d - b);
    }
    // Triangles a-c-b (fx + fz <= 1) and b-c-d.
    return fx + fz <= 1
      ? a + fx * (b - a) + fz * (c - a)
      : d + (1 - fx) * (c - d) + (1 - fz) * (b - d);
  }

  heightRange(): [number, number] {
    let lo = Infinity;
    let hi = -Infinity;
    for (const y of this.field.heights) {
      if (y < lo) lo = y;
      if (y > hi) hi = y;
    }
    return Number.isFinite(lo) ? [lo, hi] : [0, 0];
  }
}

/**
 * First point where a ray meets the terrain, by marching in steps of `step` meters inside the bounds and bisecting the
 * crossing. Writes the point into `out` and returns true, or false when the ray misses within `maxDistance`.
 */
export function raycastHeight(
  hs: HeightSource,
  origin: { x: number; y: number; z: number },
  dir: { x: number; y: number; z: number },
  out: { x: number; y: number; z: number },
  opts: { step?: number; maxDistance?: number } = {},
): boolean {
  const step = opts.step ?? 0.25;
  const maxDistance = opts.maxDistance ?? 2000;
  // Clip the ray against the bounds in x and z.
  let t0 = 0;
  let t1 = maxDistance;
  for (const [o, d, lo, hi] of [
    [origin.x, dir.x, hs.minX, hs.maxX],
    [origin.z, dir.z, hs.minZ, hs.maxZ],
  ] as const) {
    if (Math.abs(d) < 1e-12) {
      if (o < lo || o > hi) return false;
      continue;
    }
    let a = (lo - o) / d;
    let b = (hi - o) / d;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
  }
  if (t0 > t1) return false;
  const above = (t: number): number =>
    origin.y + dir.y * t - hs.heightAt(origin.x + dir.x * t, origin.z + dir.z * t, -Infinity);
  let prev = t0;
  if (above(prev) <= 0) {
    out.x = origin.x + dir.x * prev;
    out.y = origin.y + dir.y * prev;
    out.z = origin.z + dir.z * prev;
    return true;
  }
  for (let t = t0 + step; ; t += step) {
    const tc = Math.min(t, t1);
    if (above(tc) <= 0) {
      let lo = prev;
      let hi = tc;
      for (let k = 0; k < 20; k++) {
        const mid = (lo + hi) / 2;
        if (above(mid) <= 0) hi = mid;
        else lo = mid;
      }
      out.x = origin.x + dir.x * hi;
      out.y = origin.y + dir.y * hi;
      out.z = origin.z + dir.z * hi;
      return true;
    }
    if (tc >= t1) return false;
    prev = tc;
  }
}
