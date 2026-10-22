// The fog of war as a small texture on the vision grid (2 m cells, protocol FogMask), pure and testable: no three.js here.
//
// The sim answers a `fog` query with two bitsets (explored, visible) on the vision grid. The renderer needs them as a
// smooth field it can sample in every material: FogField decodes the bitsets, blurs the edges (two passes of a binomial
// 1-2-1 kernel; the GPU's bilinear filter adds the rest, so a visibility edge is about three cells wide, 6 m), and fades
// the texels towards the new target over a few hundred milliseconds instead of jumping when a unit steps into the next
// cell. The result is an RGBA8 buffer: R = visibility (0 hidden .. 255 seen now), G = explored (255 once seen at some
// time; never below R), B = a static grain (the texture of the unexplored dark), A = 255.
//
// The query runs at a few Hz; the fade runs per frame, but only while a texel is still moving (step() answers whether
// the buffer changed, so the caller uploads only then).
import type { FogMask } from '@crawlout/protocol';

/** Per second: how fast a texel closes on its target (e^-9 per second: about a quarter second to settle). */
export const FOG_FADE_RATE = 9;

/** Blur passes over the decoded mask: two give an edge of about 3 cells (6 m) that the bilinear filter rounds off. */
export const FOG_BLUR_PASSES = 2;

/** Channels of the decoded mask: [visible, explored] per cell, 0 or 255. */
const MASK_CHANNELS = 2;

/** Decodes the bitsets of a FogMask into `out` (2 bytes per cell: visible, explored; each 0 or 255). */
export function decodeFogMask(mask: FogMask, out: Uint8Array): void {
  const n = mask.cellsW * mask.cellsH;
  for (let c = 0; c < n; c++) {
    const bit = 1 << (c & 7);
    const byte = c >> 3;
    const visible = (mask.visible[byte]! & bit) !== 0;
    const explored = visible || (mask.explored[byte]! & bit) !== 0;
    out[c * 2] = visible ? 255 : 0;
    out[c * 2 + 1] = explored ? 255 : 0;
  }
}

/**
 * One 1-2-1 blur pass over a 2-channel field in x then y, edges replicated: `src` into `out` (floats, same layout),
 * `tmp` a float scratch of the same size. `out` may be `src` itself (it is read completely before it is written).
 */
export function blurFogChannels(
  src: ArrayLike<number>,
  w: number,
  h: number,
  tmp: Float32Array,
  out: Float32Array,
): void {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const xl = x > 0 ? x - 1 : 0;
      const xr = x < w - 1 ? x + 1 : x;
      const i = (y * w + x) * MASK_CHANNELS;
      const l = (y * w + xl) * MASK_CHANNELS;
      const r = (y * w + xr) * MASK_CHANNELS;
      for (let ch = 0; ch < MASK_CHANNELS; ch++)
        tmp[i + ch] = (src[l + ch]! + 2 * src[i + ch]! + src[r + ch]!) * 0.25;
    }
  }
  for (let y = 0; y < h; y++) {
    const yu = y > 0 ? y - 1 : 0;
    const yd = y < h - 1 ? y + 1 : y;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * MASK_CHANNELS;
      const u = (yu * w + x) * MASK_CHANNELS;
      const d = (yd * w + x) * MASK_CHANNELS;
      for (let ch = 0; ch < MASK_CHANNELS; ch++)
        out[i + ch] = (tmp[u + ch]! + 2 * tmp[i + ch]! + tmp[d + ch]!) * 0.25;
    }
  }
}

/** A 0..1 hash of an integer lattice point (deterministic, no Math.random: the grain is the same every run). */
function hash2(x: number, y: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Static grain, one byte per cell: value noise on a lattice of 4 cells (soft blotches, about 8 m) plus a per-cell hash
 * (fine), so the unexplored dark is not a flat fill and the relief of the map edge stays readable in it.
 */
export function fogGrain(w: number, h: number, out: Uint8Array, stride = 4): void {
  const lattice = (lx: number, ly: number): number => hash2(lx, ly);
  for (let y = 0; y < h; y++) {
    const fy = y / stride;
    const y0 = Math.floor(fy);
    const ty = fy - y0;
    const sy = ty * ty * (3 - 2 * ty);
    for (let x = 0; x < w; x++) {
      const fx = x / stride;
      const x0 = Math.floor(fx);
      const tx = fx - x0;
      const sx = tx * tx * (3 - 2 * tx);
      const a = lattice(x0, y0) + (lattice(x0 + 1, y0) - lattice(x0, y0)) * sx;
      const b = lattice(x0, y0 + 1) + (lattice(x0 + 1, y0 + 1) - lattice(x0, y0 + 1)) * sx;
      const soft = a + (b - a) * sy;
      const fine = hash2(x + 7919, y + 104729);
      out[y * w + x] = Math.round(255 * (0.7 * soft + 0.3 * fine));
    }
  }
}

/** What setMask() did with a mask. */
export type FogMaskChange = 'same' | 'changed' | 'resized';

export class FogField {
  width = 0;
  height = 0;
  /** RGBA8, width * height texels (see the file comment); the texture's data. */
  data: Uint8Array = new Uint8Array(0);
  /** Counts resizes: the owner creates a new texture when it changes. */
  generation = 0;
  /** World size of the field in sim units per cell (FogMask.cellUnits). */
  cellUnits = 512;

  private decoded: Uint8Array = new Uint8Array(0);
  private scratch: Uint8Array = new Uint8Array(0);
  private tmp: Float32Array = new Float32Array(0);
  private target: Float32Array = new Float32Array(0);
  private current: Float32Array = new Float32Array(0);
  private settled = true;
  private hasMask = false;

  constructor(private readonly fadeRate = FOG_FADE_RATE) {}

  /**
   * Takes a mask from the sim. The first mask (and one of another size) is shown at once; later ones fade in step().
   * Returns whether anything differs from the previous mask: an identical one costs one decode and a compare.
   */
  setMask(mask: FogMask): FogMaskChange {
    const { cellsW: w, cellsH: h } = mask;
    const resized = w !== this.width || h !== this.height;
    if (resized) this.resize(w, h);
    this.cellUnits = mask.cellUnits;
    decodeFogMask(mask, this.scratch);
    if (!resized && this.hasMask && sameBytes(this.scratch, this.decoded)) return 'same';
    const swap = this.decoded;
    this.decoded = this.scratch;
    this.scratch = swap;
    blurFogChannels(this.decoded, w, h, this.tmp, this.target);
    for (let pass = 1; pass < FOG_BLUR_PASSES; pass++)
      blurFogChannels(this.target, w, h, this.tmp, this.target);
    const first = resized || !this.hasMask;
    this.hasMask = true;
    if (first) {
      this.current.set(this.target);
      this.write(true);
      this.settled = true;
      return 'resized';
    }
    this.settled = false;
    return 'changed';
  }

  /** Moves the texels towards the target by dt seconds. Returns true when `data` changed (upload the texture). */
  step(dt: number): boolean {
    if (this.settled || !this.hasMask || dt <= 0) return false;
    const k = 1 - Math.exp(-dt * this.fadeRate);
    const cur = this.current;
    const tgt = this.target;
    let moving = false;
    for (let i = 0; i < cur.length; i++) {
      const d = tgt[i]! - cur[i]!;
      if (d === 0) continue;
      if (Math.abs(d) < 0.6) cur[i] = tgt[i]!;
      else {
        cur[i] = cur[i]! + d * k;
        moving = true;
      }
    }
    this.settled = !moving;
    return this.write(false);
  }

  /** True once the fade has reached the target (step() would do nothing). */
  get isSettled(): boolean {
    return this.settled;
  }

  /** The target (blurred, not faded) of cell (cx, cy): [visible, explored], 0..255. For tests. */
  targetAt(cx: number, cy: number): [number, number] {
    const i = (cy * this.width + cx) * MASK_CHANNELS;
    return [this.target[i]!, this.target[i + 1]!];
  }

  private resize(w: number, h: number): void {
    this.width = w;
    this.height = h;
    this.generation++;
    const n = w * h;
    this.data = new Uint8Array(n * 4);
    this.decoded = new Uint8Array(n * MASK_CHANNELS);
    this.scratch = new Uint8Array(n * MASK_CHANNELS);
    this.tmp = new Float32Array(n * MASK_CHANNELS);
    this.target = new Float32Array(n * MASK_CHANNELS);
    this.current = new Float32Array(n * MASK_CHANNELS);
    this.hasMask = false;
    const grain = new Uint8Array(n);
    fogGrain(w, h, grain);
    for (let c = 0; c < n; c++) {
      this.data[c * 4 + 2] = grain[c]!;
      this.data[c * 4 + 3] = 255;
    }
  }

  /** Current floats into the RGBA bytes (visible, explored >= visible). Returns whether a byte changed. */
  private write(force: boolean): boolean {
    const n = this.width * this.height;
    const d = this.data;
    const cur = this.current;
    let changed = force;
    for (let c = 0; c < n; c++) {
      const v = Math.round(cur[c * 2]!);
      const e = Math.max(v, Math.round(cur[c * 2 + 1]!));
      if (d[c * 4] !== v) {
        d[c * 4] = v;
        changed = true;
      }
      if (d[c * 4 + 1] !== e) {
        d[c * 4 + 1] = e;
        changed = true;
      }
    }
    return changed;
  }
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
