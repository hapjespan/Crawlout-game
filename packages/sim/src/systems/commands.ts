import { COMMAND_PAYLOADS, CommandEnvelope, OWNER_NEUTRAL } from '@crawlout/protocol';
import type { CommandPayload, CommandType } from '@crawlout/protocol';
import { HERO_TYPE_BASE, ROLES, UNIT_TYPE_BASE, unitTypeId } from '@crawlout/data';
import {
  BSTATE_DONE,
  BSTATE_SITE,
  C,
  NO_ENTITY,
  ORDER_ATTACK,
  ORDER_ATTACK_MOVE,
  ORDER_BUILD,
  ORDER_CRAFT,
  ORDER_GATHER,
  ORDER_MOVE,
  PHASE_CRAFT,
} from '../ecs/world.js';
import { hasTechs } from '../effects.js';
import { createBuilding, footprintFree, footprintOrigin, removeBuilding } from '../entities.js';
import { PROVIDES_CLAIM, PROVIDES_HQ } from '../fromData.js';
import { inClaimRadius } from './claims.js';
import { applyHeroAbility, applyPickPerk, applyRecruit, cancelRevive } from './hero.js';
import { idiv, isInt } from '../math/int.js';
import { isqrt } from '../math/sqrt.js';
import type { SimContext } from './common.js';
import { WIN_SURRENDER, cellCenterOf, distToRect2, inMap, isEnemy, scanRing, steerToPoint, stopMoving } from './common.js';

// Systeem 1: commando's van deze tick toepassen. Volgorde: playerId, dan seq, dan positie in de bundel.
// De zod-validatie gebeurt eenmalig bij binnenkomst (normalizeCommand, vanuit Sim.applyBundle); hier alleen
// integer- en spelregelchecks (speler, eigenaar, kosten, bereik). Ongeldige commando's of delen ervan worden stil
// genegeerd. De scripted AI gebruikt precies dezelfde applyCommand.

/** Een gevalideerd commando: payload past bij het type. */
export type SimCommand = {
  [K in CommandType]: { readonly playerId: number; readonly seq: number; readonly type: K; readonly payload: CommandPayload<K> };
}[CommandType];

/** zod-validatie van een commando uit een bundel. null als het niet aan contract 2 voldoet. */
export function normalizeCommand(raw: unknown): SimCommand | null {
  const env = CommandEnvelope.safeParse(raw);
  if (!env.success) return null;
  const payload = COMMAND_PAYLOADS[env.data.type].safeParse(env.data.payload);
  if (!payload.success) return null;
  return { playerId: env.data.playerId, seq: env.data.seq, type: env.data.type, payload: payload.data } as SimCommand;
}

export function applyCommands(ctx: SimContext, cmds: readonly SimCommand[]): void {
  if (cmds.length === 0) return;
  const order: number[] = [];
  for (let i = 0; i < cmds.length; i++) order.push(i);
  order.sort((a, b) => {
    const ca = cmds[a]!;
    const cb = cmds[b]!;
    return ca.playerId - cb.playerId || ca.seq - cb.seq || a - b;
  });
  for (const k of order) applyCommand(ctx, cmds[k]!);
}

const ROLE_BUILDER = ROLES.indexOf('builder');

/** Past één commando toe. Geeft true als er iets veranderd is (voor de AI). */
export function applyCommand(ctx: SimContext, cmd: SimCommand): boolean {
  const p = cmd.playerId;
  if (!isInt(p) || p < 0 || p >= ctx.playerCount || ctx.ps.defeated[p] !== 0) return false;
  switch (cmd.type) {
    case 'Move':
      return applyMove(ctx, p, cmd.payload.ids, cmd.payload.x, cmd.payload.y, false);
    case 'AttackMove':
      return applyMove(ctx, p, cmd.payload.ids, cmd.payload.x, cmd.payload.y, true);
    case 'Attack':
      return applyAttack(ctx, p, cmd.payload);
    case 'Stop':
      return applyStop(ctx, p, cmd.payload.ids);
    case 'Gather':
      return applyGather(ctx, p, cmd.payload);
    case 'Build':
      return applyBuild(ctx, p, cmd.payload);
    case 'Cancel':
      return applyCancel(ctx, p, cmd.payload.ids);
    case 'SetRole':
      return applyCraftTo(ctx, p, cmd.payload.ids, (_i, factionRoles) => factionRoles[ROLES.indexOf(cmd.payload.role)] ?? 0);
    case 'Craft':
      return applyCraft(ctx, p, cmd.payload);
    case 'Claim':
      return applyClaim(ctx, p, cmd.payload);
    case 'Research':
      return applyResearch(ctx, p, cmd.payload.techId);
    case 'Recruit':
      return applyRecruit(ctx, p, cmd.payload);
    case 'HeroAbility':
      return applyHeroAbility(ctx, p, cmd.payload);
    case 'PickPerk':
      return applyPickPerk(ctx, p, cmd.payload);
    case 'Surrender':
      ctx.ps.defeated[p] = WIN_SURRENDER;
      ctx.ps.domTicks[p] = 0;
      return true;
    default:
      return false;
  }
}

/** Indices van levende entities met deze ids die van `playerId` zijn en `needMask` hebben, zonder dubbelen. */
function ownedWith(ctx: SimContext, ids: readonly number[], playerId: number, needMask: number): number[] {
  const w = ctx.world;
  const out: number[] = [];
  for (const id of ids) {
    if (!isInt(id)) continue;
    const i = w.resolve(id);
    if (i < 0 || w.owner[i] !== playerId || !w.has(i, needMask | C.owner)) continue;
    if (out.includes(i)) continue;
    out.push(i);
  }
  return out;
}

const UNIT = C.unit | C.orders | C.movement;

/** Teruggave bij Cancel (sim.json cancelRefundPct): het deel van de prijs dat terugkomt. */
export function refundOf(ctx: SimContext, cost: number): number {
  return idiv(cost * ctx.config.cancelRefundPermille, 1000);
}

/** Lopende omscholing die al betaald is: terugbetalen volgens cancelRefundPermille. */
function refundCraft(ctx: SimContext, i: number): void {
  const w = ctx.world;
  if (w.orderType(i) !== ORDER_CRAFT || w.phase[i] !== PHASE_CRAFT) return;
  const t = ctx.unitType(w.ordX[w.currentOrder(i)]!);
  if (t !== undefined) ctx.ps.scrap[w.owner[i]!] = ctx.ps.scrap[w.owner[i]!]! + refundOf(ctx, t.scrapCost);
}

/** Nieuwe order die de huidige vervangt. */
function replaceOrder(ctx: SimContext, i: number, type: number, x: number, y: number, t: number): void {
  const w = ctx.world;
  refundCraft(ctx, i);
  w.clearOrders(i);
  w.target[i] = NO_ENTITY;
  w.pushOrder(i, type, x, y, t);
}

function applyMove(ctx: SimContext, p: number, ids: readonly number[], x: number, y: number, attack: boolean): boolean {
  if (!isInt(x) || !isInt(y) || !inMap(ctx.map, x, y)) return false;
  const units = ownedWith(ctx, ids, p, attack ? UNIT | C.combat : UNIT);
  if (units.length === 0) return false;
  const w = ctx.world;
  // Eerst iedereen loskoppelen, zodat een veld dat alleen deze groep gebruikte weer beschikbaar is.
  for (const i of units) stopMoving(ctx, i);
  // Straal van de cirkel waarin de groep dicht gepakt past (pakkingsdichtheid ongeveer 0,8), plus één straal marge.
  const n = units.length;
  for (const i of units) {
    const r = w.radius[i]!;
    const groupR = isqrt(idiv(r * r * n * 5, 4)) + r;
    replaceOrder(ctx, i, attack ? ORDER_ATTACK_MOVE : ORDER_MOVE, x, y, groupR);
    steerToPoint(ctx, i, x, y, ctx.config.arriveRadius, groupR);
  }
  return true;
}

function applyAttack(ctx: SimContext, p: number, pl: CommandPayload<'Attack'>): boolean {
  const w = ctx.world;
  const t = isInt(pl.target) ? w.resolve(pl.target) : -1;
  if (t < 0 || !w.has(t, C.health) || w.owner[t] === p || w.owner[t] === OWNER_NEUTRAL) return false;
  let any = false;
  for (const i of ownedWith(ctx, pl.ids, p, UNIT | C.combat)) {
    if (w.damage[i]! <= 0 || !isEnemy(w, i, t)) continue;
    replaceOrder(ctx, i, ORDER_ATTACK, 0, 0, pl.target);
    w.target[i] = pl.target;
    any = true;
  }
  return any;
}

function applyStop(ctx: SimContext, p: number, ids: readonly number[]): boolean {
  const w = ctx.world;
  const units = ownedWith(ctx, ids, p, UNIT);
  for (const i of units) {
    refundCraft(ctx, i);
    w.clearOrders(i);
    w.target[i] = NO_ENTITY;
    stopMoving(ctx, i);
  }
  return units.length > 0;
}

function applyGather(ctx: SimContext, p: number, pl: CommandPayload<'Gather'>): boolean {
  const w = ctx.world;
  const node = isInt(pl.nodeId) ? w.resolve(pl.nodeId) : -1;
  if (node < 0 || !w.has(node, C.resource)) return false;
  let any = false;
  for (const i of ownedWith(ctx, pl.ids, p, UNIT)) {
    const t = ctx.unitType(w.typeId[i]!);
    if (t === undefined || t.gatherAmount <= 0) continue;
    const carry = w.carry[i]!;
    replaceOrder(ctx, i, ORDER_GATHER, 0, 0, pl.nodeId);
    w.carry[i] = carry;
    any = true;
  }
  return any;
}

/** Of de speler dit gebouwtype mag plaatsen: eigen factie, geen hoofdgebouw, alle prereqTech onderzocht. */
export function canPlaceType(ctx: SimContext, p: number, typeId: number): boolean {
  const bt = ctx.buildingType(typeId);
  if (bt === undefined) return false;
  return bt.factionId === ctx.players[p]!.factionId && (bt.provides & PROVIDES_HQ) === 0 && hasTechs(ctx, p, bt.prereqTech);
}

/**
 * Build: (x, y) is het midden van de footprint (cel van (x, y) min de halve footprint is de oorsprong). Alleen units
 * met de rol bouwer. Staat er op die plek al een eigen bouwplaats van dit type, dan helpen ze daar (zonder kosten).
 */
function applyBuild(ctx: SimContext, p: number, pl: CommandPayload<'Build'>): boolean {
  const w = ctx.world;
  if (!isInt(pl.typeId) || !isInt(pl.x) || !isInt(pl.y) || !inMap(ctx.map, pl.x, pl.y)) return false;
  const builders = ownedWith(ctx, pl.ids, p, UNIT).filter((i) => w.role[i] === ROLE_BUILDER);
  if (builders.length === 0) return false;
  const bt = ctx.buildingType(pl.typeId);
  if (bt === undefined) return false;
  const { fx, fy } = footprintOrigin(pl.x, pl.y, bt.footprintW, bt.footprintH);
  let site = ownSiteAt(ctx, p, bt.typeId, fx, fy);
  if (site < 0) {
    if (!canPlaceType(ctx, p, bt.typeId) || ctx.ps.scrap[p]! < bt.scrapCost) return false;
    if (!footprintFree(ctx, fx, fy, bt.footprintW, bt.footprintH)) return false;
    site = createBuilding(ctx, bt, p, fx, fy, false);
    if (site < 0) return false;
    ctx.ps.scrap[p] = ctx.ps.scrap[p]! - bt.scrapCost;
  }
  const siteId = w.idOf(site);
  if (w.bstate[site] !== BSTATE_SITE) return true; // bouwtijd 0: meteen af
  for (const i of builders) replaceOrder(ctx, i, ORDER_BUILD, 0, 0, siteId);
  return true;
}

/** Eigen bouwplaats van dit type met precies deze oorsprong, of -1. */
function ownSiteAt(ctx: SimContext, p: number, typeId: number, fx: number, fy: number): number {
  const w = ctx.world;
  if (fx < 0 || fy < 0 || fx >= ctx.map.w || fy >= ctx.map.h) return -1;
  const b = ctx.terrain.occ[fy * ctx.map.w + fx]! - 1;
  const isSameSite = b >= 0 && w.owner[b] === p && w.typeId[b] === typeId && w.bstate[b] === BSTATE_SITE && w.fx[b] === fx && w.fy[b] === fy;
  return isSameSite ? b : -1;
}

/**
 * Cancel: een eigen bouwplaats verdwijnt met teruggave; een voltooid eigen gebouw stopt zijn onderzoek met teruggave,
 * en het hoofdgebouw stopt daarnaast ook het oplappen van de held (allebei, in die volgorde, elk met teruggave); een
 * unit stopt (een betaalde omscholing wordt terugbetaald). Teruggave: cancelRefundPermille van de prijs.
 */
function applyCancel(ctx: SimContext, p: number, ids: readonly number[]): boolean {
  const w = ctx.world;
  let any = false;
  for (const i of ownedWith(ctx, ids, p, C.building)) {
    if (w.bstate[i] === BSTATE_SITE) {
      const bt = ctx.buildingType(w.typeId[i]!);
      if (bt !== undefined) ctx.ps.scrap[p] = ctx.ps.scrap[p]! + refundOf(ctx, bt.scrapCost);
      removeBuilding(ctx, i);
      any = true;
      continue;
    }
    if (w.research[i] !== 0) {
      const t = ctx.config.techs[w.research[i]! - 1];
      if (t !== undefined) ctx.ps.scrap[p] = ctx.ps.scrap[p]! + refundOf(ctx, t.scrapCost);
      w.research[i] = 0;
      w.work[i] = 0;
      any = true;
    }
    if (cancelRevive(ctx, p, i, (cost) => refundOf(ctx, cost))) any = true;
  }
  return applyStop(ctx, p, ids) || any;
}

/**
 * Research (techId): de tech van de eigen factie, nog niet onderzocht en nergens in onderzoek, met alle prereqTech.
 * De sim kiest het eerste voltooide eigen gebouw van het type uit de tech (lab, werkplaats) zonder lopend onderzoek
 * (laagste id) en rekent de kosten meteen af. De voortgang loopt in systeem 6.
 */
function applyResearch(ctx: SimContext, p: number, techId: number): boolean {
  const t = isInt(techId) ? ctx.config.techs[techId] : undefined;
  if (t === undefined || t.factionId !== ctx.players[p]!.factionId) return false;
  if (hasTechs(ctx, p, [t.techId]) || !hasTechs(ctx, p, t.prereqTech) || ctx.ps.scrap[p]! < t.scrapCost) return false;
  const w = ctx.world;
  let lab = -1;
  for (let i = 0; i < w.highWater; i++) {
    if (!w.has(i, C.building) || w.owner[i] !== p) continue;
    if (w.research[i] === t.techId + 1) return false; // al in onderzoek
    if (lab < 0 && w.typeId[i] === t.buildingTypeId && w.bstate[i] === BSTATE_DONE && w.research[i] === 0) lab = i;
  }
  if (lab < 0) return false;
  ctx.ps.scrap[p] = ctx.ps.scrap[p]! - t.scrapCost;
  w.research[lab] = t.techId + 1;
  w.work[lab] = 0;
  return true;
}

/** Omscholen in de werkplaats naar het type dat `pick` per unit kiest (0 = niet). */
function applyCraftTo(ctx: SimContext, p: number, ids: readonly number[], pick: (i: number, factionRoles: readonly number[]) => number): boolean {
  const w = ctx.world;
  const roles = ctx.config.factions[ctx.players[p]!.factionId]!.roleTypeIds;
  let any = false;
  for (const i of ownedWith(ctx, ids, p, UNIT)) {
    if (w.has(i, C.hero)) continue; // de held schoolt niet om
    const typeId = pick(i, roles);
    const t = typeId === 0 ? undefined : ctx.unitType(typeId);
    if (t === undefined || t.factionId !== ctx.players[p]!.factionId || !hasTechs(ctx, p, t.prereqTech)) continue;
    if (t.typeId === w.typeId[i]) continue;
    if (w.orderType(i) === ORDER_CRAFT && w.ordX[w.currentOrder(i)] === t.typeId) continue; // al onderweg
    replaceOrder(ctx, i, ORDER_CRAFT, t.typeId, 0, 0);
    any = true;
  }
  return any;
}

function applyCraft(ctx: SimContext, p: number, pl: CommandPayload<'Craft'>): boolean {
  if (!isInt(pl.loadoutId) || pl.loadoutId < 0 || pl.loadoutId >= HERO_TYPE_BASE - UNIT_TYPE_BASE) return false;
  const typeId = unitTypeId(pl.loadoutId);
  return applyCraftTo(ctx, p, pl.ids, () => typeId);
}

/**
 * Claim (besluit sprint 2, contract 2): de bouwers bouwen het claimgebouw van hun factie (SimFaction.claimTypeId) binnen
 * claimRadius van het punt, als Build. Staat daar al een eigen bouwplaats met provides claim, dan helpen ze daar.
 * Anders kiest de sim de vrije plek die het dichtst bij het punt ligt (ring voor ring rond de cel van het punt, het
 * punt zelf blijft vrij; tiebreak scanvolgorde) en waarvan de footprint binnen de straal valt en geen node of claimpunt
 * bedekt. Een punt dat al van de speler is, of zonder plek, is ongeldig.
 */
function applyClaim(ctx: SimContext, p: number, pl: CommandPayload<'Claim'>): boolean {
  const w = ctx.world;
  const point = isInt(pl.pointId) ? w.resolve(pl.pointId) : -1;
  if (point < 0 || !w.has(point, C.claim)) return false;
  const typeId = ctx.config.factions[ctx.players[p]!.factionId]!.claimTypeId;
  const bt = typeId === 0 ? undefined : ctx.buildingType(typeId);
  if (bt === undefined) return false;
  // Eigen claimbouwplaats binnen de straal: helpen (laagste index eerst).
  for (let b = 0; b < w.highWater; b++) {
    if (!w.has(b, C.building) || w.owner[b] !== p || w.bstate[b] !== BSTATE_SITE) continue;
    const st = ctx.buildingType(w.typeId[b]!);
    if (st === undefined || (st.provides & PROVIDES_CLAIM) === 0 || !inClaimRadius(ctx, b, point)) continue;
    return applyBuild(ctx, p, { ids: pl.ids, typeId: st.typeId, x: w.x[b]!, y: w.y[b]! });
  }
  if (w.owner[point] === p) return false;
  const at = claimSite(ctx, point, bt.footprintW, bt.footprintH);
  if (at === null) return false;
  return applyBuild(ctx, p, { ids: pl.ids, typeId: bt.typeId, x: at.x, y: at.y });
}

/** Midden (in eenheden) van de vrije footprint w x h het dichtst bij claimpunt pt binnen claimRadius, of null. */
export function claimSite(ctx: SimContext, pt: number, fw: number, fh: number): { x: number; y: number } | null {
  const w = ctx.world;
  const map = ctx.map;
  const px = w.x[pt]!;
  const py = w.y[pt]!;
  const r = ctx.config.claimRadius;
  const maxRing = (r >> 8) + (fw > fh ? fw : fh);
  for (let d = 1; d <= maxRing; d++) {
    let best = -1;
    let bestD = 0;
    scanRing(map, px >> 8, py >> 8, 1, 1, d, (cx, cy) => {
      const fx = cx - (fw >> 1);
      const fy = cy - (fh >> 1);
      if (distToRect2(px, py, fx, fy, fw, fh) > r * r || !footprintFree(ctx, fx, fy, fw, fh)) return false;
      for (let j = 0; j < w.highWater; j++) {
        if (!w.has(j, C.resource) && !w.has(j, C.claim)) continue;
        if (distToRect2(w.x[j]!, w.y[j]!, fx, fy, fw, fh) === 0) return false;
      }
      const dx = (cx << 8) + 128 - px;
      const dy = (cy << 8) + 128 - py;
      const dd = dx * dx + dy * dy;
      if (best < 0 || dd < bestD) {
        best = cy * map.w + cx;
        bestD = dd;
      }
      return false;
    });
    if (best >= 0) return cellCenterOf(map, best);
  }
  return null;
}
