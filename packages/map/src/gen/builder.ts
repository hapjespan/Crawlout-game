import type { MapDef } from '@crawlout/data';
import { encodeGrid } from '../grid-format.js';
import { encodeProps, scatterProps, type PropsSpec } from '../props.js';

// Deterministische kaartgenerator, alleen integers. Puntsymmetrisch (180 graden): cel (x,y) spiegelt naar (w-1-x, h-1-y),
// zodat beide spelers een identieke positie hebben. Draait bij build-tijd, de sim leest alleen de uitvoerbestanden.

export const OPEN = 1;
export const BLOCKED = 0;

export interface Rect {
  x0: number;
  y0: number;
  x1: number; // inclusief
  y1: number; // inclusief
}
export interface Feature {
  x: number;
  y: number;
}

export interface MapSpec {
  id: string;
  w: number;
  h: number;
  seed: number;
  comment: string;
  dominance: Dominance;
  /** Randstrook onbegaanbaar (kliffen), in cellen. */
  border: number;
  /** Ruines (laag, onbegaanbaar), alleen de helft die gespiegeld wordt. */
  ruins: Rect[];
  /** Kliffen (hoog, onbegaanbaar). */
  cliffs: Rect[];
  /** Vlakke plateaus rond deze punten (straal in cellen), hoogte 0. */
  flats: Array<Feature & { radius: number }>;
  /** Alle lijsten hieronder bevatten alleen de A-helft; de B-helft wordt gespiegeld. Zelfspiegelend: selfMirrored. */
  scrapNodes: Array<Feature & { amount: number }>;
  claimPoints: Array<Feature & { kind: 'scrap' | 'settlement' | 'powerArmor' }>;
  creepCamps: Array<Feature & { tier: number }>;
  spawns: Feature[];
  /** Claimpunten in het midden (zonder spiegelpartner). */
  centerClaims: Array<Feature & { kind: 'scrap' | 'settlement' | 'powerArmor' }>;
  /** Hoogtes in sim-eenheden (1 m = 256). */
  ruinHeight: number;
  cliffHeight: number;
  groundAmplitude: number; // 0..255 ruis wordt hiermee geschaald (>> 8)
  /** Optioneel: decoratieve props (data/maps/<id>.props.json, MapDef.props). */
  props?: PropsSpec;
}

/** Dominantie per map (menselijke eenheden; de data-loader rekent om naar ticks). */
export interface Dominance {
  pointsRequired: number;
  minutes: number;
}

export interface GeneratedMap {
  def: MapDef;
  passabilityFile: string;
  heightmapFile: string;
  /** Alleen als de spec props heeft. */
  propsFile?: string;
  passable: Uint8Array;
  heights: Int16Array;
}

function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(seed, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) & 255;
}

/** Waarderuis 0..255 op een raster van 16 cellen, bilineair met gehele gewichten (geen floats). */
function noise(x: number, y: number, seed: number): number {
  const gx = x >> 4;
  const gy = y >> 4;
  const fx = x & 15;
  const fy = y & 15;
  const a = hash2(gx, gy, seed);
  const b = hash2(gx + 1, gy, seed);
  const c = hash2(gx, gy + 1, seed);
  const d = hash2(gx + 1, gy + 1, seed);
  const top = (a * (16 - fx) + b * fx) >> 4;
  const bottom = (c * (16 - fx) + d * fx) >> 4;
  return (top * (16 - fy) + bottom * fy) >> 4;
}

function mirrorRect(r: Rect, w: number, h: number): Rect {
  return { x0: w - 1 - r.x1, y0: h - 1 - r.y1, x1: w - 1 - r.x0, y1: h - 1 - r.y0 };
}

export function generateMap(spec: MapSpec): GeneratedMap {
  const { w, h } = spec;
  const passable = new Uint8Array(w * h).fill(OPEN);
  const heights = new Int16Array(w * h);

  // Basisreliëf, puntsymmetrisch gemaakt door te middelen met het gespiegelde punt.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const n = (noise(x, y, spec.seed) + noise(w - 1 - x, h - 1 - y, spec.seed)) >> 1;
      heights[y * w + x] = (n * spec.groundAmplitude) >> 8;
    }
  }
  const flatten = (cx: number, cy: number, radius: number): void => {
    for (let y = cy - radius; y <= cy + radius; y++) {
      for (let x = cx - radius; x <= cx + radius; x++) {
        if (x >= 0 && y >= 0 && x < w && y < h) heights[y * w + x] = 0;
      }
    }
  };
  for (const f of spec.flats) {
    flatten(f.x, f.y, f.radius);
    flatten(w - 1 - f.x, h - 1 - f.y, f.radius);
  }

  const fill = (r: Rect, height: number): void => {
    for (let y = Math.max(0, r.y0); y <= Math.min(h - 1, r.y1); y++) {
      for (let x = Math.max(0, r.x0); x <= Math.min(w - 1, r.x1); x++) {
        passable[y * w + x] = BLOCKED;
        heights[y * w + x] = height;
      }
    }
  };
  for (const r of spec.ruins) {
    fill(r, spec.ruinHeight);
    fill(mirrorRect(r, w, h), spec.ruinHeight);
  }
  for (const r of spec.cliffs) {
    fill(r, spec.cliffHeight);
    fill(mirrorRect(r, w, h), spec.cliffHeight);
  }
  const b = spec.border;
  if (b > 0) {
    fill({ x0: 0, y0: 0, x1: w - 1, y1: b - 1 }, spec.cliffHeight);
    fill({ x0: 0, y0: h - b, x1: w - 1, y1: h - 1 }, spec.cliffHeight);
    fill({ x0: 0, y0: 0, x1: b - 1, y1: h - 1 }, spec.cliffHeight);
    fill({ x0: w - b, y0: 0, x1: w - 1, y1: h - 1 }, spec.cliffHeight);
  }

  const mirror = (f: Feature): Feature => ({ x: w - 1 - f.x, y: h - 1 - f.y });
  const both = <T extends Feature>(list: T[]): T[] => list.flatMap((f) => [f, { ...f, ...mirror(f) }]);

  const def: MapDef = {
    id: spec.id,
    size: { w, h },
    heightmap: `maps/${spec.id}.heightmap.json`,
    passability: `maps/${spec.id}.passability.json`,
    ...(spec.props === undefined ? {} : { props: `maps/${spec.id}.props.json` }),
    scrapNodes: both(spec.scrapNodes),
    claimPoints: [...both(spec.claimPoints), ...spec.centerClaims],
    spawns: both(spec.spawns),
    creepCamps: both(spec.creepCamps),
    dominance: spec.dominance,
    _comment: spec.comment,
  };

  for (const [what, list] of [
    ['scrapNode', def.scrapNodes],
    ['claimPoint', def.claimPoints],
    ['spawn', def.spawns],
    ['creepCamp', def.creepCamps],
  ] as const) {
    for (const f of list) {
      if (passable[f.y * w + f.x] !== OPEN) throw new Error(`gen ${spec.id}: ${what} (${f.x},${f.y}) ligt op een onbegaanbare cel`);
    }
  }

  return {
    def,
    passabilityFile: encodeGrid(w, h, 'u8', passable),
    heightmapFile: encodeGrid(w, h, 'i16', heights),
    ...(spec.props === undefined ? {} : { propsFile: encodeProps(scatterProps(def, passable, spec.props)) }),
    passable,
    heights,
  };
}
