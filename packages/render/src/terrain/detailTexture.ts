// Tiling detail texture of the terrain, generated on the CPU at start (no asset to ship, no download): one RGBA8 tile
// that the terrain material samples at several scales for close-up grit and pebbles. Data, not colour, so it
// is NoColorSpace and the shader decodes it:
//
//   R = grit brightness around 0.5 (fine value noise, pebbles with their own tone)
//   G = normal x of the same relief, B = normal z (0.5 flat), so the detail can bend the shading normal
//   A = macro variation 0..1 (smooth, low frequency): sampled at tens of meters it breaks up large flat areas
//
// Every feature wraps at the tile edge (lattice noise with modular lattice coordinates, cellular noise with modular
// cells), so the tile repeats without seams. The mip chain is built here (box filter, the normal channels flatten at
// distance on their own), so no backend has to generate mipmaps and every level exists on WebGL2 and WebGPU alike.
import {
  DataTexture,
  LinearMipmapLinearFilter,
  LinearFilter,
  NoColorSpace,
  RGBAFormat,
  RepeatWrapping,
  UnsignedByteType,
} from 'three/webgpu';

/** Edge of the generated tile, texels (a power of two). */
export const DETAIL_SIZE = 256;

/** Deterministic hash of lattice coordinates and a seed to 0..1. */
export function hash2(x: number, y: number, seed: number): number {
  let h =
    Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);
const wrap = (i: number, n: number): number => ((i % n) + n) % n;

/** Tileable value noise at (u, v) in 0..1 with `cells` lattice cells per tile: 0..1. */
export function valueNoise(u: number, v: number, cells: number, seed: number): number {
  const x = u * cells;
  const y = v * cells;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = fade(x - x0);
  const fy = fade(y - y0);
  const a = hash2(wrap(x0, cells), wrap(y0, cells), seed);
  const b = hash2(wrap(x0 + 1, cells), wrap(y0, cells), seed);
  const c = hash2(wrap(x0, cells), wrap(y0 + 1, cells), seed);
  const d = hash2(wrap(x0 + 1, cells), wrap(y0 + 1, cells), seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** Tileable fractal noise: octaves of valueNoise from `baseCells` up, 0..1 (normalised by the amplitude sum). */
export function fractalNoise(
  u: number,
  v: number,
  baseCells: number,
  octaves: number,
  seed: number,
): number {
  let sum = 0;
  let amp = 1;
  let total = 0;
  let cells = baseCells;
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise(u, v, cells, seed + o * 31) * amp;
    total += amp;
    amp *= 0.5;
    cells *= 2;
  }
  return sum / total;
}

/** Tileable cellular noise: distances to the nearest (f1) and second nearest (f2) jittered point, in cell units, and the nearest cell's id hash. */
export function cellular(
  u: number,
  v: number,
  cells: number,
  seed: number,
): { f1: number; f2: number; id: number } {
  const x = u * cells;
  const y = v * cells;
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  let f1 = 9;
  let f2 = 9;
  let id = 0;
  for (let j = -1; j <= 1; j++)
    for (let i = -1; i <= 1; i++) {
      const gx = cx + i;
      const gy = cy + j;
      const wx = wrap(gx, cells);
      const wy = wrap(gy, cells);
      const px = gx + 0.15 + 0.7 * hash2(wx, wy, seed);
      const py = gy + 0.15 + 0.7 * hash2(wx, wy, seed + 7);
      const dist = Math.hypot(px - x, py - y);
      if (dist < f1) {
        f2 = f1;
        f1 = dist;
        id = hash2(wx, wy, seed + 13);
      } else if (dist < f2) f2 = dist;
    }
  return { f1, f2, id };
}

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export interface DetailTexels {
  size: number;
  /** size * size * 4 bytes, row 0 first. */
  data: Uint8Array;
}

/** Strength of the relief in the stored normal: slope per texel of height, before the shader's own strength. */
const NORMAL_GAIN = 5;
/** Standard deviation of the grit channel (0..1 scale) around its 0.5 mean. */
export const GRIT_SPREAD = 0.15;

/**
 * The detail tile. Relief = fine fbm + pebbles (cellular, round tops with their own tone, only in some cells). The
 * cracks of the ground come from the real albedo underneath; a cellular crack network here read as a tiled pattern.
 */
export function generateDetailTexels(size: number = DETAIL_SIZE, seed = 1): DetailTexels {
  const n = size;
  const height = new Float32Array(n * n);
  const grit = new Float32Array(n * n);
  const macro = new Float32Array(n * n);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n;
      const v = (y + 0.5) / n;
      const fine = fractalNoise(u, v, 16, 4, seed) - 0.5;
      // Pebbles: only some cells hold one, each with its own size and tone; between them the grit stays.
      const pebble = cellular(u, v, 22, seed + 100);
      const holds = pebble.id > 0.5;
      const radius = 0.16 + 0.3 * ((pebble.id - 0.5) * 2); // in cell units
      const top = holds ? 1 - smooth(radius * 0.45, radius, pebble.f1) : 0;
      const tone = (hash2(Math.floor(pebble.id * 4096), 5, seed) - 0.5) * 0.6;
      height[y * n + x] = fine * 0.5 + top * 0.3;
      grit[y * n + x] = fine * 0.7 + top * tone * 0.5;
      macro[y * n + x] = fractalNoise(u, v, 2, 3, seed + 300);
    }
  // The macro field spans less than 0..1 (averaged octaves): stretch it so the shader gets the full range.
  let lo = Infinity;
  let hi = -Infinity;
  for (const m of macro) {
    if (m < lo) lo = m;
    if (m > hi) hi = m;
  }
  let gritMean = 0;
  for (const g of grit) gritMean += g;
  gritMean /= grit.length;
  let gritVar = 0;
  for (const g of grit) gritVar += (g - gritMean) ** 2;
  // Fixed contrast whatever the feature mix: the shader's gains then mean the same thing for every seed.
  const gritScale = GRIT_SPREAD / Math.max(1e-6, Math.sqrt(gritVar / grit.length));
  const data = new Uint8Array(n * n * 4);
  const to8 = (v: number): number => Math.round(Math.min(1, Math.max(0, v)) * 255);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const k = y * n + x;
      const dx = height[y * n + wrap(x + 1, n)]! - height[y * n + wrap(x - 1, n)]!;
      const dz = height[wrap(y + 1, n) * n + x]! - height[wrap(y - 1, n) * n + x]!;
      data[k * 4] = to8(0.5 + (grit[k]! - gritMean) * gritScale);
      data[k * 4 + 1] = to8(0.5 - dx * NORMAL_GAIN * 0.5);
      data[k * 4 + 2] = to8(0.5 - dz * NORMAL_GAIN * 0.5);
      data[k * 4 + 3] = to8((macro[k]! - lo) / Math.max(1e-6, hi - lo));
    }
  return { size: n, data };
}

export interface MipLevel {
  width: number;
  height: number;
  data: Uint8Array;
}

/** Box-filtered mip chain of an RGBA8 square image, level 0 (the input) first, down to 1 x 1. */
export function buildMipChain(base: DetailTexels): MipLevel[] {
  const levels: MipLevel[] = [{ width: base.size, height: base.size, data: base.data }];
  let w = base.size;
  while (w > 1) {
    const src = levels[levels.length - 1]!;
    const nw = w >> 1;
    const out = new Uint8Array(nw * nw * 4);
    for (let y = 0; y < nw; y++)
      for (let x = 0; x < nw; x++)
        for (let c = 0; c < 4; c++) {
          const i = (2 * y * w + 2 * x) * 4 + c;
          out[(y * nw + x) * 4 + c] = Math.round(
            (src.data[i]! + src.data[i + 4]! + src.data[i + w * 4]! + src.data[i + w * 4 + 4]!) / 4,
          );
        }
    levels.push({ width: nw, height: nw, data: out });
    w = nw;
  }
  return levels;
}

/** The detail tile as a GPU texture: repeat wrap, trilinear with the CPU mip chain, anisotropic, data (no colour space). */
export function createDetailTexture(size: number = DETAIL_SIZE, seed = 1): DataTexture {
  const levels = buildMipChain(generateDetailTexels(size, seed));
  const t = new DataTexture(levels[0]!.data, size, size, RGBAFormat, UnsignedByteType);
  t.mipmaps = levels;
  t.generateMipmaps = false;
  t.colorSpace = NoColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.anisotropy = 8;
  t.flipY = false;
  t.needsUpdate = true;
  return t;
}
