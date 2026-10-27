import { NO_FIELD } from './ecs/world.js';
import { idiv } from './math/int.js';
import {
  DIST_UNKNOWN,
  EMPTY,
  MAX_FLOW_FIELDS,
  MIN_POOL_FIELDS,
  NO_REGION,
  Sector,
  SlotSearch,
} from './flowfield.base.js';
import type { PathTuning } from './flowfield.base.js';
import { valueAt } from './flowfield.fields.js';
import { ensureGraph } from './flowfield.graph.js';
import { dropSearch, ensureSearch } from './flowfield.search.js';

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

export { MAX_FLOW_FIELDS, DIST_UNKNOWN } from './flowfield.base.js';
export type { PathTuning } from './flowfield.base.js';

export class FlowFields {
  readonly w: number;
  readonly h: number;
  readonly cells: number;
  /** Actuele begaanbaarheid (map plus gebouwen), gedeeld met de sim. */
  readonly walk: Uint8Array;

  // State (geserialiseerd en gehasht)
  readonly active = new Uint8Array(MAX_FLOW_FIELDS);
  readonly tx0 = new Int32Array(MAX_FLOW_FIELDS);
  readonly ty0 = new Int32Array(MAX_FLOW_FIELDS);
  readonly tw = new Int32Array(MAX_FLOW_FIELDS);
  readonly th = new Int32Array(MAX_FLOW_FIELDS);

  // Afgeleid
  readonly refcount = new Int32Array(MAX_FLOW_FIELDS);

  // Internal: the fields below (and `walk`) are not an API; they are public only so that the sibling modules
  // flowfield.graph/nodes/search/fields.ts, which hold the method bodies, can read and write them.

  // Sectoren
  readonly shift: number;
  readonly S: number;
  readonly mask: number;
  readonly S2: number;
  readonly entranceMax: number;
  readonly sx: number;
  readonly sy: number;
  readonly sectors: Sector[] = [];
  /** Per cel de lokale regio binnen zijn sector, NO_REGION voor een onbegaanbare cel. */
  readonly regLocal: Uint16Array;
  readonly dirty: Uint8Array;
  graphDirty = true;
  epoch = 0;

  // Globale nummering (na elke herbouw van de graaf)
  readonly nodeBase: Int32Array;
  readonly regionBase: Int32Array;
  nodeCount = 0;
  regionCount = 0;
  /** Duurste rand van de knopengraaf (minstens 1, de oversteek van een grens); maat van de emmerring van Dijkstra. */
  maxEdge = 1;
  gNodeSec: Int32Array = EMPTY;
  gNodeK: Int32Array = EMPTY;
  gNodeCross: Int32Array = EMPTY;

  // Zoekopdrachten en regiovelden
  readonly search: SlotSearch[] = [];
  readonly poolCap: number;
  pool: Int32Array = EMPTY;
  poolTop = 0;
  readonly poolSlot: Int32Array;
  readonly poolRegion: Int32Array;
  readonly poolStamp: Int32Array;
  readonly poolFree: Int32Array;
  poolFreeTop = 0;
  clock = 0;
  stamp = 1;

  // Kladruimte
  readonly scratchQ: Int32Array;
  readonly scratchD: Int32Array;
  readonly scratchT: Uint8Array;
  readonly oldPart = new Int32Array(5);
  seedV: Int32Array = new Int32Array(64);
  seedC: Int32Array = new Int32Array(64);
  winQ: Int32Array = EMPTY;

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
    ensureGraph(this);
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
    dropSearch(this, s);
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
    this.dropCaches();
    this.freeUnusedSlots();
  }

  /** Alle afgeleide caches vervallen: zoekopdrachten beginnen opnieuw, de pool is leeg. */
  private dropCaches(): void {
    this.epoch++;
    this.poolTop = 0;
    this.poolFreeTop = 0;
    this.poolSlot.fill(-1);
    for (let s = 0; s < MAX_FLOW_FIELDS; s++) this.search[s]!.epoch = -1;
  }

  /** Slots die geen unit gebruikt, vallen vrij (state). */
  private freeUnusedSlots(): void {
    for (let s = 0; s < MAX_FLOW_FIELDS; s++) {
      if (this.active[s] !== 1 || this.refcount[s] !== 0) continue;
      this.active[s] = 0;
      this.tx0[s] = 0;
      this.ty0[s] = 0;
      this.tw[s] = 0;
      this.th[s] = 0;
    }
  }

  /** Na deserialize: de afgeleide graaf en caches opnieuw. De state zelf (slots) is al geladen en blijft staan. */
  rebuild(): void {
    this.dirty.fill(1);
    this.graphDirty = true;
    this.dropCaches();
    ensureGraph(this);
  }

  /** Systeem 3: de graaf bijwerken voor de sectoren die sinds de vorige tick zijn veranderd. */
  step(): void {
    ensureGraph(this);
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
    ensureGraph(this);
    this.nextStamp();
    const q = ensureSearch(this, s);
    const y = idiv(cell, this.w);
    const x = cell - y * this.w;
    const tx = this.tx0[s]!;
    const ty = this.ty0[s]!;
    if (x >= tx && x < tx + this.tw[s]! && y >= ty && y < ty + this.th[s]!) return 0;
    return valueAt(this, s, q, x, y);
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
      b +=
        q.g.byteLength +
        q.done.byteLength +
        q.next.byteLength +
        q.prev.byteLength +
        q.head.byteLength;
      b += q.regionField.byteLength + q.win.byteLength;
    }
    b += this.pool.byteLength + this.poolSlot.byteLength * 4;
    return b;
  }

  /**
   * Beste volgende cel vanaf `cell` in veld s: de buur (8 richtingen, diagonaal alleen als beide rechte buren
   * begaanbaar zijn) met de laagste waarde; bij gelijke waarde de buur die hemelsbreed het dichtst bij het midden van de
   * doelrechthoek ligt (xl-int: zo kiezen twee spelers op een puntsymmetrische map elkaars spiegelbeeld), dan de buur
   * rechts van de richting naar het doel (fair-ronde), dan de eerste in vaste volgorde. Geeft `cell` zelf als er geen
   * betere begaanbare buur is (doel bereikt), -1 als het doel vanaf deze cel onbereikbaar is.
   */
  nextCell(s: number, cell: number): number {
    ensureGraph(this);
    this.nextStamp();
    const q = ensureSearch(this, s);
    const w = this.w;
    const cy = idiv(cell, w);
    const cx = cell - cy * w;
    const tx = this.tx0[s]!;
    const ty = this.ty0[s]!;
    if (cx >= tx && cx < tx + this.tw[s]! && cy >= ty && cy < ty + this.th[s]!) return cell;
    if (this.walk[cell] !== 1) return -1;
    const here = valueAt(this, s, q, cx, cy);
    if (here === DIST_UNKNOWN) return -1;
    if (here === 0) return cell;
    const pass = this.walk;
    const pE = cx + 1 < w && pass[cell + 1] === 1;
    const pW = cx > 0 && pass[cell - 1] === 1;
    const pS = cy + 1 < this.h && pass[cell + w] === 1;
    const pN = cy > 0 && pass[cell - w] === 1;
    // midden van de doelrechthoek in halve cellen; afstand van een buur (dx, dy) erheen ook in halve cellen
    const gx = 2 * tx + this.tw[s]! - 1 - 2 * cx;
    const gy = 2 * ty + this.th[s]! - 1 - 2 * cy;
    // Kandidaten in vaste volgorde: O, W, Z, N, ZO, ZW, NO, NW.
    let best = cell;
    let bestD = here;
    let bestE = 0;
    let bestX = 0;
    const consider = (ok: boolean, dx: number, dy: number): void => {
      if (!ok) return;
      const d = valueAt(this, s, q, cx + dx, cy + dy);
      if (d === DIST_UNKNOWN || d > bestD || (d === bestD && best === cell)) return;
      const ex = gx - 2 * dx;
      const ey = gy - 2 * dy;
      const e = ex * ex + ey * ey;
      // ook gelijk hemelsbreed: de buur rechts van de richting naar het doel (kruisproduct, blijft gelijk onder de
      // 180-gradenspiegel, de vaste volgorde niet)
      const x = gx * dy - gy * dx;
      if (d < bestD || e < bestE || (e === bestE && x > bestX)) {
        bestD = d;
        bestE = e;
        bestX = x;
        best = cell + dy * w + dx;
      }
    };
    consider(pE, 1, 0);
    consider(pW, -1, 0);
    consider(pS, 0, 1);
    consider(pN, 0, -1);
    consider(pE && pS && pass[cell + w + 1] === 1, 1, 1);
    consider(pW && pS && pass[cell + w - 1] === 1, -1, 1);
    consider(pE && pN && pass[cell - w + 1] === 1, 1, -1);
    consider(pW && pN && pass[cell - w - 1] === 1, -1, -1);
    return best;
  }
}
