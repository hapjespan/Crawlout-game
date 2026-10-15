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
import type { TerrainGeometry, TerrainHeightField } from './heightField.js';
import { buildTerrainField, splitsAlongAD, type TerrainField } from './terrainField.js';

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

/** Upper bound on fine vertices, so an odd mesh cannot make the renderer build millions of them in one mesh. */
const MAX_VERTICES = 600_000;

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
  const field = buildTerrainField(src, hf, {
    subdivide: sub,
    baseStep: base,
    maxSamples: MAX_VERTICES,
  });
  return fieldMesh(field);
}

/** The whole field as one shared-vertex mesh: normals over one step, colors as sRGB floats, the field's split. */
export function fieldMesh(field: TerrainField): RefinedTerrain {
  const { nx, nz, heights, step, minX, minZ } = field;
  const positions = new Float32Array(nx * nz * 3);
  const normals = new Float32Array(nx * nz * 3);
  const colors = field.colors ? new Float32Array(nx * nz * 3) : undefined;
  const h = (i: number, j: number): number =>
    heights[Math.min(nz - 1, Math.max(0, j)) * nx + Math.min(nx - 1, Math.max(0, i))]!;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const o = (j * nx + i) * 3;
      positions[o] = minX + i * step;
      positions[o + 1] = heights[j * nx + i]!;
      positions[o + 2] = minZ + j * step;
      // Central differences over one step (one-sided at the border).
      const dx =
        (h(i + 1, j) - h(i - 1, j)) / ((Math.min(nx - 1, i + 1) - Math.max(0, i - 1) || 1) * step);
      const dz =
        (h(i, j + 1) - h(i, j - 1)) / ((Math.min(nz - 1, j + 1) - Math.max(0, j - 1) || 1) * step);
      const len = Math.hypot(dx, 1, dz);
      normals[o] = -dx / len;
      normals[o + 1] = 1 / len;
      normals[o + 2] = -dz / len;
      if (colors) for (let k = 0; k < 3; k++) colors[o + k] = field.colors![o + k]! / 255;
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
      if (splitsAlongAD(heights, nx, i, j)) indices.set([a, c, d, a, d, b], k);
      else indices.set([a, c, b, b, c, d], k);
      k += 6;
    }
  }
  const occlusion = field.occlusion.slice();
  return colors
    ? { positions, indices, normals, colors, occlusion }
    : { positions, indices, normals, occlusion };
}
