import type { MapDef } from '@crawlout/data';
import { encodeGrid } from '../grid-format.js';
import { encodeProps, scatterProps, type PropsSpec } from '../props.js';
import { BLOCKED, OPEN } from './cells.js';
import {
  applyHeightCurve,
  parseHeightfield,
  passabilityFromSlope,
  symmetrize,
  type TerrainSpec,
} from './terrain.js';

export { BLOCKED, OPEN };
export type { TerrainSpec } from './terrain.js';

// Deterministische kaartgenerator, alleen integers. Puntsymmetrisch (180 graden): cel (x,y) spiegelt naar (w-1-x, h-1-y),
// zodat beide spelers een identieke positie hebben. Draait bij build-tijd, de sim leest alleen de uitvoerbestanden.

/** Leest bronbestanden van het hoogteveld (build-tijd; Node-implementatie in gen/node.ts). `ref` is relatief aan assets/dist. */
export interface GenIo {
  readSource(ref: string): string;
}

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
  /** Vlakke plateaus rond deze punten (straal in cellen), hoogte 0. Alleen zonder `terrain`. */
  flats?: Array<Feature & { radius: number }>;
  /**
   * Terrein uit een gescand hoogteveld (puntsymmetrisch gemaakt) in plaats van ruis. Dan zijn kliffen de steile
   * cellen van het terrein, en tellen `ruins` en `cliffs` er als extra onbegaanbare blokken bovenop (hoogte erbij).
   */
  terrain?: TerrainSpec;
  /**
   * Bouwvlakken (alleen A-helft, de B-helft wordt gespiegeld): maakt een cirkel vlak op de hoogte van het middelpunt,
   * met een rand van `blend` cellen waarover de hoogte gelijkmatig terugloopt naar het terrein. Alleen met `terrain`.
   */
  pads?: Array<Feature & { radius: number; blend: number }>;
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
  groundAmplitude?: number; // 0..255 ruis wordt hiermee geschaald (>> 8); alleen zonder `terrain`
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

/** Integer-wortel (afgerond naar beneden), zonder Math.sqrt. */
function isqrt(v: number): number {
  let k = 0;
  while ((k + 1) * (k + 1) <= v) k++;
  return k;
}

/** Maakt een cirkel (straal `radius`) vlak op de hoogte van het middelpunt, met een gladde rand van `blend` cellen (macht van twee). */
function applyPad(
  cm: Int32Array,
  n: number,
  cx: number,
  cy: number,
  radius: number,
  blend: number,
): void {
  if (![1, 2, 4, 8, 16].includes(blend)) throw new Error('pad: blend moet 1, 2, 4, 8 of 16 zijn');
  const shift = 31 - Math.clz32(blend);
  const centre = cm[cy * n + cx] as number;
  const original = Int32Array.from(cm);
  for (let y = Math.max(0, cy - radius - blend); y <= Math.min(n - 1, cy + radius + blend); y++) {
    for (let x = Math.max(0, cx - radius - blend); x <= Math.min(n - 1, cx + radius + blend); x++) {
      const d = isqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));
      if (d > radius + blend) continue;
      const k = Math.min(blend, radius + blend - d); // 0 aan de buitenrand, blend binnen de straal
      const t = (k << 8) >> shift; // 0..256
      const wt = (t * t * (768 - 2 * t)) >> 16;
      cm[y * n + x] = (wt * centre + (256 - wt) * (original[y * n + x] as number) + 128) >> 8;
    }
  }
}

export function generateMap(spec: MapSpec, io?: GenIo): GeneratedMap {
  const { w, h } = spec;
  const passable = new Uint8Array(w * h).fill(OPEN);
  const heights = new Int16Array(w * h);

  const terrainMode = spec.terrain !== undefined;
  if (spec.terrain !== undefined) {
    if (io === undefined)
      throw new Error(`gen ${spec.id}: terrein vraagt een GenIo (bronbestand lezen)`);
    if (w !== h) throw new Error(`gen ${spec.id}: terrein vraagt een vierkante map`);
    const field = parseHeightfield(io.readSource(spec.terrain.source));
    const cm = applyHeightCurve(symmetrize(field, spec.terrain, w), spec.terrain.heightCurve);
    for (const pad of spec.pads ?? []) {
      applyPad(cm, w, pad.x, pad.y, pad.radius, pad.blend);
      applyPad(cm, w, w - 1 - pad.x, h - 1 - pad.y, pad.radius, pad.blend);
    }
    passable.set(passabilityFromSlope(cm, w, spec.terrain));
    for (let i = 0; i < cm.length; i++) heights[i] = Math.round((cm[i] as number) * 2.56); // cm -> 1/256 m
  } else {
    // Basisreliëf, puntsymmetrisch gemaakt door te middelen met het gespiegelde punt.
    const amplitude = spec.groundAmplitude ?? 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const n = (noise(x, y, spec.seed) + noise(w - 1 - x, h - 1 - y, spec.seed)) >> 1;
        heights[y * w + x] = (n * amplitude) >> 8;
      }
    }
    const flatten = (cx: number, cy: number, radius: number): void => {
      for (let y = cy - radius; y <= cy + radius; y++) {
        for (let x = cx - radius; x <= cx + radius; x++) {
          if (x >= 0 && y >= 0 && x < w && y < h) heights[y * w + x] = 0;
        }
      }
    };
    for (const f of spec.flats ?? []) {
      flatten(f.x, f.y, f.radius);
      flatten(w - 1 - f.x, h - 1 - f.y, f.radius);
    }
  }

  // Zonder terrein zetten ruines en kliffen de hoogte vast; met terrein komt hun hoogte bovenop het terrein.
  // Overlappende rechthoeken (een L-vorm uit twee stukken) tellen hun hoogte maar één keer.
  const raised = new Uint8Array(w * h);
  const fill = (r: Rect, height: number): void => {
    for (let y = Math.max(0, r.y0); y <= Math.min(h - 1, r.y1); y++) {
      for (let x = Math.max(0, r.x0); x <= Math.min(w - 1, r.x1); x++) {
        const i = y * w + x;
        passable[i] = BLOCKED;
        if (!terrainMode) heights[i] = height;
        else if (raised[i] === 0) heights[i] = (heights[i] as number) + height;
        raised[i] = 1;
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
    // Met terrein blijft de natuurlijke hoogte aan de rand staan; alleen de begaanbaarheid sluit.
    const edge = terrainMode ? 0 : spec.cliffHeight;
    const closeEdge = (r: Rect): void => {
      for (let y = r.y0; y <= r.y1; y++)
        for (let x = r.x0; x <= r.x1; x++) {
          passable[y * w + x] = BLOCKED;
          if (!terrainMode) heights[y * w + x] = edge;
        }
    };
    closeEdge({ x0: 0, y0: 0, x1: w - 1, y1: b - 1 });
    closeEdge({ x0: 0, y0: h - b, x1: w - 1, y1: h - 1 });
    closeEdge({ x0: 0, y0: 0, x1: b - 1, y1: h - 1 });
    closeEdge({ x0: w - b, y0: 0, x1: w - 1, y1: h - 1 });
  }

  const mirror = (f: Feature): Feature => ({ x: w - 1 - f.x, y: h - 1 - f.y });
  const both = <T extends Feature>(list: T[]): T[] =>
    list.flatMap((f) => [f, { ...f, ...mirror(f) }]);

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
      if (passable[f.y * w + f.x] !== OPEN)
        throw new Error(`gen ${spec.id}: ${what} (${f.x},${f.y}) ligt op een onbegaanbare cel`);
    }
  }

  return {
    def,
    passabilityFile: encodeGrid(w, h, 'u8', passable),
    heightmapFile: encodeGrid(w, h, 'i16', heights),
    ...(spec.props === undefined
      ? {}
      : { propsFile: encodeProps(scatterProps(def, passable, spec.props)) }),
    passable,
    heights,
  };
}
