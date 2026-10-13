// Sim-gerichte maptypes. Alles integers: cellen van 1 m, en waar de sim posities nodig heeft sim-eenheden (1 m = 256).
export interface MapPoint {
  /** Cel-coordinaten (1 cel = 1 m). */
  x: number;
  y: number;
  /** Middelpunt van de cel in sim-eenheden. */
  ux: number;
  uy: number;
}
export interface ScrapNode extends MapPoint {
  amount: number;
}
export interface ClaimPoint extends MapPoint {
  kind: 'scrap' | 'settlement' | 'powerArmor';
}
export interface CreepCamp extends MapPoint {
  tier: number;
}
export interface MapGrid {
  id: string;
  /** Breedte en hoogte in cellen. */
  w: number;
  h: number;
  /** w*h bytes, index y*w+x. 1 = begaanbaar, 0 = onbegaanbaar. Het enige terreinveld dat de sim leest. */
  passable: Uint8Array;
  scrapNodes: ScrapNode[];
  claimPoints: ClaimPoint[];
  spawns: MapPoint[];
  creepCamps: CreepCamp[];
}
/** Alleen voor de renderer. w*h waarden in sim-eenheden (1/256 m), index y*w+x. */
export interface Heightmap {
  w: number;
  h: number;
  data: Int16Array;
}
/** Leest bestanden uit data/ op ref (zoals in MapDef.heightmap en MapDef.passability). Synchroon: de sim heeft geen IO. */
export interface MapAssets {
  read(ref: string): string;
}
