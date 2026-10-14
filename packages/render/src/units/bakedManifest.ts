// The asset-cli's baked bone-matrix texture (fase-0 section 12) as the BakedAnimations the unit material reads.
// Manifest side: `baked { path, width, height, fps, clips[{ name, startRow, frames, loop, durationSeconds }] }`
// (tools/asset-cli/src/manifest.ts); file side: `<id>.anim.f32`, RGBA float32 little-endian, row by row.
// The layout is the one bake.ts produces procedurally, so both paths end in the same structure.
import type { BakedAnimation } from '@crawlout/asset-cli/manifest';
import { ANIM_NAMES } from '@crawlout/protocol';
import type { BakedAnimations, BakedClip } from './bake.js';

export class BakedManifestError extends Error {
  override name = 'BakedManifestError';
}

const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

/** Reads RGBA float32 little-endian texels, whatever the platform's byte order. */
function readFloat32LE(bytes: ArrayBuffer | ArrayBufferView): Float32Array {
  const view = ArrayBuffer.isView(bytes) ? bytes : new Uint8Array(bytes);
  if (view.byteLength % 4 !== 0) throw new BakedManifestError(`anim.f32 has ${view.byteLength} bytes, not a whole number of floats`);
  const n = view.byteLength / 4;
  if (LITTLE_ENDIAN && view.byteOffset % 4 === 0) return new Float32Array(view.buffer, view.byteOffset, n).slice();
  const dv = new DataView(view.buffer, view.byteOffset, view.byteLength);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = dv.getFloat32(i * 4, true);
  return out;
}

/**
 * Builds the clip table and bone texture data from a manifest `baked` entry and the bytes of its `.anim.f32`.
 * Throws BakedManifestError when the two do not fit together; the caller keeps the placeholder rig then.
 */
export function bakedAnimationsFromManifest(baked: BakedAnimation, boneCount: number, bytes: ArrayBuffer | ArrayBufferView): BakedAnimations {
  if (baked.width !== boneCount * 4) throw new BakedManifestError(`baked.width ${baked.width} does not match boneCount ${boneCount} * 4`);
  const names = baked.clips.map((c) => c.name);
  if (names.join(',') !== ANIM_NAMES.join(',')) throw new BakedManifestError(`clips must be ${ANIM_NAMES.join(', ')}; found ${names.join(', ')}`);
  const data = readFloat32LE(bytes);
  const expected = baked.width * baked.height * 4;
  if (data.length !== expected) throw new BakedManifestError(`anim.f32 holds ${data.length} floats, expected ${baked.width} x ${baked.height} x 4 = ${expected}`);
  let row = 0;
  const clips: BakedClip[] = baked.clips.map((c) => {
    if (c.startRow !== row) throw new BakedManifestError(`clip ${c.name} starts at row ${c.startRow}, expected ${row}`);
    row += c.frames;
    return { name: c.name, startRow: c.startRow, frameCount: c.frames, loop: c.loop, duration: c.durationSeconds };
  });
  if (row !== baked.height) throw new BakedManifestError(`clip frames add up to ${row}, height is ${baked.height}`);
  for (let i = 0; i < data.length; i++) {
    if (!Number.isFinite(data[i]!)) throw new BakedManifestError(`anim.f32 holds a non-finite value at float ${i}`);
  }
  const clipTable = new Float32Array(clips.length * 4);
  clips.forEach((c, i) => clipTable.set([c.startRow, c.frameCount, c.loop ? 1 : 0, c.duration], i * 4));
  return { boneCount, width: baked.width, height: baked.height, data, clips, clipTable };
}

/** The size a character is drawn at: the artist brief's 1.8 m, feet on y = 0, facing +Z. */
export const CHARACTER_HEIGHT = 1.8;
/** Heights (m) the manifest bounds may have without rescaling: art in meters stays as authored. */
export const CHARACTER_HEIGHT_RANGE: readonly [number, number] = [1.2, 2.6];
/** Feet further than this (m) from y = 0 are lifted or lowered onto it. */
const FEET_TOLERANCE = 0.05;

export interface CharacterFit {
  /** Uniform scale around the model origin. */
  scale: number;
  /** Added to y after the scale. */
  lift: number;
}

/**
 * How to bring a character to the brief from its manifest bounds (model space, rest pose). Art in meters at a human
 * height stays as it is; anything outside CHARACTER_HEIGHT_RANGE (centimeters, inches) is scaled to CHARACTER_HEIGHT,
 * and feet off y = 0 are moved onto it. Facing is not corrected: the asset-cli rejects a character facing -Z.
 */
export function characterFit(bounds: { min: readonly number[]; max: readonly number[] }): CharacterFit {
  const minY = bounds.min[1] ?? 0;
  const height = (bounds.max[1] ?? 0) - minY;
  if (!(height > 1e-6)) return { scale: 1, lift: 0 };
  const [lo, hi] = CHARACTER_HEIGHT_RANGE;
  const scale = height < lo || height > hi ? CHARACTER_HEIGHT / height : 1;
  const feet = minY * scale;
  return { scale, lift: Math.abs(feet) > FEET_TOLERANCE ? -feet : 0 };
}

/**
 * Applies a fit to every skin matrix in place: M' = T(0, lift, 0) * S(scale) * M. With skin weights summing to 1 the
 * lift moves each vertex exactly once, so the shader needs no extra transform.
 */
export function applyCharacterFit(anims: BakedAnimations, fit: CharacterFit): void {
  if (fit.scale === 1 && fit.lift === 0) return;
  const d = anims.data;
  // Each matrix is 4 texels (columns) of 4 floats; scale rows x, y, z of all columns, then lift the translation.
  for (let m = 0; m < d.length; m += 16) {
    for (let c = 0; c < 4; c++) {
      const o = m + c * 4;
      d[o] = d[o]! * fit.scale;
      d[o + 1] = d[o + 1]! * fit.scale;
      d[o + 2] = d[o + 2]! * fit.scale;
    }
    d[m + 13] = d[m + 13]! + fit.lift * d[m + 15]!;
  }
}
