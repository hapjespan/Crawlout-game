import { describe, expect, it } from 'vitest';
import { DENSITY_BAND, texelsPerMeter, uvScaleForDensity } from './texelDensity.js';

describe('texel density', () => {
  it('measures texels per meter from the area ratio', () => {
    // 4 m2 of wall over one uv tile of a 512 px texture: 2 m per tile, 256 texels per meter.
    expect(texelsPerMeter(4, 1, 512)).toBeCloseTo(256, 6);
    // The same wall over 4 tiles: half the meters per tile, twice the density.
    expect(texelsPerMeter(4, 4, 512)).toBeCloseTo(512, 6);
    expect(texelsPerMeter(0, 1, 512)).toBe(0);
    expect(texelsPerMeter(4, 0, 512)).toBe(0);
    expect(texelsPerMeter(4, 1, 0)).toBe(0);
  });

  it('leaves a density inside the band alone', () => {
    expect(uvScaleForDensity(DENSITY_BAND[0])).toBe(1);
    expect(uvScaleForDensity(140)).toBe(1);
    expect(uvScaleForDensity(DENSITY_BAND[1])).toBe(1);
    expect(uvScaleForDensity(0)).toBe(1); // unknown
  });

  it('scales the uv so the density lands on the nearest band edge', () => {
    const fine = 618; // the house planks
    const s = uvScaleForDensity(fine);
    expect(s).toBeLessThan(1);
    expect(fine * s).toBeCloseTo(DENSITY_BAND[1], 6);
    const coarse = 60;
    const t = uvScaleForDensity(coarse);
    expect(t).toBeGreaterThan(1);
    expect(coarse * t).toBeCloseTo(DENSITY_BAND[0], 6);
  });

  it('caps the change so a degenerate layout cannot blow the texture up', () => {
    expect(uvScaleForDensity(5000)).toBe(0.25);
    expect(uvScaleForDensity(1)).toBe(4);
  });
});
