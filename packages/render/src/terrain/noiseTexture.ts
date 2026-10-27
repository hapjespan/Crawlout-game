// Noise primitives for the terrain's generated textures (groundLayers.ts, groundMap.ts), and the CPU mip chain those
// textures carry. Everything is tileable: lattice noise with modular lattice coordinates, cellular noise with modular
// cells, so a tile repeats without seams. The mip chain is built here (box filter), so no backend has to generate
// mipmaps and every level exists on WebGL2 and WebGPU alike.

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

export interface DetailTexels {
  size: number;
  /** size * size * 4 bytes, row 0 first. */
  data: Uint8Array;
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
