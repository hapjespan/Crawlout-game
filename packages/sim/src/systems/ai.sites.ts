// Split from ai.ts to stay under the 5,000-token file limit; ai.ts re-exports the public surface.
// Holds: findSite, isOwnSide, enemyOf, exclusiveFor, armyType, heroClaimNear, +5 more.
import { type SimContext, distToRect2, cellCenterOf, visibleTo } from './common.js';
import {
  type SimBuildingType,
  AI_SITE_HQ,
  AI_SITE_FRONT,
  type SimAiScript,
  type SimUnitType,
} from '../config.js';
import type { WorkReach } from './slaves.js';
import { PROVIDES_CLAIM } from '../fromData.js';
import {
  hqCentres,
  marginCells,
  placementInput,
  territoryOf,
  placeAs,
  touchesTerritory,
  inHqRange,
  neighbourReason,
  PLACE_OK,
} from './placement.js';
import { clampI, imod } from '../math/int.js';
import { hasTechs } from '../effects.js';
import { OWNER_NEUTRAL } from '@crawlout/protocol';
import { applyCommand } from './commands.js';
import {
  ORDER_NONE,
  ORDER_ATTACK_MOVE,
  C,
  SLAVE_SLAVE,
  SLAVE_CAPTIVE,
  BSTATE_DONE,
} from '../ecs/world.js';
import {
  AI_SITE_RING,
  OWN_SIDE_DEN,
  OWN_SIDE_NUM,
  TURRET_FORWARD_CELLS,
  localDist,
  ownClaimNear,
  rallyCell,
  stepAlong,
  walkSums,
} from './ai.geometry.js';
import type { Fields } from './ai.geometry.js';

/**
 * Vrije plek voor een gebouw volgens de plaatsingsregel (systems/placement.ts, sim.json placement): footprint plus een
 * vrije rand van clearance cellen, niet op of naast nodes of claimpunten, en de gang rond een depot vrij. Het anker is
 * het hoofdgebouw (AI_SITE_HQ), het eigen claimpunt het dichtst bij huis (AI_SITE_CLAIM) of het dichtst bij de vijand
 * (AI_SITE_FRONT), beide op padafstand; zonder eigen claimpunt het hoofdgebouw. Een gebouw met een wapen (turret) zoekt
 * vanaf een punt voor het anker, langs de weg naar de spawn van de vijand, zodat een aanval binnen zijn bereik komt.
 * Een plek moet vanaf het anker te belopen zijn zonder grote omweg (lokale padafstand hoogstens 2 maal de ring plus 2):
 * nooit aan de overkant van een rivier of bosrand.
 */
export function findSite(
  ctx: SimContext,
  p: number,
  hq: number,
  bt: SimBuildingType,
  site: number,
  fields: Fields,
  reach: WorkReach | null = null,
): { x: number; y: number } | null {
  const w = ctx.world;
  const map = ctx.map;
  // data 0.21.0 (Raiders): a slave builder builds only within its work reach (a claim building anywhere), and a
  // building with a distance rule to the headquarters (the Kooi) only within that range (systems/placement.ts)
  const limit = reach !== null && (bt.provides & PROVIDES_CLAIM) === 0 ? reach : null;
  const hqs = bt.hqRange === null ? null : hqCentres(ctx, p);
  let cx = w.fx[hq]! + (w.fw[hq]! >> 1);
  let cy = w.fy[hq]! + (w.fh[hq]! >> 1);
  let rx = w.fx[hq]!;
  let ry = w.fy[hq]!;
  let rw = w.fw[hq]!;
  let rh = w.fh[hq]!;
  let half = w.fw[hq]! >> 1;
  if (site !== AI_SITE_HQ) {
    const f = site === AI_SITE_FRONT && fields.enemy !== null ? fields.enemy : fields.home;
    const pt = ownClaimNear(ctx, p, f);
    if (pt >= 0) {
      cx = w.x[pt]! >> 8;
      cy = w.y[pt]! >> 8;
      rx = cx;
      ry = cy;
      rw = 1;
      rh = 1;
      half = 1;
    }
  }
  if (bt.damage > 0 && fields.enemy !== null) {
    const at = stepAlong(
      ctx,
      fields.enemy,
      fields.enemyCx,
      fields.enemyCy,
      cx,
      cy,
      half + TURRET_FORWARD_CELLS + (bt.footprintW >> 1),
    );
    cx = clampI(at.cx, 0, map.w - 1);
    cy = clampI(at.cy, 0, map.h - 1);
    rx = cx;
    ry = cy;
    rw = 1;
    rh = 1;
  }
  // Het verzamelpunt bij het hoofdgebouw blijft vrij: een groep die naar een punt in een gebouw loopt komt nooit aan en
  // blijft op AttackMove staan (een woning van 3x3 kwam er in een potje precies op te staan).
  const rally = rallyCell(ctx, hq, fields);
  const local = localDist(ctx, rx, ry, rw, rh, AI_SITE_RING + half + 2);
  // Op de eerste ring met een vrije plek: de plek het dichtst bij het midden van de map, dan het dichtst bij het anker,
  // dan rechts van de richting anker naar midden.
  // Op een puntsymmetrische map kiezen beide spelers zo elkaars spiegelbeeld (de scanvolgorde is dat niet). Gemeten
  // tussen de middens van de footprints in halve cellen: het midden van de map en van een footprint van even breedte
  // ligt op een celgrens, en een ring rond één cel zou voor de twee spelers andere footprints bevatten.
  const fw = bt.footprintW;
  const fh = bt.footprintH;
  const ax2 = 2 * rx + rw;
  const ay2 = 2 * ry + rh;
  // Kandidaten: elke footprint waarvan het midden binnen AI_SITE_RING cellen (Chebyshev) van het midden van het anker
  // ligt. Ring r2 is die afstand in halve cellen; de eerste ring met een vrije plek wint, daarbinnen m en a.
  const R2 = 2 * AI_SITE_RING;
  // Begaanbaarheid als somtabel over het zoekvenster (plus de rand van één cel): een footprint is vrij als zijn som
  // gelijk is aan zijn oppervlak. Buiten de map telt als onbegaanbaar, zoals in footprintFree.
  // de rand van de plaatsingsregel in hele cellen (de rest van de regel: neighbourReason hieronder)
  const mc = marginCells(ctx.config.placement.clearance);
  const sx0 = cx - AI_SITE_RING - fw - mc;
  const sy0 = cy - AI_SITE_RING - fh - mc;
  const sw = 2 * AI_SITE_RING + 2 * fw + 2 * mc + 2;
  const sh = 2 * AI_SITE_RING + 2 * fh + 2 * mc + 2;
  const input = placementInput(ctx);
  const terr = territoryOf(ctx, p);
  const as = placeAs(bt);
  const sat = walkSums(ctx, sx0, sy0, sw, sh);
  const freeRect = (x: number, y: number, ww: number, hh: number): boolean => {
    const ax = x - sx0;
    const ay = y - sy0;
    if (ax < 0 || ay < 0 || ax + ww > sw || ay + hh > sh) return false;
    const W1 = sw + 1;
    const sum =
      sat[(ay + hh) * W1 + ax + ww]! -
      sat[ay * W1 + ax + ww]! -
      sat[(ay + hh) * W1 + ax]! +
      sat[ay * W1 + ax]!;
    return sum === ww * hh;
  };
  let found = -1;
  let bestR = 0;
  let bestM = 0;
  let bestA = 0;
  let bestX = 0;
  const idx = ctx.index;
  idx.refresh(w);
  for (let fy = cy - AI_SITE_RING - fh; fy <= cy + AI_SITE_RING; fy++) {
    for (let fx = cx - AI_SITE_RING - fw; fx <= cx + AI_SITE_RING; fx++) {
      const x2 = 2 * fx + fw;
      const y2 = 2 * fy + fh;
      const ex = x2 > ax2 ? x2 - ax2 : ax2 - x2;
      const ey = y2 > ay2 ? y2 - ay2 : ay2 - y2;
      const r2 = ex > ey ? ex : ey;
      if (r2 < 2 || r2 > R2) continue;
      const m = (x2 - map.w) * (x2 - map.w) + (y2 - map.h) * (y2 - map.h);
      const a = (x2 - ax2) * (x2 - ax2) + (y2 - ay2) * (y2 - ay2);
      // laatste tiebreak: rechts van de richting anker naar midden van de map (kruisproduct, gelijk onder de spiegel)
      const xr = (map.w - ax2) * (y2 - ay2) - (map.h - ay2) * (x2 - ax2);
      if (
        found >= 0 &&
        (r2 > bestR ||
          (r2 === bestR &&
            (m > bestM || (m === bestM && (a > bestA || (a === bestA && xr <= bestX))))))
      )
        continue;
      if (!freeRect(fx - mc, fy - mc, fw + 2 * mc, fh + 2 * mc)) continue;
      if (
        rally !== null &&
        rally.cx >= fx &&
        rally.cx < fx + fw &&
        rally.cy >= fy &&
        rally.cy < fy + fh
      )
        continue;
      // te belopen vanaf het anker zonder grote omweg (de dichtstbijzijnde cel van de footprint)
      let ld = -1;
      for (let y = fy; y < fy + fh; y++) {
        for (let x = fx; x < fx + fw; x++) {
          const lx = x - local.x0;
          const ly = y - local.y0;
          if (lx < 0 || ly < 0 || lx >= local.ww) continue;
          const v = local.d[ly * local.ww + lx];
          if (v !== undefined && v >= 0 && (ld < 0 || v < ld)) ld = v;
        }
      }
      if (ld < 0 || ld > r2 + 2) continue;
      // het eigen gebied (data 0.20.0): de footprint raakt een cel binnen bouwbereik van een eigen gebouw
      if (terr !== null && !touchesTerritory(terr, map.w, fx, fy, fw, fh)) continue;
      if (
        limit !== null &&
        (limit.r < 0 || distToRect2(limit.x, limit.y, fx, fy, fw, fh) > limit.r * limit.r)
      )
        continue;
      if (hqs !== null && !inHqRange(hqs, bt.hqRange!.min, bt.hqRange!.max, fx, fy, fw, fh))
        continue;
      // nodes, claimpunten en de gang rond een depot (de rand zelf is hierboven al vrij en begaanbaar)
      if (neighbourReason(input, fx, fy, fw, fh, as) !== PLACE_OK) continue;
      found = (fy + (fh >> 1)) * map.w + fx + (fw >> 1);
      bestR = r2;
      bestM = m;
      bestA = a;
      bestX = xr;
    }
  }
  if (found >= 0) return cellCenterOf(map, found);
  return null;
}

/**
 * Of claimpunt pt aan de eigen kant ligt: op padafstand duidelijk dichter bij het eigen hoofdgebouw dan bij de spawn van
 * de vijand (OWN_SIDE_NUM/DEN op de kwadraten). Zonder vijand ligt alles aan de eigen kant.
 */
export function isOwnSide(ctx: SimContext, pt: number, fields: Fields): boolean {
  if (fields.enemy === null) return true;
  const w = ctx.world;
  const h = ctx.terrainDist.at(fields.home, w.x[pt]!, w.y[pt]!);
  const e = ctx.terrainDist.at(fields.enemy, w.x[pt]!, w.y[pt]!);
  return h * h * OWN_SIDE_DEN < e * e * OWN_SIDE_NUM;
}

/** Eerste tegenstander na p (cyclisch) die nog meedoet, of -1. */
export function enemyOf(ctx: SimContext, p: number): number {
  for (let k = 1; k < ctx.playerCount; k++) {
    let q = p + k;
    if (q >= ctx.playerCount) q -= ctx.playerCount;
    if (ctx.ps.defeated[q] === 0) return q;
  }
  return -1;
}

/** Of node j binnen exclusiveRadius ligt van een claimpunt van p (dan is hij exclusief van p). */
export function exclusiveFor(ctx: SimContext, j: number, p: number): boolean {
  const w = ctx.world;
  const r = ctx.config.exclusiveRadius;
  for (const pt of ctx.claimPoints) {
    if (w.owner[pt] !== p) continue;
    const dx = w.x[j]! - w.x[pt]!;
    const dy = w.y[j]! - w.y[pt]!;
    if (dx * dx + dy * dy <= r * r) return true;
  }
  return false;
}

/** Het eerste unittype uit het script waarvoor speler p de techs heeft, of 0. */
export function armyType(ctx: SimContext, p: number, script: SimAiScript): number {
  for (const t of script.armyTypeIds) {
    const u = ctx.unitType(t);
    if (
      u !== undefined &&
      u.factionId === ctx.players[p]!.factionId &&
      hasTechs(ctx, p, u.prereqTech)
    )
      return t;
  }
  return 0;
}

/**
 * De held zonder taak claimt een punt zonder paal (data 0.20.0, ai/*.json heroClaimRadiusM, sim.json heroClaimS): ligt
 * er een neutraal claimpunt binnen heroClaimRadius van hem (hemelsbreed; het dichtstbijzijnde, dan de laagste index),
 * dan loopt hij erheen en blijft hij in de cirkel staan tot het van zijn speler is. True als de held daarmee bezig is
 * (dan gaat hij niet mee naar het verzamelpunt). Alleen zonder dreiging (de aanroeper).
 */
export function heroClaimNear(
  ctx: SimContext,
  p: number,
  hero: number,
  script: SimAiScript,
): boolean {
  const w = ctx.world;
  const rr = script.heroClaimRadius;
  if (rr <= 0 || ctx.config.heroClaimTicks <= 0) return false;
  let best = -1;
  let bestD = 0;
  for (const pt of ctx.claimPoints) {
    if (w.owner[pt] !== OWNER_NEUTRAL) continue;
    const dx = w.x[pt]! - w.x[hero]!;
    const dy = w.y[pt]! - w.y[hero]!;
    const d = dx * dx + dy * dy;
    if (d > rr * rr || (best >= 0 && d >= bestD)) continue;
    best = pt;
    bestD = d;
  }
  if (best < 0) return false;
  // already standing in the circle (well inside, so the separation does not push him out): stay
  const inner = ctx.config.claimRadius - 256;
  if (bestD <= inner * inner) return true;
  applyCommand(ctx, {
    playerId: p,
    seq: 0,
    type: 'Move',
    payload: { ids: [w.idOf(hero)], x: w.x[best]!, y: w.y[best]! },
  });
  return true;
}

/**
 * defendHqFirst (data 0.24.0): adds to `idle` every unit of `units` that is not on a push (an AttackMove to the enemy
 * spawn) and not already heading for a point within defendRadius (r2 squared) of the threat: AttackMove units elsewhere
 * and, with `orderless`, units without an order. Crafting and liberating units keep their order.
 */
export function drawToThreat(
  ctx: SimContext,
  threat: number,
  enemySpawn: { x: number; y: number },
  r2: number,
  units: readonly number[],
  idle: number[],
  orderless: boolean,
): void {
  const w = ctx.world;
  for (const id of units) {
    if (idle.includes(id)) continue;
    const i = w.resolve(id);
    const ord = w.orderType(i);
    if (ord === ORDER_NONE) {
      if (orderless) idle.push(id);
      continue;
    }
    if (ord !== ORDER_ATTACK_MOVE) continue;
    const o = w.currentOrder(i);
    const x = w.ordX[o]!;
    const y = w.ordY[o]!;
    const isPush = x === enemySpawn.x && y === enemySpawn.y;
    const dx = x - w.x[threat]!;
    const dy = y - w.y[threat]!;
    const nearThreat = dx * dx + dy * dy <= r2;
    if (!isPush && !nearThreat) idle.push(id);
  }
}

/**
 * Liberation (data 0.24.0, ai/*.json liberate): with at least minFree idle militia, the visible slave or captive of
 * another player within `radius` of one of p's buildings, nearest p's headquarters (then the lowest index), gets up to
 * `units` of them, nearest first (then the lowest index), with Attack: walk up and touch it (systems/slaves.ts frees it
 * when no guard of its owner stands near). They leave `idle` (they are on a task now); once the slave is freed the
 * Attack ends and they are idle again. Only what p sees (fog of war), no other knowledge.
 */
export function liberate(
  ctx: SimContext,
  p: number,
  hq: number,
  lb: NonNullable<SimAiScript['liberate']>,
  idle: number[],
): void {
  if (idle.length < lb.minFree) return;
  const w = ctx.world;
  const idx = ctx.index;
  idx.refresh(w);
  const r2 = lb.radius * lb.radius;
  let best = -1;
  let bestD = 0;
  for (let j = 0; j < w.highWater; j++) {
    if (w.alive[j] !== 1 || !w.has(j, C.unit | C.health)) continue;
    const st = w.slaveState[j]!;
    if (st !== SLAVE_SLAVE && st !== SLAVE_CAPTIVE) continue;
    const o = w.owner[j]!;
    if (o === p || o >= ctx.playerCount || !visibleTo(w, j, p)) continue;
    const x = w.x[j]!;
    const y = w.y[j]!;
    let near = false;
    for (let k = 0; k < idx.buildingCount && !near; k++) {
      const b = idx.buildings[k]!;
      if (w.owner[b] === p && distToRect2(x, y, w.fx[b]!, w.fy[b]!, w.fw[b]!, w.fh[b]!) <= r2)
        near = true;
    }
    if (!near) continue;
    const d = distToRect2(x, y, w.fx[hq]!, w.fy[hq]!, w.fw[hq]!, w.fh[hq]!);
    if (best < 0 || d < bestD) {
      best = j;
      bestD = d;
    }
  }
  if (best < 0) return;
  const send: number[] = [];
  while (send.length < lb.units && idle.length > 0) {
    let k = -1;
    let kd = 0;
    for (let q = 0; q < idle.length; q++) {
      const i = w.resolve(idle[q]!);
      const dx = w.x[i]! - w.x[best]!;
      const dy = w.y[i]! - w.y[best]!;
      const d = dx * dx + dy * dy;
      if (k < 0 || d < kd || (d === kd && i < w.resolve(idle[k]!))) {
        k = q;
        kd = d;
      }
    }
    send.push(idle[k]!);
    idle.splice(k, 1);
  }
  applyCommand(ctx, {
    playerId: p,
    seq: 0,
    type: 'Attack',
    payload: { ids: send, target: w.idOf(best) },
  });
}

/**
 * Robotproductie van de AI (data 0.16.0, ai/*.json robots): zolang er minder dan max robots zijn (levend plus in
 * productie), bestelt hij in een vrije eigen fabriek het volgende type uit de volgorde (cyclisch, PlayerState.aiRobot);
 * een type zonder de techs slaat hij over, een type dat hij nog niet kan betalen of dat niet in popCapMax past laat hij
 * wachten. Data 0.17.0: alleen van wat boven `reserve` zit; geeft de prijs als hij met een vrije fabriek alleen op scrap
 * wacht (om voor te sparen), anders 0.
 */
export function produceRobot(
  ctx: SimContext,
  p: number,
  rs: NonNullable<SimAiScript['robots']>,
  have: number,
  reserve: number,
): number {
  if (have >= rs.max) return 0;
  const n = rs.typeIds.length;
  for (let k = 0; k < n; k++) {
    const at = imod(ctx.ps.aiRobot[p]! + k, n);
    const t = ctx.unitType(rs.typeIds[at]!);
    if (t === undefined || t.producedAtTypeId === 0 || !hasTechs(ctx, p, t.prereqTech)) continue;
    return orderRobot(ctx, p, t, reserve, () => {
      ctx.ps.aiRobot[p] = at + 1 < n ? at + 1 : 0;
    });
  }
  return 0;
}

/**
 * Data 0.26.0 (voorstel, ter bevestiging door de architect; ai/*.json robots.builders): a builder robot while there are
 * fewer than max (alive plus in production) and its techs are researched, the same way as produceRobot (the first
 * free factory, the price to save for). -1: none is due, the combat robots go on.
 */
export function builderRobotStep(
  ctx: SimContext,
  p: number,
  rb: NonNullable<NonNullable<SimAiScript['robots']>['builders']>,
  have: number,
  reserve: number,
): number {
  if (have >= rb.max) return -1;
  const t = ctx.unitType(rb.typeId);
  if (t === undefined || t.producedAtTypeId === 0 || !hasTechs(ctx, p, t.prereqTech)) return -1;
  return orderRobot(ctx, p, t, reserve);
}

/** Produce type t in the first free own factory of its type: 0 (ordered, or no free factory) or the price to save for. */
function orderRobot(
  ctx: SimContext,
  p: number,
  t: SimUnitType,
  reserve: number,
  onOrdered?: () => void,
): number {
  const w = ctx.world;
  let b = -1;
  for (let i = 0; i < w.highWater && b < 0; i++) {
    if (
      w.has(i, C.building) &&
      w.owner[i] === p &&
      w.typeId[i] === t.producedAtTypeId &&
      w.bstate[i] === BSTATE_DONE &&
      w.job[i] === 0 &&
      w.research[i] === 0
    )
      b = i;
  }
  if (b < 0) return 0;
  if (ctx.ps.scrap[p]! < t.scrapCost + reserve) return t.scrapCost;
  if (
    applyCommand(ctx, {
      playerId: p,
      seq: 0,
      type: 'Produce',
      payload: { buildingId: w.idOf(b), loadoutId: t.loadoutId },
    })
  )
    onOrdered?.();
  return 0;
}
