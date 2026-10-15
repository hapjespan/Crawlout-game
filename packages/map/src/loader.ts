import { metersToUnits, type MapDef } from '@crawlout/data';
import { decodeGrid } from './grid-format.js';
import type {
  ClaimPoint,
  CreepCamp,
  Heightmap,
  MapAssets,
  MapGrid,
  MapPoint,
  ScrapNode,
} from './types.js';

function point(def: MapDef, x: number, y: number, what: string): MapPoint {
  if (x < 0 || y < 0 || x >= def.size.w || y >= def.size.h)
    throw new Error(`map ${def.id}: ${what} (${x},${y}) ligt buiten de map`);
  // Cel-middelpunt: (x + 0.5) m, exact in sim-eenheden.
  return { x, y, ux: metersToUnits(x + 0.5), uy: metersToUnits(y + 0.5) };
}

/** MapDef (al gevalideerd door packages/data) plus bestanden naar de integer-grid voor de sim. */
export function loadMap(def: MapDef, assets: MapAssets): MapGrid {
  const { w, h } = def.size;
  const bits = decodeGrid(assets.read(def.passability), w, h, 'u8') as Uint8Array;
  const passable = new Uint8Array(w * h);
  for (let i = 0; i < passable.length; i++) passable[i] = (bits[i] as number) === 0 ? 0 : 1;
  const scrapNodes: ScrapNode[] = def.scrapNodes.map((n) => ({
    ...point(def, n.x, n.y, 'scrapNode'),
    amount: Math.trunc(n.amount),
  }));
  const claimPoints: ClaimPoint[] = def.claimPoints.map((c) => ({
    ...point(def, c.x, c.y, 'claimPoint'),
    kind: c.kind,
  }));
  const spawns: MapPoint[] = def.spawns.map((s) => point(def, s.x, s.y, 'spawn'));
  const creepCamps: CreepCamp[] = def.creepCamps.map((c) => ({
    ...point(def, c.x, c.y, 'creepCamp'),
    tier: c.tier,
  }));
  return { id: def.id, w, h, passable, scrapNodes, claimPoints, spawns, creepCamps };
}

/** Alleen voor de renderer; de sim leest nooit hoogtes. */
export function loadHeightmap(def: MapDef, assets: MapAssets): Heightmap {
  const { w, h } = def.size;
  return { w, h, data: decodeGrid(assets.read(def.heightmap), w, h, 'i16') as Int16Array };
}

/**
 * Alleen voor de renderer: het watermasker (w*h, index y*w+x; 0 droog, 1 water, 2 ondiep en begaanbaar), of null
 * als de map geen water heeft. Het wateroppervlak ligt op hoogte 0 (WATER_LEVEL_CM); de bedding in de heightmap is
 * negatief. De sim leest dit nooit: water is al onbegaanbaar in de passability.
 */
export function loadWater(def: MapDef, assets: MapAssets): Uint8Array | null {
  if (def.water === undefined) return null;
  const { w, h } = def.size;
  return decodeGrid(assets.read(def.water), w, h, 'u8') as Uint8Array;
}
