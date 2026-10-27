// The shared surface tiles (src/surfaceTiles.ts): one file set per surface kind next to manifest.json instead of a
// copy inside every GLB. What is checked here is the contract render depends on: the manifest block is complete and
// in the schema, the paths point at files that were actually written, and the bytes are the same on every run.
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import {
  buildSurfaceTiles,
  SURFACE_TILE_SIZE,
  SURFACE_TILE_SLOTS,
  surfaceTilePath,
} from '../src/surfaceTiles.js';
import { SURFACE_KINDS, surfaceTilesSchema } from '../src/manifest.js';
import { UV_METERS_PER_TILE } from '../src/uvmap.js';

describe('gedeelde oppervlaktetegels', () => {
  it('schrijft elke soort een keer, gesorteerd, en past in het manifestschema', async () => {
    const { outputs, surfaces } = await buildSurfaceTiles();
    const parsed = surfaceTilesSchema.parse(surfaces);
    expect(parsed.size).toBe(SURFACE_TILE_SIZE);
    expect(parsed.metersPerTile).toBe(UV_METERS_PER_TILE);
    expect(parsed.tiles.map((t) => t.kind)).toEqual([...SURFACE_KINDS].sort());
    // Elk pad in het manifest hoort bij een bestand dat deze build ook echt schrijft.
    for (const tile of parsed.tiles)
      for (const slot of SURFACE_TILE_SLOTS) {
        expect(tile[slot]).toBe(surfaceTilePath(tile.kind, slot));
        expect(outputs.get(tile[slot])?.byteLength).toBeGreaterThan(0);
      }
    expect(outputs.size).toBe(SURFACE_KINDS.length * SURFACE_TILE_SLOTS.length);
  }, 60_000);

  it('levert vierkante JPEG-tegels op de maat die het manifest noemt', async () => {
    const { outputs, surfaces } = await buildSurfaceTiles();
    for (const path of [
      surfaceTilePath('paintedMetal', 'normal'),
      surfaceTilePath('wood', 'base'),
      surfaceTilePath('concrete', 'mr'),
    ]) {
      const meta = await sharp(Buffer.from(outputs.get(path)!)).metadata();
      expect(meta.format).toBe('jpeg');
      expect([meta.width, meta.height]).toEqual([surfaces.size, surfaces.size]);
    }
  }, 60_000);

  it('is deterministisch: twee runs geven gelijke bytes', async () => {
    const a = await buildSurfaceTiles();
    const b = await buildSurfaceTiles();
    expect([...b.outputs.keys()]).toEqual([...a.outputs.keys()]);
    for (const [path, bytes] of a.outputs)
      expect(Buffer.from(b.outputs.get(path)!).equals(Buffer.from(bytes)), path).toBe(true);
  }, 60_000);

  it('weigert een ongesorteerde of dubbele lijst', () => {
    const tile = (kind: string) => ({
      kind,
      base: `surfaces/${kind}.base.jpg`,
      normal: `surfaces/${kind}.normal.jpg`,
      mr: `surfaces/${kind}.mr.jpg`,
    });
    const block = (kinds: string[]) => ({ size: 256, metersPerTile: 2, tiles: kinds.map(tile) });
    expect(surfaceTilesSchema.safeParse(block(['wood', 'cloth'])).success).toBe(false);
    expect(surfaceTilesSchema.safeParse(block(['cloth', 'cloth'])).success).toBe(false);
    expect(surfaceTilesSchema.safeParse(block(['nonsense'])).success).toBe(false);
    expect(surfaceTilesSchema.safeParse(block(['cloth', 'wood'])).success).toBe(true);
  });
});
