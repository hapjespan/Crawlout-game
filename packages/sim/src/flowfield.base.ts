// Split from flowfield.ts to stay under the 5,000-token file limit; flowfield.ts re-exports the public surface.
// Holds the constants, the derived per-sector and per-slot records and the sector geometry helpers.
import { idiv } from './math/int.js';
import type { FlowFields } from './flowfield.js';

export const MAX_FLOW_FIELDS = 32;
export const DIST_UNKNOWN = -1;
export const NO_REGION = 0xffff;
export const EMPTY = new Int32Array(0);
/** Geometrie: kleinste aantal regiovelden in de pool (een nextCell leest negen cellen, dus hoogstens negen regio's). */
export const MIN_POOL_FIELDS = 16;

/** Tuning van de padvinding in cellen (uit data/sim.json via de adapter). */
export interface PathTuning {
  /** Sectorzijde in cellen, een macht van 2 (4 tot en met 64). */
  readonly sectorCells: number;
  /** Langste ingang per knopenpaar; een langer open stuk van een sectorgrens wordt opgeknipt. */
  readonly entranceMaxCells: number;
  /** Geheugenbudget van de regiovelden, in cellen (int32). Verandert de uitkomst niet, alleen de snelheid. */
  readonly cacheCells: number;
}

/** Per sector: aantal regio's, de grensingangen (oost en zuid, als cel-paren) en de knopen aan deze kant. */
export class Sector {
  regions = 0;
  /**
   * De begaanbare cellen vormen één rechthoek (de hele sector, of de sector min een rand langs de map): afstanden
   * binnen de sector zijn dan Manhattan (geen BFS nodig).
   */
  open = false;
  /** Ingangen op de oostgrens: cel in deze sector (a) en in de oosterbuur (b), midden van elk stuk. */
  eastA: Int32Array = EMPTY;
  eastB: Int32Array = EMPTY;
  /** Ingangen op de zuidgrens: cel in deze sector (a) en in de zuiderbuur (b). */
  southA: Int32Array = EMPTY;
  southB: Int32Array = EMPTY;
  /** Knopen aan deze kant, in de volgorde noord, west, oost, zuid; elk deel in de volgorde van de grens. */
  nodeCell: Int32Array = EMPTY;
  nodeRegion: Int32Array = EMPTY;
  /** Afstand tussen knoop i en j binnen de regio (n*n), -1 als ze in andere regio's liggen. */
  nodeDist: Int32Array = EMPTY;
  /**
   * Knopengraaf binnen de sector als CSR (adjStart, adjNode, adjCost): de randen i-j uit nodeDist zonder de overbodige,
   * waar een knoop k ertussen ligt met d(i,k) + d(k,j) = d(i,j) en beide delen > 0. Dijkstra geeft dezelfde afstanden
   * (elke weggelaten rand is een pad van kortere randen), met een fractie van het werk.
   */
  adjStart: Int32Array = EMPTY;
  adjNode: Int32Array = EMPTY;
  adjCost: Int32Array = EMPTY;
  /** Begin van de delen noord, west, oost, zuid en het einde. */
  readonly part = new Int32Array(5);
}

/** Zoekopdracht van één slot (afgeleid; begint opnieuw bij elke wijziging van de graaf of het doel). */
export class SlotSearch {
  /** Graaf-epoch waarin de zoekopdracht begon; anders dan de huidige: opnieuw beginnen. */
  epoch = -1;
  g: Int32Array = EMPTY;
  done = new Uint8Array(0);
  /**
   * Wachtrij van Dijkstra als ring van emmers op afstand (Dial): emmer g & bucketMask houdt de knopen met voorlopige
   * afstand g, als dubbel gelinkte lijst (next, prev per knoop). Alle afstanden in de rij liggen in [cur, cur + emmers),
   * want een rand kost hoogstens maxEdge en de beginknopen hoogstens hun vensterafstand; de ring is groter dan beide.
   * Een knoop staat in de rij precies als g >= 0 en niet done.
   */
  head: Int32Array = EMPTY;
  next: Int32Array = EMPTY;
  prev: Int32Array = EMPTY;
  bucketMask = 0;
  cur = 0;
  queued = 0;
  /** Per globale regio de index in de pool, -1 als het regioveld er (nog) niet is. */
  regionField: Int32Array = EMPTY;
  /** Doelvenster in cellen en in sectoren (inclusief), met de exacte BFS-afstand tot het doel. */
  wx0 = 0;
  wy0 = 0;
  ww = 0;
  wh = 0;
  ws0x = 0;
  ws0y = 0;
  ws1x = 0;
  ws1y = 0;
  win: Int32Array = EMPTY;
}

export function secX0(ff: FlowFields, s: number): number {
  return (s - idiv(s, ff.sx) * ff.sx) << ff.shift;
}

export function secY0(ff: FlowFields, s: number): number {
  return idiv(s, ff.sx) << ff.shift;
}

/** Lokale index (rij maal S plus kolom) van globale cel c in de sector met oorsprong (x0, y0). */
export function localOf(ff: FlowFields, c: number, x0: number, y0: number): number {
  const cy = idiv(c, ff.w);
  return ((cy - y0) << ff.shift) + (c - cy * ff.w - x0);
}
