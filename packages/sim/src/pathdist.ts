import type { SimMap } from './config.js';
import { idiv } from './math/int.js';

// Padafstanden over het terrein voor de keuzes van de scripted AI (xl-int): welke node, welk claimpunt, welk doel en
// welke bouwplek, op een map waar een rivier of bosrand de hemelsbrede afstand misleidend maakt.
//
// Per bron (een rechthoek van cellen: het hoofdgebouw, een depot, de spawn van de vijand) één BFS met 4-buren over de
// begaanbaarheid van de map, dezelfde metriek als de flow fields. Gebouwen tellen niet mee: het terrein verandert
// nooit, dus een veld wordt één keer per bron gerekend (ongeveer 1 ms op 384 bij 384) en blijft geldig. Afgeleid, geen
// state: een veld is een pure functie van (map, bron), dus hoe vol de cache is, verandert geen enkele uitkomst
// (serialize/deserialize, een andere volgorde van vragen). De cache heeft een vaste bovengrens en verdringt de oudste.
//
// Waarom geen padgraaf (flowfield.ts): die rekent met gebouwen en zijn zoekopdrachten horen bij slots, en slots zijn
// state (ze zitten in de hash). Een AI-vraag mag de state niet veranderen. Voor een rangorde van verre doelen is het
// terrein genoeg; de beweging zelf blijft op de flow fields lopen.

/** Onbereikbaar vanaf de bron (of verder dan 65534 cellen). */
export const TERRAIN_UNREACHABLE = 0xffff;
/** Geometrie: zoveel velden houdt de cache (elk w * h * 2 bytes; 295 kB op 384 bij 384). */
const CACHE_FIELDS = 16;

/** No component: an unwalkable cell. */
export const NO_COMPONENT = -1;

export class TerrainDistances {
  private readonly keys: number[] = [];
  private readonly fields: Uint16Array[] = [];
  private readonly queue: Int32Array;
  private labels: Int32Array | null = null;

  constructor(private readonly map: SimMap) {
    this.queue = new Int32Array(map.w * map.h);
  }

  /**
   * The connected walkable piece of terrain (4-neighbours over map.passable, as the flow fields walk) that cell c
   * belongs to, NO_COMPONENT for an unwalkable cell; labels number the pieces in scan order. Computed once (the terrain
   * never changes). Buildings do not count: the placement rule (systems/placement.ts) keeps a free walkable ring around
   * every building placed in a match, so a building never splits a piece, and two cells in one piece stay connected
   * whatever stands on the map.
   */
  component(c: number): number {
    if (this.labels === null) this.labels = this.computeLabels();
    return this.labels[c]!;
  }

  private computeLabels(): Int32Array {
    const map = this.map;
    const W = map.w;
    const H = map.h;
    const pass = map.passable;
    const label = new Int32Array(W * H).fill(NO_COMPONENT);
    const q = this.queue;
    let next = 0;
    for (let s = 0; s < W * H; s++) {
      if (pass[s] !== 1 || label[s] !== NO_COMPONENT) continue;
      const id = next++;
      label[s] = id;
      let qt = 0;
      let qh = 0;
      q[qt++] = s;
      while (qh < qt) {
        const c = q[qh++]!;
        const cy = idiv(c, W);
        const cx = c - cy * W;
        if (cx + 1 < W && pass[c + 1] === 1 && label[c + 1] === NO_COMPONENT) {
          label[c + 1] = id;
          q[qt++] = c + 1;
        }
        if (cx > 0 && pass[c - 1] === 1 && label[c - 1] === NO_COMPONENT) {
          label[c - 1] = id;
          q[qt++] = c - 1;
        }
        if (cy + 1 < H && pass[c + W] === 1 && label[c + W] === NO_COMPONENT) {
          label[c + W] = id;
          q[qt++] = c + W;
        }
        if (cy > 0 && pass[c - W] === 1 && label[c - W] === NO_COMPONENT) {
          label[c - W] = id;
          q[qt++] = c - W;
        }
      }
    }
    return label;
  }

  /** Afstandsveld (cellen) vanaf de rechthoek [x0, x0+w) x [y0, y0+h), geknipt op de map. */
  field(x0: number, y0: number, w: number, h: number): Uint16Array {
    const key = ((h * 64 + w) * 1024 + y0) * 1024 + x0;
    for (let k = 0; k < this.keys.length; k++) if (this.keys[k] === key) return this.fields[k]!;
    const f = this.compute(x0, y0, w, h);
    if (this.keys.length >= CACHE_FIELDS) {
      this.keys.shift();
      this.fields.shift();
    }
    this.keys.push(key);
    this.fields.push(f);
    return f;
  }

  /** Afstandsveld vanaf de cel onder het punt (x, y) in eenheden. */
  fieldAt(x: number, y: number): Uint16Array {
    return this.field(x >> 8, y >> 8, 1, 1);
  }

  /** Waarde van veld f bij het punt (x, y) in eenheden. */
  at(f: Uint16Array, x: number, y: number): number {
    return f[(y >> 8) * this.map.w + (x >> 8)]!;
  }

  private compute(rx: number, ry: number, rw: number, rh: number): Uint16Array {
    const map = this.map;
    const W = map.w;
    const H = map.h;
    const pass = map.passable;
    const d = new Uint16Array(W * H).fill(TERRAIN_UNREACHABLE);
    const q = this.queue;
    let qt = 0;
    const x0 = rx < 0 ? 0 : rx;
    const y0 = ry < 0 ? 0 : ry;
    const x1 = rx + rw > W ? W : rx + rw;
    const y1 = ry + rh > H ? H : ry + rh;
    // zaden: de hele bronrechthoek op 0, ook geblokkeerde cellen (zoals de flow fields een gebouw als doel nemen)
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const c = y * W + x;
        d[c] = 0;
        q[qt++] = c;
      }
    }
    let qh = 0;
    while (qh < qt) {
      const c = q[qh++]!;
      const cy = idiv(c, W);
      const cx = c - cy * W;
      const v = d[c]!;
      if (v + 1 >= TERRAIN_UNREACHABLE) continue;
      const nd = v + 1;
      if (cx + 1 < W && pass[c + 1] === 1 && d[c + 1] === TERRAIN_UNREACHABLE) {
        d[c + 1] = nd;
        q[qt++] = c + 1;
      }
      if (cx > 0 && pass[c - 1] === 1 && d[c - 1] === TERRAIN_UNREACHABLE) {
        d[c - 1] = nd;
        q[qt++] = c - 1;
      }
      if (cy + 1 < H && pass[c + W] === 1 && d[c + W] === TERRAIN_UNREACHABLE) {
        d[c + W] = nd;
        q[qt++] = c + W;
      }
      if (cy > 0 && pass[c - W] === 1 && d[c - W] === TERRAIN_UNREACHABLE) {
        d[c - W] = nd;
        q[qt++] = c - W;
      }
    }
    return d;
  }
}
