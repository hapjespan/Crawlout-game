import { describe, expect, it } from 'vitest';
import { encodeGrid } from '@crawlout/map';
import { parseWaterMask } from '@crawlout/render';
import { loadMapWater } from '../src/render/water.js';

describe('loadMapWater (MapDef water for renderer.setWater)', () => {
  const cells = [0, 0, 1, 1, 0, 2, 2, 0, 0, 1, 1, 0];
  const files: Record<string, string> = { 'maps/x.water.json': encodeGrid(4, 3, 'u8', cells) };
  const read = (ref: string): string => files[ref] ?? '';

  it('decodes the RLE grid into a mask the renderer accepts', () => {
    const mask = loadMapWater({ size: { w: 4, h: 3 }, water: 'maps/x.water.json' }, read)!;
    expect(mask.w).toBe(4);
    expect(mask.h).toBe(3);
    expect([...mask.data]).toEqual(cells);
    expect([...parseWaterMask(mask).data]).toEqual(cells);
  });

  it('is null for a map without water', () => {
    expect(loadMapWater({ size: { w: 4, h: 3 } }, read)).toBeNull();
  });

  it('refuses a grid of another size than the map', () => {
    expect(() => loadMapWater({ size: { w: 8, h: 3 }, water: 'maps/x.water.json' }, read)).toThrow(
      /past niet/,
    );
  });
});
