import { UNITS_PER_METER } from '@crawlout/protocol';
import type { MapDef } from '@crawlout/data';
import { noise2 } from './gen/forest.js';
import { PROP_INFO, propRadiusU, type PropInfo } from './propcatalog.js';
import {
  PROPS_FORMAT,
  PROP_CLEARANCE_M,
  PROP_SCALE_MAX,
  PROP_SCALE_MIN,
  type PropRecord,
  type PropsFile,
} from './props.js';
import { createRng, type Rng } from './rng.js';
import type { MapGrid } from './types.js';

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
function clearingMask(n: number, clearings: NonNullable<ScatterLayers['clearings']>): Uint8Array {
  const mask = new Uint8Array(n * n);
  for (const c of clearings) {
    const r2 = c.radius * c.radius;
    for (let y = Math.max(0, c.y - c.radius); y <= Math.min(n - 1, c.y + c.radius); y++)
      for (let x = Math.max(0, c.x - c.radius); x <= Math.min(n - 1, c.x + c.radius); x++)
        if ((x - c.x) * (x - c.x) + (y - c.y) * (y - c.y) <= r2) mask[y * n + x] = 1;
  }
  return mask;
}

const KEY_POINT_CLEARANCE_U = PROP_CLEARANCE_M * UNITS_PER_METER;
/** Een prop met een voetstraal vanaf 0,9 m telt als groot: hij blijft uit corridors, bouwvlakken en water. */
const BIG_PROP_U = Math.round(0.9 * UNITS_PER_METER);
const BUCKET_SHIFT = 11; // buckets van 8 m voor de onderlinge afstand
const MAX_ATTEMPTS = 400000;
const DEFAULT_SCALE: readonly [number, number] = [90, 115];

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

interface KeyPoint {
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
function chebyshevDistance(free: Uint8Array, n: number): Uint8Array {
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

function pickWeighted(r: Rng, list: readonly WeightedAsset[], depth = -1): string {
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

/** Genereert de propslijst voor een gegenereerde map. Gooit als een quota niet te halen is. */
export function scatterProps(
  def: Pick<MapDef, 'id' | 'size' | 'spawns' | 'scrapNodes' | 'claimPoints' | 'creepCamps'>,
  passable: Uint8Array,
  spec: PropsSpec,
  layers: ScatterLayers = {},
): PropsFile {
  const { w, h } = def.size;
  if (w !== h) throw new Error('scatterProps: alleen vierkante maps');
  const n = w;
  const rng = createRng(spec.seed);
  const forest = layers.forest ?? new Uint8Array(n * n);
  const water = layers.water ?? new Uint8Array(n * n);
  const clear = clearingMask(n, layers.clearings ?? []);
  const heights = layers.heights;
  const bands = spec.bands ?? { valleyBelowM: 0, dryAboveM: 1000 };
  const valleyBelowU = Math.round(bands.valleyBelowM * UNITS_PER_METER);
  const dryAboveU = Math.round(bands.dryAboveM * UNITS_PER_METER);
  const keyPoints: KeyPoint[] = [
    ...def.spawns,
    ...def.scrapNodes,
    ...def.claimPoints,
    ...def.creepCamps,
  ].map((p) => ({ x: p.x, y: p.y }));
  const corridor = pathCorridor({ w, h, passable }, def.spawns, keyPoints);
  // Sim-eenheden van de middens, voor de afstandscontrole.
  const keyU = keyPoints.map((p) => ({
    x: p.x * UNITS_PER_METER + (UNITS_PER_METER >> 1),
    y: p.y * UNITS_PER_METER + (UNITS_PER_METER >> 1),
  }));
  const maxU = n * UNITS_PER_METER - 1;
  // Afstand tot begaanbaar (onbegaanbare cellen) en tot niet-bos (bos-cellen), voor kliffen en boomsoorten.
  const blockedDepth = chebyshevDistance(passable, n);
  const forestFree = new Uint8Array(n * n);
  for (let i = 0; i < forestFree.length; i++) forestFree[i] = forest[i] === 0 ? 1 : 0;
  const forestDepth = chebyshevDistance(forestFree, n);

  const blocked = (cx: number, cy: number): boolean =>
    cx < 0 || cy < 0 || cx >= n || cy >= n || passable[cy * n + cx] !== 1;
  const nearBlocked = (cx: number, cy: number, r: number): boolean => {
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) if (blocked(cx + dx, cy + dy)) return true;
    return false;
  };
  const nearWater = (cx: number, cy: number, r: number): boolean => {
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && y >= 0 && x < n && y < n && water[y * n + x] !== 0) return true;
      }
    return false;
  };
  /** Of een van de maskers (corridor, bouwvlak, water) een cel in de schijf met straal `rU` raakt. */
  const footprintHitsReserved = (x: number, y: number, rU: number): boolean => {
    const rc = (rU + UNITS_PER_METER - 1) >> 8; // omhoog naar cellen
    const cx = x >> 8;
    const cy = y >> 8;
    for (let dy = -rc; dy <= rc; dy++)
      for (let dx = -rc; dx <= rc; dx++) {
        const px = cx + dx;
        const py = cy + dy;
        if (px < 0 || py < 0 || px >= n || py >= n) continue;
        // Het middelpunt van de cel binnen de schijf.
        const ddx = px * UNITS_PER_METER + 128 - x;
        const ddy = py * UNITS_PER_METER + 128 - y;
        if (ddx * ddx + ddy * ddy > rU * rU) continue;
        const i = py * n + px;
        if (corridor[i] !== 0 || clear[i] !== 0 || water[i] !== 0) return true;
      }
    return false;
  };

  const placed: PropRecord[] = [];
  const bucket = new Map<number, { x: number; y: number; r: number }[]>();
  const bucketKey = (x: number, y: number): number =>
    ((y >> BUCKET_SHIFT) << 10) | (x >> BUCKET_SHIFT);
  let maxRadiusU = 0;
  const farFromKeyPoints = (x: number, y: number, extraU: number): boolean => {
    const min = KEY_POINT_CLEARANCE_U + extraU;
    for (const k of keyU) {
      const dx = x - k.x;
      const dy = y - k.y;
      if (dx * dx + dy * dy < min * min) return false;
    }
    return true;
  };
  /** Staat er binnen de som van de voetstralen niets anders (en niet op `extra`, de spiegel in wording)? */
  const spaced = (x: number, y: number, r: number, extra: PropRecord | null): boolean => {
    const reach = ((r + maxRadiusU) >> BUCKET_SHIFT) + 1;
    const bx0 = x >> BUCKET_SHIFT;
    const by0 = y >> BUCKET_SHIFT;
    for (let by = by0 - reach; by <= by0 + reach; by++) {
      for (let bx = bx0 - reach; bx <= bx0 + reach; bx++) {
        for (const q of bucket.get((by << 10) | bx) ?? []) {
          const dx = x - q.x;
          const dy = y - q.y;
          const min = r + q.r;
          if (dx * dx + dy * dy < min * min) return false;
        }
      }
    }
    if (extra !== null) {
      const dx = x - extra.x;
      const dy = y - extra.y;
      const min = r + propRadiusU(extra.asset);
      if (dx * dx + dy * dy < min * min) return false;
    }
    return true;
  };
  const store = (p: PropRecord): void => {
    placed.push(p);
    const r = propRadiusU(p.asset);
    if (r > maxRadiusU) maxRadiusU = r;
    const k = bucketKey(p.x, p.y);
    const list = bucket.get(k);
    const item = { x: p.x, y: p.y, r };
    if (list === undefined) bucket.set(k, [item]);
    else list.push(item);
  };
  /** Zet een prop en zijn spiegel als beide vrij liggen; true als het lukte. */
  const tryPlace = (
    asset: string,
    x: number,
    y: number,
    yaw: number,
    scalePct: number,
  ): boolean => {
    if (x < 0 || y < 0 || x > maxU || y > maxU) return false;
    const r = propRadiusU(asset);
    const big = r >= BIG_PROP_U;
    const mx = maxU - x;
    const my = maxU - y;
    const a: PropRecord = { asset, x, y, yaw, scalePct };
    const b: PropRecord = { asset, x: mx, y: my, yaw: (yaw + 32768) & 65535, scalePct };
    const extra = big ? r : 0;
    if (!farFromKeyPoints(x, y, extra) || !farFromKeyPoints(mx, my, extra)) return false;
    if (big && (footprintHitsReserved(x, y, r) || footprintHitsReserved(mx, my, r))) return false;
    if (!spaced(x, y, r, null) || !spaced(mx, my, r, a) || !spaced(x, y, r, b)) return false;
    store(a);
    store(b);
    return true;
  };

  const scaleIn = (range: readonly [number, number]): number =>
    rng.range(Math.max(PROP_SCALE_MIN, range[0]), Math.min(PROP_SCALE_MAX, range[1]));
  /** Is de cel een kandidaat voor props op begaanbare grond (geen bos, water, bouwvlak of padcorridor)? */
  const isOpenGround = (cx: number, cy: number): boolean => {
    if (cx < 0 || cy < 0 || cx >= n || cy >= n) return false;
    const i = cy * n + cx;
    return (
      passable[i] === 1 && forest[i] === 0 && water[i] === 0 && clear[i] === 0 && corridor[i] === 0
    );
  };
  /** A-helft: de cel komt eerder in rijvolgorde dan zijn spiegel (de spiegel van een prop wordt erbij gezet). */
  const isFirstHalf = (cx: number, cy: number): boolean =>
    cy * n + cx < (n - 1 - cy) * n + (n - 1 - cx);
  /** Anker (cel) hoort bij de A-helft of is zijn eigen spiegel (het midden). */
  const isAnchorHalf = (cx: number, cy: number): boolean =>
    cy * n + cx <= (n - 1 - cy) * n + (n - 1 - cx);

  // 1. Kits: kampen, ruines, claimpunten en voordes.
  const placeKitPart = (part: KitPart, ax: number, ay: number, baseU: number): void => {
    const count = rng.range(part.count[0], part.count[1]);
    const ringMin = Math.round(part.ringM[0] * UNITS_PER_METER);
    const ringSpan = Math.max(1, Math.round((part.ringM[1] - part.ringM[0]) * UNITS_PER_METER));
    const clumpU = Math.round((part.clumpM ?? 0) * UNITS_PER_METER);
    let cxU = 0; // het middelpunt van de pluk
    let cyU = 0;
    let haveClump = false;
    let done = 0;
    for (let attempt = 0; attempt < count * 24 && done < count; attempt++) {
      let x: number;
      let y: number;
      let yaw = rng.below(65536);
      if (clumpU > 0) {
        if (!haveClump) {
          const angle = rng.below(65536);
          const radius = baseU + ringMin + rng.below(ringSpan);
          cxU = ax + ((radius * cos1024(angle)) >> 10);
          cyU = ay + ((radius * sin1024(angle)) >> 10);
        }
        x = cxU + rng.below(2 * clumpU + 1) - clumpU;
        y = cyU + rng.below(2 * clumpU + 1) - clumpU;
      } else {
        const angle = rng.below(65536);
        const radius = baseU + ringMin + rng.below(ringSpan);
        x = ax + ((radius * cos1024(angle)) >> 10);
        y = ay + ((radius * sin1024(angle)) >> 10);
        if (part.tangent === true) yaw = angle;
      }
      if (!isOpenGround(x >> 8, y >> 8)) continue;
      const asset = pickWeighted(rng, part.assets);
      if (tryPlace(asset, x, y, yaw, scaleIn(DEFAULT_SCALE))) {
        done++;
        haveClump = true;
      }
    }
  };
  const placeKit = (kit: KitSpec | undefined, cx: number, cy: number, baseM: number): void => {
    if (kit === undefined || !isAnchorHalf(cx, cy)) return;
    const ax = cx * UNITS_PER_METER + (UNITS_PER_METER >> 1);
    const ay = cy * UNITS_PER_METER + (UNITS_PER_METER >> 1);
    for (const part of kit.parts) placeKitPart(part, ax, ay, Math.round(baseM * UNITS_PER_METER));
  };

  // 2. Kliffen komen eerst: ze hebben veel ruimte nodig en liggen alleen op dikke onbegaanbare stroken.
  const cliffQuotas = spec.quotas.filter((q) => q.on === 'cliff');
  const otherQuotas = spec.quotas.filter((q) => q.on !== 'cliff');

  // Kandidaatcellen per klasse, in rijvolgorde (deterministisch). Bos en water zijn nooit kandidaat voor quota's,
  // behalve de kliffen (die staan juist graag aan de bosrand van de map, waar het terrein al onbegaanbaar is).
  const margin = spec.edgeMargin ?? 0;
  const lists: Record<PropPlacement, number[]> = {
    blocked: [],
    edge: [],
    open: [],
    shore: [],
    valley: [],
    dry: [],
    cliff: [],
  };
  const masks: Record<PropPlacement, Uint8Array> = {
    blocked: new Uint8Array(n * n),
    edge: new Uint8Array(n * n),
    open: new Uint8Array(n * n),
    shore: new Uint8Array(n * n),
    valley: new Uint8Array(n * n),
    dry: new Uint8Array(n * n),
    cliff: new Uint8Array(n * n),
  };
  const add = (kind: PropPlacement, i: number): void => {
    lists[kind].push(i);
    masks[kind][i] = 1;
  };
  for (let cy = 0; cy < n; cy++) {
    for (let cx = 0; cx < n; cx++) {
      const i = cy * n + cx;
      if (water[i] !== 0 || clear[i] !== 0) continue;
      const inMargin = cx < margin || cy < margin || cx >= n - margin || cy >= n - margin;
      if (passable[i] !== 1) {
        if (inMargin) continue;
        add('cliff', i);
        if (forest[i] === 0) add('blocked', i);
      } else if (forest[i] === 0 && corridor[i] === 0) {
        add('open', i);
        if (nearBlocked(cx, cy, 1)) add('edge', i);
        if (nearWater(cx, cy, 3)) add('shore', i);
        const height = heights === undefined ? 0 : (heights[i] as number);
        if (heights !== undefined && height < valleyBelowU) add('valley', i);
        if (heights !== undefined && height >= dryAboveU) add('dry', i);
      }
    }
  }

  // Celindex naar rij zonder deling: een binaire zoekactie op de rij-starts.
  const rowOf = (i: number): number => {
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (mid * n <= i) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  const quotaAsset = (q: PropQuota): string => pickWeighted(rng, q.assets);
  /** Een klif mag alleen waar de onbegaanbare strook dik genoeg is: de voet kan er dan niet ver in een pad steken. */
  const cliffDepthOk = (asset: string, cx: number, cy: number): boolean => {
    const need = Math.max(2, Math.ceil((PROP_INFO[asset] as PropInfo).radiusM * 0.7));
    const depth = blockedDepth[cy * n + cx] as number;
    return depth >= need && depth <= need + 3;
  };
  const placeQuota = (q: PropQuota): void => {
    const list = lists[q.on];
    if (list.length === 0) throw new Error(`scatterProps: geen kandidaatcellen voor ${q.on}`);
    const scale = q.scalePct ?? DEFAULT_SCALE;
    let done = 0;
    let attempts = 0;
    while (done < q.perHalf) {
      if (++attempts > MAX_ATTEMPTS)
        throw new Error(`scatterProps: quota ${q.assets[0]?.asset ?? '?'} (${q.on}) niet te halen`);
      const i = list[rng.below(list.length)] as number;
      const cy = rowOf(i);
      const cx = i - cy * n;
      if (!isFirstHalf(cx, cy)) continue;
      const x0 = cx * UNITS_PER_METER + rng.below(UNITS_PER_METER);
      const y0 = cy * UNITS_PER_METER + rng.below(UNITS_PER_METER);
      if (q.clump === undefined) {
        const asset = quotaAsset(q);
        if (q.on === 'cliff' && !cliffDepthOk(asset, cx, cy)) continue;
        if (tryPlace(asset, x0, y0, rng.below(65536), scaleIn(scale))) done++;
        continue;
      }
      const size = rng.range(q.clump.min, q.clump.max);
      const spread = Math.round(q.clump.radiusM * UNITS_PER_METER);
      for (let m = 0; m < size && done < q.perHalf; m++) {
        const x = x0 + rng.below(2 * spread + 1) - spread;
        const y = y0 + rng.below(2 * spread + 1) - spread;
        if (x < 0 || y < 0 || x > maxU || y > maxU) continue;
        if (masks[q.on][(y >> 8) * n + (x >> 8)] !== 1) continue;
        if (tryPlace(quotaAsset(q), x, y, rng.below(65536), scaleIn(scale))) done++;
      }
    }
  };
  for (const q of cliffQuotas) placeQuota(q);

  // 3. Kits (kampen, ruines, claimpunten, voordes), vóór het bos en de quota's: zij claimen hun ruimte eerst.
  const kits = spec.kits;
  if (kits !== undefined) {
    for (const c of def.creepCamps) placeKit(kits.camp, c.x, c.y, 0);
    for (const r of layers.ruins ?? []) {
      const cx = (r.x0 + r.x1) >> 1;
      const cy = (r.y0 + r.y1) >> 1;
      placeKit(kits.ruin, cx, cy, (Math.max(r.x1 - r.x0, r.y1 - r.y0) + 1) >> 1);
    }
    for (const c of def.claimPoints) placeKit(kits.claim, c.x, c.y, 0);
    for (const c of layers.crossings ?? []) if (c.kind === 'ford') placeKit(kits.ford, c.x, c.y, 0);
  }

  // 4. Bos: een gejitterd raster van `cellM` meter; per vak hooguit één boom. Vakken in de A-helft (eerder in
  //    rijvolgorde dan hun spiegelvak), de spiegel komt erbij. Dicht bos op bos-cellen, losse bomen in de ring.
  if (spec.forest !== undefined) {
    const f = spec.forest;
    const blocks = blocksPerSide(n, f.cellM);
    const ring = forestRing(forest, n, f.ringM);
    const cellU = f.cellM * UNITS_PER_METER;
    const treeAt = (cx: number, cy: number): string => {
      const i = cy * n + cx;
      const depth = forestDepth[i] as number; // 0 buiten het bos
      const atEdge = depth <= f.barePct.edgeCells;
      const high = heights !== undefined && (heights[i] as number) >= dryAboveU;
      const bare = f.barePct.base + (atEdge ? f.barePct.edge : 0) + (high ? f.barePct.dry : 0);
      if (rng.below(100) < bare) return pickWeighted(rng, f.bare, depth);
      // Gladde ruis op een raster van 32 m, met extra contrast: stukken eiken- en stukken dennenbos.
      const mix = Math.max(0, Math.min(255, ((noise2(cx, cy, spec.seed + 5, 5) - 128) << 1) + 128));
      const pine = f.pinePct[0] + (((f.pinePct[1] - f.pinePct[0]) * mix) >> 8);
      return pickWeighted(rng, rng.below(100) < pine ? f.pine : f.oak, depth);
    };
    for (let by = 0; by < blocks; by++) {
      for (let bx = 0; bx < blocks; bx++) {
        if (by * blocks + bx >= (blocks - 1 - by) * blocks + (blocks - 1 - bx)) continue;
        // Plek binnen het vak met 1/2 m marge aan elke kant.
        const x = bx * cellU + 128 + rng.below(cellU - UNITS_PER_METER);
        const y = by * cellU + 128 + rng.below(cellU - UNITS_PER_METER);
        const yaw = rng.below(65536);
        const scalePct = scaleIn(f.scalePct);
        const roll = rng.below(100);
        const cx = x >> 8;
        const cy = y >> 8;
        const i = cy * n + cx;
        if (water[i] !== 0 || nearWater(cx, cy, 1) || clear[i] !== 0) continue;
        const inForest = forest[i] !== 0;
        if (inForest) {
          if (roll >= f.gapPct) tryPlace(treeAt(cx, cy), x, y, yaw, scalePct);
          if (f.understory !== undefined && rng.below(100) < f.understory.pct) {
            const px = bx * cellU + 128 + rng.below(cellU - UNITS_PER_METER);
            const py = by * cellU + 128 + rng.below(cellU - UNITS_PER_METER);
            const pi = (py >> 8) * n + (px >> 8);
            if (forest[pi] !== 0 && water[pi] === 0 && clear[pi] === 0)
              tryPlace(
                pickWeighted(rng, f.understory.assets),
                px,
                py,
                rng.below(65536),
                scaleIn(DEFAULT_SCALE),
              );
          }
        } else if (ring[i] === 1 && isOpenGround(cx, cy)) {
          if (roll < f.ringPct) tryPlace(treeAt(cx, cy), x, y, yaw, scalePct);
        }
      }
    }
  }

  // 5. Quota's.
  for (const q of otherQuotas) placeQuota(q);
  return { format: PROPS_FORMAT, w: n, h: n, props: placed, _comment: spec.comment };
}

/** Aantal vakken van `cellM` meter per zijde; `cellM` moet de mapmaat precies delen. */
function blocksPerSide(n: number, cellM: number): number {
  let b = 0;
  while ((b + 1) * cellM <= n) b++;
  if (b * cellM !== n) throw new Error(`scatterProps: forest.cellM ${cellM} deelt ${n} niet`);
  return b;
}

/** Cellen zonder bos binnen `ringM` (Chebyshev) van een bos-cel: daar komen losse bomen. */
function forestRing(forest: Uint8Array, n: number, ringM: number): Uint8Array {
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
