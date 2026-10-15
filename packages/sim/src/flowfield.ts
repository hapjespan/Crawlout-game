import { NO_FIELD } from './ecs/world.js';
import { idiv } from './math/int.js';

// Hiërarchische padvinding (sim-xl, data 0.11.0): flow fields per doel, schaalbaar tot maps van 384 bij 384 m en meer.
//
// Slots en state. Een slot hoort bij een doelrechthoek van cellen (een cel voor een punt, de footprint voor een gebouw).
// State per slot is alleen (active, rechthoek); welke unit welk slot gebruikt staat op de unit. Al het andere hieronder
// is afgeleid: een pure functie van (doel, begaanbaarheid, sectorgrootte, ingangslengte), lui berekend en gecachet.
// Hoe ver een cache is, verandert geen enkele waarde die de sim leest, dus serialize/deserialize midden in een opbouw,
// een kleinere cache of een andere volgorde van vragen geeft dezelfde hashes (test/flowfield.test.ts).
//
// 1. Sectoren van S bij S cellen (S = pathSectorCells, macht van 2). Per sector de regio's: samenhangende stukken
//    begaanbare cellen binnen de sector (4-buren). Een rivier of bosrand die een sector splitst, geeft twee regio's.
// 2. Ingangen: op elke grens tussen twee buursectoren de aaneengesloten stukken waar beide kanten begaanbaar zijn,
//    opgeknipt in gelijke stukken van hoogstens pathEntranceMaxCells. Elke ingang geeft twee knopen, het midden aan elke
//    kant (kosten 1 over de grens). Binnen een sector-regio verbindt een BFS de knopen onderling (kosten = celafstand,
//    in een sector zonder obstakels gewoon Manhattan); randen waar een andere knoop precies tussen ligt vallen weg.
// 3. Per doel: een doelvenster van de sectoren rond het doel (de sectoren die het doel raken plus één sector rand) met
//    een exacte BFS vanaf het doel. Knopen in het venster beginnen met hun vensterafstand; Dijkstra over de knopengraaf
//    (vaste tiebreak op knoopindex) geeft per knoop de afstand tot het doel. Lui: alleen zover als units het vragen.
// 4. Per (doel, sector-regio) een regioveld: BFS binnen de regio vanaf de knopen van die regio met hun afstand, in het
//    venster het minimum met de vensterafstand. Zo heeft elke cel één waarde V, en heeft elke cel met V > 0 een buur
//    (ook over een sectorgrens) met een lagere V: de unit volgt het veld zonder lokale minima naar het doel.
//    Regiovelden staan in een pool met een vaste bovengrens (pathCacheCells); verdringen is veilig, want opnieuw
//    rekenen geeft dezelfde waarden.
//
// Een nieuw of verdwenen gebouw (invalidate) markeert alleen de sectoren onder de footprint: hun regio's, hun vier
// grenzen en de knopen van die sectoren en hun buren worden opnieuw berekend, de rest van de graaf blijft staan.
// De zoekopdrachten per doel beginnen wel opnieuw (een afgesloten oversteek verandert verre afstanden), maar die zijn
// klein en lui. Ongebruikte slots vallen bij elke wijziging vrij, zoals voorheen. Systeem 3 (step) werkt alleen de graaf
// bij; de velden zelf rekent beweging (systeem 4) lui uit, dus een unit vertrekt in de tick van zijn bevel.

export const MAX_FLOW_FIELDS = 32;
export const DIST_UNKNOWN = -1;
const NO_REGION = 0xffff;
const EMPTY = new Int32Array(0);
/** Geometrie: kleinste aantal regiovelden in de pool (een nextCell leest negen cellen, dus hoogstens negen regio's). */
const MIN_POOL_FIELDS = 16;

/** Tuning van de padvinding in cellen (uit data/sim.json via de adapter). */
export interface PathTuning {
  /** Sectorzijde in cellen, een macht van 2 (4 tot en met 64). */
  readonly sectorCells: number;
  /** Langste ingang per knopenpaar; een langer open stuk van een sectorgrens wordt opgeknipt. */
  readonly entranceMaxCells: number;
  /** Geheugenbudget van de regiovelden, in cellen (int32). Verandert de uitkomst niet, alleen de snelheid. */
  readonly cacheCells: number;
}

/** Per sector: aantal regio's, de grensingangen (oost en zuid, als cel-paren) en de knopen aan deze kant. */
class Sector {
  regions = 0;
  /** Alle cellen begaanbaar: afstanden binnen de sector zijn dan Manhattan (geen BFS nodig). */
  open = false;
  /** Ingangen op de oostgrens: cel in deze sector (a) en in de oosterbuur (b), midden van elk stuk. */
  eastA: Int32Array = EMPTY;
  eastB: Int32Array = EMPTY;
  /** Ingangen op de zuidgrens: cel in deze sector (a) en in de zuiderbuur (b). */
  southA: Int32Array = EMPTY;
  southB: Int32Array = EMPTY;
  /** Knopen aan deze kant, in de volgorde noord, west, oost, zuid; elk deel in de volgorde van de grens. */
  nodeCell: Int32Array = EMPTY;
  nodeRegion: Int32Array = EMPTY;
  /** Afstand tussen knoop i en j binnen de regio (n*n), -1 als ze in andere regio's liggen. */
  nodeDist: Int32Array = EMPTY;
  /**
   * Knopengraaf binnen de sector als CSR (adjStart, adjNode, adjCost): de randen i-j uit nodeDist zonder de overbodige,
   * waar een knoop k ertussen ligt met d(i,k) + d(k,j) = d(i,j) en beide delen > 0. Dijkstra geeft dezelfde afstanden
   * (elke weggelaten rand is een pad van kortere randen), met een fractie van het werk.
   */
  adjStart: Int32Array = EMPTY;
  adjNode: Int32Array = EMPTY;
  adjCost: Int32Array = EMPTY;
  /** Begin van de delen noord, west, oost, zuid en het einde. */
  readonly part = new Int32Array(5);
}

/** Zoekopdracht van één slot (afgeleid; begint opnieuw bij elke wijziging van de graaf of het doel). */
class SlotSearch {
  /** Graaf-epoch waarin de zoekopdracht begon; anders dan de huidige: opnieuw beginnen. */
  epoch = -1;
  g: Int32Array = EMPTY;
  done = new Uint8Array(0);
  heapNode: Int32Array = EMPTY;
  heapPos: Int32Array = EMPTY;
  heapSize = 0;
  /** Per globale regio de index in de pool, -1 als het regioveld er (nog) niet is. */
  regionField: Int32Array = EMPTY;
  /** Doelvenster in cellen en in sectoren (inclusief), met de exacte BFS-afstand tot het doel. */
  wx0 = 0;
  wy0 = 0;
  ww = 0;
  wh = 0;
  ws0x = 0;
  ws0y = 0;
  ws1x = 0;
  ws1y = 0;
  win: Int32Array = EMPTY;
}

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

  // Afgeleid
  readonly refcount = new Int32Array(MAX_FLOW_FIELDS);

  // Sectoren
  private readonly shift: number;
  private readonly S: number;
  private readonly mask: number;
  private readonly S2: number;
  private readonly entranceMax: number;
  readonly sx: number;
  readonly sy: number;
  private readonly sectors: Sector[] = [];
  /** Per cel de lokale regio binnen zijn sector, NO_REGION voor een onbegaanbare cel. */
  private readonly regLocal: Uint16Array;
  private readonly dirty: Uint8Array;
  private graphDirty = true;
  private epoch = 0;

  // Globale nummering (na elke herbouw van de graaf)
  private readonly nodeBase: Int32Array;
  private readonly regionBase: Int32Array;
  nodeCount = 0;
  regionCount = 0;
  private gNodeSec: Int32Array = EMPTY;
  private gNodeK: Int32Array = EMPTY;
  private gNodeCross: Int32Array = EMPTY;

  // Zoekopdrachten en regiovelden
  private readonly search: SlotSearch[] = [];
  private readonly poolCap: number;
  private pool: Int32Array = EMPTY;
  private poolTop = 0;
  private readonly poolSlot: Int32Array;
  private readonly poolRegion: Int32Array;
  private readonly poolStamp: Int32Array;
  private readonly poolFree: Int32Array;
  private poolFreeTop = 0;
  private clock = 0;
  private stamp = 1;

  // Kladruimte
  private readonly scratchQ: Int32Array;
  private readonly scratchD: Int32Array;
  private readonly scratchT: Uint8Array;
  private seedV: Int32Array = new Int32Array(64);
  private seedC: Int32Array = new Int32Array(64);
  private winQ: Int32Array = EMPTY;

  constructor(w: number, h: number, walk: Uint8Array, tuning: PathTuning) {
    this.w = w;
    this.h = h;
    this.cells = w * h;
    this.walk = walk;
    this.S = tuning.sectorCells;
    this.shift = 31 - Math.clz32(this.S);
    this.mask = this.S - 1;
    this.S2 = this.S * this.S;
    this.entranceMax = tuning.entranceMaxCells;
    this.sx = (w + this.mask) >> this.shift;
    this.sy = (h + this.mask) >> this.shift;
    const n = this.sx * this.sy;
    for (let s = 0; s < n; s++) this.sectors.push(new Sector());
    this.regLocal = new Uint16Array(this.cells);
    this.dirty = new Uint8Array(n).fill(1);
    this.nodeBase = new Int32Array(n + 1);
    this.regionBase = new Int32Array(n + 1);
    for (let s = 0; s < MAX_FLOW_FIELDS; s++) this.search.push(new SlotSearch());
    this.poolCap = Math.max(MIN_POOL_FIELDS, idiv(tuning.cacheCells, this.S2));
    this.poolSlot = new Int32Array(this.poolCap).fill(-1);
    this.poolRegion = new Int32Array(this.poolCap);
    this.poolStamp = new Int32Array(this.poolCap);
    this.poolFree = new Int32Array(this.poolCap);
    this.scratchQ = new Int32Array(this.S2);
    this.scratchD = new Int32Array(this.S2);
    this.scratchT = new Uint8Array(this.S2);
    // de graaf meteen opbouwen, zodat de eerste tick hem niet betaalt
    this.ensureGraph();
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
    this.dropSearch(s);
  }

  /** De zoekopdracht van slot s vervalt; zijn regiovelden gaan terug naar de pool. */
  private dropSearch(s: number): void {
    const q = this.search[s]!;
    if (q.epoch !== this.epoch) {
      q.epoch = -1;
      return;
    }
    const rf = q.regionField;
    for (let r = 0; r < this.regionCount; r++) {
      const p = rf[r]!;
      if (p >= 0 && this.poolSlot[p] === s && this.poolRegion[p] === r) {
        this.poolSlot[p] = -1;
        this.poolFree[this.poolFreeTop++] = p;
      }
    }
    q.epoch = -1;
  }

  /**
   * De begaanbaarheid van de rechthoek [fx, fx+fw) x [fy, fy+fh) is veranderd: de sectoren eronder worden opnieuw
   * opgebouwd, alle zoekopdrachten beginnen opnieuw, ongebruikte slots vallen vrij.
   */
  invalidate(fx: number, fy: number, fw: number, fh: number): void {
    const sx0 = Math.max(0, fx) >> this.shift;
    const sy0 = Math.max(0, fy) >> this.shift;
    const sx1 = Math.min(this.w - 1, fx + fw - 1) >> this.shift;
    const sy1 = Math.min(this.h - 1, fy + fh - 1) >> this.shift;
    for (let y = sy0; y <= sy1; y++)
      for (let x = sx0; x <= sx1; x++) this.dirty[y * this.sx + x] = 1;
    this.graphDirty = true;
    this.dropAll();
  }

  /** Alles opnieuw (na deserialize of als de hele begaanbaarheid is vervangen). */
  invalidateAll(): void {
    this.dirty.fill(1);
    this.graphDirty = true;
    this.dropAll();
  }

  private dropAll(): void {
    this.epoch++;
    this.poolTop = 0;
    this.poolFreeTop = 0;
    this.poolSlot.fill(-1);
    for (let s = 0; s < MAX_FLOW_FIELDS; s++) {
      this.search[s]!.epoch = -1;
      if (this.active[s] !== 1 || this.refcount[s] !== 0) continue;
      this.active[s] = 0;
      this.tx0[s] = 0;
      this.ty0[s] = 0;
      this.tw[s] = 0;
      this.th[s] = 0;
    }
  }

  /** Na deserialize: de afgeleide graaf en caches opnieuw (lui). De state zelf (slots) is al geladen. */
  rebuild(): void {
    this.dirty.fill(1);
    this.graphDirty = true;
    this.epoch++;
    this.poolTop = 0;
    this.poolFreeTop = 0;
    this.poolSlot.fill(-1);
    for (let s = 0; s < MAX_FLOW_FIELDS; s++) this.search[s]!.epoch = -1;
    this.ensureGraph();
  }

  /** Systeem 3: de graaf bijwerken voor de sectoren die sinds de vorige tick zijn veranderd. */
  step(): void {
    this.ensureGraph();
  }

  // ---------------------------------------------------------------- graaf

  private ensureGraph(): void {
    if (!this.graphDirty) return;
    const n = this.sx * this.sy;
    for (let s = 0; s < n; s++) if (this.dirty[s] === 1) this.computeRegions(s);
    // grenzen van vuile sectoren (en de grenzen die de buren met hen delen)
    for (let s = 0; s < n; s++) {
      if (this.dirty[s] !== 1) continue;
      const x = s - idiv(s, this.sx) * this.sx;
      this.computeBorders(s);
      if (x > 0) this.computeBorders(s - 1);
      if (s >= this.sx) this.computeBorders(s - this.sx);
    }
    // knopen van vuile sectoren en hun vier buren
    const nodesDirty = new Uint8Array(n);
    for (let s = 0; s < n; s++) {
      if (this.dirty[s] !== 1) continue;
      const x = s - idiv(s, this.sx) * this.sx;
      nodesDirty[s] = 1;
      if (x > 0) nodesDirty[s - 1] = 1;
      if (x + 1 < this.sx) nodesDirty[s + 1] = 1;
      if (s >= this.sx) nodesDirty[s - this.sx] = 1;
      if (s + this.sx < n) nodesDirty[s + this.sx] = 1;
    }
    for (let s = 0; s < n; s++) if (nodesDirty[s] === 1) this.computeNodes(s);
    this.dirty.fill(0);
    this.renumber();
    this.graphDirty = false;
  }

  private secX0(s: number): number {
    return (s - idiv(s, this.sx) * this.sx) << this.shift;
  }

  private secY0(s: number): number {
    return idiv(s, this.sx) << this.shift;
  }

  /** Regio's van sector s: flood fill (4-buren) binnen de sector, in rijvolgorde genummerd. */
  private computeRegions(s: number): void {
    const x0 = this.secX0(s);
    const y0 = this.secY0(s);
    const x1 = Math.min(this.w, x0 + this.S);
    const y1 = Math.min(this.h, y0 + this.S);
    const w = this.w;
    const walk = this.walk;
    const reg = this.regLocal;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) reg[y * w + x] = NO_REGION;
    const stack = this.scratchQ;
    let count = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const c0 = y * w + x;
        if (walk[c0] !== 1 || reg[c0] !== NO_REGION) continue;
        reg[c0] = count;
        let top = 0;
        stack[top++] = c0;
        while (top > 0) {
          const c = stack[--top]!;
          const cy = idiv(c, w);
          const cx = c - cy * w;
          if (cx + 1 < x1 && walk[c + 1] === 1 && reg[c + 1] === NO_REGION) {
            reg[c + 1] = count;
            stack[top++] = c + 1;
          }
          if (cx > x0 && walk[c - 1] === 1 && reg[c - 1] === NO_REGION) {
            reg[c - 1] = count;
            stack[top++] = c - 1;
          }
          if (cy + 1 < y1 && walk[c + w] === 1 && reg[c + w] === NO_REGION) {
            reg[c + w] = count;
            stack[top++] = c + w;
          }
          if (cy > y0 && walk[c - w] === 1 && reg[c - w] === NO_REGION) {
            reg[c - w] = count;
            stack[top++] = c - w;
          }
        }
        count++;
      }
    }
    const sec = this.sectors[s]!;
    sec.regions = count;
    let blocked = 0;
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) if (walk[y * w + x] !== 1) blocked++;
    sec.open = blocked === 0;
  }

  /** Ingangen op de oost- en zuidgrens van sector s (als die buur er is). */
  private computeBorders(s: number): void {
    const sec = this.sectors[s]!;
    const x0 = this.secX0(s);
    const y0 = this.secY0(s);
    const x1 = Math.min(this.w, x0 + this.S);
    const y1 = Math.min(this.h, y0 + this.S);
    const w = this.w;
    const walk = this.walk;
    const a: number[] = [];
    const b: number[] = [];
    const runs = (
      len: number,
      open: (k: number) => boolean,
      cellA: (k: number) => number,
      d: number,
    ): void => {
      a.length = 0;
      b.length = 0;
      let k = 0;
      while (k < len) {
        if (!open(k)) {
          k++;
          continue;
        }
        let e = k;
        while (e < len && open(e)) e++;
        // [k, e) open: opknippen in n gelijke stukken van hoogstens entranceMax (zo symmetrisch als het kan: op een
        // puntsymmetrische map horen gespiegelde ingangen zo veel mogelijk op gespiegelde plekken te liggen)
        const len2 = e - k;
        const n = idiv(len2 + this.entranceMax - 1, this.entranceMax);
        for (let j = 0; j < n; j++) {
          const p = k + idiv(j * len2, n);
          const q = k + idiv((j + 1) * len2, n);
          const c = cellA(p + ((q - p - 1) >> 1));
          a.push(c);
          b.push(c + d);
        }
        k = e;
      }
    };
    if (x1 < this.w) {
      runs(
        y1 - y0,
        (k) => walk[(y0 + k) * w + x1 - 1] === 1 && walk[(y0 + k) * w + x1] === 1,
        (k) => (y0 + k) * w + x1 - 1,
        1,
      );
      sec.eastA = Int32Array.from(a);
      sec.eastB = Int32Array.from(b);
    } else {
      sec.eastA = EMPTY;
      sec.eastB = EMPTY;
    }
    if (y1 < this.h) {
      runs(
        x1 - x0,
        (k) => walk[(y1 - 1) * w + x0 + k] === 1 && walk[y1 * w + x0 + k] === 1,
        (k) => (y1 - 1) * w + x0 + k,
        w,
      );
      sec.southA = Int32Array.from(a);
      sec.southB = Int32Array.from(b);
    } else {
      sec.southA = EMPTY;
      sec.southB = EMPTY;
    }
  }

  /** Knopen van sector s (noord, west, oost, zuid) en hun onderlinge afstanden binnen de regio (BFS per knoop). */
  private computeNodes(s: number): void {
    const sec = this.sectors[s]!;
    const sxi = s - idiv(s, this.sx) * this.sx;
    const north = s >= this.sx ? this.sectors[s - this.sx]!.southB : EMPTY;
    const west = sxi > 0 ? this.sectors[s - 1]!.eastB : EMPTY;
    const n = north.length + west.length + sec.eastA.length + sec.southA.length;
    const cell = new Int32Array(n);
    let k = 0;
    sec.part[0] = k;
    for (const c of north) cell[k++] = c;
    sec.part[1] = k;
    for (const c of west) cell[k++] = c;
    sec.part[2] = k;
    for (const c of sec.eastA) cell[k++] = c;
    sec.part[3] = k;
    for (const c of sec.southA) cell[k++] = c;
    sec.part[4] = k;
    const region = new Int32Array(n);
    for (let i = 0; i < n; i++) region[i] = this.regLocal[cell[i]!]!;
    const dist = new Int32Array(n * n).fill(-1);
    const x0 = this.secX0(s);
    const y0 = this.secY0(s);
    const x1 = Math.min(this.w, x0 + this.S);
    const y1 = Math.min(this.h, y0 + this.S);
    const d = this.scratchD;
    const q = this.scratchQ;
    const w = this.w;
    const reg = this.regLocal;
    for (let i = 0; i < n; i++) {
      dist[i * n + i] = 0;
      if (sec.open) {
        // open rechthoek: de BFS-afstand met 4-buren is de Manhattan-afstand
        const ci = cell[i]!;
        const yi = idiv(ci, w);
        const xi = ci - yi * w;
        for (let j = i + 1; j < n; j++) {
          const cj = cell[j]!;
          const yj = idiv(cj, w);
          const xj = cj - yj * w;
          const dd = Math.abs(xi - xj) + Math.abs(yi - yj);
          dist[i * n + j] = dd;
          dist[j * n + i] = dd;
        }
        continue;
      }
      // alleen naar knopen met een hogere index rekenen; de matrix is symmetrisch
      let need = false;
      for (let j = i + 1; j < n; j++) if (region[j] === region[i]) need = true;
      if (!need) continue;
      d.fill(-1);
      const r = region[i]!;
      // doelcellen (knopen j > i in dezelfde regio): de BFS stopt zodra ze allemaal bereikt zijn
      const tgt = this.scratchT;
      let left = 0;
      for (let j = i + 1; j < n; j++) {
        if (region[j] !== r) continue;
        const lj = this.localOf(cell[j]!, x0, y0);
        if (tgt[lj] === 0) {
          tgt[lj] = 1;
          left++;
        }
      }
      const ls = this.localOf(cell[i]!, x0, y0);
      d[ls] = 0;
      if (tgt[ls] === 1) {
        tgt[ls] = 0;
        left--;
      }
      let qh = 0;
      let qt = 0;
      q[qt++] = ls;
      const S = this.S;
      while (qh < qt && left > 0) {
        const l = q[qh++]!;
        const ly = l >> this.shift;
        const lx = l & this.mask;
        const c = (y0 + ly) * w + x0 + lx;
        const nd = d[l]! + 1;
        // buren O, W, Z, N; een doelcel telt af zodra hij een afstand krijgt
        for (let k = 0; k < 4; k++) {
          let m: number;
          if (k === 0) m = x0 + lx + 1 < x1 && reg[c + 1] === r ? l + 1 : -1;
          else if (k === 1) m = lx > 0 && reg[c - 1] === r ? l - 1 : -1;
          else if (k === 2) m = y0 + ly + 1 < y1 && reg[c + w] === r ? l + S : -1;
          else m = ly > 0 && reg[c - w] === r ? l - S : -1;
          if (m < 0 || d[m] !== -1) continue;
          d[m] = nd;
          q[qt++] = m;
          if (tgt[m] === 1) {
            tgt[m] = 0;
            left--;
          }
        }
      }
      for (let j = i + 1; j < n; j++) tgt[this.localOf(cell[j]!, x0, y0)] = 0;
      for (let j = i + 1; j < n; j++) {
        if (region[j] !== r) continue;
        const lj = this.localOf(cell[j]!, x0, y0);
        dist[i * n + j] = d[lj]!;
        dist[j * n + i] = d[lj]!;
      }
    }
    sec.nodeCell = cell;
    sec.nodeRegion = region;
    sec.nodeDist = dist;
    // overbodige randen weglaten (zie Sector.adjStart)
    const start = new Int32Array(n + 1);
    const adjN: number[] = [];
    const adjC: number[] = [];
    for (let i = 0; i < n; i++) {
      start[i] = adjN.length;
      for (let j = 0; j < n; j++) {
        const dij = dist[i * n + j]!;
        if (j === i || dij < 0) continue;
        let redundant = false;
        for (let k = 0; k < n && !redundant; k++) {
          const a = dist[i * n + k]!;
          const b = dist[k * n + j]!;
          if (a > 0 && b > 0 && a + b === dij) redundant = true;
        }
        if (redundant) continue;
        adjN.push(j);
        adjC.push(dij);
      }
    }
    start[n] = adjN.length;
    sec.adjStart = start;
    sec.adjNode = Int32Array.from(adjN);
    sec.adjCost = Int32Array.from(adjC);
  }

  /** Lokale index (rij maal S plus kolom) van globale cel c in de sector met oorsprong (x0, y0). */
  private localOf(c: number, x0: number, y0: number): number {
    const cy = idiv(c, this.w);
    return ((cy - y0) << this.shift) + (c - cy * this.w - x0);
  }

  /** Globale nummering van knopen en regio's, en de grensbuur van elke knoop. */
  private renumber(): void {
    const n = this.sx * this.sy;
    let nodes = 0;
    let regions = 0;
    for (let s = 0; s < n; s++) {
      this.nodeBase[s] = nodes;
      this.regionBase[s] = regions;
      nodes += this.sectors[s]!.nodeCell.length;
      regions += this.sectors[s]!.regions;
    }
    this.nodeBase[n] = nodes;
    this.regionBase[n] = regions;
    this.nodeCount = nodes;
    this.regionCount = regions;
    if (this.gNodeSec.length < nodes) {
      this.gNodeSec = new Int32Array(nodes);
      this.gNodeK = new Int32Array(nodes);
      this.gNodeCross = new Int32Array(nodes);
    }
    for (let s = 0; s < n; s++) {
      const sec = this.sectors[s]!;
      const base = this.nodeBase[s]!;
      for (let k = 0; k < sec.nodeCell.length; k++) {
        this.gNodeSec[base + k] = s;
        this.gNodeK[base + k] = k;
      }
      // oost-deel k hoort bij west-deel k van de oosterbuur, zuid-deel k bij noord-deel k van de zuiderbuur
      for (let k = sec.part[2]!; k < sec.part[3]!; k++) {
        const o = this.sectors[s + 1]!;
        const v = this.nodeBase[s + 1]! + o.part[1]! + (k - sec.part[2]!);
        this.gNodeCross[base + k] = v;
        this.gNodeCross[v] = base + k;
      }
      for (let k = sec.part[3]!; k < sec.part[4]!; k++) {
        const o = this.sectors[s + this.sx]!;
        const v = this.nodeBase[s + this.sx]! + o.part[0]! + (k - sec.part[3]!);
        this.gNodeCross[base + k] = v;
        this.gNodeCross[v] = base + k;
      }
    }
  }

  // ---------------------------------------------------------------- zoekopdracht per slot

  /** Zorgt dat slot s een lopende zoekopdracht heeft in de huidige graaf (start: venster-BFS en beginknopen). */
  private ensureSearch(s: number): SlotSearch {
    const q = this.search[s]!;
    if (q.epoch === this.epoch) return q;
    if (q.epoch !== -1) this.dropSearch(s);
    q.epoch = this.epoch;
    const nodes = this.nodeCount;
    if (q.g.length < nodes) {
      q.g = new Int32Array(nodes);
      q.done = new Uint8Array(nodes);
      q.heapNode = new Int32Array(nodes);
      q.heapPos = new Int32Array(nodes);
    }
    q.g.fill(-1, 0, nodes);
    q.done.fill(0, 0, nodes);
    q.heapPos.fill(-1, 0, nodes);
    q.heapSize = 0;
    if (q.regionField.length < this.regionCount) q.regionField = new Int32Array(this.regionCount);
    q.regionField.fill(-1, 0, this.regionCount);
    // doelvenster: sectoren die het doel (plus één cel) raken, plus één sector rand
    const gx0 = Math.max(0, this.tx0[s]! - 1);
    const gy0 = Math.max(0, this.ty0[s]! - 1);
    const gx1 = Math.min(this.w - 1, this.tx0[s]! + this.tw[s]!);
    const gy1 = Math.min(this.h - 1, this.ty0[s]! + this.th[s]!);
    q.ws0x = Math.max(0, (gx0 >> this.shift) - 1);
    q.ws0y = Math.max(0, (gy0 >> this.shift) - 1);
    q.ws1x = Math.min(this.sx - 1, (gx1 >> this.shift) + 1);
    q.ws1y = Math.min(this.sy - 1, (gy1 >> this.shift) + 1);
    q.wx0 = q.ws0x << this.shift;
    q.wy0 = q.ws0y << this.shift;
    q.ww = Math.min(this.w, (q.ws1x + 1) << this.shift) - q.wx0;
    q.wh = Math.min(this.h, (q.ws1y + 1) << this.shift) - q.wy0;
    this.windowBfs(s, q);
    // beginknopen: knopen in het venster met hun vensterafstand
    for (let sy = q.ws0y; sy <= q.ws1y; sy++) {
      for (let sx = q.ws0x; sx <= q.ws1x; sx++) {
        const sec = sy * this.sx + sx;
        const cells = this.sectors[sec]!.nodeCell;
        const base = this.nodeBase[sec]!;
        for (let k = 0; k < cells.length; k++) {
          const c = cells[k]!;
          const cy = idiv(c, this.w);
          const v = q.win[(cy - q.wy0) * q.ww + (c - cy * this.w - q.wx0)]!;
          if (v >= 0) this.relax(q, base + k, v);
        }
      }
    }
    return q;
  }

  /** Exacte BFS (4-buren, begaanbare cellen) binnen het venster vanaf de doelrechthoek. */
  private windowBfs(s: number, q: SlotSearch): void {
    const ww = q.ww;
    const size = ww * q.wh;
    if (q.win.length < size) q.win = new Int32Array(size);
    if (this.winQ.length < size) this.winQ = new Int32Array(size);
    const d = q.win;
    d.fill(-1, 0, size);
    const queue = this.winQ;
    const walk = this.walk;
    const w = this.w;
    let qt = 0;
    const x0 = this.tx0[s]!;
    const y0 = this.ty0[s]!;
    const x1 = Math.min(this.w, x0 + this.tw[s]!);
    const y1 = Math.min(this.h, y0 + this.th[s]!);
    // zaadcellen: de hele doelrechthoek op 0, ook geblokkeerde cellen (zo wijst het veld naar de rand van een gebouw)
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const l = (y - q.wy0) * ww + (x - q.wx0);
        d[l] = 0;
        queue[qt++] = l;
      }
    }
    let qh = 0;
    while (qh < qt) {
      const l = queue[qh++]!;
      const ly = idiv(l, ww);
      const lx = l - ly * ww;
      const c = (q.wy0 + ly) * w + q.wx0 + lx;
      const nd = d[l]! + 1;
      if (lx + 1 < ww && walk[c + 1] === 1 && d[l + 1] === -1) {
        d[l + 1] = nd;
        queue[qt++] = l + 1;
      }
      if (lx > 0 && walk[c - 1] === 1 && d[l - 1] === -1) {
        d[l - 1] = nd;
        queue[qt++] = l - 1;
      }
      if (ly + 1 < q.wh && walk[c + w] === 1 && d[l + ww] === -1) {
        d[l + ww] = nd;
        queue[qt++] = l + ww;
      }
      if (ly > 0 && walk[c - w] === 1 && d[l - ww] === -1) {
        d[l - ww] = nd;
        queue[qt++] = l - ww;
      }
    }
  }

  private heapLess(q: SlotSearch, a: number, b: number): boolean {
    const ga = q.g[a]!;
    const gb = q.g[b]!;
    return ga < gb || (ga === gb && a < b);
  }

  private heapUp(q: SlotSearch, i0: number): void {
    const hn = q.heapNode;
    let i = i0;
    const v = hn[i]!;
    while (i > 0) {
      const p = (i - 1) >> 1;
      const u = hn[p]!;
      if (!this.heapLess(q, v, u)) break;
      hn[i] = u;
      q.heapPos[u] = i;
      i = p;
    }
    hn[i] = v;
    q.heapPos[v] = i;
  }

  private heapDown(q: SlotSearch, i0: number): void {
    const hn = q.heapNode;
    const n = q.heapSize;
    let i = i0;
    const v = hn[i]!;
    for (;;) {
      const l = 2 * i + 1;
      if (l >= n) break;
      const r = l + 1;
      const c = r < n && this.heapLess(q, hn[r]!, hn[l]!) ? r : l;
      if (!this.heapLess(q, hn[c]!, v)) break;
      hn[i] = hn[c]!;
      q.heapPos[hn[i]!] = i;
      i = c;
    }
    hn[i] = v;
    q.heapPos[v] = i;
  }

  private relax(q: SlotSearch, v: number, d: number): void {
    if (q.done[v] === 1) return;
    const old = q.g[v]!;
    if (old !== -1 && old <= d) return;
    q.g[v] = d;
    if (q.heapPos[v] === -1) {
      q.heapNode[q.heapSize] = v;
      q.heapPos[v] = q.heapSize;
      q.heapSize++;
    }
    this.heapUp(q, q.heapPos[v]!);
  }

  /** Eén knoop definitief maken (Dijkstra, vaste tiebreak op knoopindex) en zijn buren ontspannen. */
  private settleOne(q: SlotSearch): void {
    const u = q.heapNode[0]!;
    q.heapSize--;
    q.heapPos[u] = -1;
    if (q.heapSize > 0) {
      q.heapNode[0] = q.heapNode[q.heapSize]!;
      q.heapPos[q.heapNode[0]!] = 0;
      this.heapDown(q, 0);
    }
    q.done[u] = 1;
    const gu = q.g[u]!;
    const cross = this.gNodeCross[u]!;
    this.relax(q, cross, gu + 1);
    const s = this.gNodeSec[u]!;
    const sec = this.sectors[s]!;
    const k = this.gNodeK[u]!;
    const base = this.nodeBase[s]!;
    const end = sec.adjStart[k + 1]!;
    for (let e = sec.adjStart[k]!; e < end; e++) {
      const v = base + sec.adjNode[e]!;
      if (q.done[v] === 0) this.relax(q, v, gu + sec.adjCost[e]!);
    }
  }

  /** Dijkstra doorzetten tot alle knopen van regio r in sector sec definitief zijn (of niets meer bereikbaar is). */
  private settleRegion(q: SlotSearch, sec: number, r: number): void {
    const S = this.sectors[sec]!;
    const base = this.nodeBase[sec]!;
    for (let k = 0; k < S.nodeCell.length; k++) {
      if (S.nodeRegion[k] !== r) continue;
      while (q.done[base + k] === 0 && q.heapSize > 0) this.settleOne(q);
    }
  }

  // ---------------------------------------------------------------- regiovelden

  private allocField(): number {
    if (this.poolFreeTop > 0) return this.poolFree[--this.poolFreeTop]!;
    if (this.poolTop < this.poolCap) {
      const need = (this.poolTop + 1) * this.S2;
      if (this.pool.length < need) {
        const grown = new Int32Array(
          Math.min(this.poolCap * this.S2, Math.max(need, this.pool.length * 2)),
        );
        grown.set(this.pool);
        this.pool = grown;
      }
      return this.poolTop++;
    }
    // vol: verdring rond de klok, nooit een veld dat in deze vraag al gebruikt wordt
    for (;;) {
      const p = this.clock;
      this.clock = this.clock + 1 === this.poolCap ? 0 : this.clock + 1;
      if (this.poolStamp[p] === this.stamp) continue;
      const owner = this.poolSlot[p]!;
      if (owner >= 0) {
        const rf = this.search[owner]!.regionField;
        if (rf[this.poolRegion[p]!] === p) rf[this.poolRegion[p]!] = -1;
        this.poolSlot[p] = -1;
      }
      return p;
    }
  }

  /** Bouwt het regioveld van slot s voor lokale regio r van sector sec (globale regio gr). Geeft de pool-index. */
  private buildField(s: number, q: SlotSearch, sec: number, r: number, gr: number): number {
    this.settleRegion(q, sec, r);
    const p = this.allocField();
    this.poolSlot[p] = s;
    this.poolRegion[p] = gr;
    this.poolStamp[p] = this.stamp;
    q.regionField[gr] = p;
    const off = p * this.S2;
    const out = this.pool;
    out.fill(-1, off, off + this.S2);
    const S = this.sectors[sec]!;
    const base = this.nodeBase[sec]!;
    // zaden: de knopen van deze regio met hun afstand, oplopend (afstand, knoop)
    let ns = 0;
    const nn = S.nodeCell.length;
    if (this.seedV.length < nn) {
      this.seedV = new Int32Array(nn);
      this.seedC = new Int32Array(nn);
    }
    for (let k = 0; k < nn; k++) {
      if (S.nodeRegion[k] !== r) continue;
      const v = q.g[base + k]!;
      if (v < 0) continue;
      let i = ns++;
      while (i > 0 && this.seedV[i - 1]! > v) {
        this.seedV[i] = this.seedV[i - 1]!;
        this.seedC[i] = this.seedC[i - 1]!;
        i--;
      }
      this.seedV[i] = v;
      this.seedC[i] = S.nodeCell[k]!;
    }
    const x0 = this.secX0(sec);
    const y0 = this.secY0(sec);
    const x1 = Math.min(this.w, x0 + this.S);
    const y1 = Math.min(this.h, y0 + this.S);
    const w = this.w;
    const reg = this.regLocal;
    const queue = this.scratchQ;
    let qh = 0;
    let qt = 0;
    let si = 0;
    // BFS met meerdere zaden van verschillende waarde: steeds de kleinste van (volgend zaad, kop van de rij)
    for (;;) {
      let l: number;
      if (si < ns && (qh === qt || this.seedV[si]! <= out[off + queue[qh]!]!)) {
        const c = this.seedC[si]!;
        const v = this.seedV[si]!;
        si++;
        const cy = idiv(c, w);
        l = ((cy - y0) << this.shift) + (c - cy * w - x0);
        if (out[off + l] !== -1) continue;
        out[off + l] = v;
      } else if (qh < qt) {
        l = queue[qh++]!;
      } else break;
      const ly = l >> this.shift;
      const lx = l & this.mask;
      const c = (y0 + ly) * w + x0 + lx;
      const nd = out[off + l]! + 1;
      if (x0 + lx + 1 < x1 && reg[c + 1] === r && out[off + l + 1] === -1) {
        out[off + l + 1] = nd;
        queue[qt++] = l + 1;
      }
      if (lx > 0 && reg[c - 1] === r && out[off + l - 1] === -1) {
        out[off + l - 1] = nd;
        queue[qt++] = l - 1;
      }
      if (y0 + ly + 1 < y1 && reg[c + w] === r && out[off + l + this.S] === -1) {
        out[off + l + this.S] = nd;
        queue[qt++] = l + this.S;
      }
      if (ly > 0 && reg[c - w] === r && out[off + l - this.S] === -1) {
        out[off + l - this.S] = nd;
        queue[qt++] = l - this.S;
      }
    }
    // in het doelvenster: het minimum met de exacte vensterafstand
    const ssx = x0 >> this.shift;
    const ssy = y0 >> this.shift;
    if (ssx >= q.ws0x && ssx <= q.ws1x && ssy >= q.ws0y && ssy <= q.ws1y) {
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          if (reg[y * w + x] !== r) continue;
          const v = q.win[(y - q.wy0) * q.ww + (x - q.wx0)]!;
          if (v < 0) continue;
          const l = off + ((y - y0) << this.shift) + (x - x0);
          if (out[l] === -1 || v < out[l]!) out[l] = v;
        }
      }
    }
    return p;
  }

  /** Waarde V van cel (x, y) in slot s (begaanbare cel), DIST_UNKNOWN als het doel er niet bereikbaar is. */
  private valueAt(s: number, q: SlotSearch, x: number, y: number): number {
    const c = y * this.w + x;
    const lr = this.regLocal[c]!;
    if (lr === NO_REGION) return DIST_UNKNOWN;
    const sec = (y >> this.shift) * this.sx + (x >> this.shift);
    const gr = this.regionBase[sec]! + lr;
    let p = q.regionField[gr]!;
    if (p < 0) p = this.buildField(s, q, sec, lr, gr);
    else this.poolStamp[p] = this.stamp;
    return this.pool[p * this.S2 + ((y & this.mask) << this.shift) + (x & this.mask)]!;
  }

  /**
   * Of het veld van slot s cel `cell` al kent, zonder iets op te bouwen (meting en debug; de sim leest dit niet).
   */
  guides(s: number, cell: number): boolean {
    if (s === NO_FIELD || this.active[s] !== 1 || this.graphDirty) return false;
    const q = this.search[s]!;
    if (q.epoch !== this.epoch) return false;
    const lr = this.regLocal[cell]!;
    if (lr === NO_REGION) return false;
    const y = idiv(cell, this.w);
    const x = cell - y * this.w;
    const sec = (y >> this.shift) * this.sx + (x >> this.shift);
    const p = q.regionField[this.regionBase[sec]! + lr]!;
    return (
      p >= 0 && this.pool[p * this.S2 + ((y & this.mask) << this.shift) + (x & this.mask)]! >= 0
    );
  }

  /** Afstand (in cellen, langs het veld) van cel tot het doel van slot s, DIST_UNKNOWN als onbereikbaar. Tests. */
  distance(s: number, cell: number): number {
    this.ensureGraph();
    this.nextStamp();
    const q = this.ensureSearch(s);
    const y = idiv(cell, this.w);
    const x = cell - y * this.w;
    const tx = this.tx0[s]!;
    const ty = this.ty0[s]!;
    if (x >= tx && x < tx + this.tw[s]! && y >= ty && y < ty + this.th[s]!) return 0;
    return this.valueAt(s, q, x, y);
  }

  /** Nieuwe vraag: velden met deze stempel worden in deze vraag niet verdrongen (alleen snelheid, nooit de uitkomst). */
  private nextStamp(): void {
    this.stamp = this.stamp === 0x7fffffff ? 1 : this.stamp + 1;
  }

  /** Bytes in gebruik door de padvinding (meting). */
  memoryBytes(): number {
    let b = this.regLocal.byteLength + this.dirty.byteLength;
    b += this.nodeBase.byteLength + this.regionBase.byteLength;
    b += this.gNodeSec.byteLength + this.gNodeK.byteLength + this.gNodeCross.byteLength;
    for (const sec of this.sectors) {
      b +=
        sec.eastA.byteLength + sec.eastB.byteLength + sec.southA.byteLength + sec.southB.byteLength;
      b += sec.nodeCell.byteLength + sec.nodeRegion.byteLength + sec.nodeDist.byteLength + 20;
      b += sec.adjStart.byteLength + sec.adjNode.byteLength + sec.adjCost.byteLength;
    }
    for (const q of this.search) {
      b += q.g.byteLength + q.done.byteLength + q.heapNode.byteLength + q.heapPos.byteLength;
      b += q.regionField.byteLength + q.win.byteLength;
    }
    b += this.pool.byteLength + this.poolSlot.byteLength * 4;
    return b;
  }

  /**
   * Beste volgende cel vanaf `cell` in veld s: de buur (8 richtingen, diagonaal alleen als beide rechte buren
   * begaanbaar zijn) met de laagste waarde; gelijke waarde: de eerste in vaste volgorde.
   * Geeft `cell` zelf als er geen betere begaanbare buur is (doel bereikt), -1 als het doel vanaf deze cel onbereikbaar is.
   */
  nextCell(s: number, cell: number): number {
    this.ensureGraph();
    this.nextStamp();
    const q = this.ensureSearch(s);
    const w = this.w;
    const cy = idiv(cell, w);
    const cx = cell - cy * w;
    const tx = this.tx0[s]!;
    const ty = this.ty0[s]!;
    if (cx >= tx && cx < tx + this.tw[s]! && cy >= ty && cy < ty + this.th[s]!) return cell;
    if (this.walk[cell] !== 1) return -1;
    const here = this.valueAt(s, q, cx, cy);
    if (here === DIST_UNKNOWN) return -1;
    if (here === 0) return cell;
    const pass = this.walk;
    const pE = cx + 1 < w && pass[cell + 1] === 1;
    const pW = cx > 0 && pass[cell - 1] === 1;
    const pS = cy + 1 < this.h && pass[cell + w] === 1;
    const pN = cy > 0 && pass[cell - w] === 1;
    // Kandidaten in vaste volgorde: O, W, Z, N, ZO, ZW, NO, NW. Strikt kleiner wint, dus gelijke afstand houdt de eerste.
    let best = cell;
    let bestD = here;
    let d = 0;
    if (pE) {
      d = this.valueAt(s, q, cx + 1, cy);
      if (d !== DIST_UNKNOWN && d < bestD) {
        bestD = d;
        best = cell + 1;
      }
    }
    if (pW) {
      d = this.valueAt(s, q, cx - 1, cy);
      if (d !== DIST_UNKNOWN && d < bestD) {
        bestD = d;
        best = cell - 1;
      }
    }
    if (pS) {
      d = this.valueAt(s, q, cx, cy + 1);
      if (d !== DIST_UNKNOWN && d < bestD) {
        bestD = d;
        best = cell + w;
      }
    }
    if (pN) {
      d = this.valueAt(s, q, cx, cy - 1);
      if (d !== DIST_UNKNOWN && d < bestD) {
        bestD = d;
        best = cell - w;
      }
    }
    if (pE && pS && pass[cell + w + 1] === 1) {
      d = this.valueAt(s, q, cx + 1, cy + 1);
      if (d !== DIST_UNKNOWN && d < bestD) {
        bestD = d;
        best = cell + w + 1;
      }
    }
    if (pW && pS && pass[cell + w - 1] === 1) {
      d = this.valueAt(s, q, cx - 1, cy + 1);
      if (d !== DIST_UNKNOWN && d < bestD) {
        bestD = d;
        best = cell + w - 1;
      }
    }
    if (pE && pN && pass[cell - w + 1] === 1) {
      d = this.valueAt(s, q, cx + 1, cy - 1);
      if (d !== DIST_UNKNOWN && d < bestD) {
        bestD = d;
        best = cell - w + 1;
      }
    }
    if (pW && pN && pass[cell - w - 1] === 1) {
      d = this.valueAt(s, q, cx - 1, cy - 1);
      if (d !== DIST_UNKNOWN && d < bestD) {
        bestD = d;
        best = cell - w - 1;
      }
    }
    return best;
  }
}
