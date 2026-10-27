/// <reference types="vite/client" />
// Water mask of a map for renderer.setWater. The map agent adds an optional MapDef field `water` (branch map-xl): a
// ref to a crawlout-grid/1 u8 file in data/maps next to the heightmap and passability, the size of the map, with
// 0 land, 1 water and 2 shallow or fordable. The sim reads passability, never this; only the renderer draws it.
// loadMapWater reads `size` and `water` from the raw map JSON, so it works before and after MapDef knows the field.
import { decodeGrid } from '@crawlout/map';

export interface MapWaterRef {
  size: { w: number; h: number };
  water?: string | undefined;
}

export interface WaterMaskData {
  w: number;
  h: number;
  data: Uint8Array;
}

/** The decoded mask of a map, or null when the map has no water ref. Throws on a file of the wrong size or type. */
export function loadMapWater(
  def: MapWaterRef,
  read: (ref: string) => string,
): WaterMaskData | null {
  if (!def.water) return null;
  const { w, h } = def.size;
  return { w, h, data: decodeGrid(read(def.water), w, h, 'u8') as Uint8Array };
}

const DATA_PREFIX = '../../../../data/';
const mapFiles = import.meta.glob('../../../../data/maps/*.json', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

/** The water mask of a map in data/maps (bundled by Vite), or null without a water ref. */
export function loadClientMapWater(mapId: string): WaterMaskData | null {
  const read = (ref: string): string => {
    const text = mapFiles[`${DATA_PREFIX}${ref}`];
    if (typeof text !== 'string') throw new Error(`mapbestand data/${ref} ontbreekt in de bundel`);
    return text;
  };
  return loadMapWater(JSON.parse(read(`maps/${mapId}.json`)) as MapWaterRef, read);
}
