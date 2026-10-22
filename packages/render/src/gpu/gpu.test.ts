import { describe, expect, it } from 'vitest';
import { DataUtils, FloatType, HalfFloatType } from 'three/webgpu';
import { MAX_PLAYERS } from '@crawlout/protocol';
import { NEUTRAL_TEAM, teamIndex, teamPalette } from '../palette.js';
import { createGridTerrain, TerrainHeightField } from '../terrain/heightField.js';
import { bakeHeights } from '../terrain/heightTexture.js';
import {
  createDataTexture,
  pickDataTexturePrecision,
  toHalfFloatArray,
  WEBGPU_DATA_TEXTURE_CAPS,
} from './dataTextures.js';

describe('data texture precision', () => {
  it('keeps float32 when supported and the texture fits', () => {
    expect(pickDataTexturePrecision(WEBGPU_DATA_TEXTURE_CAPS, 512)).toBe('float');
    expect(pickDataTexturePrecision({ float32: true, maxTextureSize: 4096 }, 512)).toBe('float');
  });

  it('falls back to half-float without float32 or when a texture is too large', () => {
    expect(pickDataTexturePrecision({ float32: false, maxTextureSize: 4096 }, 512)).toBe('half');
    expect(pickDataTexturePrecision({ float32: true, maxTextureSize: 256 }, 512)).toBe('half');
  });

  it('honors a forced precision', () => {
    expect(pickDataTexturePrecision(WEBGPU_DATA_TEXTURE_CAPS, 512, 'half')).toBe('half');
  });

  it('converts to half-float within half precision', () => {
    const src = new Float32Array([0, 1, -0.5, 1.8, 123.25, 0.001]);
    const half = toHalfFloatArray(src);
    src.forEach((v, i) => expect(DataUtils.fromHalfFloat(half[i]!)).toBeCloseTo(v, 2));
  });

  it('creates float and half-float textures with the right type', () => {
    const data = new Float32Array(16);
    expect(createDataTexture(data, 2, 2, 'float').type).toBe(FloatType);
    const half = createDataTexture(data, 2, 2, 'half');
    expect(half.type).toBe(HalfFloatType);
    expect(half.image.data).toBeInstanceOf(Uint16Array);
  });
});

describe('team palette', () => {
  it('clamps owners instead of wrapping them', () => {
    expect(teamIndex(0)).toBe(0);
    expect(teamIndex(MAX_PLAYERS - 1)).toBe(MAX_PLAYERS - 1);
    expect(teamIndex(MAX_PLAYERS)).toBe(NEUTRAL_TEAM);
    expect(teamIndex(255)).toBe(NEUTRAL_TEAM);
    expect(teamPalette()).toHaveLength(NEUTRAL_TEAM + 1);
  });
});

describe('bakeHeights', () => {
  it('samples the terrain on a grid over its bounds', () => {
    const terrain = createGridTerrain(16, 8, 1, (x, z) => x * 0.5 + z);
    const hf = new TerrainHeightField(terrain.positions, terrain.indices);
    const baked = bakeHeights(hf, 1);
    expect(baked.cols).toBe(17);
    expect(baked.rows).toBe(9);
    const at = (i: number, j: number) => baked.data[(j * baked.cols + i) * 4]!;
    expect(at(0, 0)).toBeCloseTo(0);
    expect(at(4, 2)).toBeCloseTo(4);
    expect(at(16, 8)).toBeCloseTo(16);
  });

  it('caps the texture edge', () => {
    const terrain = createGridTerrain(64, 64, 4);
    const hf = new TerrainHeightField(terrain.positions, terrain.indices);
    const baked = bakeHeights(hf, 0.01, 32);
    expect(baked.cols).toBeLessThanOrEqual(32);
    expect(baked.rows).toBeLessThanOrEqual(32);
  });
});
