import { describe, expect, it } from 'vitest';
import { defaultShadowQuality, SHADOW_QUALITY } from './sunShadow.js';

describe('defaultShadowQuality', () => {
  it('is high on WebGPU and low on the WebGL2 fallback, where the shadow pass costs the most', () => {
    expect(defaultShadowQuality('webgpu')).toBe('high');
    expect(defaultShadowQuality('webgl2')).toBe('low');
    expect(SHADOW_QUALITY.low.mapSize).toBeLessThan(SHADOW_QUALITY.high.mapSize);
    expect(SHADOW_QUALITY.low.smallProps).toBe(false);
  });
});
