// Split from flowfield.ts to stay under the 5,000-token file limit; flowfield.ts re-exports the public surface.
// The graph: regions and border entrances per sector, global numbering, incremental rebuild.
import { idiv } from './math/int.js';
import { EMPTY, NO_REGION, secX0, secY0 } from './flowfield.base.js';
import { computeNodes } from './flowfield.nodes.js';
import type { FlowFields } from './flowfield.js';

export function ensureGraph(ff: FlowFields): void {
  if (!ff.graphDirty) return;
  const n = ff.sx * ff.sy;
  for (let s = 0; s < n; s++) if (ff.dirty[s] === 1) computeRegions(ff, s);
  // grenzen van vuile sectoren (en de grenzen die de buren met hen delen)
  for (let s = 0; s < n; s++) {
    if (ff.dirty[s] !== 1) continue;
    const x = s - idiv(s, ff.sx) * ff.sx;
    computeBorders(ff, s);
    if (x > 0) computeBorders(ff, s - 1);
    if (s >= ff.sx) computeBorders(ff, s - ff.sx);
  }
  // knopen van vuile sectoren en hun vier buren
  const nodesDirty = new Uint8Array(n);
  for (let s = 0; s < n; s++) {
    if (ff.dirty[s] !== 1) continue;
    const x = s - idiv(s, ff.sx) * ff.sx;
    nodesDirty[s] = 1;
    if (x > 0) nodesDirty[s - 1] = 1;
    if (x + 1 < ff.sx) nodesDirty[s + 1] = 1;
    if (s >= ff.sx) nodesDirty[s - ff.sx] = 1;
    if (s + ff.sx < n) nodesDirty[s + ff.sx] = 1;
  }
  for (let s = 0; s < n; s++) if (nodesDirty[s] === 1) computeNodes(ff, s, ff.dirty[s] === 1);
  ff.dirty.fill(0);
  renumber(ff);
  ff.graphDirty = false;
}

/** Regio's van sector s: flood fill (4-buren) binnen de sector, in rijvolgorde genummerd. */
export function computeRegions(ff: FlowFields, s: number): void {
  const x0 = secX0(ff, s);
  const y0 = secY0(ff, s);
  const x1 = Math.min(ff.w, x0 + ff.S);
  const y1 = Math.min(ff.h, y0 + ff.S);
  const w = ff.w;
  const walk = ff.walk;
  const reg = ff.regLocal;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) reg[y * w + x] = NO_REGION;
  const stack = ff.scratchQ;
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
  const sec = ff.sectors[s]!;
  sec.regions = count;
  // rechthoek: het aantal begaanbare cellen is het oppervlak van hun omhullende
  let walkable = 0;
  let bx0 = x1;
  let by0 = y1;
  let bx1 = x0 - 1;
  let by1 = y0 - 1;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      if (walk[y * w + x] !== 1) continue;
      walkable++;
      if (x < bx0) bx0 = x;
      if (x > bx1) bx1 = x;
      if (y < by0) by0 = y;
      if (y > by1) by1 = y;
    }
  sec.open = walkable > 0 && walkable === (bx1 - bx0 + 1) * (by1 - by0 + 1);
}

/** Ingangen op de oost- en zuidgrens van sector s (als die buur er is). */
export function computeBorders(ff: FlowFields, s: number): void {
  const sec = ff.sectors[s]!;
  const x0 = secX0(ff, s);
  const y0 = secY0(ff, s);
  const x1 = Math.min(ff.w, x0 + ff.S);
  const y1 = Math.min(ff.h, y0 + ff.S);
  const w = ff.w;
  const walk = ff.walk;
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
      // [k, e) open: opknippen in stukken van hoogstens entranceMax, met per stuk een ingang in het midden.
      // Spiegelsymmetrisch (fair-ronde): de 180-gradenspiegel van een puntsymmetrische map legt deze grens op een
      // andere grens met hetzelfde open stuk achterstevoren, dus de ingangen van een stuk van lengte L moeten onder
      // omkeren (x -> L - 1 - x) op zichzelf vallen. Daarom zijn de knippunten symmetrisch (b(n - j) = L - b(j); geen
      // knip precies in het midden bij een oneven L), ligt het midden van een stuk van even lengte op de cel het
      // dichtst bij het midden van het open stuk, en krijgt een stuk van even lengte dat precies in het midden ligt
      // twee ingangen (beide middelste cellen).
      const len2 = e - k;
      let n = idiv(len2 + ff.entranceMax - 1, ff.entranceMax);
      if ((n & 1) === 0 && (len2 & 1) === 1) n++;
      const cut = (j: number): number =>
        2 * j <= n ? idiv(j * len2, n) : len2 - idiv((n - j) * len2, n);
      const push = (x: number): void => {
        const c = cellA(k + x);
        a.push(c);
        b.push(c + d);
      };
      for (let j = 0; j < n; j++) {
        const p = cut(j);
        const q = cut(j + 1);
        const m = q - p;
        if ((m & 1) === 1) {
          push(p + (m >> 1));
          continue;
        }
        const lo = p + (m >> 1) - 1;
        // side < 0: lo + 1 ligt dichter bij het midden van het open stuk; 0: het stuk ligt precies in het midden
        const side = 2 * lo + 1 - (len2 - 1);
        if (side === 0) {
          push(lo);
          push(lo + 1);
        } else push(side < 0 ? lo + 1 : lo);
      }
      k = e;
    }
  };
  if (x1 < ff.w) {
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
  if (y1 < ff.h) {
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

/** Globale nummering van knopen en regio's, en de grensbuur van elke knoop. */
export function renumber(ff: FlowFields): void {
  const n = ff.sx * ff.sy;
  let nodes = 0;
  let regions = 0;
  for (let s = 0; s < n; s++) {
    ff.nodeBase[s] = nodes;
    ff.regionBase[s] = regions;
    nodes += ff.sectors[s]!.nodeCell.length;
    regions += ff.sectors[s]!.regions;
  }
  ff.nodeBase[n] = nodes;
  ff.regionBase[n] = regions;
  ff.nodeCount = nodes;
  ff.regionCount = regions;
  let maxEdge = 1;
  for (let s = 0; s < n; s++) {
    const cost = ff.sectors[s]!.adjCost;
    for (let e = 0; e < cost.length; e++) if (cost[e]! > maxEdge) maxEdge = cost[e]!;
  }
  ff.maxEdge = maxEdge;
  if (ff.gNodeSec.length < nodes) {
    ff.gNodeSec = new Int32Array(nodes);
    ff.gNodeK = new Int32Array(nodes);
    ff.gNodeCross = new Int32Array(nodes);
  }
  for (let s = 0; s < n; s++) {
    const sec = ff.sectors[s]!;
    const base = ff.nodeBase[s]!;
    for (let k = 0; k < sec.nodeCell.length; k++) {
      ff.gNodeSec[base + k] = s;
      ff.gNodeK[base + k] = k;
    }
    // oost-deel k hoort bij west-deel k van de oosterbuur, zuid-deel k bij noord-deel k van de zuiderbuur
    for (let k = sec.part[2]!; k < sec.part[3]!; k++) {
      const o = ff.sectors[s + 1]!;
      const v = ff.nodeBase[s + 1]! + o.part[1]! + (k - sec.part[2]!);
      ff.gNodeCross[base + k] = v;
      ff.gNodeCross[v] = base + k;
    }
    for (let k = sec.part[3]!; k < sec.part[4]!; k++) {
      const o = ff.sectors[s + ff.sx]!;
      const v = ff.nodeBase[s + ff.sx]! + o.part[0]! + (k - sec.part[3]!);
      ff.gNodeCross[base + k] = v;
      ff.gNodeCross[v] = base + k;
    }
  }
}
