import type { SimMap } from './config.js';
import { NO_FIELD } from './ecs/world.js';
import { idiv } from './math/int.js';

// Flow fields: per doelcel een integratieveld (BFS-afstand over begaanbare cellen, 4-buren) dat gebudgetteerd
// wordt opgebouwd: hoogstens `budget` cellen per tick, over alle velden samen, in slotvolgorde.
//
// State per slot is alleen (active, targetCell, processed). Het veld zelf (dist, queue) is een pure functie
// daarvan plus de map: na deserialize wordt het opnieuw opgebouwd door `processed` cellen te expanderen.
// refcount is afgeleid uit de units en wordt ook herberekend.

export const MAX_FLOW_FIELDS = 16;
export const DIST_UNKNOWN = -1;

export class FlowFields {
  readonly w: number;
  readonly h: number;
  readonly cells: number;
  private readonly passable: Uint8Array;

  // State (geserialiseerd en gehasht)
  readonly active = new Uint8Array(MAX_FLOW_FIELDS);
  readonly target = new Int32Array(MAX_FLOW_FIELDS);
  readonly processed = new Int32Array(MAX_FLOW_FIELDS);

  // Afgeleid
  readonly tail = new Int32Array(MAX_FLOW_FIELDS);
  readonly refcount = new Int32Array(MAX_FLOW_FIELDS);
  readonly dist: Int32Array[] = [];
  private readonly queue: Int32Array[] = [];

  constructor(map: SimMap) {
    this.w = map.w;
    this.h = map.h;
    this.cells = map.w * map.h;
    this.passable = map.passable;
    for (let s = 0; s < MAX_FLOW_FIELDS; s++) {
      this.dist.push(new Int32Array(this.cells).fill(DIST_UNKNOWN));
      this.queue.push(new Int32Array(this.cells));
    }
  }

  /** Slot voor een doelcel: hergebruik een veld met hetzelfde doel, anders een vrij of ongebruikt slot. NO_FIELD als alles bezet is. */
  acquire(cell: number): number {
    for (let s = 0; s < MAX_FLOW_FIELDS; s++) if (this.active[s] === 1 && this.target[s] === cell) return s;
    for (let s = 0; s < MAX_FLOW_FIELDS; s++) {
      if (this.active[s] === 0) {
        this.reset(s, cell);
        return s;
      }
    }
    for (let s = 0; s < MAX_FLOW_FIELDS; s++) {
      if (this.refcount[s] === 0) {
        this.reset(s, cell);
        return s;
      }
    }
    return NO_FIELD;
  }

  private reset(s: number, cell: number): void {
    this.active[s] = 1;
    this.target[s] = cell;
    this.processed[s] = 0;
    const dist = this.dist[s]!;
    dist.fill(DIST_UNKNOWN);
    dist[cell] = 0;
    this.queue[s]![0] = cell;
    this.tail[s] = 1;
  }

  isComplete(s: number): boolean {
    return this.processed[s] === this.tail[s];
  }

  /** Expandeert één cel van slot s (BFS, vaste burenvolgorde O, W, Z, N). */
  private expand(s: number): void {
    const dist = this.dist[s]!;
    const queue = this.queue[s]!;
    const pass = this.passable;
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
      this.reset(s, this.target[s]!);
      while (this.processed[s]! < want) {
        if (this.processed[s]! >= this.tail[s]!) throw new Error(`flow field ${s}: voortgang ${want} niet reproduceerbaar`);
        this.expand(s);
      }
    }
  }

  /**
   * Beste volgende cel vanaf `cell` in veld s: de buur (8 richtingen, diagonaal alleen als beide rechte buren
   * begaanbaar zijn) met de laagste afstand; gelijke afstand: de eerste in vaste volgorde.
   * Geeft `cell` zelf als dat de doelcel is, -1 als het veld deze cel (nog) niet kent.
   */
  nextCell(s: number, cell: number): number {
    const dist = this.dist[s]!;
    const here = dist[cell]!;
    if (here === DIST_UNKNOWN) return -1;
    if (here === 0) return cell;
    const w = this.w;
    const pass = this.passable;
    const cy = idiv(cell, w);
    const cx = cell - cy * w;
    const hasE = cx + 1 < w;
    const hasW = cx > 0;
    const hasS = cy + 1 < this.h;
    const hasN = cy > 0;
    const pE = hasE && pass[cell + 1] === 1;
    const pW = hasW && pass[cell - 1] === 1;
    const pS = hasS && pass[cell + w] === 1;
    const pN = hasN && pass[cell - w] === 1;
    // Kandidaten in vaste volgorde: O, W, Z, N, ZO, ZW, NO, NW. Strikt kleiner wint, dus gelijke afstand houdt de eerste.
    let best = cell;
    let bestD = here;
    let c = 0;
    let d = 0;
    if (pE) { c = cell + 1; d = dist[c]!; if (d !== DIST_UNKNOWN && d < bestD) { bestD = d; best = c; } }
    if (pW) { c = cell - 1; d = dist[c]!; if (d !== DIST_UNKNOWN && d < bestD) { bestD = d; best = c; } }
    if (pS) { c = cell + w; d = dist[c]!; if (d !== DIST_UNKNOWN && d < bestD) { bestD = d; best = c; } }
    if (pN) { c = cell - w; d = dist[c]!; if (d !== DIST_UNKNOWN && d < bestD) { bestD = d; best = c; } }
    if (pE && pS && pass[cell + w + 1] === 1) { c = cell + w + 1; d = dist[c]!; if (d !== DIST_UNKNOWN && d < bestD) { bestD = d; best = c; } }
    if (pW && pS && pass[cell + w - 1] === 1) { c = cell + w - 1; d = dist[c]!; if (d !== DIST_UNKNOWN && d < bestD) { bestD = d; best = c; } }
    if (pE && pN && pass[cell - w + 1] === 1) { c = cell - w + 1; d = dist[c]!; if (d !== DIST_UNKNOWN && d < bestD) { bestD = d; best = c; } }
    if (pW && pN && pass[cell - w - 1] === 1) { c = cell - w - 1; d = dist[c]!; if (d !== DIST_UNKNOWN && d < bestD) { bestD = d; best = c; } }
    return best;
  }
}
