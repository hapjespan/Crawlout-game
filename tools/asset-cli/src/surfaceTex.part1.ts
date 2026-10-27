// Split from surfaceTex.ts to stay under the 5,000-token file limit; surfaceTex.ts re-exports the public surface.
// Holds: the surface kinds, the kind of a material name, tileable noise and a minimal PNG writer.
//
// No image library: sharp is a heavyweight optional dependency of the texture steps and its API is async, while the
// building assembler (buildings.part1.ts) is synchronous. A greyscale-or-rgb PNG is a header, one deflate stream and
// a CRC, so the generator writes it itself and stays deterministic byte for byte.
import { deflateSync } from 'node:zlib';
import { SURFACE_KINDS, type SurfaceKind } from './manifest.js';

/**
 * The surface kinds live in manifest.ts: they are part of the contract with render (a shared tile is named after its
 * kind). Keep the ladder in `surfaceKindOfName` equal to `surfaceKindOfMaterial` in
 * packages/render/src/look/surfaces.ts; a drift means a material gets a generated relief that does not match the
 * roughness render gives it.
 */
export { SURFACE_KINDS, type SurfaceKind };

/** Surface kind of a glTF material name; the same ladder (and the same order) as render's surfaceKindOfMaterial. */
export function surfaceKindOfName(name: string): SurfaceKind {
  const n = name.toLowerCase();
  if (/lens|visor|glass/.test(n)) return 'lens';
  if (/rust|corrod/.test(n)) return 'rustMetal';
  if (/rubber|track|tyre|tire|opening/.test(n)) return 'leather';
  if (/metal|steel|iron|pipe|tank|pole|mast|sheet|tin/.test(n)) return 'paintedMetal';
  if (/roof|shingle|tar/.test(n)) return 'roofing';
  if (/concrete|slab|cement|brick|stone/.test(n)) return 'concrete';
  if (/team_trim|trim/.test(n)) return 'paintedMetal';
  if (/team|cloth|fabric|canvas|flag|banner|tarp/.test(n)) return 'cloth';
  if (/leather/.test(n)) return 'leather';
  if (/skin|flesh/.test(n)) return 'skin';
  if (/rock|cliff/.test(n)) return 'rock';
  if (/leaf|grass|foliage|bush/.test(n)) return 'foliage';
  return 'wood';
}

/** Deterministic hash of a lattice point to 0..1; integer mix, no Math.random, stable across platforms. */
export function hash2(x: number, y: number, seed: number): number {
  let h = (x | 0) * 374761393 + (y | 0) * 668265263 + (seed | 0) * 1442695041;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const smooth = (t: number): number => t * t * (3 - 2 * t);

/** Value noise on a lattice that wraps every `period` cells, so the tile repeats seamlessly. */
export function valueNoise(x: number, y: number, period: number, seed: number): number {
  const wrap = (v: number): number => ((v % period) + period) % period;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);
  const [ax, ay] = [wrap(x0), wrap(y0)];
  const [bx, by] = [wrap(x0 + 1), wrap(y0 + 1)];
  const n00 = hash2(ax, ay, seed);
  const n10 = hash2(bx, ay, seed);
  const n01 = hash2(ax, by, seed);
  const n11 = hash2(bx, by, seed);
  return (n00 * (1 - fx) + n10 * fx) * (1 - fy) + (n01 * (1 - fx) + n11 * fx) * fy;
}

/** Fractal sum of `octaves` of tileable value noise over a tile of `period` base cells; result 0..1. */
export function fbm(x: number, y: number, period: number, octaves: number, seed: number): number {
  let sum = 0;
  let amplitude = 1;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const p = period * 2 ** o;
    sum += valueNoise(x * 2 ** o, y * 2 ** o, p, seed + o * 7919) * amplitude;
    total += amplitude;
    amplitude *= 0.5;
  }
  return sum / total;
}

/** Noise stretched along y by `aspect` (wood grain, brushed metal): same lattice, anisotropic sampling. */
export function streak(x: number, y: number, period: number, aspect: number, seed: number): number {
  return fbm(x, y / aspect, period, 3, seed);
}

/** Distance to the nearest line of a grid of `cells` lines across the tile, 0 on the line, 1 halfway between. */
export function gridLine(v: number, cells: number): number {
  const t = v * cells;
  const d = Math.abs(t - Math.round(t));
  return Math.min(1, d * 2);
}

/**
 * Distance to the nearest of `cells` lines across the tile, in tile units (so a width can be given in metres over
 * UV_METERS_PER_TILE and keeps its size whatever the grid). Runs from 0 on a line to 1 / (2 * cells) between them.
 */
export function gridDist(v: number, cells: number): number {
  const t = v * cells;
  return Math.abs(t - Math.round(t)) / cells;
}

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

export const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Smoothstep between two edges. */
export function smoothstep(edge0: number, edge1: number, v: number): number {
  const t = clamp01((v - edge0) / (edge1 - edge0 || 1e-6));
  return t * t * (3 - 2 * t);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(body.length + 12);
  const view = new DataView(out.buffer);
  view.setUint32(0, body.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);
  view.setUint32(body.length + 8, crc32(out.subarray(4, body.length + 8)));
  return out;
}

/** An 8-bit RGB PNG from `rgb` (width * height * 3 bytes), filter 0 on every scanline. */
export function encodePng(width: number, height: number, rgb: Uint8Array): Uint8Array {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: truecolour
  const raw = new Uint8Array(height * (width * 3 + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    raw.set(rgb.subarray(y * width * 3, (y + 1) * width * 3), y * (width * 3 + 1) + 1);
  }
  const parts = [
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', new Uint8Array(deflateSync(raw, { level: 9 }))),
    chunk('IEND', new Uint8Array(0)),
  ];
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const png = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    png.set(p, offset);
    offset += p.length;
  }
  return png;
}
