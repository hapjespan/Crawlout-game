import { UNITS_PER_METER } from '@crawlout/protocol';
import type { MapDef } from '@crawlout/data';
import { createRng, type Rng } from './rng.js';
import type { MapAssets, MapGrid } from './types.js';

// Decoratieve props (bomen, rotsen, struiken, gras). Puur visueel: de sim leest ze niet en ze zitten niet in de envHash.
// Opslag: data/maps/<id>.props.json, verwezen door het optionele veld MapDef.props. Posities in sim-eenheden (1 m = 256),
// yaw 0..65535 (zoals de sim), scalePct 80..130. Asset-ids zijn manifest-ids (bestandsnaam in kleine letters).
export const PROPS_FORMAT = 'crawlout-props/1';
export const PROP_SCALE_MIN = 80;
export const PROP_SCALE_MAX = 130;
/** Geen prop binnen deze afstand (meters) van spawns, scrap-nodes, claimpunten en creep-kampen. */
export const PROP_CLEARANCE_M = 3;

export type PropKind = 'tree' | 'rock' | 'bush' | 'grass' | 'reed';

/** Vaste lijst: de tien Gobkit-props uit assets/src/props, met soort. */
export const PROP_KINDS: Readonly<Record<string, PropKind>> = {
  treehigh001: 'tree',
  treemed001: 'tree',
  treelow001: 'tree',
  bush001: 'bush',
  bush002: 'bush',
  rock001: 'rock',
  rock002: 'rock',
  rock003: 'rock',
  grass001: 'grass',
  reed001: 'reed',
};

export interface PropRecord {
  asset: string;
  /** Sim-eenheden (1 m = 256). */
  x: number;
  y: number;
  /** 0..65535, 0 = sim +x. */
  yaw: number;
  scalePct: number;
}

export interface PropsFile {
  format: typeof PROPS_FORMAT;
  w: number;
  h: number;
  props: PropRecord[];
  _comment?: string;
}

/** Voor render: posities in meters, hoek in radialen. Hoogte (y omhoog) leest de renderer uit de heightmap. */
export interface PropInstance {
  asset: string;
  /** Meters, x en y als de map (y wordt z in de wereld). */
  x: number;
  y: number;
  yaw: number;
  yawRad: number;
  /** 1 = 100 %. */
  scale: number;
  scalePct: number;
}

const INV_UNITS = 0.00390625; // 1/256, macht van twee, dus exact (UNITS_PER_METER = 256)
const YAW_TO_RAD = 6.283185307179586 * 0.0000152587890625; // 2*pi/65536, de factor 1/65536 is exact

export function parseProps(text: string, w: number, h: number): PropsFile {
  const f = JSON.parse(text) as Partial<PropsFile> | null;
  if (!f || f.format !== PROPS_FORMAT)
    throw new Error(`props: onbekend formaat (verwacht ${PROPS_FORMAT})`);
  if (f.w !== w || f.h !== h)
    throw new Error(`props: ${String(f.w)}x${String(f.h)} past niet bij mapgrootte ${w}x${h}`);
  if (!Array.isArray(f.props)) throw new Error('props: props ontbreekt');
  const maxX = w * UNITS_PER_METER;
  const maxY = h * UNITS_PER_METER;
  f.props.forEach((p, i) => {
    const where = `props[${i}]`;
    if (typeof p.asset !== 'string' || p.asset.length === 0)
      throw new Error(`${where}: asset ontbreekt`);
    if (!Number.isInteger(p.x) || p.x < 0 || p.x >= maxX)
      throw new Error(`${where}: x buiten de map`);
    if (!Number.isInteger(p.y) || p.y < 0 || p.y >= maxY)
      throw new Error(`${where}: y buiten de map`);
    if (!Number.isInteger(p.yaw) || p.yaw < 0 || p.yaw > 65535)
      throw new Error(`${where}: yaw buiten 0..65535`);
    if (!Number.isInteger(p.scalePct) || p.scalePct < PROP_SCALE_MIN || p.scalePct > PROP_SCALE_MAX)
      throw new Error(`${where}: scalePct buiten ${PROP_SCALE_MIN}..${PROP_SCALE_MAX}`);
  });
  return f as PropsFile;
}

/** Leest de props van een map (def.props) voor de renderer. Geeft [] als de map geen props heeft. De sim roept dit nooit aan. */
export function loadProps(def: MapDef, assets: MapAssets): PropInstance[] {
  if (def.props === undefined) return [];
  const file = parseProps(assets.read(def.props), def.size.w, def.size.h);
  return file.props.map((p) => ({
    asset: p.asset,
    x: p.x * INV_UNITS,
    y: p.y * INV_UNITS,
    yaw: p.yaw,
    yawRad: p.yaw * YAW_TO_RAD,
    scale: p.scalePct * 0.01,
    scalePct: p.scalePct,
  }));
}

export function encodeProps(file: PropsFile): string {
  const head = JSON.stringify({
    format: file.format,
    w: file.w,
    h: file.h,
    ...(file._comment === undefined ? {} : { _comment: file._comment }),
  });
  const rows = file.props.map(
    (p) =>
      `    ${JSON.stringify({ asset: p.asset, x: p.x, y: p.y, yaw: p.yaw, scalePct: p.scalePct })}`,
  );
  return `${head.slice(0, -1)},"props":[\n${rows.join(',\n')}\n  ]}`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Scatter-generator (build-tijd). Deterministisch: eigen integer-RNG, vaste volgorde, puntsymmetrisch (180 graden).
// Werkt op elke vierkante map. Twee delen: het bos (een gejitterd raster over de bosrand, de kernen van de bosjes en
// een rand van losse bomen eromheen) en daarna de quota (losse bomen, rotsen, struiken, gras, riet).

/** Waar een quotum zijn kandidaatcellen zoekt. Standaard per soort (zie `pickCell`). */
export type PropPlacement = 'blocked' | 'edge' | 'open' | 'shore';

export interface PropQuota {
  asset: string;
  /** Aantal in de A-helft; de B-helft wordt gespiegeld, dus het totaal is tweemaal dit getal. */
  perHalf: number;
  /** Optioneel: vaste plek in plaats van de standaardverdeling van de soort. */
  on?: PropPlacement;
}

export interface WeightedAsset {
  asset: string;
  weight: number;
}

export interface ForestPropsSpec {
  /** Rastermaat in meters (deler van de mapmaat): in dicht bos staat één boom per vak, op een willekeurige plek. */
  cellM: number;
  /** Kans in procenten dat een vak in dicht bos leeg blijft. */
  gapPct: number;
  /** Soorten in dicht bos (bosrand en kernen), met gewicht. */
  dense: WeightedAsset[];
  /** Rand van losse bomen (begaanbaar) rond dicht bos: breedte in meters en kans in procenten per vak. */
  ringM: number;
  ringPct: number;
  ring: WeightedAsset[];
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
  /** Optioneel: bomen in het bos (vraagt `ScatterLayers.forest`). */
  forest?: ForestPropsSpec;
}

/** Extra lagen van de generator: bos (0 geen, anders dicht bos) en water (0 droog). Zonder lagen geldt alles als 0. */
export interface ScatterLayers {
  forest?: Uint8Array;
  water?: Uint8Array;
  /**
   * Cirkels (cellen) zonder props: de bouwvlakken rond de spawns, waar gebouwen op echte schaal komen te staan. De
   * aanroeper geeft beide spelers op (de builder spiegelt de pads); de spiegel van een prop moet ook vrij liggen.
   */
  clearings?: readonly { x: number; y: number; radius: number }[];
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
const MIN_SPACING_U = UNITS_PER_METER; // props onderling minstens 1 m uit elkaar
const MAX_ATTEMPTS = 200000;

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

function pickWeighted(r: Rng, list: WeightedAsset[]): string {
  let total = 0;
  for (const a of list) total += a.weight;
  let roll = r.below(total);
  for (const a of list) {
    if (roll < a.weight) return a.asset;
    roll -= a.weight;
  }
  return (list[list.length - 1] as WeightedAsset).asset;
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

  const placed: PropRecord[] = [];
  const bucket = new Map<number, PropRecord[]>(); // 4 m-buckets voor de onderlinge afstand
  const bucketKey = (x: number, y: number): number => ((y >> 10) << 10) | (x >> 10);
  const farFromKeyPoints = (x: number, y: number): boolean => {
    for (const k of keyU) {
      const dx = x - k.x;
      const dy = y - k.y;
      if (dx * dx + dy * dy < KEY_POINT_CLEARANCE_U * KEY_POINT_CLEARANCE_U) return false;
    }
    return true;
  };
  const spacedFromOthers = (x: number, y: number, extra: PropRecord | null): boolean => {
    for (let by = (y >> 10) - 1; by <= (y >> 10) + 1; by++) {
      for (let bx = (x >> 10) - 1; bx <= (x >> 10) + 1; bx++) {
        for (const q of bucket.get((by << 10) | bx) ?? []) {
          const dx = x - q.x;
          const dy = y - q.y;
          if (dx * dx + dy * dy < MIN_SPACING_U * MIN_SPACING_U) return false;
        }
      }
    }
    if (extra !== null) {
      const dx = x - extra.x;
      const dy = y - extra.y;
      if (dx * dx + dy * dy < MIN_SPACING_U * MIN_SPACING_U) return false;
    }
    return true;
  };
  const store = (p: PropRecord): void => {
    placed.push(p);
    const k = bucketKey(p.x, p.y);
    const list = bucket.get(k);
    if (list === undefined) bucket.set(k, [p]);
    else list.push(p);
  };
  /** Zet een prop en zijn spiegel als beide vrij liggen; true als het lukte. */
  const tryPlace = (
    asset: string,
    x: number,
    y: number,
    yaw: number,
    scalePct: number,
  ): boolean => {
    const mx = maxU - x;
    const my = maxU - y;
    const a: PropRecord = { asset, x, y, yaw, scalePct };
    const b: PropRecord = { asset, x: mx, y: my, yaw: (yaw + 32768) & 65535, scalePct };
    if (!farFromKeyPoints(x, y) || !farFromKeyPoints(mx, my)) return false;
    if (!spacedFromOthers(x, y, null) || !spacedFromOthers(mx, my, a) || !spacedFromOthers(x, y, b))
      return false;
    store(a);
    store(b);
    return true;
  };

  // 1. Bos: een gejitterd raster van `cellM` meter; per vak hooguit één boom. Vakken in de A-helft (eerder in
  //    rijvolgorde dan hun spiegelvak), de spiegel komt erbij. Dicht bos op bos-cellen, losse bomen in de ring.
  if (spec.forest !== undefined) {
    const f = spec.forest;
    const blocks = blocksPerSide(n, f.cellM);
    const ring = forestRing(forest, n, f.ringM);
    const cellU = f.cellM * UNITS_PER_METER;
    for (let by = 0; by < blocks; by++) {
      for (let bx = 0; bx < blocks; bx++) {
        if (by * blocks + bx >= (blocks - 1 - by) * blocks + (blocks - 1 - bx)) continue;
        // Plek binnen het vak met 1/2 m marge aan elke kant, zodat bomen in buurvakken minstens 1 m uit elkaar staan.
        const x = bx * cellU + 128 + rng.below(cellU - UNITS_PER_METER);
        const y = by * cellU + 128 + rng.below(cellU - UNITS_PER_METER);
        const yaw = rng.below(65536);
        const scalePct = rng.range(PROP_SCALE_MIN, PROP_SCALE_MAX);
        const roll = rng.below(100);
        const cx = x >> 8;
        const cy = y >> 8;
        const i = cy * n + cx;
        if (water[i] !== 0 || nearWater(cx, cy, 1) || clear[i] !== 0) continue;
        if (forest[i] !== 0) {
          if (roll < f.gapPct) continue;
          tryPlace(pickWeighted(rng, f.dense), x, y, yaw, scalePct);
        } else if (ring[i] === 1 && passable[i] === 1 && corridor[i] === 0) {
          if (roll >= f.ringPct) continue;
          tryPlace(pickWeighted(rng, f.ring), x, y, yaw, scalePct);
        }
      }
    }
  }

  // 2. Quota. Kandidaatcellen per klasse, in rijvolgorde (deterministisch), nooit in bos of water.
  const margin = spec.edgeMargin ?? 0;
  const onBlocked: number[] = [];
  const onEdge: number[] = [];
  const onOpen: number[] = [];
  const onShore: number[] = [];
  for (let cy = 0; cy < n; cy++) {
    for (let cx = 0; cx < n; cx++) {
      const i = cy * n + cx;
      if (forest[i] !== 0 || water[i] !== 0 || clear[i] !== 0) continue;
      const inMargin = cx < margin || cy < margin || cx >= n - margin || cy >= n - margin;
      if (passable[i] !== 1) {
        if (!inMargin) onBlocked.push(i);
      } else if (corridor[i] === 0) {
        onOpen.push(i);
        if (nearBlocked(cx, cy, 1)) onEdge.push(i);
        if (nearWater(cx, cy, 2)) onShore.push(i);
      }
    }
  }
  const lists: Record<PropPlacement, number[]> = {
    blocked: onBlocked,
    edge: onEdge,
    open: onOpen,
    shore: onShore,
  };
  const pick = (r: Rng, list: number[]): number => {
    if (list.length === 0) throw new Error('scatterProps: geen kandidaatcellen');
    return list[r.below(list.length)] as number;
  };
  const pickCell = (kind: PropKind, on: PropPlacement | undefined, r: Rng): number => {
    const roll = r.below(100);
    if (on !== undefined) return pick(r, lists[on]);
    switch (kind) {
      case 'tree':
        return pick(r, roll < 65 ? onBlocked : onEdge);
      case 'rock':
        return pick(r, roll < 55 ? onBlocked : onEdge);
      case 'bush':
        return pick(r, roll < 50 ? onEdge : onOpen);
      case 'reed':
        return pick(r, onShore.length > 0 ? onShore : onEdge);
      default:
        return pick(r, onOpen);
    }
  };
  // Celindex naar (x, y) zonder deling: een rij-tabel.
  const rowStart = new Int32Array(n + 1);
  for (let y = 0; y <= n; y++) rowStart[y] = y * n;
  const rowOf = (i: number): number => {
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((rowStart[mid] as number) <= i) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };

  for (const q of spec.quotas) {
    const kind = PROP_KINDS[q.asset];
    if (kind === undefined) throw new Error(`scatterProps: onbekend prop-asset ${q.asset}`);
    let done = 0;
    let attempts = 0;
    while (done < q.perHalf) {
      if (++attempts > MAX_ATTEMPTS)
        throw new Error(`scatterProps: quota ${q.asset} niet te halen`);
      const i = pickCell(kind, q.on, rng);
      const cy = rowOf(i);
      const cx = i - cy * n;
      // A-helft: cel eerder in rijvolgorde dan zijn spiegel; de spiegel wordt erbij gezet.
      if (i >= (n - 1 - cy) * n + (n - 1 - cx)) continue;
      const x = cx * UNITS_PER_METER + rng.below(UNITS_PER_METER);
      const y = cy * UNITS_PER_METER + rng.below(UNITS_PER_METER);
      const yaw = rng.below(65536);
      const scalePct = rng.range(PROP_SCALE_MIN, PROP_SCALE_MAX);
      if (tryPlace(q.asset, x, y, yaw, scalePct)) done++;
    }
  }
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
