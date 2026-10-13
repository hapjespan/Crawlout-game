// Terrain heights as a data texture, so ground decals (blob shadows, selection rings, claim rings, the placement
// preview) can follow hills in the vertex shader instead of floating or cutting into slopes.
import type { DataTexture, Node } from 'three/webgpu';
import { clamp, floor, int, ivec2, mix, textureLoad, vec2 } from 'three/tsl';
import { createDataTexture, type DataTexturePrecision } from '../gpu/dataTextures.js';
import type { TerrainHeightField } from './heightField.js';

export interface HeightTexture {
  texture: DataTexture;
  minX: number;
  minZ: number;
  /** Meters between two texels. */
  step: number;
  cols: number;
  rows: number;
}

/** Heights in the r channel, one texel per `step` meters over the field's bounds, at most `maxEdge` texels per side. */
export function bakeHeights(hf: TerrainHeightField, step = 1, maxEdge = 512): { data: Float32Array; cols: number; rows: number; step: number } {
  const spanX = Math.max(hf.maxX - hf.minX, 1e-3);
  const spanZ = Math.max(hf.maxZ - hf.minZ, 1e-3);
  const s = Math.max(step, spanX / (maxEdge - 1), spanZ / (maxEdge - 1));
  const cols = Math.min(maxEdge, Math.ceil(spanX / s) + 1);
  const rows = Math.min(maxEdge, Math.ceil(spanZ / s) + 1);
  const data = new Float32Array(cols * rows * 4);
  for (let j = 0; j < rows; j++) {
    const z = Math.min(hf.maxZ, hf.minZ + j * s);
    for (let i = 0; i < cols; i++) {
      const x = Math.min(hf.maxX, hf.minX + i * s);
      data[(j * cols + i) * 4] = hf.heightAt(x, z, 0);
    }
  }
  return { data, cols, rows, step: s };
}

export function createHeightTexture(hf: TerrainHeightField, precision: DataTexturePrecision): HeightTexture {
  const baked = bakeHeights(hf);
  return {
    texture: createDataTexture(baked.data, baked.cols, baked.rows, precision),
    minX: hf.minX,
    minZ: hf.minZ,
    step: baked.step,
    cols: baked.cols,
    rows: baked.rows,
  };
}

/** TSL: bilinear terrain height at world (x, z). Constants are baked in; rebuild the material when the terrain changes. */
export function terrainHeightNode(ht: HeightTexture, xz: Node<'vec2'>): Node<'float'> {
  const g = clamp(xz.sub(vec2(ht.minX, ht.minZ)).div(ht.step), vec2(0, 0), vec2(ht.cols - 1.001, ht.rows - 1.001));
  const g0 = floor(g);
  const f = g.sub(g0);
  const ix = int(g0.x);
  const iz = int(g0.y);
  const h = (dx: number, dz: number): Node<'float'> => textureLoad(ht.texture, ivec2(ix.add(dx), iz.add(dz))).x;
  return mix(mix(h(0, 0), h(1, 0), f.x), mix(h(0, 1), h(1, 1), f.x), f.y);
}
