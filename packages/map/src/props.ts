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
  if (!f || f.format !== PROPS_FORMAT) throw new Error(`props: onbekend formaat (verwacht ${PROPS_FORMAT})`);
  if (f.w !== w || f.h !== h) throw new Error(`props: ${String(f.w)}x${String(f.h)} past niet bij mapgrootte ${w}x${h}`);
  if (!Array.isArray(f.props)) throw new Error('props: props ontbreekt');
  const maxX = w * UNITS_PER_METER;
  const maxY = h * UNITS_PER_METER;
  f.props.forEach((p, i) => {
    const where = `props[${i}]`;
    if (typeof p.asset !== 'string' || p.asset.length === 0) throw new Error(`${where}: asset ontbreekt`);
    if (!Number.isInteger(p.x) || p.x < 0 || p.x >= maxX) throw new Error(`${where}: x buiten de map`);
    if (!Number.isInteger(p.y) || p.y < 0 || p.y >= maxY) throw new Error(`${where}: y buiten de map`);
    if (!Number.isInteger(p.yaw) || p.yaw < 0 || p.yaw > 65535) throw new Error(`${where}: yaw buiten 0..65535`);
    if (!Number.isInteger(p.scalePct) || p.scalePct < PROP_SCALE_MIN || p.scalePct > PROP_SCALE_MAX) throw new Error(`${where}: scalePct buiten ${PROP_SCALE_MIN}..${PROP_SCALE_MAX}`);
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
  const head = JSON.stringify({ format: file.format, w: file.w, h: file.h, ...(file._comment === undefined ? {} : { _comment: file._comment }) });
  const rows = file.props.map((p) => `    ${JSON.stringify({ asset: p.asset, x: p.x, y: p.y, yaw: p.yaw, scalePct: p.scalePct })}`);
  return `${head.slice(0, -1)},"props":[\n${rows.join(',\n')}\n  ]}`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Scatter-generator (build-tijd). Deterministisch: eigen integer-RNG, vaste volgorde, puntsymmetrisch (180 graden).

export interface PropQuota {
  asset: string;
  /** Aantal in de A-helft; de B-helft wordt gespiegeld, dus het totaal is tweemaal dit getal. */
  perHalf: number;
}
export interface PropsSpec {
  seed: number;
  quotas: PropQuota[];
  comment: string;
}

const KEY_POINT_CLEARANCE_U = PROP_CLEARANCE_M * UNITS_PER_METER;
const MIN_SPACING_U = UNITS_PER_METER; // props onderling minstens 1 m uit elkaar
const MAX_ATTEMPTS = 20000;

interface KeyPoint {
  x: number;
  y: number;
}

/**
 * Cellen die vrij van tall props blijven: een kortste 4-verbonden pad van elke spawn naar elk ander belangrijk punt,
 * 1 cel verbreed, plus de spiegel ervan. Props op begaanbare cellen mogen er nooit op liggen.
 */
export function pathCorridor(map: Pick<MapGrid, 'w' | 'h' | 'passable'>, spawns: KeyPoint[], targets: KeyPoint[]): Uint8Array {
  const { w, h, passable } = map;
  if (w !== 128 || h !== 128) throw new Error('pathCorridor: alleen 128x128 (celindex via bitshift)');
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
  for (const s of spawns) {
    const parent = new Int32Array(w * h).fill(-2);
    const queue = new Int32Array(w * h);
    let head = 0;
    let tail = 0;
    parent[s.y * w + s.x] = -1;
    queue[tail++] = s.y * w + s.x;
    while (head < tail) {
      const i = queue[head++] as number;
      const cx = i & 127;
      const cy = i >> 7;
      for (let d = 0; d < 4; d++) {
        const nx = cx + (DX[d] as number);
        const ny = cy + (DY[d] as number);
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (passable[j] !== 1 || parent[j] !== -2) continue;
        parent[j] = i;
        queue[tail++] = j;
      }
    }
    for (const t of [...targets, ...spawns]) {
      let i = t.y * w + t.x;
      if (parent[i] === -2) continue;
      while (i >= 0) {
        mark(i & 127, i >> 7);
        i = parent[i] as number;
      }
    }
  }
  return corridor;
}

/** Genereert de propslijst voor een gegenereerde map. Gooit als een quota niet te halen is. */
export function scatterProps(
  def: Pick<MapDef, 'id' | 'size' | 'spawns' | 'scrapNodes' | 'claimPoints' | 'creepCamps'>,
  passable: Uint8Array,
  spec: PropsSpec,
): PropsFile {
  const { w, h } = def.size;
  if (w !== 128 || h !== 128) throw new Error('scatterProps: alleen 128x128 (celindex via bitshift)');
  const rng = createRng(spec.seed);
  const keyPoints: KeyPoint[] = [...def.spawns, ...def.scrapNodes, ...def.claimPoints, ...def.creepCamps].map((p) => ({ x: p.x, y: p.y }));
  const corridor = pathCorridor({ w, h, passable }, def.spawns, keyPoints);
  // Sim-eenheden van de middens, voor de afstandscontrole.
  const keyU = keyPoints.map((p) => ({ x: p.x * UNITS_PER_METER + (UNITS_PER_METER >> 1), y: p.y * UNITS_PER_METER + (UNITS_PER_METER >> 1) }));
  const maxU = w * UNITS_PER_METER - 1;

  const blocked = (cx: number, cy: number): boolean => cx < 0 || cy < 0 || cx >= w || cy >= h || passable[cy * w + cx] !== 1;
  const nearBlocked = (cx: number, cy: number, r: number): boolean => {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (blocked(cx + dx, cy + dy)) return true;
    return false;
  };
  // Kandidaatcellen per klasse, in rijvolgorde (deterministisch): onbegaanbaar, begaanbare rand (buiten het pad), open grond (buiten het pad).
  const onBlocked: number[] = [];
  const onEdge: number[] = [];
  const onOpen: number[] = [];
  for (let cy = 0; cy < h; cy++) {
    for (let cx = 0; cx < w; cx++) {
      const i = cy * w + cx;
      if (passable[i] !== 1) onBlocked.push(i);
      else if (corridor[i] === 0) {
        onOpen.push(i);
        if (nearBlocked(cx, cy, 1)) onEdge.push(i);
      }
    }
  }

  const placed: PropRecord[] = [];
  const bucket = new Map<number, PropRecord[]>(); // 4 m-buckets voor de onderlinge afstand
  const bucketKey = (x: number, y: number): number => ((y >> 10) << 8) | (x >> 10);
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
        for (const q of bucket.get((by << 8) | bx) ?? []) {
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

  const pickCell = (kind: PropKind, r: Rng): number => {
    const roll = r.below(100);
    switch (kind) {
      case 'tree':
        return pick(r, roll < 65 ? onBlocked : onEdge);
      case 'rock':
        return pick(r, roll < 55 ? onBlocked : onEdge);
      case 'bush':
        return pick(r, roll < 50 ? onEdge : onOpen);
      case 'reed':
        return pick(r, onEdge);
      default:
        return pick(r, onOpen);
    }
  };
  const pick = (r: Rng, list: number[]): number => list[r.below(list.length)] as number;

  for (const q of spec.quotas) {
    const kind = PROP_KINDS[q.asset];
    if (kind === undefined) throw new Error(`scatterProps: onbekend prop-asset ${q.asset}`);
    let done = 0;
    let attempts = 0;
    while (done < q.perHalf) {
      if (++attempts > MAX_ATTEMPTS) throw new Error(`scatterProps: quota ${q.asset} niet te halen`);
      const i = pickCell(kind, rng);
      const cx = i & 127;
      const cy = i >> 7;
      // A-helft: cel eerder in rijvolgorde dan zijn spiegel; de spiegel wordt erbij gezet.
      if (i >= (h - 1 - cy) * w + (w - 1 - cx)) continue;
      const x = cx * UNITS_PER_METER + rng.below(UNITS_PER_METER);
      const y = cy * UNITS_PER_METER + rng.below(UNITS_PER_METER);
      const yaw = rng.below(65536);
      const scalePct = rng.range(PROP_SCALE_MIN, PROP_SCALE_MAX);
      const mx = maxU - x;
      const my = maxU - y;
      const a: PropRecord = { asset: q.asset, x, y, yaw, scalePct };
      const b: PropRecord = { asset: q.asset, x: mx, y: my, yaw: (yaw + 32768) & 65535, scalePct };
      if (!farFromKeyPoints(x, y) || !farFromKeyPoints(mx, my)) continue;
      if (!spacedFromOthers(x, y, null) || !spacedFromOthers(mx, my, a) || !spacedFromOthers(x, y, b)) continue;
      store(a);
      store(b);
      done++;
    }
  }
  return { format: PROPS_FORMAT, w, h, props: placed, _comment: spec.comment };
}
