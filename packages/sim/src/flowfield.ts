import { NO_FIELD } from './ecs/world.js';
import { idiv } from './math/int.js';

// Flow fields: per doel een integratieveld (BFS-afstand over begaanbare cellen, 4-buren) dat gebudgetteerd wordt
// opgebouwd: hoogstens `budget` cellen per tick, over alle velden samen, in slotvolgorde.
//
// Het doel is een rechthoek van cellen (een cel voor een punt, de footprint voor een gebouw). Alle cellen van de
// rechthoek zijn zaadcellen met afstand 0, ook als ze geblokkeerd zijn: zo wijst het veld naar de rand van een gebouw.
//
// State per slot is alleen (active, rechthoek, processed). Het veld zelf (dist, queue) is een pure functie daarvan
// plus de begaanbaarheid: na deserialize wordt het opnieuw opgebouwd door `processed` cellen te expanderen. Elke
// wijziging in de begaanbaarheid (gebouw geplaatst of weg) zet alle velden terug op nul (invalidateAll), zodat die
// reconstructie altijd met dezelfde begaanbaarheid gebeurt. refcount is afgeleid uit de units en wordt herberekend.

export const MAX_FLOW_FIELDS = 32;
export const DIST_UNKNOWN = -1;

export class FlowFields {
  readonly w: number;
  readonly h: number;
  readonly cells: number;
  /** Actuele begaanbaarheid (map plus gebouwen), gedeeld met de sim. */
  private readonly walk: Uint8Array;

  // State (geserialiseerd en gehasht)
  readonly active = new Uint8Array(MAX_FLOW_FIELDS);
  readonly tx0 = new Int32Array(MAX_FLOW_FIELDS);
  readonly ty0 = new Int32Array(MAX_FLOW_FIELDS);
  readonly tw = new Int32Array(MAX_FLOW_FIELDS);
  readonly th = new Int32Array(MAX_FLOW_FIELDS);
  readonly processed = new Int32Array(MAX_FLOW_FIELDS);

  // Afgeleid
  readonly tail = new Int32Array(MAX_FLOW_FIELDS);
  readonly refcount = new Int32Array(MAX_FLOW_FIELDS);
  readonly dist: Int32Array[] = [];
  private readonly queue: Int32Array[] = [];

  constructor(w: number, h: number, walk: Uint8Array) {
    this.w = w;
    this.h = h;
    this.cells = w * h;
    this.walk = walk;
    for (let s = 0; s < MAX_FLOW_FIELDS; s++) {
      this.dist.push(new Int32Array(this.cells).fill(DIST_UNKNOWN));
      this.queue.push(new Int32Array(this.cells));
    }
  }

  private matches(s: number, x0: number, y0: number, w: number, h: number): boolean {
    return (
      this.active[s] === 1 &&
      this.tx0[s] === x0 &&
      this.ty0[s] === y0 &&
      this.tw[s] === w &&
      this.th[s] === h
    );
  }

  /** Of slot s precies deze doelrechthoek heeft. */
  hasTarget(s: number, x0: number, y0: number, w: number, h: number): boolean {
    return s !== NO_FIELD && this.matches(s, x0, y0, w, h);
  }

  /**
   * Slot voor een doelrechthoek (cellen, binnen de map): hergebruik een veld met hetzelfde doel, anders een vrij of
   * ongebruikt slot. NO_FIELD als alles bezet is (de unit loopt dan recht op zijn doel af).
   */
  acquire(x0: number, y0: number, w: number, h: number): number {
    for (let s = 0; s < MAX_FLOW_FIELDS; s++) if (this.matches(s, x0, y0, w, h)) return s;
    for (let s = 0; s < MAX_FLOW_FIELDS; s++) {
      if (this.active[s] === 0) {
        this.reset(s, x0, y0, w, h);
        return s;
      }
    }
    for (let s = 0; s < MAX_FLOW_FIELDS; s++) {
      if (this.refcount[s] === 0) {
        this.reset(s, x0, y0, w, h);
        return s;
      }
    }
    return NO_FIELD;
  }

  private reset(s: number, x0: number, y0: number, w: number, h: number): void {
    this.active[s] = 1;
    this.tx0[s] = x0;
    this.ty0[s] = y0;
    this.tw[s] = w;
    this.th[s] = h;
    this.processed[s] = 0;
    this.seed(s);
  }

  /** Zaadcellen: de doelrechthoek, rij voor rij. */
  private seed(s: number): void {
    const dist = this.dist[s]!;
    const queue = this.queue[s]!;
    dist.fill(DIST_UNKNOWN);
    let t = 0;
    const x0 = this.tx0[s]!;
    const y0 = this.ty0[s]!;
    for (let y = y0; y < y0 + this.th[s]!; y++) {
      for (let x = x0; x < x0 + this.tw[s]!; x++) {
        const c = y * this.w + x;
        dist[c] = 0;
        queue[t++] = c;
      }
    }
    this.tail[s] = t;
  }

  /** De begaanbaarheid is veranderd: elk actief veld begint opnieuw, ongebruikte velden vallen vrij. */
  invalidateAll(): void {
    for (let s = 0; s < MAX_FLOW_FIELDS; s++) {
      if (this.active[s] !== 1) continue;
      if (this.refcount[s] === 0) {
        this.active[s] = 0;
        this.tx0[s] = 0;
        this.ty0[s] = 0;
        this.tw[s] = 0;
        this.th[s] = 0;
        this.processed[s] = 0;
        this.tail[s] = 0;
        continue;
      }
      this.processed[s] = 0;
      this.seed(s);
    }
  }

  isComplete(s: number): boolean {
    return this.processed[s] === this.tail[s];
  }

  /** Expandeert één cel van slot s (BFS, vaste burenvolgorde O, W, Z, N, alleen naar begaanbare buren). */
  private expand(s: number): void {
    const dist = this.dist[s]!;
    const queue = this.queue[s]!;
    const pass = this.walk;
    const w = this.w;
    const c = queue[this.processed[s]!]!;
    this.processed[s] = this.processed[s]! + 1;
    const d = dist[c]! + 1;
    const cy = idiv(c, w);
    const cx = c - cy * w;
    let t = this.tail[s]!;
    if (cx + 1 < w && pass[c + 1] === 1 && dist[c + 1] === DIST_UNKNOWN) {
      dist[c + 1] = d;
      queue[t++] = c + 1;
    }
    if (cx > 0 && pass[c - 1] === 1 && dist[c - 1] === DIST_UNKNOWN) {
      dist[c - 1] = d;
      queue[t++] = c - 1;
    }
    if (cy + 1 < this.h && pass[c + w] === 1 && dist[c + w] === DIST_UNKNOWN) {
      dist[c + w] = d;
      queue[t++] = c + w;
    }
    if (cy > 0 && pass[c - w] === 1 && dist[c - w] === DIST_UNKNOWN) {
      dist[c - w] = d;
      queue[t++] = c - w;
    }
    this.tail[s] = t;
  }

  /** Systeem 3: gebruikte, onvolledige velden in slotvolgorde uitbreiden tot het budget op is. */
  step(budget: number): void {
    let left = budget;
    for (let s = 0; s < MAX_FLOW_FIELDS && left > 0; s++) {
      if (this.active[s] !== 1 || this.refcount[s] === 0) continue;
      while (left > 0 && this.processed[s]! < this.tail[s]!) {
        this.expand(s);
        left--;
      }
    }
  }

  /** Na deserialize: velden opnieuw opbouwen tot hun geserialiseerde voortgang. */
  rebuild(): void {
    for (let s = 0; s < MAX_FLOW_FIELDS; s++) {
      const want = this.processed[s]!;
      if (this.active[s] !== 1) {
        this.tail[s] = 0;
        continue;
      }
      this.processed[s] = 0;
      this.seed(s);
      while (this.processed[s]! < want) {
        if (this.processed[s]! >= this.tail[s]!)
          throw new Error(`flow field ${s}: voortgang ${want} niet reproduceerbaar`);
        this.expand(s);
      }
    }
  }

  /**
   * Beste volgende cel vanaf `cell` in veld s: de buur (8 richtingen, diagonaal alleen als beide rechte buren
   * begaanbaar zijn) met de laagste afstand; gelijke afstand: de eerste in vaste volgorde.
   * Geeft `cell` zelf als er geen betere begaanbare buur is (doel bereikt), -1 als het veld deze cel (nog) niet kent.
   */
  nextCell(s: number, cell: number): number {
    const dist = this.dist[s]!;
    const here = dist[cell]!;
    if (here === DIST_UNKNOWN) return -1;
    if (here === 0) return cell;
    const w = this.w;
    const pass = this.walk;
    const cy = idiv(cell, w);
    const cx = cell - cy * w;
    const pE = cx + 1 < w && pass[cell + 1] === 1;
    const pW = cx > 0 && pass[cell - 1] === 1;
    const pS = cy + 1 < this.h && pass[cell + w] === 1;
    const pN = cy > 0 && pass[cell - w] === 1;
    // Kandidaten in vaste volgorde: O, W, Z, N, ZO, ZW, NO, NW. Strikt kleiner wint, dus gelijke afstand houdt de eerste.
    let best = cell;
    let bestD = here;
    let c = 0;
    let d = 0;
    if (pE) {
      c = cell + 1;
      d = dist[c]!;
      if (d !== DIST_UNKNOWN && d < bestD) {
        bestD = d;
        best = c;
      }
    }
    if (pW) {
      c = cell - 1;
      d = dist[c]!;
      if (d !== DIST_UNKNOWN && d < bestD) {
        bestD = d;
        best = c;
      }
    }
    if (pS) {
      c = cell + w;
      d = dist[c]!;
      if (d !== DIST_UNKNOWN && d < bestD) {
        bestD = d;
        best = c;
      }
    }
    if (pN) {
      c = cell - w;
      d = dist[c]!;
      if (d !== DIST_UNKNOWN && d < bestD) {
        bestD = d;
        best = c;
      }
    }
    if (pE && pS && pass[cell + w + 1] === 1) {
      c = cell + w + 1;
      d = dist[c]!;
      if (d !== DIST_UNKNOWN && d < bestD) {
        bestD = d;
        best = c;
      }
    }
    if (pW && pS && pass[cell + w - 1] === 1) {
      c = cell + w - 1;
      d = dist[c]!;
      if (d !== DIST_UNKNOWN && d < bestD) {
        bestD = d;
        best = c;
      }
    }
    if (pE && pN && pass[cell - w + 1] === 1) {
      c = cell - w + 1;
      d = dist[c]!;
      if (d !== DIST_UNKNOWN && d < bestD) {
        bestD = d;
        best = c;
      }
    }
    if (pW && pN && pass[cell - w - 1] === 1) {
      c = cell - w - 1;
      d = dist[c]!;
      if (d !== DIST_UNKNOWN && d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }
}
