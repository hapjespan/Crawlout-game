import { EVENT_TYPE, OWNER_NEUTRAL } from '@crawlout/protocol';
import { CLAIM_POINT_TYPE_ID, SCRAP_NODE_TYPE_ID } from '@crawlout/data';
import type { SimBuildingType, SimUnitType } from './config.js';
import { BSTATE_DONE, BSTATE_SITE, C, NO_ENTITY, NO_FIELD, NO_GOAL } from './ecs/world.js';
import { PROVIDES_HQ } from './fromData.js';
import { idiv } from './math/int.js';
import type { SimContext } from './systems/common.js';
import { nearestFreeCellAround, placeOnCell, setFlowField } from './systems/common.js';

// Aanmaken, ombouwen en opruimen van entities. Alle paden lopen hierlangs, ook de startopstelling en de commando's.

/** Zet de unit-componenten van type t op index i (spawn en omscholen). Houdt hp, positie en orders. */
export function applyUnitType(ctx: SimContext, i: number, t: SimUnitType): void {
  const w = ctx.world;
  w.typeId[i] = t.typeId;
  w.loadoutId[i] = t.loadoutId;
  w.bodyType[i] = t.bodyType;
  w.role[i] = t.role;
  w.armorType[i] = t.armorType;
  w.speed[i] = t.speed;
  w.radius[i] = t.radius;
  w.maxHp[i] = t.maxHp;
  if (w.hp[i]! > t.maxHp) w.hp[i] = t.maxHp;
  w.damage[i] = t.damage;
  w.damageType[i] = t.damageType;
  w.range[i] = t.range;
  w.cooldownMax[i] = t.cooldown;
  if (w.cooldown[i]! > t.cooldown) w.cooldown[i] = t.cooldown;
  w.carry[i] = 0;
}

/** Nieuwe unit op (x, y); geen controle op begaanbaarheid. Geeft de index of -1 als de wereld vol is. */
export function createUnit(ctx: SimContext, t: SimUnitType, owner: number, x: number, y: number, yaw: number): number {
  const w = ctx.world;
  const i = w.alloc();
  if (i < 0) return -1;
  w.mask[i] = C.transform | C.movement | C.health | C.owner | C.unit | C.orders | C.combat;
  w.x[i] = x;
  w.y[i] = y;
  w.yaw[i] = yaw & 0xffff;
  w.owner[i] = owner;
  w.hp[i] = t.maxHp;
  applyUnitType(ctx, i, t);
  ctx.events.push(EVENT_TYPE.spawn, w.idOf(i), t.typeId, x, y);
  return i;
}

/** Of de footprint met oorsprong (fx, fy) binnen de map ligt en volledig begaanbaar en vrij is. */
export function footprintFree(ctx: SimContext, fx: number, fy: number, fw: number, fh: number): boolean {
  const map = ctx.map;
  if (fx < 0 || fy < 0 || fx + fw > map.w || fy + fh > map.h) return false;
  for (let y = fy; y < fy + fh; y++) {
    for (let x = fx; x < fx + fw; x++) if (ctx.terrain.walk[y * map.w + x] !== 1) return false;
  }
  return true;
}

/** Oorsprong (linksboven, in cellen) van een footprint waarvan de cel van (x, y) het midden is. */
export const footprintOrigin = (x: number, y: number, fw: number, fh: number): { fx: number; fy: number } => ({
  fx: (x >> 8) - (fw >> 1),
  fy: (y >> 8) - (fh >> 1),
});

/**
 * Nieuw gebouw (bouwplaats of af) met footprint op (fx, fy). De cellen worden onbegaanbaar, units erin worden naar
 * de dichtstbijzijnde vrije cel ernaast gezet, en alle flow fields beginnen opnieuw. Controleert niets; zie footprintFree.
 */
export function createBuilding(ctx: SimContext, bt: SimBuildingType, owner: number, fx: number, fy: number, done: boolean): number {
  const w = ctx.world;
  const i = w.alloc();
  if (i < 0) return -1;
  w.mask[i] = C.transform | C.health | C.owner | C.building;
  w.fx[i] = fx;
  w.fy[i] = fy;
  w.fw[i] = bt.footprintW;
  w.fh[i] = bt.footprintH;
  w.x[i] = (fx << 8) + (bt.footprintW << 7);
  w.y[i] = (fy << 8) + (bt.footprintH << 7);
  w.owner[i] = owner;
  w.typeId[i] = bt.typeId;
  w.armorType[i] = bt.armorType;
  w.maxHp[i] = bt.maxHp;
  const instant = done || bt.buildTicks === 0;
  w.bstate[i] = instant ? BSTATE_DONE : BSTATE_SITE;
  w.progress[i] = instant ? bt.buildTicks : 0;
  w.hp[i] = instant ? bt.maxHp : 1;
  if ((bt.provides & PROVIDES_HQ) !== 0) ctx.ps.hadHq[owner] = 1;
  ctx.terrain.setRect(i, fx, fy, bt.footprintW, bt.footprintH, true);
  displaceUnits(ctx, fx, fy, bt.footprintW, bt.footprintH);
  ctx.flow.invalidateAll();
  const id = w.idOf(i);
  ctx.events.push(EVENT_TYPE.buildingPlaced, id, bt.typeId, w.x[i]!, w.y[i]!);
  if (instant) ctx.events.push(EVENT_TYPE.buildingDone, id, bt.typeId, w.x[i]!, w.y[i]!);
  return i;
}

/** Zet units die in een (nu geblokkeerde) rechthoek staan op de dichtstbijzijnde vrije cel ernaast. */
function displaceUnits(ctx: SimContext, fx: number, fy: number, fw: number, fh: number): void {
  const w = ctx.world;
  const x0 = fx << 8;
  const y0 = fy << 8;
  const x1 = (fx + fw) << 8;
  const y1 = (fy + fh) << 8;
  for (let j = 0; j < w.highWater; j++) {
    if (!w.has(j, C.unit)) continue;
    const x = w.x[j]!;
    const y = w.y[j]!;
    if (x < x0 || x >= x1 || y < y0 || y >= y1) continue;
    const c = nearestFreeCellAround(ctx, fx, fy, fw, fh, x, y);
    if (c >= 0) placeOnCell(ctx, j, c);
  }
}

/** Haalt een gebouw weg: cellen weer vrij, flow fields opnieuw, entity vrij. */
export function removeBuilding(ctx: SimContext, i: number): void {
  const w = ctx.world;
  ctx.terrain.setRect(i, w.fx[i]!, w.fy[i]!, w.fw[i]!, w.fh[i]!, false);
  ctx.flow.invalidateAll();
  w.free(i);
}

export function createScrapNode(ctx: SimContext, x: number, y: number, amount: number): number {
  const w = ctx.world;
  const i = w.alloc();
  if (i < 0) return -1;
  w.mask[i] = C.transform | C.owner | C.resource;
  w.x[i] = x;
  w.y[i] = y;
  w.owner[i] = OWNER_NEUTRAL;
  w.typeId[i] = SCRAP_NODE_TYPE_ID;
  w.amount[i] = amount;
  w.maxHp[i] = amount; // startvoorraad: snapshot-hpPct is de resterende voorraad in procenten (contract 1)
  return i;
}

export function createClaimPoint(ctx: SimContext, x: number, y: number): number {
  const w = ctx.world;
  const i = w.alloc();
  if (i < 0) return -1;
  w.mask[i] = C.transform | C.owner | C.claim;
  w.x[i] = x;
  w.y[i] = y;
  w.owner[i] = OWNER_NEUTRAL;
  w.claimBy[i] = OWNER_NEUTRAL;
  w.typeId[i] = CLAIM_POINT_TYPE_ID;
  return i;
}

/** Een gedode unit wordt een lijk: alleen nog positie, eigenaar en type; anim death tot corpseTicks op is. */
export function makeCorpse(ctx: SimContext, i: number): void {
  const w = ctx.world;
  setFlowField(ctx, i, NO_FIELD);
  w.clearOrders(i);
  w.mask[i] = C.transform | C.owner | C.unit | C.corpse;
  w.mvOn[i] = 0;
  w.goalX[i] = NO_GOAL;
  w.goalY[i] = NO_GOAL;
  w.hp[i] = 0;
  w.target[i] = NO_ENTITY;
  w.carry[i] = 0;
  w.work[i] = ctx.config.corpseTicks;
}

/** Hoeveelheid uit een node halen; een lege node verdwijnt met resourceDepleted. Geeft wat er gehaald is. */
export function takeFromNode(ctx: SimContext, node: number, want: number): number {
  const w = ctx.world;
  const have = w.amount[node]!;
  const take = want < have ? want : have;
  w.amount[node] = have - take;
  if (have - take <= 0) {
    ctx.events.push(EVENT_TYPE.resourceDepleted, w.idOf(node), 0, w.x[node]!, w.y[node]!);
    w.free(node);
  }
  return take;
}

/** hp van een bouwplaats groeit mee met de voortgang: van 1 naar maxHp. */
export function siteHpStep(maxHp: number, buildTicks: number, p: number): number {
  return idiv((maxHp - 1) * (p + 1), buildTicks) - idiv((maxHp - 1) * p, buildTicks);
}
