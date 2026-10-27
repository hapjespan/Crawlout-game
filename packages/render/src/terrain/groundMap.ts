// The ground map: what the land is like at each meter of the map, computed once on the CPU from the heights, the
// water and the grass props (render only, nothing here reaches the sim). The terrain material (groundSplat.ts) reads
// it to choose its layers, and the vegetation scatter (vegetation/) reads the same fields, so the plants grow where
// the ground looks like it would carry them: one landscape instead of separate pieces.
//
//   R moisture  1 at the water, falling off over MOISTURE_REACH_M, plus a little in hollows (the ground there holds water)
//   G cover     how much of the ground is grown over: smooth noise, more in the meadows of the grass props, more near
//               water, less on ridges and steep ground
//   B ridge     convexity of the ground against its surroundings, 0..1 (0.5 flat): rock comes out on ridges and
//               crests, gravel and sediment settle in the hollows
//   A macro     smooth noise over tens of meters, for large-scale variation of hue and brightness
import { ClampToEdgeWrapping, DataTexture, LinearFilter, RGBAFormat } from 'three/webgpu';
import { fractalNoise } from './noiseTexture.js';

/** Edge of one ground-map texel, meters. */
export const GROUND_CELL_M = 1;
/** Distance (m) over which the moisture from the water falls to 1/e. */
export const MOISTURE_REACH_M = 7;
/** Radius (m) of the neighbourhood the ridge and hollow measure compares against. */
export const RIDGE_RADIUS_M = 6;
/** Meters of height above the neighbourhood that make a full ridge (or below it, a full hollow). */
export const RIDGE_SPAN_M = 1.6;

export interface GroundMapInput {
  bounds: { minX: number; minZ: number; maxX: number; maxZ: number };
  heightAt: (x: number, z: number) => number;
  /**
   * Meters the map reaches past `bounds` on every side (the skirt beyond the map edge reads it too, so the ground
   * there continues instead of smearing the edge texels outward). Default 0.
   */
  margin?: number;
  /** Water cells (non-zero = water) over `bounds`, row 0 at minZ. */
  water?: { w: number; h: number; data: ArrayLike<number> } | null;
  /** Grass density (0..255) over its own rectangle (grassMask.ts). */
  grass?: {
    w: number;
    h: number;
    minX: number;
    minZ: number;
    sizeX: number;
    sizeZ: number;
    data: Uint8Array;
  } | null;
  seed?: number;
}

export interface GroundMap {
  w: number;
  h: number;
  minX: number;
  minZ: number;
  sizeX: number;
  sizeZ: number;
  /** The map's own rectangle inside (bounds without the margin): where the water and passability grids lie. */
  inner: { minX: number; minZ: number; sizeX: number; sizeZ: number };
  /** w * h * 4 bytes (moisture, cover, ridge, macro), row 0 at minZ. */
  data: Uint8Array;
}

/** Box blur of a w x h field, radius r texels, separable (clamped edges). */
function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = -r; k <= r; k++) s += src[y * w + Math.min(w - 1, Math.max(0, x + k))]!;
      tmp[y * w + x] = s / (2 * r + 1);
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = -r; k <= r; k++) s += tmp[Math.min(h - 1, Math.max(0, y + k)) * w + x]!;
      out[y * w + x] = s / (2 * r + 1);
    }
  return out;
}

/** Distance (texels) to the nearest marked texel: two-pass chamfer (1, sqrt 2). Infinity without any. */
export function distanceField(marked: Uint8Array, w: number, h: number): Float32Array {
  const d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = marked[i] ? 0 : Infinity;
  const D = Math.SQRT2;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const k = y * w + x;
      let v = d[k]!;
      if (x > 0) v = Math.min(v, d[k - 1]! + 1);
      if (y > 0) {
        v = Math.min(v, d[k - w]! + 1);
        if (x > 0) v = Math.min(v, d[k - w - 1]! + D);
        if (x < w - 1) v = Math.min(v, d[k - w + 1]! + D);
      }
      d[k] = v;
    }
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      const k = y * w + x;
      let v = d[k]!;
      if (x < w - 1) v = Math.min(v, d[k + 1]! + 1);
      if (y < h - 1) {
        v = Math.min(v, d[k + w]! + 1);
        if (x < w - 1) v = Math.min(v, d[k + w + 1]! + D);
        if (x > 0) v = Math.min(v, d[k + w - 1]! + D);
      }
      d[k] = v;
    }
  return d;
}

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function buildGroundMap(input: GroundMapInput, cell = GROUND_CELL_M): GroundMap {
  const { heightAt, water, grass } = input;
  const margin = input.margin ?? 0;
  const inner = {
    minX: input.bounds.minX,
    minZ: input.bounds.minZ,
    sizeX: input.bounds.maxX - input.bounds.minX,
    sizeZ: input.bounds.maxZ - input.bounds.minZ,
  };
  const bounds = {
    minX: input.bounds.minX - margin,
    minZ: input.bounds.minZ - margin,
    maxX: input.bounds.maxX + margin,
    maxZ: input.bounds.maxZ + margin,
  };
  const seed = input.seed ?? 3;
  const sizeX = bounds.maxX - bounds.minX;
  const sizeZ = bounds.maxZ - bounds.minZ;
  const w = Math.max(2, Math.ceil(sizeX / cell));
  const h = Math.max(2, Math.ceil(sizeZ / cell));
  const xOf = (i: number): number => bounds.minX + ((i + 0.5) / w) * sizeX;
  const zOf = (j: number): number => bounds.minZ + ((j + 0.5) / h) * sizeZ;

  const height = new Float32Array(w * h);
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) height[j * w + i] = heightAt(xOf(i), zOf(j));
  const mean = boxBlur(height, w, h, Math.max(1, Math.round(RIDGE_RADIUS_M / cell)));
  const wide = boxBlur(height, w, h, Math.max(1, Math.round((RIDGE_RADIUS_M * 3) / cell)));

  // Water cells resampled onto this grid, then the distance to them.
  const wet = new Uint8Array(w * h);
  if (water && water.w > 0 && water.h > 0)
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) {
        const wi = Math.floor(((xOf(i) - inner.minX) / inner.sizeX) * water.w);
        const wj = Math.floor(((zOf(j) - inner.minZ) / inner.sizeZ) * water.h);
        if (wi < 0 || wj < 0 || wi >= water.w || wj >= water.h) continue;
        if (water.data[wj * water.w + wi]) wet[j * w + i] = 1;
      }
  const toWater = distanceField(wet, w, h);

  const grassAt = (x: number, z: number): number => {
    if (!grass) return 0;
    const gi = Math.floor(((x - grass.minX) / grass.sizeX) * grass.w);
    const gj = Math.floor(((z - grass.minZ) / grass.sizeZ) * grass.h);
    if (gi < 0 || gj < 0 || gi >= grass.w || gj >= grass.h) return 0;
    return grass.data[gj * grass.w + gi]! / 255;
  };

  const coverCells = Math.max(2, Math.round(Math.max(sizeX, sizeZ) / 24));
  const macroCells = Math.max(2, Math.round(Math.max(sizeX, sizeZ) / 80));
  const data = new Uint8Array(w * h * 4);
  const to8 = (v: number): number => Math.round(Math.min(1, Math.max(0, v)) * 255);
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const k = j * w + i;
      const x = xOf(i);
      const z = zOf(j);
      // Lattice noise wraps per tile: one tile over the whole map, cells of about 24 m (cover) and 80 m (macro).
      const u = (x - bounds.minX) / sizeX;
      const v = (z - bounds.minZ) / sizeZ;
      const ridge = 0.5 + ((height[k]! - mean[k]!) / RIDGE_SPAN_M) * 0.5;
      const hollow = smooth(0.3, 2.5, wide[k]! - height[k]!);
      const moist = Math.max(Math.exp((-toWater[k]! * cell) / MOISTURE_REACH_M), hollow * 0.3);
      // Local steepness from the neighbours (m per m).
      const gx =
        (height[j * w + Math.min(w - 1, i + 1)]! - height[j * w + Math.max(0, i - 1)]!) /
        (2 * cell);
      const gz =
        (height[Math.min(h - 1, j + 1) * w + i]! - height[Math.max(0, j - 1) * w + i]!) /
        (2 * cell);
      const steep = smooth(0.35, 0.9, Math.hypot(gx, gz));
      const noise = fractalNoise(u, v, coverCells, 4, seed);
      const cover =
        0.15 +
        0.75 * smooth(0.35, 0.7, noise) +
        0.55 * grassAt(x, z) +
        0.45 * moist -
        0.7 * smooth(0.6, 0.9, ridge) -
        0.9 * steep;
      data[k * 4] = to8(moist);
      data[k * 4 + 1] = to8(cover);
      data[k * 4 + 2] = to8(ridge);
      data[k * 4 + 3] = to8(fractalNoise(u, v, macroCells, 3, seed + 17));
    }
  return { w, h, minX: bounds.minX, minZ: bounds.minZ, sizeX, sizeZ, inner, data };
}

/** The ground map as a GPU texture: bilinear, clamped (the skirt beyond the map reads the edge). */
export function createGroundMapTexture(map: GroundMap): DataTexture {
  const t = new DataTexture(map.data, map.w, map.h, RGBAFormat);
  t.minFilter = t.magFilter = LinearFilter;
  t.wrapS = t.wrapT = ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}
