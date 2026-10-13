// Building footprints for the renderer: from GameData (setGameData) or a callback, with a fallback size.
// Footprints are whole 1 m cells along sim x (w) and sim y (h); the entity position is the footprint center.
import type { GameData } from '@crawlout/data';
import { buildingIdOf, classifyTypeId, ENTITY_KIND } from './typeIds.js';

export interface Footprint {
  /** Cells along sim x / world x. */
  w: number;
  /** Cells along sim y / world z. */
  h: number;
}

export type FootprintLookup = (typeId: number) => Footprint | null;

/** Used when a building typeId has no footprint (no GameData yet, or an id outside it). */
export const DEFAULT_FOOTPRINT: Readonly<Footprint> = { w: 2, h: 2 };

/** Footprint lookup over GameData.buildings, by building typeId. */
export function footprintsFromGameData(data: Pick<GameData, 'buildings'>): FootprintLookup {
  return (typeId) => {
    const id = buildingIdOf(typeId);
    const b = id >= 0 ? data.buildings[id] : undefined;
    return b ? { w: b.footprint.w, h: b.footprint.h } : null;
  };
}

/**
 * Resolves footprints with a cache per typeId (lookups run per building per frame).
 * Non-building typeIds resolve to 1x1.
 */
export class FootprintTable {
  private lookup: FootprintLookup | null;
  private readonly cache = new Map<number, Footprint>();

  constructor(lookup: FootprintLookup | null = null) {
    this.lookup = lookup;
  }

  setLookup(lookup: FootprintLookup | null): void {
    this.lookup = lookup;
    this.cache.clear();
  }

  get(typeId: number): Footprint {
    let f = this.cache.get(typeId);
    if (f) return f;
    if (classifyTypeId(typeId) !== ENTITY_KIND.building) f = { w: 1, h: 1 };
    else {
      const found = this.lookup?.(typeId);
      f = found && found.w > 0 && found.h > 0 ? { w: found.w, h: found.h } : { ...DEFAULT_FOOTPRINT };
    }
    this.cache.set(typeId, f);
    return f;
  }
}

/** Wall height of a placeholder building, meters: grows with the footprint so a 5x5 hq towers over a 1x1 beacon. */
export function buildingWallHeight(f: Footprint): number {
  return 1.9 + 0.5 * Math.min(f.w, f.h);
}

/** Ridge of the placeholder roof, in units of the wall height (structureGeometry.ts: walls up to 1, roof above). */
export const BUILDING_ROOF_TOP = 1.32;

/** Height of a placeholder building's roof ridge above its ground, meters: where a turret's muzzle sits. */
export function buildingRoofHeight(f: Footprint): number {
  return BUILDING_ROOF_TOP * buildingWallHeight(f);
}

/**
 * Snaps a footprint center (sim units, 1 m = 256) to the cell grid: odd sizes center on a cell, even sizes on a
 * cell corner. For the HUD's placement cursor; the renderer draws previews where it is told.
 */
export function snapFootprintCenter(x: number, y: number, f: Footprint, unitsPerCell = 256): { x: number; y: number } {
  const snap = (v: number, cells: number): number => {
    const half = (cells % 2) * (unitsPerCell / 2);
    return Math.round((v - half) / unitsPerCell) * unitsPerCell + half;
  };
  return { x: snap(x, f.w), y: snap(y, f.h) };
}
