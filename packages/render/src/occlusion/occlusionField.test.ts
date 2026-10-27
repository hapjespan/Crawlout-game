import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three/webgpu';
import { createInterpolatedFrame } from '../snapshot/interpolate.js';
import { FADE_IN_S, FIELD_TEXELS, OcclusionField, stampFocus } from './occlusionField.js';

// A 256 m field: one texel per meter, texel (i, j) centred on (i + 0.5, j + 0.5).
const N = FIELD_TEXELS;
const rect = { minX: 0, minZ: 0, sizeX: N, sizeZ: N };
const at = (t: Float32Array, x: number, z: number, ch: number): number =>
  t[(Math.floor(z) * N + Math.floor(x)) * 2 + ch]!;

describe('occlusion field', () => {
  // A unit at (100, 100) on flat ground, the camera 30 m up and 20 m towards +z: the line of sight rises 1.45 m per m.
  const focus = { x: 100.5, y: 0, z: 100.5, lift: 1.1, widen: 0 };
  const cam = { x: 100.5, y: 30, z: 120.5 };
  const t = new Float32Array(N * N * 2);
  stampFocus(t, N, rect, focus, cam);

  it('fades a tree between the unit and the camera, not one behind it or beside it', () => {
    expect(at(t, 100.5, 104.5, 0)).toBeGreaterThan(0.9);
    expect(at(t, 100.5, 94.5, 0)).toBe(0);
    expect(at(t, 106.5, 104.5, 0)).toBe(0);
  });

  it('reaches less far for low shrubs than for trees', () => {
    expect(at(t, 100.5, 100.5, 1)).toBeGreaterThan(0.9);
    expect(at(t, 100.5, 104.5, 1)).toBe(0);
    expect(at(t, 100.5, 104.5, 0)).toBeGreaterThan(0.9);
  });

  it('eases in over time instead of popping', () => {
    const field = new OcclusionField();
    field.setBounds({ minX: 0, maxX: N, minZ: 0, maxZ: N });
    const frame = createInterpolatedFrame(4);
    frame.count = 1;
    frame.typeId[0] = 0xffff; // unknown type ids draw as units
    frame.x[0] = 100.5;
    frame.z[0] = 100.5;
    const bytes = field.texture.image.data as Uint8Array;
    const texel = (104 * N + 100) * 2;
    field.update(frame, new Vector3(cam.x, cam.y, cam.z), FADE_IN_S / 2);
    expect(bytes[texel]).toBeGreaterThan(100);
    expect(bytes[texel]).toBeLessThan(155);
    field.update(frame, new Vector3(cam.x, cam.y, cam.z), FADE_IN_S);
    expect(bytes[texel]).toBe(255);
    frame.count = 0;
    field.update(frame, new Vector3(cam.x, cam.y, cam.z), 0.1);
    expect(bytes[texel]).toBeGreaterThan(0);
    expect(bytes[texel]).toBeLessThan(255);
  });
});
