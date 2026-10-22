// Rivier (build-tijd, alleen integers). Een meanderende rivier langs een middellijn van controlepunten, gladgemaakt
// met Chaikin (hoeken afsnijden), met per punt een eigen straal. De rivier snijdt een bedding in het hoogteveld: het
// wateroppervlak ligt op hoogte 0 (`WATER_LEVEL_CM`), de bedding eronder, de oevers lopen als een flauw strand omhoog
// en gaan daarna steil (klif) over in het terrein. Oversteken: een voorde (ondiep, begaanbaar, masker 2) of een
// landbrug (het terrein blijft staan, masker 0). Puntsymmetrie: de controlepunten van de A-helft lopen van de rand naar
// het midden en worden gespiegeld; de uitvoer wordt bovendien exact gemaakt door de A-helft over de B-helft te kopiëren.

export const WATER_NONE = 0;
export const WATER_DEEP = 1;
export const WATER_SHALLOW = 2;
/** Het wateroppervlak ligt op hoogte 0; de bedding is negatief. */
export const WATER_LEVEL_CM = 0;

/** Fixed point voor de middellijn: 1/16 m. */
const FP = 16;
const FP_SHIFT = 4;

export interface RiverPoint {
  /** Meters (mag buiten de map liggen, zodat de rivier over de rand doorloopt). */
  x: number;
  y: number;
  /** Halve breedte van het water in meters (3 tot 5 voor 6 tot 10 m breed). */
  r: number;
}

export interface RiverCrossing {
  /** Een punt bij de rivier (meters); de oversteek ligt op het dichtstbijzijnde punt van de middellijn. */
  x: number;
  y: number;
  kind: 'ford' | 'bridge';
  /** Halve lengte langs de rivier in meters (3,5 = 7 m breed). */
  halfLengthM: number;
}

export interface RiverSpec {
  /**
   * Controlepunten van de A-helft, van de maprand tot vlak bij het midden. Het midden zelf wordt toegevoegd en de
   * B-helft is de 180 graden gedraaide kopie in omgekeerde volgorde, dus de rivier loopt glad door het midden.
   */
  points: RiverPoint[];
  /** Straal in het midden (meters). */
  centreR: number;
  /** Aantal Chaikin-rondes. */
  smoothRounds: number;
  /** Oversteken in de A-helft (een oversteek in het midden is zelfspiegelend en staat er één keer in). */
  crossings: RiverCrossing[];
  /** Diepte van de bedding aan de waterrand en in het diepste deel (cm onder het wateroppervlak). */
  bedEdgeCm: number;
  bedMaxCm: number;
  /** Diepte van een voorde (cm onder het wateroppervlak). */
  fordDepthCm: number;
  /** Oever: hoogte aan de waterrand (cm), het strand (helling in cm per m, lengte in m) en daarna de wand (cm per m). */
  bankBaseCm: number;
  beachSlopeCmPerM: number;
  beachLengthM: number;
  wallSlopeCmPerM: number;
  /** Tot hoe ver van het water (m) de oever het terrein mag verlagen. */
  bankReachM: number;
}

export interface RiverResult {
  /** WATER_NONE, WATER_DEEP of WATER_SHALLOW per cel. */
  mask: Uint8Array;
  /** Cellen van een landbrug (1), voor tests en props. */
  bridge: Uint8Array;
  /** Afstand van de cel tot de waterrand in 1/16 m (negatief in het water), gekapt op bankReach. */
  edgeDist: Int32Array;
  /** Middellijn (1/16 m), voor tests en props. */
  line: Array<{ x: number; y: number }>;
  /** Midden van elke oversteek in cellen (A-helft plus spiegels, midden één keer). */
  crossings: Array<{ x: number; y: number; kind: 'ford' | 'bridge' }>;
}

/** Integer-wortel (naar beneden afgerond) zonder Math.sqrt: bitgewijze methode. */
export function isqrtFast(v: number): number {
  if (v <= 0) return 0;
  let res = 0;
  let bit = 1 << 30;
  while (bit > v) bit >>>= 2;
  let x = v;
  while (bit !== 0) {
    if (x >= res + bit) {
      x -= res + bit;
      res = (res >>> 1) + bit;
    } else res >>>= 1;
    bit >>>= 2;
  }
  return res;
}

function chaikin(
  pts: Array<[number, number, number]>,
  rounds: number,
): Array<[number, number, number]> {
  let cur = pts;
  for (let r = 0; r < rounds; r++) {
    const next: Array<[number, number, number]> = [cur[0] as [number, number, number]];
    for (let i = 0; i + 1 < cur.length; i++) {
      const a = cur[i] as [number, number, number];
      const b = cur[i + 1] as [number, number, number];
      next.push([
        (3 * a[0] + b[0] + 2) >> 2,
        (3 * a[1] + b[1] + 2) >> 2,
        (3 * a[2] + b[2] + 2) >> 2,
      ]);
      next.push([
        (a[0] + 3 * b[0] + 2) >> 2,
        (a[1] + 3 * b[1] + 2) >> 2,
        (a[2] + 3 * b[2] + 2) >> 2,
      ]);
    }
    next.push(cur[cur.length - 1] as [number, number, number]);
    cur = next;
  }
  return cur;
}

/** Verdicht een polyline tot punten hooguit 1/2 m uit elkaar (interpolatie met een macht van twee, geen deling). */
function densify(pts: Array<[number, number, number]>): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i] as [number, number, number];
    const b = pts[i + 1] as [number, number, number];
    const span = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
    let s = 0;
    while (span >> s > FP >> 1) s++;
    const steps = 1 << s;
    for (let k = 0; k < steps; k++)
      out.push([
        a[0] + (((b[0] - a[0]) * k) >> s),
        a[1] + (((b[1] - a[1]) * k) >> s),
        a[2] + (((b[2] - a[2]) * k) >> s),
      ]);
  }
  out.push(pts[pts.length - 1] as [number, number, number]);
  return out;
}

/**
 * Bouwt de rivier op een map van n x n en snijdt de bedding in `cm` (centimeters, wordt aangepast).
 * Geeft het watermasker en de hulpvelden terug. Exact puntsymmetrisch als `cm` dat is.
 */
export function carveRiver(cm: Int32Array, n: number, spec: RiverSpec): RiverResult {
  // Middellijn: A-helft, midden, gespiegelde A-helft achterstevoren. Middelpunt van de map in 1/16 m: n * 8.
  const c = n * (FP >> 1);
  const mirrorFp = (v: number): number => 2 * c - v;
  const a: Array<[number, number, number]> = spec.points.map((p) => [
    Math.round(p.x * FP),
    Math.round(p.y * FP),
    Math.round(p.r * FP),
  ]);
  const poly: Array<[number, number, number]> = [
    ...a,
    [c, c, Math.round(spec.centreR * FP)],
    ...a
      .slice()
      .reverse()
      .map((p): [number, number, number] => [mirrorFp(p[0]), mirrorFp(p[1]), p[2]]),
  ];
  const line = densify(chaikin(poly, spec.smoothRounds));
  const count = line.length;
  // Booglengte (1/16 m) per punt.
  const arc = new Int32Array(count);
  for (let i = 1; i < count; i++) {
    const p = line[i] as [number, number, number];
    const q = line[i - 1] as [number, number, number];
    arc[i] =
      (arc[i - 1] as number) +
      isqrtFast((p[0] - q[0]) * (p[0] - q[0]) + (p[1] - q[1]) * (p[1] - q[1]));
  }

  // Per cel: kleinste (afstand - straal) en de index van dat punt.
  const reach = spec.bankReachM * FP;
  const edgeDist = new Int32Array(n * n).fill(reach);
  const nearest = new Int32Array(n * n).fill(-1);
  let maxR = 0;
  for (const p of line) maxR = Math.max(maxR, p[2]);
  const box = ((maxR + reach) >> FP_SHIFT) + 2;
  for (let i = 0; i < count; i++) {
    const p = line[i] as [number, number, number];
    const px = p[0] >> FP_SHIFT;
    const py = p[1] >> FP_SHIFT;
    for (let y = Math.max(0, py - box); y <= Math.min(n - 1, py + box); y++) {
      const dy = y * FP + (FP >> 1) - p[1];
      for (let x = Math.max(0, px - box); x <= Math.min(n - 1, px + box); x++) {
        const dx = x * FP + (FP >> 1) - p[0];
        const d2 = dx * dx + dy * dy;
        const lim = p[2] + reach;
        if (d2 >= lim * lim) continue;
        const e = isqrtFast(d2) - p[2];
        const k = y * n + x;
        if (e < (edgeDist[k] as number)) {
          edgeDist[k] = e;
          nearest[k] = i;
        }
      }
    }
  }

  // Oversteken: booglengte-interval rond het punt van de middellijn dat het dichtst bij de opgegeven plek ligt.
  const spans: Array<{ lo: number; hi: number; kind: 'ford' | 'bridge'; at: number }> = [];
  const crossingCells: Array<{ x: number; y: number; kind: 'ford' | 'bridge' }> = [];
  const addSpan = (fx: number, fy: number, kind: 'ford' | 'bridge', half: number): void => {
    let best = 0;
    let bestD = Number.MAX_SAFE_INTEGER;
    for (let i = 0; i < count; i++) {
      const p = line[i] as [number, number, number];
      const d = (p[0] - fx) * (p[0] - fx) + (p[1] - fy) * (p[1] - fy);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    const at = arc[best] as number;
    spans.push({ lo: at - half, hi: at + half, kind, at: best });
    const p = line[best] as [number, number, number];
    crossingCells.push({ x: p[0] >> FP_SHIFT, y: p[1] >> FP_SHIFT, kind });
  };
  for (const cr of spec.crossings) {
    const fx = Math.round(cr.x * FP);
    const fy = Math.round(cr.y * FP);
    const half = Math.round(cr.halfLengthM * FP);
    addSpan(fx, fy, cr.kind, half);
    if (fx !== c || fy !== c) addSpan(mirrorFp(fx), mirrorFp(fy), cr.kind, half);
  }
  const spanOf = (i: number): 'ford' | 'bridge' | null => {
    const s = arc[i] as number;
    for (const sp of spans) if (s >= sp.lo && s <= sp.hi) return sp.kind;
    return null;
  };

  const mask = new Uint8Array(n * n);
  const bridge = new Uint8Array(n * n);
  const beachEnd = spec.beachLengthM * FP;
  for (let k = 0; k < n * n; k++) {
    const i = nearest[k] as number;
    if (i < 0) continue;
    const e = edgeDist[k] as number;
    const span = spanOf(i);
    if (span === 'bridge') {
      bridge[k] = 1;
      continue; // de landbrug houdt zijn terrein
    }
    if (e < 0) {
      if (span === 'ford') {
        mask[k] = WATER_SHALLOW;
        cm[k] = WATER_LEVEL_CM - spec.fordDepthCm;
      } else {
        mask[k] = WATER_DEEP;
        // Dieper naar het midden: bedEdge aan de rand, + 15 cm per meter, tot bedMax.
        const depth = Math.min(spec.bedMaxCm, spec.bedEdgeCm + ((-e * 15) >> FP_SHIFT));
        cm[k] = Math.min(cm[k] as number, WATER_LEVEL_CM - depth);
      }
    } else {
      // Oever: strand en daarna wand; het terrein wordt alleen verlaagd.
      const beach = Math.min(e, beachEnd);
      const wall = Math.max(0, e - beachEnd);
      const target =
        WATER_LEVEL_CM +
        spec.bankBaseCm +
        ((beach * spec.beachSlopeCmPerM) >> FP_SHIFT) +
        ((wall * spec.wallSlopeCmPerM) >> FP_SHIFT);
      if (target < (cm[k] as number)) cm[k] = target;
    }
  }
  // Exact puntsymmetrisch: de A-helft (eerder in rijvolgorde) over de B-helft.
  const last = n * n - 1;
  for (let k = 0; k < n * n; k++) {
    const m = last - k;
    if (m <= k) break;
    mask[m] = mask[k] as number;
    bridge[m] = bridge[k] as number;
    edgeDist[m] = edgeDist[k] as number;
    cm[m] = cm[k] as number;
  }
  return {
    mask,
    bridge,
    edgeDist,
    line: line.map((p) => ({ x: p[0], y: p[1] })),
    crossings: crossingCells,
  };
}
