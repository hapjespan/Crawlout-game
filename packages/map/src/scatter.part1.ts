// Split from scatter.ts to stay under the 5,000-token file limit; scatter.ts re-exports the public surface.
// Holds: PropPlacement, WeightedAsset, PropQuota, TerrainBands, ForestPropsSpec, KitPart, +19 more.
import { PROP_CLEARANCE_M } from './props.js';
import { UNITS_PER_METER } from '@crawlout/protocol';
import type { MapGrid } from './types.js';
import type { Rng } from './rng.js';

// Scatter-generator voor decoratieve props (build-tijd). Deterministisch: eigen integer-RNG, vaste volgorde,
// puntsymmetrisch (180 graden): elke prop krijgt zijn spiegel (zelfde asset en schaal, yaw + 180 graden). Werkt op
// elke vierkante map. Volgorde: 1 kliffen, 2 kits (kampen, ruines, claimpunten, voordes), 3 bos, 4 quota's.
//
// Alle maten zijn echt (de props komen op echte schaal uit de asset-cli); de generator schaalt niets, alleen scalePct
// (80..130) geeft variatie. Een prop met een straal vanaf 0,9 m (rots, wand, toren, klif) blijft uit de padcorridors,
// bouwvlakken en het water en mag een pad nooit versperren: props zijn visueel, maar een rots op een looproute leest
// als een muur.

/** Waar een quotum zijn kandidaatcellen zoekt. */
export type PropPlacement =
  | 'blocked' // onbegaanbaar, niet in bos of water (ruines, klifwanden)
  | 'edge' // begaanbaar, naast een onbegaanbare cel
  | 'open' // begaanbaar, niet op een padcorridor
  | 'shore' // begaanbaar, binnen 3 cellen van het water
  | 'valley' // open en lager dan `bands.valleyBelowM`
  | 'dry' // open en hoger dan `bands.dryAboveM` (plateau, rotsig)
  | 'cliff'; // onbegaanbaar met een dikke onbegaanbare strook (zie `cliffDepth`)

export interface WeightedAsset {
  asset: string;
  weight: number;
  /** Alleen bomen in het bos: de afstand tot de bosrand in cellen (1 = aan de rand) waarbinnen deze boom past. */
  minDepth?: number;
  maxDepth?: number;
}

export interface PropQuota {
  assets: WeightedAsset[];
  /** Aantal props in de A-helft; de B-helft wordt gespiegeld, dus het totaal is tweemaal dit getal. */
  perHalf: number;
  on: PropPlacement;
  /** Optioneel: pluk van `min` tot `max` props binnen `radiusM` van een gekozen cel (alle in dezelfde klasse). */
  clump?: { min: number; max: number; radiusM: number };
  /** Schaal in procenten, standaard 90 tot 115. */
  scalePct?: readonly [number, number];
}

/** Hoogtebanden voor de plaatsing (meters boven de basis van de map). */
export interface TerrainBands {
  /** Lager dan dit is dal: dichter gras. */
  valleyBelowM: number;
  /** Hoger dan dit is droog en rotsig: kale bomen. */
  dryAboveM: number;
}

export interface ForestPropsSpec {
  /** Rastermaat in meters (deler van de mapmaat): in dicht bos staat één boom per vak, op een willekeurige plek. */
  cellM: number;
  /** Kans in procenten dat een vak in dicht bos leeg blijft. */
  gapPct: number;
  /** Soorten per boomklasse (gewicht en passende diepte); een gemengd bos van eiken en dennen met kale bomen. */
  oak: WeightedAsset[];
  pine: WeightedAsset[];
  bare: WeightedAsset[];
  /** Aandeel dennen (procent) volgens gladde ruis op een raster van 32 m: stukken eikenbos, stukken dennenbos. */
  pinePct: readonly [number, number];
  /** Kans (procent) op een kale boom: basis, bij de bosrand (binnen `edgeCells`) en op droog terrein (hoog). */
  barePct: { base: number; edge: number; dry: number; edgeCells: number };
  /** Rand van losse bomen (begaanbaar) rond dicht bos: breedte in meters en kans in procenten per vak. */
  ringM: number;
  ringPct: number;
  /** Ondergroei in dicht bos: kans (procent) per vak op een extra plant. */
  understory?: { assets: WeightedAsset[]; pct: number };
  scalePct: readonly [number, number];
}

/** Een onderdeel van een kit: een aantal props rond een ankerpunt. */
export interface KitPart {
  assets: WeightedAsset[];
  /** Aantal per anker. */
  count: readonly [number, number];
  /** Afstand tot het anker in meters (bij een ruine: bovenop de halve lengte van de ruine). */
  ringM: readonly [number, number];
  /** Alle props van dit onderdeel staan in één pluk met deze straal (meters) rond één punt van de ring. */
  clumpM?: number;
  /** De lange as van de prop ligt langs de ring (een hek) in plaats van een willekeurige draai. */
  tangent?: boolean;
}

export interface KitSpec {
  parts: KitPart[];
}

export interface PropsKits {
  /** Creep-kampen (`def.creepCamps`): een kampement met puin, kisten, een vat, een hek en een wachttoren. */
  camp?: KitSpec;
  /** Ruines (`ScatterLayers.ruins`): puin en kratten ernaast en een vervallen omheining. */
  ruin?: KitSpec;
  /** Claimpunten (`def.claimPoints`). */
  claim?: KitSpec;
  /** Voordes van de rivier (`ScatterLayers.crossings`, soort ford). */
  ford?: KitSpec;
}

export interface PropsSpec {
  seed: number;
  quotas: PropQuota[];
  comment: string;
  /**
   * Randstrook (in cellen) die geen kandidaat is voor props op onbegaanbare cellen, zodat bomen en rotsen op de
   * kliffen en ruines komen en niet op de map-rand. Standaard 0.
   */
  edgeMargin?: number;
  bands?: TerrainBands;
  /** Optioneel: bomen in het bos (vraagt `ScatterLayers.forest`). */
  forest?: ForestPropsSpec;
  kits?: PropsKits;
}

/** Extra lagen van de generator: bos (0 geen, anders dicht bos), water (0 droog) en meer. Zonder lagen geldt alles als 0. */
export interface ScatterLayers {
  forest?: Uint8Array;
  water?: Uint8Array;
  /**
   * Cirkels (cellen) zonder props: de bouwvlakken rond de spawns, waar gebouwen op echte schaal komen te staan. De
   * aanroeper geeft beide spelers op (de builder spiegelt de pads); de spiegel van een prop moet ook vrij liggen.
   */
  clearings?: readonly { x: number; y: number; radius: number }[];
  /** Hoogte per cel in sim-eenheden (1/256 m), voor dal en droog terrein. */
  heights?: Int16Array;
  /** Ruines (rechthoeken in cellen, beide helften). */
  ruins?: readonly { x0: number; y0: number; x1: number; y1: number }[];
  /** Middens van de rivieroversteken (cellen, beide helften). */
  crossings?: readonly { x: number; y: number; kind: 'ford' | 'bridge' }[];
}

/** Masker (1 = geen props) van de cellen binnen de cirkels, op een vierkante map van n cellen. */
export function clearingMask(
  n: number,
  clearings: NonNullable<ScatterLayers['clearings']>,
): Uint8Array {
  const mask = new Uint8Array(n * n);
  for (const c of clearings) {
    const r2 = c.radius * c.radius;
    for (let y = Math.max(0, c.y - c.radius); y <= Math.min(n - 1, c.y + c.radius); y++)
      for (let x = Math.max(0, c.x - c.radius); x <= Math.min(n - 1, c.x + c.radius); x++)
        if ((x - c.x) * (x - c.x) + (y - c.y) * (y - c.y) <= r2) mask[y * n + x] = 1;
  }
  return mask;
}

export const KEY_POINT_CLEARANCE_U = PROP_CLEARANCE_M * UNITS_PER_METER;

/** Een prop met een voetstraal vanaf 0,9 m telt als groot: hij blijft uit corridors, bouwvlakken en water. */
export const BIG_PROP_U = Math.round(0.9 * UNITS_PER_METER);

export const BUCKET_SHIFT = 11; // buckets van 8 m voor de onderlinge afstand

export const MAX_ATTEMPTS = 400000;

export const DEFAULT_SCALE: readonly [number, number] = [90, 115];

// Sinus van een kwartslag in 65 stappen (1,40625 graden), maal 1024: de generator draait op integers, geen Math.sin.
const SIN_QUARTER = [
  0, 25, 50, 75, 100, 125, 150, 175, 200, 224, 249, 273, 297, 321, 345, 369, 392, 415, 438, 460,
  483, 505, 526, 548, 569, 590, 610, 630, 650, 669, 688, 706, 724, 742, 759, 775, 792, 807, 822,
  837, 851, 865, 878, 891, 903, 915, 926, 936, 946, 955, 964, 972, 980, 987, 993, 999, 1004, 1009,
  1013, 1016, 1019, 1021, 1023, 1024, 1024,
] as const;

/** Sinus van een hoek 0..65535 (0 = +x, hoeken groeien naar +y), maal 1024. */
export function sin1024(angle: number): number {
  const step = ((angle + 128) & 65535) >> 8; // 0..255, een volledige slag in 256 stappen (afgerond)
  const quarter = step & 63;
  const half = (step >> 6) & 1;
  const sign = (step >> 7) & 1;
  const v = SIN_QUARTER[half === 0 ? quarter : 64 - quarter] as number;
  return sign === 0 ? v : 0 - v;
}

/** Cosinus van een hoek 0..65535, maal 1024. */
export function cos1024(angle: number): number {
  return sin1024(angle + 16384);
}

export interface KeyPoint {
  x: number;
  y: number;
}

/**
 * Cellen die vrij van tall props blijven: een kortste 4-verbonden pad van elke spawn naar elk ander belangrijk punt,
 * 1 cel verbreed, plus de spiegel ervan. Props op begaanbare cellen mogen er nooit op liggen.
 */
export function pathCorridor(
  map: Pick<MapGrid, 'w' | 'h' | 'passable'>,
  spawns: KeyPoint[],
  targets: KeyPoint[],
): Uint8Array {
  const { w, h, passable } = map;
  const corridor = new Uint8Array(w * h);
  const mark = (cx: number, cy: number): void => {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        corridor[y * w + x] = 1;
        corridor[(h - 1 - y) * w + (w - 1 - x)] = 1;
      }
    }
  };
  const DX = [1, 0, -1, 0];
  const DY = [0, 1, 0, -1];
  const qx = new Int32Array(w * h);
  const qy = new Int32Array(w * h);
  const parentX = new Int32Array(w * h);
  const parentY = new Int32Array(w * h);
  for (const s of spawns) {
    parentX.fill(-2);
    let head = 0;
    let tail = 0;
    parentX[s.y * w + s.x] = -1;
    qx[tail] = s.x;
    qy[tail++] = s.y;
    while (head < tail) {
      const cx = qx[head] as number;
      const cy = qy[head++] as number;
      for (let d = 0; d < 4; d++) {
        const nx = cx + (DX[d] as number);
        const ny = cy + (DY[d] as number);
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (passable[j] !== 1 || parentX[j] !== -2) continue;
        parentX[j] = cx;
        parentY[j] = cy;
        qx[tail] = nx;
        qy[tail++] = ny;
      }
    }
    for (const t of [...targets, ...spawns]) {
      let x = t.x;
      let y = t.y;
      if (parentX[y * w + x] === -2) continue;
      for (;;) {
        mark(x, y);
        const i = y * w + x;
        const px = parentX[i] as number;
        if (px < 0) break;
        y = parentY[i] as number;
        x = px;
      }
    }
  }
  return corridor;
}

/**
 * Chebyshev-afstand (in cellen, hooguit 255) van elke cel tot de dichtstbijzijnde cel met `free[i] === 1`; vrije cellen
 * hebben 0. Twee doorgangen met een 8-buurt zijn exact.
 */
export function chebyshevDistance(free: Uint8Array, n: number): Uint8Array {
  const d = new Uint8Array(n * n);
  for (let i = 0; i < d.length; i++) d[i] = free[i] === 1 ? 0 : 255;
  const at = (x: number, y: number): number =>
    x < 0 || y < 0 || x >= n || y >= n ? 255 : (d[y * n + x] as number);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      if (d[i] === 0) continue;
      const m = Math.min(at(x - 1, y), at(x - 1, y - 1), at(x, y - 1), at(x + 1, y - 1));
      if (m + 1 < (d[i] as number)) d[i] = m + 1;
    }
  for (let y = n - 1; y >= 0; y--)
    for (let x = n - 1; x >= 0; x--) {
      const i = y * n + x;
      if (d[i] === 0) continue;
      const m = Math.min(at(x + 1, y), at(x + 1, y + 1), at(x, y + 1), at(x - 1, y + 1));
      if (m + 1 < (d[i] as number)) d[i] = m + 1;
    }
  return d;
}

export function pickWeighted(r: Rng, list: readonly WeightedAsset[], depth = -1): string {
  let pool = list;
  if (depth >= 0) {
    const fit = list.filter(
      (a) => depth >= (a.minDepth ?? 0) && (a.maxDepth === undefined || depth <= a.maxDepth),
    );
    if (fit.length > 0) pool = fit;
  }
  let total = 0;
  for (const a of pool) total += a.weight;
  let roll = r.below(total);
  for (const a of pool) {
    if (roll < a.weight) return a.asset;
    roll -= a.weight;
  }
  return (pool[pool.length - 1] as WeightedAsset).asset;
}

/** Aantal vakken van `cellM` meter per zijde; `cellM` moet de mapmaat precies delen. */
export function blocksPerSide(n: number, cellM: number): number {
  let b = 0;
  while ((b + 1) * cellM <= n) b++;
  if (b * cellM !== n) throw new Error(`scatterProps: forest.cellM ${cellM} deelt ${n} niet`);
  return b;
}

/** Cellen zonder bos binnen `ringM` (Chebyshev) van een bos-cel: daar komen losse bomen. */
export function forestRing(forest: Uint8Array, n: number, ringM: number): Uint8Array {
  const ring = new Uint8Array(n * n);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      if (forest[y * n + x] === 0) continue;
      for (let dy = -ringM; dy <= ringM; dy++)
        for (let dx = -ringM; dx <= ringM; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
          if (forest[ny * n + nx] === 0) ring[ny * n + nx] = 1;
        }
    }
  return ring;
}
