// Data textures read with textureLoad (bone matrices, clip table, terrain heights), in float32 or half-float.
//
// WebGPU always samples rgba32float with textureLoad. WebGL2 has RGBA32F as a core sampled format too, but some
// mobile and older integrated drivers reject it or cap the texture size, so the WebGL2 backend probes a throwaway
// context first and falls back to RGBA16F (half-float) when float32 is refused or a texture would be too large.
// Half precision is ~1/1000 relative: fine for the placeholder rig (sub-millimetre at 1.8 m) and for heights.
import {
  DataTexture,
  DataUtils,
  FloatType,
  HalfFloatType,
  NearestFilter,
  RGBAFormat,
} from 'three/webgpu';

export type DataTexturePrecision = 'float' | 'half';

export interface DataTextureCaps {
  /** Float32 RGBA textures can be uploaded and sampled. */
  float32: boolean;
  /** Largest texture edge the backend accepts. */
  maxTextureSize: number;
}

/** WebGPU guarantees rgba32float sampling and at least 8192 texels per edge. */
export const WEBGPU_DATA_TEXTURE_CAPS: DataTextureCaps = { float32: true, maxTextureSize: 8192 };

/**
 * Probes float32 texture support on a separate WebGL2 context, so the renderer's own GL state cache is untouched.
 * Returns null when no WebGL2 context can be made (then the caller keeps its default).
 */
export function probeWebGL2DataTextureCaps(): DataTextureCaps | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const gl = canvas.getContext('webgl2');
  if (!gl) return null;
  try {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    while (gl.getError() !== gl.NO_ERROR) {
      /* drain earlier errors */
    }
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 2, 2, 0, gl.RGBA, gl.FLOAT, new Float32Array(16));
    const float32 = gl.getError() === gl.NO_ERROR;
    gl.deleteTexture(tex);
    const maxTextureSize = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 2048;
    return { float32, maxTextureSize };
  } finally {
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

/**
 * Picks float32 when the backend supports it and the largest texture fits, else half-float.
 * `force` overrides the choice (debugging, `?half` in the demo).
 */
export function pickDataTexturePrecision(
  caps: DataTextureCaps,
  largestEdge: number,
  force?: DataTexturePrecision,
): DataTexturePrecision {
  if (force) return force;
  return caps.float32 && largestEdge <= caps.maxTextureSize ? 'float' : 'half';
}

/** Float32 to IEEE half-float bits, element by element. */
export function toHalfFloatArray(src: Float32Array): Uint16Array {
  const out = new Uint16Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = DataUtils.toHalfFloat(src[i]!);
  return out;
}

/** RGBA data texture for textureLoad: nearest filtering, no mipmaps. */
export function createDataTexture(
  data: Float32Array,
  width: number,
  height: number,
  precision: DataTexturePrecision,
): DataTexture {
  const tex =
    precision === 'float'
      ? new DataTexture(data, width, height, RGBAFormat, FloatType)
      : new DataTexture(toHalfFloatArray(data), width, height, RGBAFormat, HalfFloatType);
  tex.magFilter = NearestFilter;
  tex.minFilter = NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}
