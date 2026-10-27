// Split from flowfield.ts to stay under the 5,000-token file limit; flowfield.ts re-exports the public surface.
// The graph per sector: nodes, their distances within a region and the sector graph (CSR).
import { idiv } from './math/int.js';
import { EMPTY, localOf, secX0, secY0 } from './flowfield.base.js';
import type { FlowFields } from './flowfield.js';

/**
 * Knopen van sector s (noord, west, oost, zuid) en hun onderlinge afstanden binnen de regio (BFS per knoop).
 * `changed`: de begaanbaarheid van de sector zelf is veranderd. Zo niet (een buur van een vuile sector: alleen de
 * ingangen op een gedeelde grens kunnen anders zijn), dan zijn de regio's en dus de afstand tussen twee cellen
 * dezelfde als bij de vorige opbouw: zijn de knopen gelijk, dan blijft alles staan, anders komen de afstanden tussen
 * knopen die er al waren uit de vorige matrix en rekent de BFS alleen voor de nieuwe paren. Zelfde uitkomst als alles
 * opnieuw (bench: een gebouw op een sectorgrens kostte hier het grootste deel van de tick).
 */
export function computeNodes(ff: FlowFields, s: number, changed: boolean): void {
  const sec = ff.sectors[s]!;
  const sxi = s - idiv(s, ff.sx) * ff.sx;
  const north = s >= ff.sx ? ff.sectors[s - ff.sx]!.southB : EMPTY;
  const west = sxi > 0 ? ff.sectors[s - 1]!.eastB : EMPTY;
  const n = north.length + west.length + sec.eastA.length + sec.southA.length;
  const cell = new Int32Array(n);
  const oldPart = ff.oldPart;
  oldPart.set(sec.part);
  let k = 0;
  sec.part[0] = k;
  for (const c of north) cell[k++] = c;
  sec.part[1] = k;
  for (const c of west) cell[k++] = c;
  sec.part[2] = k;
  for (const c of sec.eastA) cell[k++] = c;
  sec.part[3] = k;
  for (const c of sec.southA) cell[k++] = c;
  const oldCell = changed ? EMPTY : sec.nodeCell;
  const on = oldCell.length;
  sec.part[4] = k;
  if (!changed && on === n) {
    let same = true;
    for (let i = 0; i < 5 && same; i++) if (sec.part[i] !== oldPart[i]) same = false;
    for (let i = 0; i < n && same; i++) if (cell[i] !== oldCell[i]) same = false;
    // dezelfde knopen in dezelfde volgorde en delen: regio's, afstanden en randen blijven zoals ze waren
    if (same) return;
  }
  // per knoop de index in de vorige opbouw (een cel met dezelfde afstanden), -1 voor een nieuwe knoop
  const prev = new Int32Array(n).fill(-1);
  for (let i = 0; i < n && on > 0; i++)
    for (let o = 0; o < on; o++)
      if (oldCell[o] === cell[i]) {
        prev[i] = o;
        break;
      }
  const oldDist = sec.nodeDist;
  const region = new Int32Array(n);
  for (let i = 0; i < n; i++) region[i] = ff.regLocal[cell[i]!]!;
  const dist = new Int32Array(n * n).fill(-1);
  const x0 = secX0(ff, s);
  const y0 = secY0(ff, s);
  const x1 = Math.min(ff.w, x0 + ff.S);
  const y1 = Math.min(ff.h, y0 + ff.S);
  const d = ff.scratchD;
  const w = ff.w;
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
    // alleen naar knopen met een hogere index rekenen; de matrix is symmetrisch. Een paar dat er al was, komt uit de
    // vorige opbouw (zelfde regio's, dus dezelfde afstand); alleen de overige paren vragen een BFS.
    const pi = prev[i]!;
    let need = false;
    for (let j = i + 1; j < n; j++) {
      if (region[j] !== region[i]) continue;
      const pj = prev[j]!;
      if (pi >= 0 && pj >= 0) {
        const dd = oldDist[pi * on + pj]!;
        dist[i * n + j] = dd;
        dist[j * n + i] = dd;
      } else need = true;
    }
    if (!need) continue;
    d.fill(-1);
    const r = region[i]!;
    // doelcellen (nieuwe paren met knopen j > i in dezelfde regio): de BFS stopt zodra ze allemaal bereikt zijn
    const tgt = ff.scratchT;
    let left = 0;
    for (let j = i + 1; j < n; j++) {
      if (region[j] !== r || (pi >= 0 && prev[j]! >= 0)) continue;
      const lj = localOf(ff, cell[j]!, x0, y0);
      if (tgt[lj] === 0) {
        tgt[lj] = 1;
        left++;
      }
    }
    nodeBfs(ff, localOf(ff, cell[i]!, x0, y0), r, left, x0, y0, x1, y1);
    for (let j = i + 1; j < n; j++) tgt[localOf(ff, cell[j]!, x0, y0)] = 0;
    for (let j = i + 1; j < n; j++) {
      if (region[j] !== r || (pi >= 0 && prev[j]! >= 0)) continue;
      const lj = localOf(ff, cell[j]!, x0, y0);
      dist[i * n + j] = d[lj]!;
      dist[j * n + i] = d[lj]!;
    }
  }
  sec.nodeCell = cell;
  sec.nodeRegion = region;
  sec.nodeDist = dist;
  // overbodige randen weglaten (zie Sector.adjStart). De matrix is symmetrisch, dus ook "overbodig": één keer per paar
  // i < j, met d(k, j) als d(j, k) zodat beide rijen aaneengesloten gelezen worden.
  const keep = new Uint8Array(n * n);
  for (let i = 0; i < n; i++) {
    const ri = i * n;
    for (let j = i + 1; j < n; j++) {
      const dij = dist[ri + j]!;
      if (dij < 0) continue;
      const rj = j * n;
      let redundant = false;
      for (let k = 0; k < n; k++) {
        const a = dist[ri + k]!;
        const b = dist[rj + k]!;
        if (a > 0 && b > 0 && a + b === dij) {
          redundant = true;
          break;
        }
      }
      if (redundant) continue;
      keep[ri + j] = 1;
      keep[rj + i] = 1;
    }
  }
  const start = new Int32Array(n + 1);
  const adjN: number[] = [];
  const adjC: number[] = [];
  for (let i = 0; i < n; i++) {
    start[i] = adjN.length;
    for (let j = 0; j < n; j++) {
      if (keep[i * n + j] !== 1) continue;
      adjN.push(j);
      adjC.push(dist[i * n + j]!);
    }
  }
  start[n] = adjN.length;
  sec.adjStart = start;
  sec.adjNode = Int32Array.from(adjN);
  sec.adjCost = Int32Array.from(adjC);
}

/**
 * BFS (4-buren, binnen regio r van de sector [x0, x1) x [y0, y1)) vanaf lokale cel ls in scratchD (vooraf -1), tot de
 * `left` doelcellen in scratchT bereikt zijn; die worden onderweg weer 0. Een eigen methode: de zware lus van
 * computeNodes, zodat hij geoptimaliseerd blijft als computeNodes een nieuwe tak neemt (bench: een koude deopt kostte
 * bij de eerste wijziging na de start ruim 1 ms per sector).
 */
export function nodeBfs(
  ff: FlowFields,
  ls: number,
  r: number,
  left0: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): void {
  const d = ff.scratchD;
  const q = ff.scratchQ;
  const tgt = ff.scratchT;
  const reg = ff.regLocal;
  const w = ff.w;
  const S = ff.S;
  let left = left0;
  d[ls] = 0;
  if (tgt[ls] === 1) {
    tgt[ls] = 0;
    left--;
  }
  let qh = 0;
  let qt = 0;
  q[qt++] = ls;
  while (qh < qt && left > 0) {
    const l = q[qh++]!;
    const ly = l >> ff.shift;
    const lx = l & ff.mask;
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
}
