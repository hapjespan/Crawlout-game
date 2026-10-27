import { BLOCKED, OPEN } from './cells.js';

// Terrein uit een gescand hoogteveld (assets/dist/terrain/*.height.json, formaat crawlout-heightfield/1).
// Alleen integers in de eigenlijke bewerking (centimeters): geen deling, geen Math.sqrt, geen Float-arrays.
// Pijplijn (alles puntsymmetrisch gemaakt, zodat beide spelers dezelfde grond hebben):
//   1. inlezen en afronden naar centimeters, lichte binomiale uitvlakking (ruis van de fotogrammetrie);
//   2. de oriëntatie (draaiing/spiegeling van de bron) zet het gewenste stuk van het veld in de gekozen helft;
//   3. de helft wordt 180 graden gedraaid over de andere helft gelegd, met een gemengde naad (gladde stap over
//      `seam.halfWidth` cellen aan weerszijden van de scheidingslijn);
//   4. de hoogtecurve schaalt het bronreliëf naar spelmaat (stuksgewijs lineair, zie TerrainSpec.heightCurve);
//   5. begaanbaarheid: cellen met een helling boven de drempel zijn klif, daarna opschonen.

export type SeamKind = 'horizontal' | 'vertical' | 'diagonal' | 'antidiagonal';

export interface HeightCurveStep {
  /** Vanaf deze bronhoogte (meter, in het ruwe veld) geldt `gain`, tot de volgende stap. Eerste stap begint bij 0. */
  fromM: number;
  /** Verticale schaal vanaf `fromM`: 0,4 betekent 10 m bron wordt 4 m in het spel. */
  gain: number;
}

export interface TerrainSpec {
  /** Pad van het hoogteveld, relatief aan assets/dist (bijvoorbeeld 'terrain/rock_terrain_4.height.json'). */
  source: string;
  /** Oriëntatie van de bron (0..7): 0 = ongewijzigd, 1 = spiegel x, 2 = spiegel y, 3 = 180 graden, 4 = transponeren,
   *  5 = 90 graden, 6 = 270 graden, 7 = anti-transponeren. Zie `sourceCell`. */
  orientation: number;
  /** Scheidingslijn door het midden. De helft aan de kleine kant (noord, west, linksboven) blijft, de andere is de kopie. */
  seam: { kind: SeamKind; halfWidthCells: 1 | 2 | 4 | 8 | 16 | 32 };
  /** Aantal uitvlakpasses (binomiaal 1-2-1 in x en y) op het bronveld. */
  smoothPasses: number;
  /** Stuksgewijze verticale schaal; de factor per hoogtebereik staat hier met toelichting in de spec. */
  heightCurve: HeightCurveStep[];
  /**
   * Een cel is klif (onbegaanbaar) als het hoogteverschil met een buur (na schalen) groter is dan deze helling,
   * in promille (625 = tan 32 graden). Diagonale buren tellen over 1,41 m.
   */
  maxSlopePermille: number;
  /** Klifcomponenten (8-verbonden) kleiner dan dit aantal cellen vervallen (ruis). */
  minCliffCells: number;
  /** Begaanbare zakken (4-verbonden) kleiner dan dit aantal cellen worden dichtgezet. */
  minPocketCells: number;
  /**
   * Optioneel: een grote map uit k x k tegels van dit bronveld (zie `composeTiles`); de middentegel is dan het
   * puntsymmetrische veld hierboven (orientation en seam), de buitentegels hebben elk een eigen oriëntatie.
   */
  tiles?: TileSpec;
  /** Optioneel: hoogte (cm) die na de hoogtecurve overal bij komt, zodat een rivier op hoogte 0 eronder ligt. */
  baseOffsetCm?: number;
}

export interface Heightfield {
  w: number;
  h: number;
  /** Centimeters, index j * w + i. */
  cm: Int32Array;
}

/** Leest crawlout-heightfield/1 (zie @crawlout/asset-cli/heightfield) en rondt af naar centimeters. */
export function parseHeightfield(text: string): Heightfield {
  const f = JSON.parse(text) as {
    format?: string;
    w?: number;
    h?: number;
    metersPerCell?: number;
    heights?: number[];
  } | null;
  if (!f || f.format !== 'crawlout-heightfield/1')
    throw new Error('hoogteveld: onbekend formaat (verwacht crawlout-heightfield/1)');
  if (f.metersPerCell !== 1)
    throw new Error('hoogteveld: alleen metersPerCell 1 wordt ondersteund');
  const { w, h, heights } = f;
  if (!Number.isInteger(w) || !Number.isInteger(h) || !Array.isArray(heights))
    throw new Error('hoogteveld: w, h of heights ontbreekt');
  if (heights.length !== (w as number) * (h as number))
    throw new Error('hoogteveld: aantal waarden komt niet overeen met w*h');
  const cm = new Int32Array(heights.length);
  for (let i = 0; i < heights.length; i++) cm[i] = Math.round((heights[i] as number) * 100);
  return { w: w as number, h: h as number, cm };
}

/** Bronpositie bij doelcel (i, j) voor oriëntatie `o` in een veld van n bij n. */
export function sourceCell(o: number, i: number, j: number, n: number): [number, number] {
  const m = n - 1;
  switch (o) {
    case 0:
      return [i, j];
    case 1:
      return [m - i, j];
    case 2:
      return [i, m - j];
    case 3:
      return [m - i, m - j];
    case 4:
      return [j, i];
    case 5:
      return [m - j, i];
    case 6:
      return [j, m - i];
    case 7:
      return [m - j, m - i];
    default:
      throw new Error(`terrein: oriëntatie ${o} bestaat niet (0..7)`);
  }
}

function smooth(src: Int32Array, w: number, h: number): Int32Array {
  const tmp = new Int32Array(w * h);
  const out = new Int32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = src[y * w + Math.max(0, x - 1)] as number;
      const b = src[y * w + x] as number;
      const c = src[y * w + Math.min(w - 1, x + 1)] as number;
      tmp[y * w + x] = (a + 2 * b + c + 2) >> 2;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = tmp[Math.max(0, y - 1) * w + x] as number;
      const b = tmp[y * w + x] as number;
      const c = tmp[Math.min(h - 1, y + 1) * w + x] as number;
      out[y * w + x] = (a + 2 * b + c + 2) >> 2;
    }
  }
  return out;
}

/** Gladde stap 0..256 over t 0..256 (smoothstep), integer. */
function smoothstep256(t: number): number {
  // Puntsymmetrisch exact: s(256 - t) == 256 - s(t), ook na afronden.
  if (t > 128) return 256 - smoothstep256(256 - t);
  return (t * t * (768 - 2 * t)) >> 16;
}

/**
 * Zet het bronveld om naar een puntsymmetrisch hoogteveld in centimeters (nog niet geschaald).
 * Symmetrie is exact: h(x, y) == h(w-1-x, h-1-y).
 */
export function symmetrize(field: Heightfield, spec: TerrainSpec, n: number): Int32Array {
  if (field.w !== n || field.h !== n)
    throw new Error(`terrein: bronveld ${field.w}x${field.h} past niet op map ${n}x${n}`);
  let base: Int32Array = field.cm;
  for (let p = 0; p < spec.smoothPasses; p++) base = smooth(base, n, n);
  const oriented = new Int32Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const [si, sj] = sourceCell(spec.orientation, i, j, n);
      oriented[j * n + i] = base[sj * n + si] as number;
    }
  }
  const shift = 31 - Math.clz32(spec.seam.halfWidthCells);
  if (shift > 5) throw new Error('terrein: seam.halfWidthCells hoogstens 32');
  const out = new Int32Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      // d2: tweemaal de afstand tot de naad in cellen (altijd oneven, dus nooit exact op de naad), positief aan de kant die blijft.
      let d2: number;
      switch (spec.seam.kind) {
        case 'horizontal':
          d2 = n - 1 - 2 * j;
          break;
        case 'vertical':
          d2 = n - 1 - 2 * i;
          break;
        case 'diagonal':
          d2 = n - 1 - i - j;
          break;
        default:
          d2 = i - j;
          break;
      }
      // t = 256 * (d2 + 2W) / (4W) met W = 2^shift: exact (geen rest), en t(-d2) = 256 - t(d2) voor symmetrie.
      const t = Math.min(256, Math.max(0, ((d2 + (2 << shift)) << 8) >> (shift + 2)));
      const wt = smoothstep256(t);
      const a = oriented[j * n + i] as number;
      const b = oriented[(n - 1 - j) * n + (n - 1 - i)] as number;
      out[j * n + i] = (wt * a + (256 - wt) * b + 128) >> 8;
    }
  }
  return out;
}

/** Past de hoogtecurve toe op centimeters. Geeft centimeters in spelmaat. */
export function applyHeightCurve(cm: Int32Array, curve: HeightCurveStep[]): Int32Array {
  if (curve.length === 0 || curve[0]?.fromM !== 0)
    throw new Error('terrein: heightCurve begint bij fromM 0');
  const out = new Int32Array(cm.length);
  // Opgebouwde hoogte aan het begin van elke stap, in honderdsten van een centimeter-gain-eenheid (float is hier
  // veilig: alleen vermenigvuldigen en optellen, deterministisch in IEEE 754, en het resultaat wordt afgerond).
  const startSrc = curve.map((s) => Math.round(s.fromM * 100));
  const startDst: number[] = [0];
  for (let k = 1; k < curve.length; k++) {
    const prev = curve[k - 1] as HeightCurveStep;
    startDst.push(
      (startDst[k - 1] as number) +
        ((startSrc[k] as number) - (startSrc[k - 1] as number)) * prev.gain,
    );
  }
  for (let i = 0; i < cm.length; i++) {
    const v = cm[i] as number;
    let k = curve.length - 1;
    while (k > 0 && v < (startSrc[k] as number)) k--;
    const step = curve[k] as HeightCurveStep;
    out[i] = Math.round((startDst[k] as number) + (v - (startSrc[k] as number)) * step.gain);
  }
  return out;
}

const NB8: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
];

/** Grootste hoogteverschil (cm) met een buur, orthogonaal in cm/cel, diagonaal omgerekend naar een orthogonale maat. */
function steepExceeds(cm: Int32Array, n: number, x: number, y: number, permille: number): boolean {
  const here = cm[y * n + x] as number;
  for (const [dx, dy] of NB8) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
    const dh = Math.abs((cm[ny * n + nx] as number) - here);
    // dh cm over 100 cm (orthogonaal) of 141 cm (diagonaal): dh * 1000 > permille * afstand
    if (dh * 1000 > permille * (dx !== 0 && dy !== 0 ? 141 : 100)) return true;
  }
  return false;
}

/**
 * Begaanbaarheid uit de helling. 1 = open, 0 = klif. Opschonen: kleine klifspikkels weg, kleine begaanbare zakken
 * dicht, en diagonale lekken (twee diagonale klifcellen met twee open cellen) gesloten door beide open cellen te blokkeren.
 */
export function passabilityFromSlope(
  cm: Int32Array,
  n: number,
  spec: Pick<TerrainSpec, 'maxSlopePermille' | 'minCliffCells' | 'minPocketCells'>,
): Uint8Array {
  const pass = new Uint8Array(n * n).fill(OPEN);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++)
      if (steepExceeds(cm, n, x, y, spec.maxSlopePermille)) pass[y * n + x] = BLOCKED;
  dropSmallComponents(pass, n, BLOCKED, 8, spec.minCliffCells);
  dropSmallComponents(pass, n, OPEN, 4, spec.minPocketCells);
  closeDiagonalLeaks(pass, n);
  return pass;
}

/** Zet componenten van `value` met minder dan `minCells` cellen om. */
export function dropSmallComponents(
  grid: Uint8Array,
  n: number,
  value: number,
  connectivity: 4 | 8,
  minCells: number,
): void {
  const seen = new Uint8Array(n * n);
  const qx = new Int32Array(n * n);
  const qy = new Int32Array(n * n);
  const dirs = connectivity === 8 ? NB8 : NB8.slice(0, 4);
  for (let sy = 0; sy < n; sy++) {
    for (let sx = 0; sx < n; sx++) {
      if (grid[sy * n + sx] !== value || seen[sy * n + sx] === 1) continue;
      let head = 0;
      let tail = 0;
      qx[tail] = sx;
      qy[tail++] = sy;
      seen[sy * n + sx] = 1;
      while (head < tail) {
        const x = qx[head] as number;
        const y = qy[head++] as number;
        for (const [dx, dy] of dirs) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
          if (grid[ny * n + nx] !== value || seen[ny * n + nx] === 1) continue;
          seen[ny * n + nx] = 1;
          qx[tail] = nx;
          qy[tail++] = ny;
        }
      }
      if (tail < minCells)
        for (let k = 0; k < tail; k++)
          grid[(qy[k] as number) * n + (qx[k] as number)] = value === OPEN ? BLOCKED : OPEN;
    }
  }
}

/** Sluit diagonale lekken: twee diagonale geblokkeerde cellen met twee open cellen ertussen: blokkeer die twee. */
export function closeDiagonalLeaks(pass: Uint8Array, n: number): void {
  const toBlock: number[] = [];
  for (let y = 0; y + 1 < n; y++) {
    for (let x = 0; x + 1 < n; x++) {
      const a = pass[y * n + x] as number;
      const b = pass[y * n + x + 1] as number;
      const c = pass[(y + 1) * n + x] as number;
      const d = pass[(y + 1) * n + x + 1] as number;
      if (a === BLOCKED && d === BLOCKED && b === OPEN && c === OPEN)
        toBlock.push(y * n + x + 1, (y + 1) * n + x);
      else if (b === BLOCKED && c === BLOCKED && a === OPEN && d === OPEN)
        toBlock.push(y * n + x, (y + 1) * n + x + 1);
    }
  }
  for (const i of toBlock) pass[i] = BLOCKED;
}

// ---------------------------------------------------------------------------------------------------------------------
// Tegels: een grote map uit k x k tegels van hetzelfde bronveld (k oneven). De middentegel is het puntsymmetrische
// veld van `symmetrize`; de buitentegels zijn het (uitgevlakte) bronveld in een eigen oriëntatie. Alleen de A-helft
// van de buitentegels staat in de spec, de tegel tegenover het midden krijgt dezelfde oriëntatie 180 graden gedraaid
// (oriëntatie o ^ 3), dus de hele map blijft exact puntsymmetrisch. Over de tegelgrenzen wordt gemengd: elke tegel
// loopt `blendHalfWidthCells` cellen door over de grens (gespiegelde voortzetting van zijn eigen veld) en de gewichten
// in x en y lopen met dezelfde gladde stap als de naad van `symmetrize`.

export interface TileSpec {
  /** Aantal tegels per zijde (oneven); de map is k * n cellen breed, n = de maat van het bronveld. */
  k: 3 | 5;
  /** Oriëntatie (0..7, zie `sourceCell`) per buitentegel in de A-helft (tegel eerder in rijvolgorde dan zijn spiegel). */
  outer: Array<{ tx: number; ty: number; orientation: number }>;
  /** Halve breedte van de overgang tussen tegels, in cellen (totaal dus het dubbele). */
  blendHalfWidthCells: 1 | 2 | 4 | 8 | 16;
}

/** Oriëntatie na een extra draaiing van 180 graden (zie `sourceCell`). */
export function rotate180(o: number): number {
  return o ^ 3;
}

/**
 * Stelt het tegelveld samen (centimeters, nog niet geschaald). `field` is het ruwe bronveld (n x n), `centre` het
 * puntsymmetrische middenveld (n x n, al uitgevlakt). Exact puntsymmetrisch: h(x, y) == h(N-1-x, N-1-y).
 */
export function composeTiles(
  field: Heightfield,
  spec: Pick<TerrainSpec, 'smoothPasses'>,
  tiles: TileSpec,
  centre: Int32Array,
): { size: number; cm: Int32Array } {
  const n = field.w;
  if (field.h !== n) throw new Error('tegels: bronveld moet vierkant zijn');
  const k = tiles.k;
  const mid = k >> 1;
  const size = k * n;
  let base: Int32Array = field.cm;
  for (let p = 0; p < spec.smoothPasses; p++) base = smooth(base, n, n);
  // Oriëntatie per tegel; -1 = middentegel.
  const orient = new Int8Array(k * k).fill(-2);
  orient[mid * k + mid] = -1;
  for (const t of tiles.outer) {
    if (t.tx < 0 || t.ty < 0 || t.tx >= k || t.ty >= k)
      throw new Error(`tegels: tegel (${t.tx},${t.ty}) ligt buiten ${k}x${k}`);
    const a = t.ty * k + t.tx;
    const b = (k - 1 - t.ty) * k + (k - 1 - t.tx);
    if (a >= b) throw new Error(`tegels: tegel (${t.tx},${t.ty}) ligt niet in de A-helft`);
    sourceCell(t.orientation, 0, 0, n); // gooit bij een ongeldige oriëntatie
    orient[a] = t.orientation;
    orient[b] = rotate180(t.orientation);
  }
  for (let i = 0; i < k * k; i++)
    if ((orient[i] as number) === -2)
      throw new Error('tegels: niet elke buitentegel heeft een oriëntatie');

  const shift = 31 - Math.clz32(tiles.blendHalfWidthCells);
  // Gewichten per as: voor coördinaat v de tegel links/boven (t0) en het gewicht (0..256) van de tegel erna.
  const tileOf = new Int32Array(size);
  const nextWt = new Int32Array(size); // gewicht van tegel t0 + 1
  const prevWt = new Int32Array(size); // gewicht van tegel t0 - 1
  for (let v = 0, t = 0; v < size; v++) {
    if (v >= (t + 1) * n) t++;
    tileOf[v] = t;
    const local = v - t * n;
    // Naad rechts (tussen t en t + 1) of links (tussen t - 1 en t); d2 is tweemaal de afstand tot de naad (oneven).
    if (t + 1 < k && local >= n - (1 << shift)) {
      const d2 = 2 * (local - n) + 1; // negatief: links van de naad
      const tt = Math.min(256, Math.max(0, ((d2 + (2 << shift)) << 8) >> (shift + 2)));
      nextWt[v] = smoothstep256(tt);
    } else if (t > 0 && local < 1 << shift) {
      const d2 = 2 * local + 1; // positief: rechts van de naad
      const tt = Math.min(256, Math.max(0, ((d2 + (2 << shift)) << 8) >> (shift + 2)));
      prevWt[v] = 256 - smoothstep256(tt);
    }
  }
  const ext = (v: number): number => (v < 0 ? -1 - v : v >= n ? 2 * n - 1 - v : v);
  const tileValue = (tx: number, ty: number, i: number, j: number): number => {
    const o = orient[ty * k + tx] as number;
    const ei = ext(i);
    const ej = ext(j);
    if (o === -1) return centre[ej * n + ei] as number;
    const [si, sj] = sourceCell(o, ei, ej, n);
    return base[sj * n + si] as number;
  };
  const out = new Int32Array(size * size);
  const wx: number[] = [0, 0, 0];
  const wy: number[] = [0, 0, 0];
  for (let y = 0; y < size; y++) {
    const ty = tileOf[y] as number;
    wy[0] = prevWt[y] as number;
    wy[2] = nextWt[y] as number;
    wy[1] = 256 - (wy[0] as number) - (wy[2] as number);
    for (let x = 0; x < size; x++) {
      const tx = tileOf[x] as number;
      wx[0] = prevWt[x] as number;
      wx[2] = nextWt[x] as number;
      wx[1] = 256 - (wx[0] as number) - (wx[2] as number);
      let sum = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const gy = wy[dy + 1] as number;
        if (gy === 0) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const gx = wx[dx + 1] as number;
          if (gx === 0) continue;
          const t2x = tx + dx;
          const t2y = ty + dy;
          sum += gx * gy * tileValue(t2x, t2y, x - t2x * n, y - t2y * n);
        }
      }
      out[y * size + x] = (sum + 32768) >> 16;
    }
  }
  return { size, cm: out };
}
