import { describe, expect, it } from 'vitest';
import { PerspectiveCamera } from 'three/webgpu';
import { BUILDING_LOD_PX, PROP_LOD_PX, ScreenLod, UNIT_LOD_PX } from './screenLod.js';

function lodAt(heightPx: number, fov = 45): ScreenLod {
  const s = new ScreenLod();
  s.setViewport(heightPx);
  s.update(new PerspectiveCamera(fov, 16 / 9, 0.5, 800));
  return s;
}

/** Distance (m) where an object of `size` m drops under `px` device pixels. */
const switchAt = (s: ScreenLod, size: number, px: number): number => (size * s.pxPerMeter) / px;

describe('ScreenLod', () => {
  it('projects height to device pixels from the viewport and the fov', () => {
    const s = lodAt(1800);
    expect(s.pxPerMeter).toBeCloseTo(1800 / (2 * Math.tan(Math.PI / 8)), 6);
    expect(s.pixels(1.8, 42)).toBeCloseTo((1.8 * s.pxPerMeter) / 42, 6);
  });

  it('keeps a unit on LOD 0 at the default RTS distance on a 900 px DPR 2 view, LOD 1 at DPR 1', () => {
    expect(lodAt(1800).lod(1.8, 42, UNIT_LOD_PX)).toBe(0);
    expect(lodAt(900).lod(1.8, 42, UNIT_LOD_PX)).toBe(1);
    expect(lodAt(1800).lod(1.8, 200, UNIT_LOD_PX)).toBe(2);
  });

  it('switches at the documented distances (1800 px, fov 45)', () => {
    const s = lodAt(1800);
    expect(switchAt(s, 1.8, UNIT_LOD_PX.lod1)).toBeCloseTo(54.3, 0);
    expect(switchAt(s, 1.8, UNIT_LOD_PX.lod2)).toBeCloseTo(130.4, 0);
    expect(switchAt(s, 3.8, BUILDING_LOD_PX.lod1)).toBeCloseTo(59, 0);
    expect(switchAt(s, 5, PROP_LOD_PX.lod1)).toBeCloseTo(90.5, 0);
  });

  it('gives a bigger object its detail further out, and a narrower fov too', () => {
    const s = lodAt(1800);
    expect(s.lod(9.2, 120, BUILDING_LOD_PX)).toBe(0);
    expect(s.lod(1.8, 120, BUILDING_LOD_PX)).toBe(2);
    expect(lodAt(1800, 20).lod(1.8, 100, UNIT_LOD_PX)).toBe(0);
  });
});
