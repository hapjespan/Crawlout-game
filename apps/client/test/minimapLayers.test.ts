import { describe, expect, it } from 'vitest';
import { minimapLayers } from '../src/game/minimapLayers.js';

describe('minimapLayers', () => {
  it('marks water, forest next to trees, and other blocked cells as rock', () => {
    const w = 8;
    const h = 1;
    const passable = Uint8Array.from([1, 0, 0, 0, 0, 0, 0, 1]);
    const water = { w, h, data: Uint8Array.from([0, 1, 2, 0, 0, 0, 0, 0]) };
    const props = [
      { asset: 'treehigh001', x: 3.5, y: 0.5, yaw: 0, yawRad: 0, scale: 1, scalePct: 100 },
    ];
    const layers = minimapLayers(w, h, passable, props, water);
    expect(layers.water).toBe(water.data);
    expect([...layers.terrain]).toEqual([0, 0, 0, 1, 1, 1, 2, 0]);
  });

  it('works without water and ignores rocks as forest', () => {
    const passable = Uint8Array.from([0, 0]);
    const props = [
      { asset: 'rock001', x: 0.5, y: 0.5, yaw: 0, yawRad: 0, scale: 1, scalePct: 100 },
    ];
    const layers = minimapLayers(2, 1, passable, props, null);
    expect(layers.water).toBeUndefined();
    expect([...layers.terrain]).toEqual([2, 2]);
  });
});
