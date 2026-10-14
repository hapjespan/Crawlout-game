import { EVENT_TYPE, MAX_ENTITIES, MAX_PLAYERS, OWNER_NEUTRAL } from '@crawlout/protocol';
import { BSTATE_DONE, BSTATE_SITE, C } from '../ecs/world.js';
import { PROGRESS_ONE } from '../entities.js';
import { PROVIDES_CLAIM } from '../fromData.js';
import { clampI, idiv } from '../math/int.js';
import type { Census } from './census.js';
import { takeCensus } from './census.js';
import { heroOf } from '../effects.js';
import { grantXp } from './hero.js';
import type { SimContext } from './common.js';
import { NO_WINNER, WIN_DESTRUCTION, WIN_DOMINANCE, WIN_SURRENDER, distToRect2 } from './common.js';

// Systeem 7: claims en winroutes.
// Claim (besluit sprint 2, fase-0 sectie 13; Spelfundament 3.1): een claimpunt is van speler p zolang een voltooid
// gebouw van p met provides claim (claimpaal, hoofdgebouw) met zijn footprint binnen claimRadius van het punt staat.
// Staat er geen, dan is het punt neutraal; staan er van meerdere spelers, dan houdt de huidige eigenaar het tot zijn
// gebouw weg is, daarna de laagste playerId. Een speler die af is houdt niets. Elke wissel geeft claimTaken
// (b = nieuwe eigenaar, OWNER_NEUTRAL als het punt terugvalt).
// Presentatie: claimBy/claimProgress volgen het verst gevorderde claimgebouw in aanbouw van een andere speler dan de
// eigenaar binnen de straal (animT van het claimpunt).
// Winroutes: A, vernietiging (een speler die een hoofdgebouw had en er geen meer heeft, is af); B, dominantie
// (pointsRequired claimpunten gedurende dominance.ticks aaneengesloten); opgeven (Surrender). Is er nog één speler
// over, dan wint die. De winnaar staat vast; de sim tikt daarna gewoon door.

const ANIM_FULL = 0xffff;

export class ClaimScratch {
  readonly owned = new Int32Array(MAX_PLAYERS);
  /** Indices van gebouwen met provides claim (af of in aanbouw), oplopend. */
  readonly sources = new Int32Array(MAX_ENTITIES);
  sourceCount = 0;
}

/** Of de footprint van gebouw b binnen de claimstraal van punt pt ligt. */
export function inClaimRadius(ctx: SimContext, b: number, pt: number): boolean {
  const w = ctx.world;
  const r = ctx.config.claimRadius;
  return distToRect2(w.x[pt]!, w.y[pt]!, w.fx[b]!, w.fy[b]!, w.fw[b]!, w.fh[b]!) <= r * r;
}

function collectSources(ctx: SimContext, s: ClaimScratch): void {
  const w = ctx.world;
  let k = 0;
  for (let i = 0; i < w.highWater; i++) {
    if (!w.has(i, C.building)) continue;
    const bt = ctx.buildingType(w.typeId[i]!);
    if (bt !== undefined && (bt.provides & PROVIDES_CLAIM) !== 0) s.sources[k++] = i;
  }
  s.sourceCount = k;
}

/**
 * Eigenaar en voortgang van alle claimpunten bijwerken. quiet = true (startopstelling): geen events en geen
 * ontdekking. Geeft per speler het aantal punten in s.owned.
 */
export function updateClaimPoints(ctx: SimContext, s: ClaimScratch, quiet: boolean): void {
  const w = ctx.world;
  collectSources(ctx, s);
  s.owned.fill(0);
  for (const pt of ctx.claimPoints) {
    let holders = 0;
    let siteOwner = OWNER_NEUTRAL;
    let siteProgress = -1;
    const cur = w.owner[pt]!;
    for (let k = 0; k < s.sourceCount; k++) {
      const b = s.sources[k]!;
      const o = w.owner[b]!;
      if (o >= ctx.playerCount || ctx.ps.defeated[o] !== 0 || !inClaimRadius(ctx, b, pt)) continue;
      if (w.bstate[b] === BSTATE_DONE) holders |= 1 << o;
      else if (w.bstate[b] === BSTATE_SITE && o !== cur) {
        const bt = ctx.buildingType(w.typeId[b]!)!;
        const total = bt.buildTicks * PROGRESS_ONE;
        const prog =
          total <= 0 ? ANIM_FULL : clampI(idiv(w.progress[b]! * ANIM_FULL, total), 0, ANIM_FULL);
        if (prog > siteProgress) {
          siteProgress = prog;
          siteOwner = o;
        }
      }
    }
    let next = OWNER_NEUTRAL;
    if (cur !== OWNER_NEUTRAL && (holders & (1 << cur)) !== 0) next = cur;
    else if (holders !== 0) next = 31 - Math.clz32(holders & -holders); // laagste playerId
    if (next !== cur) {
      w.owner[pt] = next;
      if (!quiet) ctx.events.push(EVENT_TYPE.claimTaken, w.idOf(pt), next, w.x[pt]!, w.y[pt]!);
      if (next < MAX_PLAYERS && (w.seenBy[pt]! & (1 << next)) === 0) {
        // Ontdekking: de eerste keer dat een speler dit punt neemt, xpPerDiscovery voor zijn held (niet bij de start).
        w.seenBy[pt] = w.seenBy[pt]! | (1 << next);
        const h = quiet ? undefined : heroOf(ctx, next);
        if (h !== undefined) grantXp(ctx, next, h.xpPerDiscovery);
      }
    }
    w.claimBy[pt] = siteOwner === next ? OWNER_NEUTRAL : siteOwner;
    w.claimProgress[pt] = w.claimBy[pt] === OWNER_NEUTRAL ? 0 : siteProgress;
    if (next < MAX_PLAYERS) s.owned[next] = s.owned[next]! + 1;
  }
}

export function claimsSystem(ctx: SimContext, s: ClaimScratch, census: Census): void {
  updateClaimPoints(ctx, s, false);
  winRoutes(ctx, s, census);
}

function winRoutes(ctx: SimContext, s: ClaimScratch, census: Census): void {
  const ps = ctx.ps;
  const g = ctx.globals;
  takeCensus(ctx, census);
  for (let p = 0; p < ctx.playerCount; p++) {
    if (ps.defeated[p] === 0 && ps.hadHq[p] === 1 && census.hqCount[p] === 0)
      ps.defeated[p] = WIN_DESTRUCTION;
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
