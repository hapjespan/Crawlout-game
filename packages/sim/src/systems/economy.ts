import { ROLES } from '@crawlout/data';
import {
  BSTATE_DONE,
  BSTATE_SITE,
  C,
  JOB_PRODUCE,
  JOB_TRAIN,
  ORDER_BUILD,
  ORDER_CRAFT,
  ORDER_GATHER,
  PHASE_CRAFT,
  PHASE_GO,
  PHASE_RETURN,
  PHASE_WORK,
} from '../ecs/world.js';
import {
  SPECIAL_C,
  SPECIAL_I,
  STAT_BUILD_TIME,
  STAT_RESEARCH_TIME,
  effectSum,
  gatherAmountOf,
  liveHeroBonus,
  refreshPlayer,
  scalePermille,
  workRate,
} from '../effects.js';
import { heroSystem } from './hero.js';
import { productionWork, repairWork } from './robots.js';
import { safetyNetSystem } from './safetyNet.js';
import { trainingWork } from './training.js';
import { chemSystem } from './chems.js';
import { tributeSystem } from './plunder.js';
import { slaveSystem } from './slaves.js';
import {
  PROGRESS_ONE,
  applyUnitType,
  completeBuilding,
  createUnit,
  siteHpAt,
  takeFromNode,
} from '../entities.js';
import { imod } from '../math/int.js';
import type { Census } from './census.js';
import { takeCensus } from './census.js';
import type { SimContext } from './common.js';
import {
  cellCenterOf,
  nearestReachableBuilding,
  nodeAllowed,
  nthFreeCellAround,
  SPAWN_SPREAD,
  playerInTurn,
  withinReach,
} from './common.js';
import { DEPOT_MASK, autoGather } from './orders.js';
import { PROVIDES_WORKSHOP } from '../fromData.js';

// Systeem 6: economie. Verzamelen (een rit duurt gatherTicks en levert gatherAmount), afleveren bij een depot,
// bouwen (elke bouwer in bereik telt één tick voortgang), omscholen in de werkplaats (betalen, dan craftTicks
// wachten) en huisvestingsgroei. Units in oplopende id-volgorde; dat bepaalt wie eerst betaalt.

export function economySystem(ctx: SimContext, census: Census): void {
  const w = ctx.world;
  const reach = ctx.config.interactRange;
  const need = C.unit | C.orders;
  for (let i = 0; i < w.highWater; i++) {
    if (!w.has(i, need)) continue;
    const type = w.orderType(i);
    if (type === ORDER_GATHER) gatherWork(ctx, i, reach);
    else if (type === ORDER_BUILD) buildWork(ctx, i, reach);
    else if (type === ORDER_CRAFT) craftWork(ctx, i);
  }
  for (let i = 0; i < w.highWater; i++) {
    if (!w.has(i, C.building)) continue;
    if (w.research[i] !== 0) researchWork(ctx, i);
    // data 0.16.0: robotproductie en training in voltooide gebouwen
    if (w.jobKind[i] === JOB_PRODUCE) productionWork(ctx, i);
    else if (w.jobKind[i] === JOB_TRAIN) trainingWork(ctx, i);
  }
  repairWork(ctx);
  // Raiders (data 0.21.0, sim 0.18.0): captives, liberation and revolt; chems; tribute
  slaveSystem(ctx, ROLE_MILITIA);
  chemSystem(ctx);
  tributeSystem(ctx);
  takeCensus(ctx, census);
  // de groei in dezelfde doordraaiende beurtvolgorde als de AI: wie eerst groeit, krijgt de lagere index
  for (let k = 0; k < ctx.playerCount; k++) growth(ctx, census, playerInTurn(ctx, k));
  safetyNetSystem(ctx, census);
  heroSystem(ctx, census);
}

/** Onderzoek in gebouw i: werk per tick volgens researchTimePct; klaar zet de tech-bit en past de effecten toe. */
function researchWork(ctx: SimContext, i: number): void {
  const w = ctx.world;
  const t = ctx.config.techs[w.research[i]! - 1];
  const p = w.owner[i]!;
  if (t === undefined) {
    w.research[i] = 0;
    w.researchPaid[i] = 0;
    return;
  }
  const intel = liveHeroBonus(ctx, p, SPECIAL_I, ctx.config.special.intelligenceResearchPermille);
  w.work[i] =
    w.work[i]! +
    workRate(PROGRESS_ONE, effectSum(ctx, p, STAT_RESEARCH_TIME, w.typeId[i]!, false) + intel);
  if (w.work[i]! < t.researchTicks * PROGRESS_ONE) return;
  w.research[i] = 0;
  w.researchPaid[i] = 0;
  w.work[i] = 0;
  ctx.ps.tech[p] = (ctx.ps.tech[p]! | (1 << t.techId)) >>> 0;
  refreshPlayer(ctx, p);
}

function gatherWork(ctx: SimContext, i: number, reach: number): void {
  const w = ctx.world;
  const t = ctx.unitType(w.typeId[i]!);
  if (t === undefined) return;
  if (w.phase[i] === PHASE_WORK) {
    const node = w.resolve(w.ordT[w.currentOrder(i)]!);
    if (
      node < 0 ||
      !w.has(node, C.resource) ||
      !withinReach(w, i, node, reach) ||
      !nodeAllowed(ctx, node, w.owner[i]!)
    )
      return;
    w.work[i] = w.work[i]! + 1;
    if (w.work[i]! < t.gatherTicks) return;
    const want = gatherAmountOf(ctx, i) - w.carry[i]!;
    w.carry[i] = w.carry[i]! + takeFromNode(ctx, node, want > 0 ? want : 0);
    w.work[i] = 0;
    w.phase[i] = PHASE_RETURN;
  } else if (w.phase[i] === PHASE_RETURN) {
    const dep = nearestReachableBuilding(ctx, w.owner[i]!, w.x[i]!, w.y[i]!, DEPOT_MASK);
    if (dep < 0 || !withinReach(w, i, dep, reach)) return;
    const p = w.owner[i]!;
    ctx.ps.scrap[p] = ctx.ps.scrap[p]! + w.carry[i]!;
    w.carry[i] = 0;
    w.phase[i] = PHASE_GO;
  }
}

function buildWork(ctx: SimContext, i: number, reach: number): void {
  const w = ctx.world;
  if (w.phase[i] !== PHASE_WORK) return;
  const b = w.resolve(w.ordT[w.currentOrder(i)]!);
  if (b < 0 || !w.has(b, C.building) || w.bstate[b] !== BSTATE_SITE || !withinReach(w, i, b, reach))
    return;
  const bt = ctx.buildingType(w.typeId[b]!);
  if (bt === undefined) return;
  const total = bt.buildTicks * PROGRESS_ONE;
  const p0 = w.progress[b]!;
  const rate = workRate(
    PROGRESS_ONE,
    effectSum(ctx, w.owner[i]!, STAT_BUILD_TIME, w.typeId[i]!, false),
  );
  const p1 = p0 + rate < total ? p0 + rate : total;
  w.hp[b] = w.hp[b]! + siteHpAt(w.maxHp[b]!, total, p1) - siteHpAt(w.maxHp[b]!, total, p0);
  w.progress[b] = p1;
  if (p1 >= total) completeBuilding(ctx, b, bt);
}

function craftWork(ctx: SimContext, i: number): void {
  const w = ctx.world;
  const t = ctx.unitType(w.ordX[w.currentOrder(i)]!);
  if (t === undefined) {
    w.popOrder(i);
    return;
  }
  const p = w.owner[i]!;
  if (w.phase[i] === PHASE_WORK) {
    if (ctx.ps.scrap[p]! < t.scrapCost) return; // wachten op scrap
    ctx.ps.scrap[p] = ctx.ps.scrap[p]! - t.scrapCost;
    w.phase[i] = PHASE_CRAFT;
    w.work[i] = 0;
  } else if (w.phase[i] === PHASE_CRAFT) {
    w.work[i] = w.work[i]! + 1;
  } else return;
  if (w.work[i]! < t.craftTicks) return;
  applyUnitType(ctx, i, t);
  w.popOrder(i);
}

const ROLE_BUILDER = ROLES.indexOf('builder');
const ROLE_MILITIA = ROLES.indexOf('militia');

/** Of speler p geen voltooide werkplaats heeft en geen bouwer (ook niet in opleiding tot bouwer). */
function needsBuilder(ctx: SimContext, p: number): boolean {
  const w = ctx.world;
  for (let i = 0; i < w.highWater; i++) {
    if (w.alive[i] !== 1 || w.owner[i] !== p) continue;
    if (w.has(i, C.building)) {
      const bt = ctx.buildingType(w.typeId[i]!);
      if (
        w.bstate[i] === BSTATE_DONE &&
        bt !== undefined &&
        (bt.provides & PROVIDES_WORKSHOP) !== 0
      )
        return false;
      continue;
    }
    if (!w.has(i, C.unit | C.orders | C.health) || w.has(i, C.hero)) continue;
    if (w.role[i] === ROLE_BUILDER) return false;
    if (
      w.orderType(i) === ORDER_CRAFT &&
      ctx.unitType(w.ordX[w.currentOrder(i)]!)?.role === ROLE_BUILDER
    )
      return false;
  }
  return true;
}

function growth(ctx: SimContext, census: Census, p: number): void {
  const ps = ctx.ps;
  const hq = census.hq[p]!;
  const faction = ctx.config.factions[ctx.players[p]!.factionId]!;
  const settler = faction.settlerTypeId === 0 ? undefined : ctx.unitType(faction.settlerTypeId);
  if (
    ps.defeated[p] !== 0 ||
    hq < 0 ||
    settler === undefined ||
    census.pop[p]! + settler.popCost > census.popCap(ctx, p)
  ) {
    ps.growth[p] = 0; // geen bed, geen groei (en niets opsparen)
    return;
  }
  // growth telt in duizendsten van een bewoner maal ticksPerMinute; Charisma van een levende held versnelt de groei.
  const tpm = ctx.config.ticksPerMinute * 1000;
  const charisma = liveHeroBonus(ctx, p, SPECIAL_C, ctx.config.special.charismaGrowthPermille);
  ps.growth[p] = ps.growth[p]! + scalePermille(faction.housingGrowthPerMin * 1000, charisma);
  if (ps.growth[p]! < tpm) return;
  ps.growth[p] = ps.growth[p]! - tpm;
  const w = ctx.world;
  const c = nthFreeCellAround(
    ctx,
    w.fx[hq]!,
    w.fy[hq]!,
    w.fw[hq]!,
    w.fh[hq]!,
    imod(ctx.frame, SPAWN_SPREAD),
  );
  if (c < 0) return;
  const at = cellCenterOf(ctx.map, c);
  // vangnet (Spelfundament 2.7): zonder werkplaats en zonder bouwer kan niemand meer omscholen of bouwen; dan is de
  // nieuwe bewoner een bouwer (het goedkoopste loadout van die rol), zodat de speler een werkplaats kan herbouwen
  const builderType = faction.roleTypeIds[ROLE_BUILDER] ?? 0;
  const t =
    builderType !== 0 && needsBuilder(ctx, p) ? (ctx.unitType(builderType) ?? settler) : settler;
  const u = createUnit(ctx, t, p, at.x, at.y, 0);
  if (u >= 0) autoGather(ctx, u);
  census.settlers[p] = census.settlers[p]! + 1;
  census.pop[p] = census.pop[p]! + settler.popCost;
}
