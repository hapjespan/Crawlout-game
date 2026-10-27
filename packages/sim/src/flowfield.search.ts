// Split from flowfield.ts to stay under the 5,000-token file limit; flowfield.ts re-exports the public surface.
// The search per slot: target window BFS and the lazy Dijkstra over the node graph.
import { idiv } from './math/int.js';
import type { SlotSearch } from './flowfield.base.js';
import type { FlowFields } from './flowfield.js';

/** De zoekopdracht van slot s vervalt; zijn regiovelden gaan terug naar de pool. */
export function dropSearch(ff: FlowFields, s: number): void {
  const q = ff.search[s]!;
  if (q.epoch !== ff.epoch) {
    q.epoch = -1;
    return;
  }
  const rf = q.regionField;
  for (let r = 0; r < ff.regionCount; r++) {
    const p = rf[r]!;
    if (p >= 0 && ff.poolSlot[p] === s && ff.poolRegion[p] === r) {
      ff.poolSlot[p] = -1;
      ff.poolFree[ff.poolFreeTop++] = p;
    }
  }
  q.epoch = -1;
}

/** Zorgt dat slot s een lopende zoekopdracht heeft in de huidige graaf (start: venster-BFS en beginknopen). */
export function ensureSearch(ff: FlowFields, s: number): SlotSearch {
  const q = ff.search[s]!;
  if (q.epoch === ff.epoch) return q;
  if (q.epoch !== -1) dropSearch(ff, s);
  q.epoch = ff.epoch;
  const nodes = ff.nodeCount;
  if (q.g.length < nodes) {
    q.g = new Int32Array(nodes);
    q.done = new Uint8Array(nodes);
    q.next = new Int32Array(nodes);
    q.prev = new Int32Array(nodes);
  }
  q.g.fill(-1, 0, nodes);
  q.done.fill(0, 0, nodes);
  q.cur = 0;
  q.queued = 0;
  if (q.regionField.length < ff.regionCount) q.regionField = new Int32Array(ff.regionCount);
  q.regionField.fill(-1, 0, ff.regionCount);
  // doelvenster: sectoren die het doel (plus één cel) raken, plus één sector rand
  const gx0 = Math.max(0, ff.tx0[s]! - 1);
  const gy0 = Math.max(0, ff.ty0[s]! - 1);
  const gx1 = Math.min(ff.w - 1, ff.tx0[s]! + ff.tw[s]!);
  const gy1 = Math.min(ff.h - 1, ff.ty0[s]! + ff.th[s]!);
  q.ws0x = Math.max(0, (gx0 >> ff.shift) - 1);
  q.ws0y = Math.max(0, (gy0 >> ff.shift) - 1);
  q.ws1x = Math.min(ff.sx - 1, (gx1 >> ff.shift) + 1);
  q.ws1y = Math.min(ff.sy - 1, (gy1 >> ff.shift) + 1);
  q.wx0 = q.ws0x << ff.shift;
  q.wy0 = q.ws0y << ff.shift;
  q.ww = Math.min(ff.w, (q.ws1x + 1) << ff.shift) - q.wx0;
  q.wh = Math.min(ff.h, (q.ws1y + 1) << ff.shift) - q.wy0;
  windowBfs(ff, s, q);
  // beginknopen: knopen in het venster met hun vensterafstand (eerst de grootste, voor de maat van de emmerring)
  let span = ff.maxEdge;
  for (let pass = 0; pass < 2; pass++) {
    if (pass === 1) {
      let b = 1;
      while (b <= span) b <<= 1;
      if (q.head.length < b) q.head = new Int32Array(b);
      q.head.fill(-1, 0, b);
      q.bucketMask = b - 1;
    }
    for (let sy = q.ws0y; sy <= q.ws1y; sy++) {
      for (let sx = q.ws0x; sx <= q.ws1x; sx++) {
        const sec = sy * ff.sx + sx;
        const cells = ff.sectors[sec]!.nodeCell;
        const base = ff.nodeBase[sec]!;
        for (let k = 0; k < cells.length; k++) {
          const c = cells[k]!;
          const cy = idiv(c, ff.w);
          const v = q.win[(cy - q.wy0) * q.ww + (c - cy * ff.w - q.wx0)]!;
          if (v < 0) continue;
          if (pass === 0) {
            if (v > span) span = v;
          } else relax(ff, q, base + k, v);
        }
      }
    }
  }
  return q;
}

/** Exacte BFS (4-buren, begaanbare cellen) binnen het venster vanaf de doelrechthoek. */
export function windowBfs(ff: FlowFields, s: number, q: SlotSearch): void {
  const ww = q.ww;
  const size = ww * q.wh;
  if (q.win.length < size) q.win = new Int32Array(size);
  if (ff.winQ.length < size) ff.winQ = new Int32Array(size);
  const d = q.win;
  d.fill(-1, 0, size);
  const queue = ff.winQ;
  const walk = ff.walk;
  const w = ff.w;
  let qt = 0;
  const x0 = ff.tx0[s]!;
  const y0 = ff.ty0[s]!;
  const x1 = Math.min(ff.w, x0 + ff.tw[s]!);
  const y1 = Math.min(ff.h, y0 + ff.th[s]!);
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

/** Knoop v in emmer b (vooraan). */
export function link(q: SlotSearch, v: number, b: number): void {
  const n = q.head[b]!;
  q.next[v] = n;
  q.prev[v] = -1;
  if (n >= 0) q.prev[n] = v;
  q.head[b] = v;
  q.queued++;
}

/** Knoop v uit emmer b. */
export function unlink(q: SlotSearch, v: number, b: number): void {
  const p = q.prev[v]!;
  const n = q.next[v]!;
  if (p >= 0) q.next[p] = n;
  else q.head[b] = n;
  if (n >= 0) q.prev[n] = p;
  q.queued--;
}

export function relax(ff: FlowFields, q: SlotSearch, v: number, d: number): void {
  if (q.done[v] === 1) return;
  const old = q.g[v]!;
  if (old !== -1) {
    if (old <= d) return;
    unlink(q, v, old & q.bucketMask);
  }
  q.g[v] = d;
  link(q, v, d & q.bucketMask);
}

/**
 * Eén knoop definitief maken (Dijkstra) en zijn buren ontspannen: een knoop met de kleinste voorlopige afstand. Bij
 * gelijke afstand maakt de volgorde voor geen enkele waarde uit (Dijkstra geeft elke knoop zijn exacte afstand), alleen
 * hoe ver een luie zoekopdracht al is; niets in de sim leest dat.
 */
export function settleOne(ff: FlowFields, q: SlotSearch): void {
  const mask = q.bucketMask;
  let b = q.cur & mask;
  while (q.head[b] === -1) {
    q.cur++;
    b = q.cur & mask;
  }
  const u = q.head[b]!;
  unlink(q, u, b);
  q.done[u] = 1;
  const gu = q.g[u]!;
  const cross = ff.gNodeCross[u]!;
  relax(ff, q, cross, gu + 1);
  const s = ff.gNodeSec[u]!;
  const sec = ff.sectors[s]!;
  const k = ff.gNodeK[u]!;
  const base = ff.nodeBase[s]!;
  const end = sec.adjStart[k + 1]!;
  const adjNode = sec.adjNode;
  const adjCost = sec.adjCost;
  for (let e = sec.adjStart[k]!; e < end; e++) {
    const v = base + adjNode[e]!;
    if (q.done[v] === 0) relax(ff, q, v, gu + adjCost[e]!);
  }
}

/** Dijkstra doorzetten tot alle knopen van regio r in sector sec definitief zijn (of niets meer bereikbaar is). */
export function settleRegion(ff: FlowFields, q: SlotSearch, sec: number, r: number): void {
  const S = ff.sectors[sec]!;
  const base = ff.nodeBase[sec]!;
  for (let k = 0; k < S.nodeCell.length; k++) {
    if (S.nodeRegion[k] !== r) continue;
    while (q.done[base + k] === 0 && q.queued > 0) settleOne(ff, q);
  }
}
