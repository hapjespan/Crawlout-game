import { EVENT_TYPE, MAX_PLAYERS } from '@crawlout/protocol';
import { C, NEUTRAL, ORDER_CLAIM } from '../ecs/world.js';
import type { Census } from './census.js';
import { takeCensus } from './census.js';
import type { SimContext } from './common.js';
import { NO_WINNER, WIN_DESTRUCTION, WIN_DOMINANCE, WIN_SURRENDER, dist2 } from './common.js';

// Systeem 7: claims en winroutes.
// Claim: units met een Claim-order op dit punt die binnen claimRadius staan, nemen het na claimTicks, zolang geen
// unit van een andere speler in de straal staat (dan pauzeert de voortgang). Zonder claimers valt de voortgang terug.
// Een genomen punt blijft van de eigenaar tot een ander het neemt.
// Winroutes: A, vernietiging (een speler die een hoofdgebouw had en er geen meer heeft, is af); B, dominantie
// (pointsRequired claimpunten gedurende dominance.ticks aaneengesloten); opgeven (Surrender). Is er nog één speler
// over, dan wint die. De winnaar staat vast; de sim tikt daarna gewoon door.

export class ClaimScratch {
  readonly claimers = new Int32Array(MAX_PLAYERS);
  readonly present = new Int32Array(MAX_PLAYERS);
  readonly owned = new Int32Array(MAX_PLAYERS);
}

export function claimsSystem(ctx: SimContext, s: ClaimScratch, census: Census): void {
  const w = ctx.world;
  const r = ctx.config.claimRadius;
  const r2 = r * r;
  s.owned.fill(0);
  for (let pt = 0; pt < w.highWater; pt++) {
    if (!w.has(pt, C.claim)) continue;
    const ptId = w.idOf(pt);
    s.claimers.fill(0);
    s.present.fill(0);
    for (let i = 0; i < w.highWater; i++) {
      if (!w.has(i, C.unit | C.health)) continue;
      const dx = w.x[i]! - w.x[pt]!;
      const dy = w.y[i]! - w.y[pt]!;
      if (dx > r || -dx > r || dy > r || -dy > r || dist2(w, i, pt) > r2) continue;
      const o = w.owner[i]!;
      s.present[o] = s.present[o]! + 1;
      const ord = w.currentOrder(i);
      if (ord >= 0 && w.ordType[ord] === ORDER_CLAIM && w.ordT[ord] === ptId) s.claimers[o] = s.claimers[o]! + 1;
    }
    let claimant = -1;
    let anyClaimers = false;
    for (let p = 0; p < ctx.playerCount; p++) {
      if (s.claimers[p]! === 0) continue;
      anyClaimers = true;
      let contested = false;
      for (let q = 0; q < ctx.playerCount; q++) if (q !== p && s.present[q]! > 0) contested = true;
      if (!contested) claimant = p;
    }
    if (claimant < 0) {
      if (!anyClaimers) {
        w.claimBy[pt] = NEUTRAL;
        w.claimProgress[pt] = 0;
      }
    } else if (w.owner[pt] === claimant) {
      w.claimBy[pt] = NEUTRAL;
      w.claimProgress[pt] = 0;
      finishClaimOrders(ctx, ptId, claimant);
    } else {
      if (w.claimBy[pt] !== claimant) {
        w.claimBy[pt] = claimant;
        w.claimProgress[pt] = 0;
      }
      w.claimProgress[pt] = w.claimProgress[pt]! + 1;
      if (w.claimProgress[pt]! >= ctx.config.claimTicks) {
        w.owner[pt] = claimant;
        w.claimBy[pt] = NEUTRAL;
        w.claimProgress[pt] = 0;
        ctx.events.push(EVENT_TYPE.claimTaken, ptId, claimant, w.x[pt]!, w.y[pt]!);
        finishClaimOrders(ctx, ptId, claimant);
      }
    }
    const o = w.owner[pt]!;
    if (o < MAX_PLAYERS) s.owned[o] = s.owned[o]! + 1;
  }
  winRoutes(ctx, s, census);
}

/** Units van de nieuwe eigenaar met een Claim-order op dit punt zijn klaar. */
function finishClaimOrders(ctx: SimContext, ptId: number, p: number): void {
  const w = ctx.world;
  for (let i = 0; i < w.highWater; i++) {
    if (!w.has(i, C.unit | C.orders) || w.owner[i] !== p) continue;
    const ord = w.currentOrder(i);
    if (ord >= 0 && w.ordType[ord] === ORDER_CLAIM && w.ordT[ord] === ptId) w.popOrder(i);
  }
}

function winRoutes(ctx: SimContext, s: ClaimScratch, census: Census): void {
  const ps = ctx.ps;
  const g = ctx.globals;
  takeCensus(ctx, census);
  for (let p = 0; p < ctx.playerCount; p++) {
    if (ps.defeated[p] === 0 && ps.hadHq[p] === 1 && census.hqCount[p] === 0) ps.defeated[p] = WIN_DESTRUCTION;
  }
  if (g.winner !== NO_WINNER) return;
  const dom = ctx.map.dominance;
  for (let p = 0; p < ctx.playerCount; p++) {
    if (ps.defeated[p] !== 0 || s.owned[p]! < dom.pointsRequired) {
      ps.domTicks[p] = 0;
      continue;
    }
    ps.domTicks[p] = ps.domTicks[p]! + 1;
    if (ps.domTicks[p]! >= dom.ticks && g.winner === NO_WINNER) declare(ctx, p, WIN_DOMINANCE);
  }
  if (g.winner !== NO_WINNER || ctx.playerCount < 2) return;
  let alive = -1;
  let aliveCount = 0;
  let surrendered = false;
  for (let p = 0; p < ctx.playerCount; p++) {
    if (ps.defeated[p] === 0) {
      alive = p;
      aliveCount++;
    } else if (ps.defeated[p] === WIN_SURRENDER) surrendered = true;
  }
  if (aliveCount === 1) declare(ctx, alive, surrendered ? WIN_SURRENDER : WIN_DESTRUCTION);
}

function declare(ctx: SimContext, p: number, reason: number): void {
  ctx.globals.winner = p;
  ctx.globals.reason = reason;
  ctx.globals.frame = ctx.frame;
}
