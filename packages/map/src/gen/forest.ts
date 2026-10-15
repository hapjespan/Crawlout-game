// Bos (build-tijd, alleen integers): een dichte, onbegaanbare bosrand rond de hele map met een onregelmatige
// binnenrand, en losse bosjes met een onbegaanbare kern. Puntsymmetrisch: de diepte van de rand onder en rechts is
// de gespiegelde diepte van boven en links, en de bosjes staan in de spec alleen voor de A-helft.

export interface GroveSpec {
  x: number;
  y: number;
  /** Straal van de onbegaanbare kern in meters (de rand van losse bomen komt er bij de props bovenop). */
  radius: number;
}

export interface ForestSpec {
  seed: number;
  /** Diepte van de bosrand in meters: minDepth + 0..(maxDepth - minDepth) uit gladde ruis langs de rand. */
  minDepthM: number;
  maxDepthM: number;
  /** Bosjes in de A-helft (de B-helft wordt gespiegeld). */
  groves: GroveSpec[];
}

export interface ForestResult {
  /** 1 = bosrand, 2 = kern van een bosje, 0 = geen bos. */
  forest: Uint8Array;
}

export const FOREST_NONE = 0;
export const FOREST_BORDER = 1;
export const FOREST_GROVE = 2;

function hash1(v: number, seed: number): number {
  let h = Math.imul(v, 0x27d4eb2d) ^ Math.imul(seed, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) & 255;
}

function hash2(x: number, y: number, seed: number): number {
  return hash1(Math.imul(x, 0x165667b1) ^ y, seed);
}

/** Gladde stap 0..256 (smoothstep), integer. */
function smooth256(t: number): number {
  return (t * t * (768 - 2 * t)) >> 16;
}

/** Gladde 1D-ruis 0..255: waarden elke 2^shift meter, glad geïnterpoleerd. */
export function noise1(v: number, seed: number, shift: number): number {
  const g = v >> shift;
  const f = smooth256(((v - (g << shift)) << 8) >> shift);
  const a = hash1(g, seed);
  const b = hash1(g + 1, seed);
  return (a * (256 - f) + b * f) >> 8;
}

/** Gladde 2D-ruis 0..255 op een raster van 2^shift meter. */
export function noise2(x: number, y: number, seed: number, shift: number): number {
  const gx = x >> shift;
  const gy = y >> shift;
  const fx = smooth256(((x - (gx << shift)) << 8) >> shift);
  const fy = smooth256(((y - (gy << shift)) << 8) >> shift);
  const a = hash2(gx, gy, seed);
  const b = hash2(gx + 1, gy, seed);
  const c = hash2(gx, gy + 1, seed);
  const d = hash2(gx + 1, gy + 1, seed);
  const top = (a * (256 - fx) + b * fx) >> 8;
  const bottom = (c * (256 - fx) + d * fx) >> 8;
  return (top * (256 - fy) + bottom * fy) >> 8;
}

/** Diepte van de bosrand (meters) op positie v langs een zijde (0 = boven, 1 = links). */
function borderDepth(spec: ForestSpec, side: number, v: number): number {
  // Twee octaven: lange golven (32 m) en kleinere uitstulpingen (8 m).
  const coarse = noise1(v, spec.seed + side * 101, 5);
  const fine = noise1(v, spec.seed + side * 101 + 7, 3);
  const mix = (coarse * 3 + fine) >> 2; // 0..255
  return spec.minDepthM + ((mix * (spec.maxDepthM - spec.minDepthM + 1)) >> 8);
}

export function buildForest(w: number, h: number, spec: ForestSpec): ForestResult {
  if (w !== h) throw new Error('bos: alleen vierkante maps');
  const n = w;
  const forest = new Uint8Array(n * n);
  // Diepte per positie langs boven (0) en links (1); onder en rechts zijn de spiegels.
  const top = new Int32Array(n);
  const left = new Int32Array(n);
  for (let v = 0; v < n; v++) {
    top[v] = borderDepth(spec, 0, v);
    left[v] = borderDepth(spec, 1, v);
  }
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const inBorder =
        y < (top[x] as number) ||
        n - 1 - y < (top[n - 1 - x] as number) ||
        x < (left[y] as number) ||
        n - 1 - x < (left[n - 1 - y] as number);
      if (inBorder) forest[y * n + x] = FOREST_BORDER;
    }
  }
  // Bosjes: een kern met een golvende rand (straal * (0,75 .. 1,25) uit 2D-ruis).
  for (const g of spec.groves) {
    for (const [cx, cy] of [
      [g.x, g.y],
      [n - 1 - g.x, n - 1 - g.y],
    ] as const) {
      const reach = g.radius + (g.radius >> 1) + 1;
      for (let y = Math.max(0, cy - reach); y <= Math.min(n - 1, cy + reach); y++) {
        for (let x = Math.max(0, cx - reach); x <= Math.min(n - 1, cx + reach); x++) {
          // Ruis op de A-coördinaat, zodat de gespiegelde kern exact de spiegel is.
          const ax = cx === g.x ? x : n - 1 - x;
          const ay = cx === g.x ? y : n - 1 - y;
          const wobble = 192 + (noise2(ax, ay, spec.seed + 31, 2) >> 1); // 192..319 (/256)
          const r = g.radius * wobble; // straal * 256
          const d2 = ((x - cx) * (x - cx) + (y - cy) * (y - cy)) << 16;
          if (d2 <= r * r && forest[y * n + x] === FOREST_NONE) forest[y * n + x] = FOREST_GROVE;
        }
      }
    }
  }
  return { forest };
}
