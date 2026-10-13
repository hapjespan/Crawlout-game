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
