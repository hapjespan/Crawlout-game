// Split from flowfield.ts to stay under the 5,000-token file limit; flowfield.ts re-exports the public surface.
// Region fields: the bounded pool and the multi-seed BFS per (target, sector region).
import { idiv } from './math/int.js';
import { DIST_UNKNOWN, NO_REGION, secX0, secY0 } from './flowfield.base.js';
import type { SlotSearch } from './flowfield.base.js';
import { settleRegion } from './flowfield.search.js';
import type { FlowFields } from './flowfield.js';

export function allocField(ff: FlowFields): number {
  if (ff.poolFreeTop > 0) return ff.poolFree[--ff.poolFreeTop]!;
  if (ff.poolTop < ff.poolCap) {
    const need = (ff.poolTop + 1) * ff.S2;
    if (ff.pool.length < need) {
      const grown = new Int32Array(
        Math.min(ff.poolCap * ff.S2, Math.max(need, ff.pool.length * 2)),
      );
      grown.set(ff.pool);
      ff.pool = grown;
    }
    return ff.poolTop++;
  }
  // vol: verdring rond de klok, nooit een veld dat in deze vraag al gebruikt wordt
  for (;;) {
    const p = ff.clock;
    ff.clock = ff.clock + 1 === ff.poolCap ? 0 : ff.clock + 1;
    if (ff.poolStamp[p] === ff.stamp) continue;
    const owner = ff.poolSlot[p]!;
    if (owner >= 0) {
      const rf = ff.search[owner]!.regionField;
      if (rf[ff.poolRegion[p]!] === p) rf[ff.poolRegion[p]!] = -1;
      ff.poolSlot[p] = -1;
    }
    return p;
  }
}

/** Bouwt het regioveld van slot s voor lokale regio r van sector sec (globale regio gr). Geeft de pool-index. */
export function buildField(
  ff: FlowFields,
  s: number,
  q: SlotSearch,
  sec: number,
  r: number,
  gr: number,
): number {
  settleRegion(ff, q, sec, r);
  const p = allocField(ff);
  ff.poolSlot[p] = s;
  ff.poolRegion[p] = gr;
  ff.poolStamp[p] = ff.stamp;
  q.regionField[gr] = p;
  const off = p * ff.S2;
  const out = ff.pool;
  out.fill(-1, off, off + ff.S2);
  const S = ff.sectors[sec]!;
  const base = ff.nodeBase[sec]!;
  // zaden: de knopen van deze regio met hun afstand, oplopend (afstand, knoop)
  let ns = 0;
  const nn = S.nodeCell.length;
  if (ff.seedV.length < nn) {
    ff.seedV = new Int32Array(nn);
    ff.seedC = new Int32Array(nn);
  }
  for (let k = 0; k < nn; k++) {
    if (S.nodeRegion[k] !== r) continue;
    const v = q.g[base + k]!;
    if (v < 0) continue;
    let i = ns++;
    while (i > 0 && ff.seedV[i - 1]! > v) {
      ff.seedV[i] = ff.seedV[i - 1]!;
      ff.seedC[i] = ff.seedC[i - 1]!;
      i--;
    }
    ff.seedV[i] = v;
    ff.seedC[i] = S.nodeCell[k]!;
  }
  const x0 = secX0(ff, sec);
  const y0 = secY0(ff, sec);
  const x1 = Math.min(ff.w, x0 + ff.S);
  const y1 = Math.min(ff.h, y0 + ff.S);
  const w = ff.w;
  const reg = ff.regLocal;
  const queue = ff.scratchQ;
  let qh = 0;
  let qt = 0;
  let si = 0;
  // BFS met meerdere zaden van verschillende waarde: steeds de kleinste van (volgend zaad, kop van de rij)
  for (;;) {
    let l: number;
    if (si < ns && (qh === qt || ff.seedV[si]! <= out[off + queue[qh]!]!)) {
      const c = ff.seedC[si]!;
      const v = ff.seedV[si]!;
      si++;
      const cy = idiv(c, w);
      l = ((cy - y0) << ff.shift) + (c - cy * w - x0);
      if (out[off + l] !== -1) continue;
      out[off + l] = v;
    } else if (qh < qt) {
      l = queue[qh++]!;
    } else break;
    const ly = l >> ff.shift;
    const lx = l & ff.mask;
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
    if (y0 + ly + 1 < y1 && reg[c + w] === r && out[off + l + ff.S] === -1) {
      out[off + l + ff.S] = nd;
      queue[qt++] = l + ff.S;
    }
    if (ly > 0 && reg[c - w] === r && out[off + l - ff.S] === -1) {
      out[off + l - ff.S] = nd;
      queue[qt++] = l - ff.S;
    }
  }
  // in het doelvenster: het minimum met de exacte vensterafstand
  const ssx = x0 >> ff.shift;
  const ssy = y0 >> ff.shift;
  if (ssx >= q.ws0x && ssx <= q.ws1x && ssy >= q.ws0y && ssy <= q.ws1y) {
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (reg[y * w + x] !== r) continue;
        const v = q.win[(y - q.wy0) * q.ww + (x - q.wx0)]!;
        if (v < 0) continue;
        const l = off + ((y - y0) << ff.shift) + (x - x0);
        if (out[l] === -1 || v < out[l]!) out[l] = v;
      }
    }
  }
  return p;
}

/** Waarde V van cel (x, y) in slot s (begaanbare cel), DIST_UNKNOWN als het doel er niet bereikbaar is. */
export function valueAt(ff: FlowFields, s: number, q: SlotSearch, x: number, y: number): number {
  const c = y * ff.w + x;
  const lr = ff.regLocal[c]!;
  if (lr === NO_REGION) return DIST_UNKNOWN;
  const sec = (y >> ff.shift) * ff.sx + (x >> ff.shift);
  const gr = ff.regionBase[sec]! + lr;
  let p = q.regionField[gr]!;
  if (p < 0) p = buildField(ff, s, q, sec, lr, gr);
  else ff.poolStamp[p] = ff.stamp;
  return ff.pool[p * ff.S2 + ((y & ff.mask) << ff.shift) + (x & ff.mask)]!;
}
