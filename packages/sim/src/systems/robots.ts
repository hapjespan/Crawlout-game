import { MAX_ENTITIES, MAX_PLAYERS } from '@crawlout/protocol';
import type { CommandPayload } from '@crawlout/protocol';
import type { SimRepair, SimUnitType } from '../config.js';
import { BSTATE_DONE, C, JOB_NONE, JOB_PRODUCE, NO_ENTITY, ORDER_NONE } from '../ecs/world.js';
import { hasTechs } from '../effects.js';
import { createUnit } from '../entities.js';
import { idiv, imod, isInt } from '../math/int.js';
import { isRobot } from './census.js';
import type { SimContext } from './common.js';
import {
  SPAWN_SPREAD,
  cellCenterOf,
  distToRect2,
  face,
  nthFreeCellAround,
  steerToEntity,
  stopMoving,
  withinReach,
} from './common.js';

// Robots van de Dwellers (data 0.15.0):
//  - Productie (loadouts producedAt, commando Produce): een voltooide eigen robotfabriek bouwt één robot tegelijk.
//    Produce rekent scrapCost meteen af en vraagt prereqTech en ruimte binnen popCapMax (bewoners, robots en robots in
//    productie; bedden spelen geen rol). Na craftTicks (systeem 6) staat de robot naast het gebouw; geen bewoner wordt
//    omgebouwd. Cancel op het gebouw geeft cancelRefundPermille terug (commands.ts).
//  - Technicus-regel (factions robotRules): dekking = levende eigen bewoners met een rol uit technicianRoles maal
//    robotsPerTechnician; de levende robots worden gedekt op oplopend entity-id. Een ongedekte robot werkt op
//    (1000 - penaltyPermille) promille: snelheid (systeem 4), aanvalstempo (systeem 5: een langere cooldown na elk
//    schot) en reparatie (systeem 6). Bij 0 promille staat hij stil en doet niets.
//  - Reparatie (loadouts repair): een unit zonder order zoekt binnen seekRange het beschadigde eigen doel (voltooid
//    gebouw of robot, niet zichzelf) met het laagste hp-aandeel, dan de laagste id; hij loopt erheen (systeem 2) en
//    herstelt binnen range milliHpPerTick duizendsten hp per tick (systeem 6), gratis, tot het doel vol is.

/** Tempo per entity van de robots zonder technicus, in promille; afgeleid, elke tick opnieuw (geen state). */
export class RobotRates {
  /** false: geen ongedekte robot deze tick, rate wordt dan niet gelezen. */
  any = false;
  readonly rate = new Int32Array(MAX_ENTITIES);
  /** Kladruimte: technici per speler. */
  readonly techs = new Int32Array(MAX_PLAYERS);
}

/** Tempo van entity i deze tick in promille (1000 = normaal). */
export const robotRate = (ctx: SimContext, i: number): number =>
  ctx.robotRates.any ? ctx.robotRates.rate[i]! : 1000;

/** Systeem 4 (vooraf): de technicus-regel. Iteratie op oplopende index, dus robots gedekt op oplopende id. */
export function robotRulesSystem(ctx: SimContext, r: RobotRates): void {
  const w = ctx.world;
  r.any = false;
  let rules = false;
  for (let p = 0; p < ctx.playerCount; p++)
    if (ctx.config.factions[ctx.players[p]!.factionId]!.robotRules !== null) rules = true;
  if (!rules) return;
  const techs = r.techs;
  techs.fill(0);
  const need = C.unit | C.health;
  let robots = 0;
  for (let i = 0; i < w.highWater; i++) {
    if (!w.has(i, need) || w.has(i, C.hero) || w.hp[i]! <= 0) continue;
    const p = w.owner[i]!;
    if (p >= ctx.playerCount) continue;
    const rr = ctx.config.factions[ctx.players[p]!.factionId]!.robotRules;
    if (rr === null) continue;
    if (isRobot(ctx, i)) robots++;
    else if (rr.technicianRoles.includes(w.role[i]!)) techs[p] = techs[p]! + 1;
  }
  if (robots === 0) return;
  // dekking per speler: technici maal robotsPerTechnician; daarna telt techs het aantal gedekte robots af
  for (let p = 0; p < ctx.playerCount; p++) {
    const rr = ctx.config.factions[ctx.players[p]!.factionId]!.robotRules;
    techs[p] = rr === null ? 0 : techs[p]! * rr.robotsPerTechnician;
  }
  for (let i = 0; i < w.highWater; i++) {
    r.rate[i] = 1000;
    if (!w.has(i, need) || w.has(i, C.hero) || !isRobot(ctx, i)) continue;
    const p = w.owner[i]!;
    if (p >= ctx.playerCount) continue;
    const rr = ctx.config.factions[ctx.players[p]!.factionId]!.robotRules;
    if (rr === null) continue;
    if (techs[p]! > 0) {
      techs[p] = techs[p]! - 1;
      continue;
    }
    r.rate[i] = 1000 - rr.penaltyPermille;
    if (rr.penaltyPermille > 0) r.any = true;
  }
}

/** Totale pop van speler p: bewoners, robots en robots in productie (zonder de held). */
export function totalPop(ctx: SimContext, p: number): number {
  const w = ctx.world;
  let pop = 0;
  for (let i = 0; i < w.highWater; i++) {
    if (w.alive[i] !== 1 || w.owner[i] !== p) continue;
    const m = w.mask[i]!;
    if ((m & (C.unit | C.health | C.hero)) === (C.unit | C.health))
      pop += ctx.unitType(w.typeId[i]!)?.popCost ?? 0;
    else if ((m & C.building) !== 0 && w.jobKind[i] === JOB_PRODUCE && w.job[i] !== 0)
      pop += ctx.unitType(w.job[i]!)?.popCost ?? 0;
  }
  return pop;
}

/** Het type dat een Produce in gebouw b kan bouwen (eigen factie, producedAt dit gebouw), of undefined. */
function producible(
  ctx: SimContext,
  p: number,
  b: number,
  loadoutId: number,
): SimUnitType | undefined {
  if (!isInt(loadoutId) || loadoutId < 0 || loadoutId >= 0xffff) return undefined;
  const t = ctx.unitType(loadoutId + 1); // unitTypeId(loadoutId) = 1 + loadoutId
  if (
    t === undefined ||
    t.loadoutId !== loadoutId ||
    t.producedAtTypeId === 0 ||
    t.producedAtTypeId !== ctx.world.typeId[b] ||
    t.factionId !== ctx.players[p]!.factionId
  )
    return undefined;
  return t;
}

/** Index van een eigen voltooid gebouw met deze id zonder werk (onderzoek of job), of -1. */
export function idleOwnBuilding(ctx: SimContext, p: number, id: number): number {
  const w = ctx.world;
  const b = isInt(id) ? w.resolve(id) : -1;
  if (
    b < 0 ||
    !w.has(b, C.building) ||
    w.owner[b] !== p ||
    w.bstate[b] !== BSTATE_DONE ||
    w.hp[b]! <= 0 ||
    w.job[b] !== 0 ||
    w.research[b] !== 0
  )
    return -1;
  return b;
}

/**
 * Produce (buildingId, loadoutId): een robot in een eigen voltooide fabriek zonder lopend werk, met prereqTech, scrap
 * en ruimte binnen popCapMax (ook voor de robots in productie). Kosten meteen.
 */
export function applyProduce(ctx: SimContext, p: number, pl: CommandPayload<'Produce'>): boolean {
  const b = idleOwnBuilding(ctx, p, pl.buildingId);
  if (b < 0) return false;
  const t = producible(ctx, p, b, pl.loadoutId);
  if (t === undefined || !hasTechs(ctx, p, t.prereqTech) || ctx.ps.scrap[p]! < t.scrapCost)
    return false;
  if (totalPop(ctx, p) + t.popCost > ctx.config.popCapMax) return false;
  const w = ctx.world;
  ctx.ps.scrap[p] = ctx.ps.scrap[p]! - t.scrapCost;
  w.job[b] = t.typeId;
  w.jobKind[b] = JOB_PRODUCE;
  w.jobWork[b] = 0;
  return true;
}

/** Systeem 6: productie in gebouw b. Na craftTicks de robot op een vrije cel naast het gebouw (wacht zonder plek). */
export function productionWork(ctx: SimContext, b: number): void {
  const w = ctx.world;
  const t = ctx.unitType(w.job[b]!);
  if (t === undefined) {
    w.job[b] = 0;
    w.jobKind[b] = JOB_NONE;
    w.jobWork[b] = 0;
    return;
  }
  if (w.jobWork[b]! < t.craftTicks) w.jobWork[b] = w.jobWork[b]! + 1;
  if (w.jobWork[b]! < t.craftTicks) return;
  const c = nthFreeCellAround(
    ctx,
    w.fx[b]!,
    w.fy[b]!,
    w.fw[b]!,
    w.fh[b]!,
    imod(ctx.frame, SPAWN_SPREAD),
  );
  if (c < 0) return;
  const at = cellCenterOf(ctx.map, c);
  if (createUnit(ctx, t, w.owner[b]!, at.x, at.y, 0) < 0) return;
  w.job[b] = 0;
  w.jobKind[b] = JOB_NONE;
  w.jobWork[b] = 0;
}

/** Of entity j een doel is dat unit i met reparatie `rep` kan herstellen (eigen, beschadigd, niet zichzelf). */
function repairable(ctx: SimContext, i: number, j: number, rep: SimRepair): boolean {
  const w = ctx.world;
  if (j === i || !w.has(j, C.health) || w.owner[j] !== w.owner[i]) return false;
  const hp = w.hp[j]!;
  if (hp <= 0 || hp >= w.maxHp[j]!) return false;
  if ((w.mask[j]! & C.building) !== 0) return rep.buildings && w.bstate[j] === BSTATE_DONE;
  return rep.robots && (w.mask[j]! & (C.unit | C.hero)) === C.unit && isRobot(ctx, j);
}

/** Of j binnen r ligt van unit i: tot de footprint bij gebouwen, tot de rand bij units. */
const near = (ctx: SimContext, i: number, j: number, r: number): boolean =>
  withinReach(ctx.world, i, j, r);

/** Het beste reparatiedoel binnen seekRange: laagste hp-aandeel, dan laagste id; -1 als er geen is. */
function seekRepair(ctx: SimContext, i: number, rep: SimRepair): number {
  const w = ctx.world;
  const r = rep.seekRange;
  const x = w.x[i]!;
  const y = w.y[i]!;
  let best = -1;
  for (let j = 0; j < w.highWater; j++) {
    if (!repairable(ctx, i, j, rep)) continue;
    if ((w.mask[j]! & C.building) !== 0) {
      if (distToRect2(x, y, w.fx[j]!, w.fy[j]!, w.fw[j]!, w.fh[j]!) > r * r) continue;
    } else if (!near(ctx, i, j, r)) continue;
    // hp-aandeel kleiner: hp[j] / max[j] < hp[best] / max[best], kruiselings vermenigvuldigd (integers)
    if (best < 0 || w.hp[j]! * w.maxHp[best]! < w.hp[best]! * w.maxHp[j]!) best = j;
  }
  return best;
}

/**
 * Systeem 2: een unit met reparatie zonder order. Houdt zijn doel zolang het te repareren is en binnen seekRange plus
 * range ligt, kiest anders een nieuw; loopt erheen of staat stil en richt. Geeft true als hij een doel heeft.
 */
export function repairIdle(ctx: SimContext, i: number, rep: SimRepair): boolean {
  const w = ctx.world;
  const cur = w.target[i]! === NO_ENTITY ? -1 : w.resolve(w.target[i]!);
  let t =
    cur >= 0 && repairable(ctx, i, cur, rep) && near(ctx, i, cur, rep.seekRange + rep.range)
      ? cur
      : -1;
  if (t < 0) t = seekRepair(ctx, i, rep);
  if (t < 0) {
    w.target[i] = NO_ENTITY;
    return false;
  }
  w.target[i] = w.idOf(t);
  if (near(ctx, i, t, rep.range)) {
    if (w.mvOn[i] === 1) stopMoving(ctx, i);
    face(w, i, w.x[t]!, w.y[t]!);
  } else steerToEntity(ctx, i, t);
  return true;
}

/** Systeem 6: herstel door elke unit met reparatie zonder order die binnen range van zijn doel staat. */
export function repairWork(ctx: SimContext): void {
  const w = ctx.world;
  const need = C.unit | C.orders | C.health;
  for (let i = 0; i < w.highWater; i++) {
    if (!w.has(i, need) || w.target[i] === NO_ENTITY || w.orderType(i) !== ORDER_NONE) continue;
    const rep = ctx.unitType(w.typeId[i]!)?.repair;
    if (rep === undefined || rep === null) continue;
    const t = w.resolve(w.target[i]!);
    if (t < 0 || !repairable(ctx, i, t, rep) || !near(ctx, i, t, rep.range)) continue;
    const acc = w.repairMilli[t]! + idiv(rep.milliHpPerTick * robotRate(ctx, i), 1000);
    const max = w.maxHp[t]!;
    const hp = w.hp[t]! + idiv(acc, 1000);
    w.hp[t] = hp < max ? hp : max;
    w.repairMilli[t] = hp < max ? acc - idiv(acc, 1000) * 1000 : 0;
  }
}
