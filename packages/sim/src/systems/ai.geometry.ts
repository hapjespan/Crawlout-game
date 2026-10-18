// Split from ai.ts to stay under the 5,000-token file limit; ai.ts re-exports the public surface.
// Holds: ROLE_SCAVENGER, ROLE_BUILDER, chunks, AiScratch, ESCORT_OFFSET, AI_SITE_RING, +11 more.
import { ROLES } from '@crawlout/data';
import { MAX_ENTITIES_PER_COMMAND, MAX_ENTITIES } from '@crawlout/protocol';
import type { SimContext } from './common.js';
import { idiv } from '../math/int.js';

export const ROLE_SCAVENGER = ROLES.indexOf('scavenger');

export const ROLE_BUILDER = ROLES.indexOf('builder');

export function chunks(ids: readonly number[]): number[][] {
  const out: number[][] = [];
  for (let k = 0; k < ids.length; k += MAX_ENTITIES_PER_COMMAND)
    out.push(ids.slice(k, k + MAX_ENTITIES_PER_COMMAND));
  return out;
}

/** Afgeleide kladruimte van de AI, elke beurt opnieuw gevuld (geen state). */
export class AiScratch {
  /** Plunderaars met een Gather-order per node-index. */
  readonly nodeLoad = new Int32Array(MAX_ENTITIES);
  /** Eigen gebouwen van de speler voor findThreat. */
  readonly own = new Int32Array(MAX_ENTITIES);
  /** Per node-index de padafstand tot het dichtstbijzijnde eigen depot (plunderaarsverdeling). */
  readonly nodeCost = new Int32Array(MAX_ENTITIES);
}

/**
 * Geometrie: de escorte van een claim loopt naar een punt zoveel eenheden naast het claimpunt (zie raidOver), aan de
 * kant van de eigen spawn vandaan. Dat is onder de 180-gradenspiegel gelijk: een vaste +1 werd bij het spiegelbeeld -1
 * en liet twee gespiegelde escortes een eenheid verschillend lopen (woning 3x3: spiegel brak in frame 3606).
 */
export const ESCORT_OFFSET = 1;

/**
 * Geometrie: zover (Chebyshev, in cellen van het midden van het anker tot het midden van de footprint) zoekt de AI een
 * bouwplek. Echte-schaalronde (data 0.14.0): een woning is 13 x 19 m en het hoofdgebouw 21 x 21 m, dus negen woningen,
 * een werkplaats en een lab liggen tot ongeveer 50 m van het hoofdgebouw (was MAX_FREE_RING, 24 cellen).
 */
export const AI_SITE_RING = 56;

/**
 * Geometrie: een claimpunt ligt aan de eigen kant als zijn afstand tot het eigen hoofdgebouw onder ongeveer 87 procent
 * (kwadraat 3/4) van die tot de spawn van de vijand ligt. Een punt in het midden van de map is zo van niemand, ook als
 * het een cel naast het symmetriepunt ligt.
 */
export const OWN_SIDE_NUM = 3;

export const OWN_SIDE_DEN = 4;

/** Geometrie: een gebouw met een wapen zoekt zijn plek vanaf zoveel cellen voorbij de rand van zijn anker, richting de vijand. */
export const TURRET_FORWARD_CELLS = 3;

/** Geometrie: het verzamelpunt bij het hoofdgebouw ligt zoveel cellen voorbij zijn rand, op de weg naar de vijand. */
const RALLY_FORWARD_CELLS = 4;

/** Eigen claimpunt met de kleinste waarde in afstandsveld f (padafstand tot de bron van f), of -1. Tiebreak laagste index. */
export function ownClaimNear(ctx: SimContext, p: number, f: Uint16Array): number {
  const w = ctx.world;
  let best = -1;
  let bestD = 0;
  for (const pt of ctx.claimPoints) {
    if (w.owner[pt] !== p) continue;
    const d = ctx.terrainDist.at(f, w.x[pt]!, w.y[pt]!);
    if (best < 0 || d < bestD) {
      best = pt;
      bestD = d;
    }
  }
  return best;
}

/** Afstandsveld over het terrein vanaf de footprint van gebouw b. */
export function fieldOf(ctx: SimContext, b: number): Uint16Array {
  const w = ctx.world;
  return ctx.terrainDist.field(w.fx[b]!, w.fy[b]!, w.fw[b]!, w.fh[b]!);
}

/** Afstanden die de AI deze beurt gebruikt: vanaf het eigen hoofdgebouw en vanaf de spawn van de vijand. */
export interface Fields {
  readonly home: Uint16Array;
  readonly enemy: Uint16Array | null;
  /** Cel van de bron van enemy (de spawn van de vijand); alleen geldig als enemy er is. */
  readonly enemyCx: number;
  readonly enemyCy: number;
}

/**
 * Een stap van `steps` cellen vanaf (cx, cy) langs veld f naar zijn bron (tx, ty) (steeds de buur met de laagste
 * waarde, 8 richtingen, diagonaal alleen als beide rechte buren begaanbaar zijn; bij gelijke waarde de buur die
 * hemelsbreed het dichtst bij de bron ligt, zodat beide spelers op een puntsymmetrische map gespiegeld kiezen; dan de
 * buur rechts van de richting naar de bron; dan de vaste volgorde O, W, Z, N, ZO, ZW, NO, NW). Zo ligt "richting de
 * vijand" langs de weg erheen, niet over een rivier.
 */
export function stepAlong(
  ctx: SimContext,
  f: Uint16Array,
  tx: number,
  ty: number,
  cx0: number,
  cy0: number,
  steps: number,
): { cx: number; cy: number } {
  const map = ctx.map;
  const W = map.w;
  const pass = map.passable;
  let cx = cx0;
  let cy = cy0;
  for (let n = 0; n < steps; n++) {
    const c = cy * W + cx;
    let best = c;
    let bestD = f[c]!;
    let bestE = 0;
    const pE = cx + 1 < W && pass[c + 1] === 1;
    const pW = cx > 0 && pass[c - 1] === 1;
    const pS = cy + 1 < map.h && pass[c + W] === 1;
    const pN = cy > 0 && pass[c - W] === 1;
    const cand = [
      pE ? c + 1 : -1,
      pW ? c - 1 : -1,
      pS ? c + W : -1,
      pN ? c - W : -1,
      pE && pS && pass[c + W + 1] === 1 ? c + W + 1 : -1,
      pW && pS && pass[c + W - 1] === 1 ? c + W - 1 : -1,
      pE && pN && pass[c - W + 1] === 1 ? c - W + 1 : -1,
      pW && pN && pass[c - W - 1] === 1 ? c - W - 1 : -1,
    ];
    let bestX = 0;
    for (const m of cand) {
      if (m < 0 || f[m]! > bestD || (f[m]! === bestD && best === c)) continue;
      const my = idiv(m, W);
      const mx = m - my * W;
      const e = (mx - tx) * (mx - tx) + (my - ty) * (my - ty);
      // dan rechts van de richting naar de bron (kruisproduct: gelijk onder de 180-gradenspiegel; de vaste volgorde
      // is dat niet)
      const x = (tx - cx) * (my - cy) - (ty - cy) * (mx - cx);
      if (f[m]! < bestD || e < bestE || (e === bestE && x > bestX)) {
        best = m;
        bestD = f[m]!;
        bestE = e;
        bestX = x;
      }
    }
    if (best === c) break;
    cy = idiv(best, W);
    cx = best - cy * W;
  }
  return { cx, cy };
}

/**
 * Het verzamelpunt voor het hoofdgebouw hq (cel), op de weg naar de vijand; null zonder vijand. Alleen terrein, geen
 * gebouwen: het ligt vast, ook als er later iets omheen wordt gebouwd. findSite houdt de cel vrij.
 */
export function rallyCell(
  ctx: SimContext,
  hq: number,
  fields: Fields,
): { cx: number; cy: number } | null {
  if (fields.enemy === null) return null;
  const w = ctx.world;
  return stepAlong(
    ctx,
    fields.enemy,
    fields.enemyCx,
    fields.enemyCy,
    w.fx[hq]! + (w.fw[hq]! >> 1),
    w.fy[hq]! + (w.fh[hq]! >> 1),
    (w.fw[hq]! >> 1) + RALLY_FORWARD_CELLS,
  );
}

/**
 * Lokale padafstand (4-buren, actuele begaanbaarheid met gebouwen) vanaf de rechthoek [rx, rx+rw) x [ry, ry+rh) in
 * een venster van straal r cellen eromheen; -1 = niet bereikbaar binnen het venster. Voor de bouwplek: een plek aan de
 * overkant van een rivier ligt hemelsbreed dichtbij maar is ver lopen.
 */
export function localDist(
  ctx: SimContext,
  rx: number,
  ry: number,
  rw: number,
  rh: number,
  r: number,
): { d: Int32Array; x0: number; y0: number; ww: number } {
  const map = ctx.map;
  const walk = ctx.terrain.walk;
  const x0 = rx - r < 0 ? 0 : rx - r;
  const y0 = ry - r < 0 ? 0 : ry - r;
  const x1 = rx + rw + r > map.w ? map.w : rx + rw + r;
  const y1 = ry + rh + r > map.h ? map.h : ry + rh + r;
  const ww = x1 - x0;
  const wh = y1 - y0;
  const d = new Int32Array(ww * wh).fill(-1);
  const q = new Int32Array(ww * wh);
  let qt = 0;
  for (let y = ry; y < ry + rh; y++) {
    for (let x = rx; x < rx + rw; x++) {
      if (x < x0 || y < y0 || x >= x1 || y >= y1) continue;
      const l = (y - y0) * ww + (x - x0);
      d[l] = 0;
      q[qt++] = l;
    }
  }
  let qh = 0;
  while (qh < qt) {
    const l = q[qh++]!;
    const ly = idiv(l, ww);
    const lx = l - ly * ww;
    const c = (y0 + ly) * map.w + x0 + lx;
    const nd = d[l]! + 1;
    if (lx + 1 < ww && walk[c + 1] === 1 && d[l + 1] === -1) {
      d[l + 1] = nd;
      q[qt++] = l + 1;
    }
    if (lx > 0 && walk[c - 1] === 1 && d[l - 1] === -1) {
      d[l - 1] = nd;
      q[qt++] = l - 1;
    }
    if (ly + 1 < wh && walk[c + map.w] === 1 && d[l + ww] === -1) {
      d[l + ww] = nd;
      q[qt++] = l + ww;
    }
    if (ly > 0 && walk[c - map.w] === 1 && d[l - ww] === -1) {
      d[l - ww] = nd;
      q[qt++] = l - ww;
    }
  }
  return { d, x0, y0, ww };
}

/**
 * Somtabel ((w + 1) x (h + 1), integer) van de actuele begaanbaarheid (met gebouwen) over het venster
 * [x0, x0 + w) x [y0, y0 + h); cellen buiten de map tellen als 0. Afgeleid, geen state.
 */
export function walkSums(
  ctx: SimContext,
  x0: number,
  y0: number,
  w: number,
  h: number,
): Int32Array {
  const map = ctx.map;
  const walk = ctx.terrain.walk;
  const W1 = w + 1;
  const sat = new Int32Array(W1 * (h + 1));
  for (let y = 0; y < h; y++) {
    const my = y0 + y;
    let row = 0;
    for (let x = 0; x < w; x++) {
      const mx = x0 + x;
      if (mx >= 0 && my >= 0 && mx < map.w && my < map.h && walk[my * map.w + mx] === 1) row++;
      sat[(y + 1) * W1 + x + 1] = sat[y * W1 + x + 1]! + row;
    }
  }
  return sat;
}
