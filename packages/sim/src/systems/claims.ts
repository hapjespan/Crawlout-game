import { EVENT_TYPE, MAX_ENTITIES, MAX_PLAYERS, OWNER_NEUTRAL } from '@crawlout/protocol';
import type { ClaimActivity, ClaimPointStatus, DominanceStatus } from '@crawlout/protocol';
import { BSTATE_DONE, BSTATE_SITE, C } from '../ecs/world.js';
import { PROGRESS_ONE } from '../entities.js';
import { PROVIDES_CLAIM } from '../fromData.js';
import { clampI, idiv } from '../math/int.js';
import type { Census } from './census.js';
import { takeCensus } from './census.js';
import { heroOf } from '../effects.js';
import { grantXp } from './hero.js';
import type { SimContext } from './common.js';
import {
  NO_WINNER,
  WIN_DESTRUCTION,
  WIN_DOMINANCE,
  WIN_PROJECT,
  WIN_SURRENDER,
  distToRect2,
} from './common.js';
import { projectSystem } from './project.js';

// Systeem 7: claims en winroutes.
// Claim (besluit sprint 2, fase-0 sectie 13; Spelfundament 3.1): een claimpunt is van speler p zolang een voltooid
// gebouw van p met provides claim (claimpaal, hoofdgebouw) met zijn footprint binnen claimRadius van het punt staat.
// Staat er geen, dan is het punt neutraal; staan er van meerdere spelers, dan houdt de huidige eigenaar het tot zijn
// gebouw weg is, daarna een van de anderen (bij meer dan één via sim.rng, fair-ronde; was de laagste playerId). Een
// speler die af is houdt niets. Elke wissel geeft claimTaken (b = nieuwe eigenaar, OWNER_NEUTRAL als het punt
// terugvalt).
// Presentatie: claimBy/claimProgress volgen het verst gevorderde claimgebouw in aanbouw van een andere speler dan de
// eigenaar binnen de straal (animT van het claimpunt).
// Claimen zonder paal (data 0.20.0, de claimronde; Martien: "de held mag ook palen claimen door 3 minuten in de zone
// te blijven staan"; bevestigd in fase-0 sectie 22 besluit 6):
//  - de held van p claimt een punt dat neutraal is en waar geen voltooid claimgebouw staat, door heroClaimTicks in de
//    cirkel (claimRadius) te staan zonder dat er een unit van een andere speler in staat (dan staat de teller stil);
//    verlaat hij de cirkel of sneuvelt hij, dan begint het opnieuw. Daarna is het punt van p met beacon = 1: geen
//    gebouw, telt mee voor dominantie en exclusieve nodes zoals een paal;
//  - een beacon is over te nemen: staan er units van een andere speler in de cirkel en geen enkele van de eigenaar,
//    dan gaat het punt na contestFlipTicks over naar die speler (ook als beacon; bij meer aanvallers de laagste
//    playerId); staan er van beide, dan staat de teller stil; zonder aanvaller valt hij terug op 0;
//  - een voltooid claimgebouw gaat voor: staat er een, dan gelden de regels hierboven (een beacon houdt het punt niet
//    tegen een paal; bouwt de eigenaar zelf een paal, dan is het geen beacon meer).
// claimBy/claimProgress tonen ook de held die claimt en de aanvaller van een beacon.
// Winroutes: A, vernietiging (een speler die een hoofdgebouw had en er geen meer heeft, is af); B, dominantie
// (pointsRequired claimpunten gedurende dominance.ticks aaneengesloten); C, Bouwproject (sim 0.25.0, systems/project.ts:
// de countdown van wie van elke soort deel een hersteld deel houdt; na dominantie in dezelfde tick); opgeven (Surrender). Is er nog één speler
// over, dan wint die. De winnaar staat vast; de sim tikt daarna gewoon door.

const ANIM_FULL = 0xffff;

/** World.claimKind: what claimBy/claimProgress of a claim point show (data 0.20.0). */
export const CLAIM_KIND_NONE = 0;
/** A claim building of claimBy going up within the radius. */
export const CLAIM_KIND_POST = 1;
/** The hero of claimBy claiming the free point by standing in it. */
export const CLAIM_KIND_HERO = 2;
/** Units of claimBy taking a beacon over (no unit of the holder in the circle). */
export const CLAIM_KIND_CONTEST = 3;
/** Bit: units of more than one player in the circle (a hero claim or a contest stands still). */
export const CLAIM_FROZEN = 0x10;

export class ClaimScratch {
  readonly owned = new Int32Array(MAX_PLAYERS);
  /** Indices van gebouwen met provides claim (af of in aanbouw), oplopend. */
  readonly sources = new Int32Array(MAX_ENTITIES);
  sourceCount = 0;
  /** Per claimpunt (entity-index): bitset van spelers met een levende unit in de cirkel, en van wie de held erin staat. */
  readonly present = new Uint8Array(MAX_ENTITIES);
  readonly heroIn = new Uint8Array(MAX_ENTITIES);
}

/** Wie er in de cirkel van elk claimpunt staat (units en helden, geen lijken), één keer per tick voor alle punten. */
function collectPresence(ctx: SimContext, s: ClaimScratch): void {
  const w = ctx.world;
  const r = ctx.config.claimRadius;
  const r2 = r * r;
  for (const pt of ctx.claimPoints) {
    s.present[pt] = 0;
    s.heroIn[pt] = 0;
  }
  if (ctx.claimPoints.length === 0) return;
  for (let i = 0; i < w.highWater; i++) {
    if (!w.has(i, C.unit) || (w.mask[i]! & C.corpse) !== 0) continue;
    const o = w.owner[i]!;
    if (o >= ctx.playerCount || ctx.ps.defeated[o] !== 0) continue;
    for (const pt of ctx.claimPoints) {
      const dx = w.x[i]! - w.x[pt]!;
      const dy = w.y[i]! - w.y[pt]!;
      if (dx * dx + dy * dy > r2) continue;
      s.present[pt] = s.present[pt]! | (1 << o);
      if ((w.mask[i]! & C.hero) !== 0) s.heroIn[pt] = s.heroIn[pt]! | (1 << o);
    }
  }
}

/** De laagste speler in bitset m. */
const lowest = (m: number): number => 31 - Math.clz32(m & -m);

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
  collectPresence(ctx, s);
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
    else if (holders !== 0) next = pickHolder(ctx, holders);
    let beacon = 0;
    let attackers = 0;
    if (
      holders === 0 &&
      cur !== OWNER_NEUTRAL &&
      w.beacon[pt] === 1 &&
      ctx.ps.defeated[cur] === 0
    ) {
      next = cur;
      beacon = 1;
      attackers = contestBeacon(ctx, s, pt, cur);
      if (w.contestTicks[pt]! >= ctx.config.contestFlipTicks && attackers !== 0) {
        next = lowest(attackers);
        w.contestTicks[pt] = 0;
      }
    } else w.contestTicks[pt] = 0;
    if (holders === 0 && next === OWNER_NEUTRAL && heroClaim(ctx, s, pt)) {
      next = w.heroClaimBy[pt]! - 1;
      beacon = 1;
      w.heroClaimBy[pt] = 0;
      w.heroClaimTicks[pt] = 0;
    } else if (holders !== 0 || next !== OWNER_NEUTRAL) {
      w.heroClaimBy[pt] = 0;
      w.heroClaimTicks[pt] = 0;
    }
    w.beacon[pt] = next === OWNER_NEUTRAL ? 0 : beacon;
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
    w.claimKind[pt] = w.claimBy[pt] === OWNER_NEUTRAL ? CLAIM_KIND_NONE : CLAIM_KIND_POST;
    if (w.claimBy[pt] === OWNER_NEUTRAL) {
      // no post going up: show the hero who is claiming, or the attacker of a beacon
      const cfg = ctx.config;
      if (w.heroClaimBy[pt]! > 0) {
        w.claimBy[pt] = w.heroClaimBy[pt]! - 1;
        w.claimProgress[pt] = fraction(w.heroClaimTicks[pt]!, cfg.heroClaimTicks);
        w.claimKind[pt] = CLAIM_KIND_HERO;
      } else if (w.contestTicks[pt]! > 0 && attackers !== 0) {
        w.claimBy[pt] = lowest(attackers);
        w.claimProgress[pt] = fraction(w.contestTicks[pt]!, cfg.contestFlipTicks);
        w.claimKind[pt] = CLAIM_KIND_CONTEST;
      }
    }
    const p = s.present[pt]!;
    if ((p & (p - 1)) !== 0) w.claimKind[pt] = w.claimKind[pt]! | CLAIM_FROZEN;
    if (next < MAX_PLAYERS) s.owned[next] = s.owned[next]! + 1;
  }
}

const ACTIVITY: readonly ClaimActivity[] = ['none', 'post', 'hero', 'contest'];

/** Claimstand van alle claimpunten voor de HUD (PlayerStatus.claimPoints, protocol 0.10.0), oplopend op pointId. */
export function claimPointStatus(ctx: SimContext): ClaimPointStatus[] {
  const w = ctx.world;
  const out: ClaimPointStatus[] = [];
  for (const pt of ctx.claimPoints) {
    if (!w.has(pt, C.claim)) continue;
    const kind = w.claimKind[pt]! & 0x0f;
    const activity = ACTIVITY[kind] ?? 'none';
    out.push({
      pointId: w.idOf(pt),
      owner: w.owner[pt]!,
      beacon: w.beacon[pt] === 1,
      activity,
      by: activity === 'none' ? OWNER_NEUTRAL : w.claimBy[pt]!,
      progressPermille: activity === 'none' ? 0 : idiv(w.claimProgress[pt]! * 1000, ANIM_FULL),
      frozen: (w.claimKind[pt]! & CLAIM_FROZEN) !== 0,
    });
  }
  out.sort((a, b) => a.pointId - b.pointId);
  return out;
}

/** a / b as 0..65535 (claimProgress), b <= 0 counts as done. */
const fraction = (a: number, b: number): number =>
  b <= 0 ? ANIM_FULL : clampI(idiv(a * ANIM_FULL, b), 0, ANIM_FULL);

/**
 * A beacon (claim without a post) of `holder` at pt: counts contestTicks up while units of another player stand in the
 * circle and none of the holder (the caller flips the point at contestFlipTicks), keeps it while both are there
 * (frozen) and resets it without attackers. Returns the attackers (bitset).
 */
function contestBeacon(ctx: SimContext, s: ClaimScratch, pt: number, holder: number): number {
  const w = ctx.world;
  const attackers = s.present[pt]! & ~(1 << holder);
  if (attackers === 0) w.contestTicks[pt] = 0;
  else if ((s.present[pt]! & (1 << holder)) === 0) w.contestTicks[pt] = w.contestTicks[pt]! + 1;
  return attackers;
}

/**
 * A free point (neutral, no finished claim building): the hero in the circle claims it by standing there heroClaimTicks
 * without units of another player in it (they freeze the count). The claiming hero is remembered (heroClaimBy); when
 * he leaves the circle or falls, the count starts over (for the lowest player whose hero is in it). True when the claim
 * is complete this tick (heroClaimBy then holds the new owner + 1).
 */
function heroClaim(ctx: SimContext, s: ClaimScratch, pt: number): boolean {
  const w = ctx.world;
  const total = ctx.config.heroClaimTicks;
  const heroes = s.heroIn[pt]!;
  if (total <= 0 || heroes === 0) {
    w.heroClaimBy[pt] = 0;
    w.heroClaimTicks[pt] = 0;
    return false;
  }
  const by = w.heroClaimBy[pt]! - 1;
  if (by < 0 || (heroes & (1 << by)) === 0) {
    w.heroClaimBy[pt] = lowest(heroes) + 1;
    w.heroClaimTicks[pt] = 0;
  }
  const p = w.heroClaimBy[pt]! - 1;
  if ((s.present[pt]! & ~(1 << p)) !== 0) return false; // contested: the count stands still
  w.heroClaimTicks[pt] = w.heroClaimTicks[pt]! + 1;
  return w.heroClaimTicks[pt]! >= total;
}

/**
 * Wie een punt krijgt dat de huidige eigenaar niet (meer) houdt: de enige speler met een voltooid claimgebouw in de
 * straal, en bij meer dan één (gelijke stand: hun claimpalen kwamen in dezelfde tick af) een van hen via sim.rng
 * (fair-ronde). Voorheen won de laagste playerId; op een puntsymmetrische map, waar twee gespiegelde AI's hun palen bij
 * het midden in dezelfde tick afbouwen, kreeg speler 0 het midden dan altijd. sim.rng wordt alleen bij een gelijke stand
 * getrokken.
 */
function pickHolder(ctx: SimContext, holders: number): number {
  let n = 0;
  for (let b = holders; b !== 0; b &= b - 1) n++;
  let k = n > 1 ? ctx.rng.nextInt(n) : 0;
  for (let b = holders; ; b &= b - 1) {
    if (k === 0) return 31 - Math.clz32(b & -b);
    k--;
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
  // win route C (sim 0.25.0): the sabotage pause and the countdowns run also after a winner is known (state, like domTicks)
  const project = projectSystem(ctx);
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
  if (g.winner === NO_WINNER && project >= 0) declare(ctx, project, WIN_PROJECT);
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

/** Aantal claimpunten van speler p. */
export function pointsOf(ctx: SimContext, p: number): number {
  let n = 0;
  for (const pt of ctx.claimPoints) if (ctx.world.owner[pt] === p) n++;
  return n;
}

/**
 * Dominantie voor de HUD (PlayerStatus.dominance, protocol 0.6.0): de stand van speler p plus de tegenstander die het
 * dichtst bij dominantie is (meeste ticksHeld, dan meeste pointsHeld, dan laagste playerId; alleen wie nog meedoet).
 * Leest alleen state (eigenaar van de claimpunten, domTicks); verandert niets.
 */
export function dominanceStatus(ctx: SimContext, p: number): DominanceStatus {
  const dom = ctx.map.dominance;
  let leader: DominanceStatus['leader'] = null;
  for (let q = 0; q < ctx.playerCount; q++) {
    if (q === p || ctx.ps.defeated[q] !== 0) continue;
    const pointsHeld = pointsOf(ctx, q);
    const ticksHeld = ctx.ps.domTicks[q]!;
    if (
      leader === null ||
      ticksHeld > leader.ticksHeld ||
      (ticksHeld === leader.ticksHeld && pointsHeld > leader.pointsHeld)
    )
      leader = { playerId: q, pointsHeld, ticksHeld };
  }
  return {
    pointsHeld: pointsOf(ctx, p),
    pointsRequired: dom.pointsRequired,
    ticksHeld: ctx.ps.domTicks[p]!,
    ticksRequired: dom.ticks,
    leader,
  };
}
