// Render-only refinement of the map's greybox terrain. The greybox (packages/map greyboxMesh) is one quad per 1 m cell
// with its own four vertices: flat cell colors, faceted normals, and on Rock Terrain 4 cliffs of 4 to 5 m over one or
// two cells. Lit as is, that reads as a field of tiles. refineTerrain resamples it into one shared-vertex grid:
//   - heights: the source surface sampled on a base grid (baseStep, 1 m: the greybox's own corners), then a
//     Catmull-Rom bicubic between them on a finer grid (subdivide vertices per base step), clamped to the four
//     surrounding base heights so cliff edges never overshoot into ridges or ditches;
//   - normals: central differences over that smooth surface (the terrain material reads the slope from them);
//   - occlusion: how much of the sky the surrounding terrain hides (8 directions, 1.5 and 4 m out), so the foot of a
//     cliff and the inside of a gully read darker without real lighting;
//   - colors: the source vertex colors at each fine vertex (barycentric on the source triangle), so passability
//     colors and marks blend over half a meter instead of stepping per cell.
// The sim never sees this; the renderer's height lookups (units, props, decals, picking) use the refined surface, so
// what stands on the ground matches what is drawn.
import { Color } from 'three/webgpu';
import type { TerrainGeometry, TerrainHeightField, TerrainHit } from './heightField.js';

export interface TerrainDetailOptions {
  /**
   * Fine vertices per base step along x and z. 1 regrids without subdividing (shared vertices, smooth normals),
   * 0 keeps the given mesh (normals from the height field when it has none). Default 2.
   */
  subdivide?: number;
  /** Spacing of the base samples, meters. Default 1 (the greybox's cell size). */
  baseStep?: number;
}

export const DEFAULT_SUBDIVIDE = 2;

/** A refined terrain: the grid plus a sky-occlusion factor per vertex (1 open, lower in hollows). */
export interface RefinedTerrain extends TerrainGeometry {
  occlusion?: Float32Array;
}

const OCCLUSION_RADII = [1.5, 4] as const;
/** How strongly a horizon angle darkens (per unit of tangent), and the floor. */
const OCCLUSION_GAIN = 0.55;
const OCCLUSION_MIN = 0.55;
/** Upper bound on fine vertices, so an odd mesh cannot make the renderer build millions of them. */
const MAX_VERTICES = 600_000;

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

/** Source vertex colors as sRGB floats 0..1 (the TerrainGeometry convention), or null without colors. */
function srgbAt(src: TerrainGeometry, vertex: number, out: [number, number, number]): boolean {
  const c = src.colors;
  if (!c) return false;
  const s = c instanceof Uint8Array ? 1 / 255 : 1;
  out[0] = c[vertex * 3]! * s;
  out[1] = c[vertex * 3 + 1]! * s;
  out[2] = c[vertex * 3 + 2]! * s;
  return true;
}

/** Normals from a height function by central differences over `step` meters (one-sided at the edges is implicit). */
export function heightFieldNormals(
  positions: Float32Array,
  height: (x: number, z: number) => number,
  step = 1,
): Float32Array {
  const out = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i]!;
    const z = positions[i + 2]!;
    const nx = height(x - step, z) - height(x + step, z);
    const nz = height(x, z - step) - height(x, z + step);
    const ny = 2 * step;
    const len = Math.hypot(nx, ny, nz);
    out[i] = nx / len;
    out[i + 1] = ny / len;
    out[i + 2] = nz / len;
  }
  return out;
}

/**
 * Resamples `src` (whose surface `hf` describes) into a smooth shared-vertex grid over the same bounds. Returns `src`
 * itself, with normals added when it had none, for `subdivide: 0`.
 */
export function refineTerrain(
  src: TerrainGeometry,
  hf: TerrainHeightField,
  opts: TerrainDetailOptions = {},
): RefinedTerrain {
  const sub = Math.max(0, Math.floor(opts.subdivide ?? DEFAULT_SUBDIVIDE));
  const base = opts.baseStep ?? 1;
  if (sub === 0) {
    if (src.normals) return src;
    return {
      ...src,
      normals: heightFieldNormals(src.positions, (x, z) => hf.heightAt(x, z, 0), base),
    };
  }
  const spanX = hf.maxX - hf.minX;
  const spanZ = hf.maxZ - hf.minZ;
  // Base grid: nb + 1 samples per axis, exactly over the bounds.
  const nbx = Math.max(1, Math.round(spanX / base));
  const nbz = Math.max(1, Math.round(spanZ / base));
  let s = sub;
  while (s > 1 && (nbx * s + 1) * (nbz * s + 1) > MAX_VERTICES) s--;
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
      let h = catmullRom(col[0]!, col[1]!, col[2]!, col[3]!, tz);
      const a = at(gi, gj);
      const b = at(gi + 1, gj);
      const c = at(gi, gj + 1);
      const d = at(gi + 1, gj + 1);
      h = Math.min(Math.max(h, Math.min(a, b, c, d)), Math.max(a, b, c, d));
      heights[j * nx + i] = h;
    }
  }

  const fx = bx / s;
  const fz = bz / s;
  const positions = new Float32Array(nx * nz * 3);
  const normals = new Float32Array(nx * nz * 3);
  const colors = src.colors ? new Float32Array(nx * nz * 3) : undefined;
  const hit: TerrainHit = { tri: 0, u: 0, v: 0, y: 0 };
  const c0: [number, number, number] = [0, 0, 0];
  const c1: [number, number, number] = [0, 0, 0];
  const c2: [number, number, number] = [0, 0, 0];
  const lin = new Color();
  const h = (i: number, j: number): number =>
    heights[Math.min(nz - 1, Math.max(0, j)) * nx + Math.min(nx - 1, Math.max(0, i))]!;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const o = (j * nx + i) * 3;
      const x = hf.minX + i * fx;
      const z = hf.minZ + j * fz;
      positions[o] = x;
      positions[o + 1] = heights[j * nx + i]!;
      positions[o + 2] = z;
      // Central differences over one fine step (one-sided at the border).
      const dx =
        (h(i + 1, j) - h(i - 1, j)) / ((Math.min(nx - 1, i + 1) - Math.max(0, i - 1) || 1) * fx);
      const dz =
        (h(i, j + 1) - h(i, j - 1)) / ((Math.min(nz - 1, j + 1) - Math.max(0, j - 1) || 1) * fz);
      const len = Math.hypot(dx, 1, dz);
      normals[o] = -dx / len;
      normals[o + 1] = 1 / len;
      normals[o + 2] = -dz / len;
      if (colors) {
        // Inset a hair so border vertices still find their triangle.
        const sx = Math.min(hf.maxX - 1e-4, Math.max(hf.minX + 1e-4, x));
        const sz = Math.min(hf.maxZ - 1e-4, Math.max(hf.minZ + 1e-4, z));
        if (hf.locate(sx, sz, hit)) {
          const [a, b, c] = hf.corners(hit.tri);
          srgbAt(src, a, c0);
          srgbAt(src, b, c1);
          srgbAt(src, c, c2);
          const w0 = 1 - hit.u - hit.v;
          // Blend in linear light, store sRGB again (the layer converts once).
          lin.setRGB(c0[0], c0[1], c0[2], 'srgb');
          let r = lin.r * w0;
          let g = lin.g * w0;
          let bl = lin.b * w0;
          lin.setRGB(c1[0], c1[1], c1[2], 'srgb');
          r += lin.r * hit.u;
          g += lin.g * hit.u;
          bl += lin.b * hit.u;
          lin.setRGB(c2[0], c2[1], c2[2], 'srgb');
          r += lin.r * hit.v;
          g += lin.g * hit.v;
          bl += lin.b * hit.v;
          lin.setRGB(r, g, bl).getRGB(lin, 'srgb');
          colors[o] = lin.r;
          colors[o + 1] = lin.g;
          colors[o + 2] = lin.b;
        } else {
          colors[o] = 0.55;
          colors[o + 1] = 0.5;
          colors[o + 2] = 0.42;
        }
      }
    }
  }

  const indices = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let k = 0;
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      const b = a + 1;
      const c = a + nx;
      const d = c + 1;
      // Counter-clockwise seen from above (+Y); split along the shorter diagonal in height, so ridges stay ridges.
      if (Math.abs(heights[a]! - heights[d]!) <= Math.abs(heights[b]! - heights[c]!)) {
        indices[k++] = a;
        indices[k++] = c;
        indices[k++] = d;
        indices[k++] = a;
        indices[k++] = d;
        indices[k++] = b;
      } else {
        indices[k++] = a;
        indices[k++] = c;
        indices[k++] = b;
        indices[k++] = b;
        indices[k++] = c;
        indices[k++] = d;
      }
    }
  }
  // Sky occlusion from the fine heights: mean positive horizon tangent over 8 directions at two radii.
  const occlusion = new Float32Array(nx * nz);
  const dirs = Array.from({ length: 8 }, (_, k) => [
    Math.cos((k * Math.PI) / 4),
    Math.sin((k * Math.PI) / 4),
  ]);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const h0 = heights[j * nx + i]!;
      let sum = 0;
      for (const r of OCCLUSION_RADII)
        for (const [cx, cz] of dirs) {
          const hi = h(Math.round(i + (cx! * r) / fx), Math.round(j + (cz! * r) / fz));
          sum += Math.max(0, (hi - h0) / r);
        }
      const mean = sum / (dirs.length * OCCLUSION_RADII.length);
      occlusion[j * nx + i] = Math.max(OCCLUSION_MIN, 1 - OCCLUSION_GAIN * mean);
    }
  }
  return colors
    ? { positions, indices, normals, colors, occlusion }
    : { positions, indices, normals, occlusion };
}
