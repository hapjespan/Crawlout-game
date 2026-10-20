// Split from commands.ts to stay under the 5,000-token file limit; commands.ts re-exports the public surface.
// Holds: SimCommand, normalizeCommand, ownedWith, UNIT, refundOf, refundCraft, +15 more.
import { refundCores } from './garde.js';
import {
  type CommandType,
  type CommandPayload,
  CommandEnvelope,
  COMMAND_PAYLOADS,
  OWNER_NEUTRAL,
} from '@crawlout/protocol';
import { type SimContext, inMap, stopMoving, isEnemy, canBuild } from './common.js';
import { isInt, idiv } from '../math/int.js';
import {
  C,
  SLAVE_CAPTIVE,
  SLAVE_FREED,
  ORDER_CRAFT,
  PHASE_CRAFT,
  NO_ENTITY,
  ORDER_ATTACK_MOVE,
  ORDER_MOVE,
  ORDER_ATTACK,
  SLAVE_NONE,
  ORDER_GUARD,
  ORDER_GATHER,
  BSTATE_SITE,
  ORDER_BUILD,
  JOB_PRODUCE,
  JOB_TRAIN,
  JOB_NONE,
  BSTATE_DONE,
  SLAVE_SLAVE,
} from '../ecs/world.js';
import { SLOT_PENDING, SPOT_PENDING } from './formation.js';
import {
  liberatable,
  wandererFor,
  isOwnKooi,
  reachesPoint,
  workReach,
  mayBuildAt,
  slaveRulesOf,
} from './slaves.js';
import { ROLES, HERO_TYPE_BASE, UNIT_TYPE_BASE, unitTypeId } from '@crawlout/data';
import { PROVIDES_HQ } from '../fromData.js';
import { hasTechs, researchCost } from '../effects.js';
import { projectKindOf, restoreRuinAt, isProjectPart, revertToRuin } from './project.js';
import { footprintOrigin, createBuilding, removeBuilding } from '../entities.js';
import { placementReasonAt, PLACE_OK } from './placement.js';
import { trainCost } from './training.js';
import { cancelRevive } from './hero.js';
import { isRobot } from './census.js';

// Systeem 1: commando's van deze tick toepassen. Volgorde: playerId, dan seq, dan positie in de bundel.
// De zod-validatie gebeurt eenmalig bij binnenkomst (normalizeCommand, vanuit Sim.applyBundle); hier alleen
// integer- en spelregelchecks (speler, eigenaar, kosten, bereik). Ongeldige commando's of delen ervan worden stil
// genegeerd. De scripted AI gebruikt precies dezelfde applyCommand.

/** Een gevalideerd commando: payload past bij het type. */
export type SimCommand = {
  [K in CommandType]: {
    readonly playerId: number;
    readonly seq: number;
    readonly type: K;
    readonly payload: CommandPayload<K>;
  };
}[CommandType];

/** zod-validatie van een commando uit een bundel. null als het niet aan contract 2 voldoet. */
export function normalizeCommand(raw: unknown): SimCommand | null {
  const env = CommandEnvelope.safeParse(raw);
  if (!env.success) return null;
  const payload = COMMAND_PAYLOADS[env.data.type].safeParse(env.data.payload);
  if (!payload.success) return null;
  return {
    playerId: env.data.playerId,
    seq: env.data.seq,
    type: env.data.type,
    payload: payload.data,
  } as SimCommand;
}

/** Indices van levende entities met deze ids die van `playerId` zijn en `needMask` hebben, zonder dubbelen. */
function ownedWith(
  ctx: SimContext,
  ids: readonly number[],
  playerId: number,
  needMask: number,
): number[] {
  const w = ctx.world;
  const out: number[] = [];
  for (const id of ids) {
    if (!isInt(id)) continue;
    const i = w.resolve(id);
    if (i < 0 || w.owner[i] !== playerId || !w.has(i, needMask | C.owner)) continue;
    // a captive or a freed unit (data 0.21.0) follows the slave rules; nobody commands it (systems/slaves.ts)
    if (w.slaveState[i] === SLAVE_CAPTIVE || w.slaveState[i] === SLAVE_FREED) continue;
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
  if (t !== undefined)
    ctx.ps.scrap[w.owner[i]!] = ctx.ps.scrap[w.owner[i]!]! + refundOf(ctx, t.scrapCost);
}

/**
 * Nieuwe order die de huidige vervangt. Een bevel heft een eerdere Stop op (`buildHold`); de onthouden bouwplaats
 * (`resumeSite`) blijft staan, zodat een bouwer na bijvoorbeeld een Move zonder taak weer verder bouwt.
 */
function replaceOrder(
  ctx: SimContext,
  i: number,
  type: number,
  x: number,
  y: number,
  t: number,
): void {
  const w = ctx.world;
  refundCraft(ctx, i);
  ctx.defense.mark[i] = 0; // a command ends a base-defence order (sim 0.29.0)
  w.clearOrders(i);
  w.target[i] = NO_ENTITY;
  w.buildHold[i] = 0;
  w.pushOrder(i, type, x, y, t);
}

export function applyMove(
  ctx: SimContext,
  p: number,
  ids: readonly number[],
  x: number,
  y: number,
  attack: boolean,
): boolean {
  if (!isInt(x) || !isInt(y) || !inMap(ctx.map, x, y)) return false;
  const units = ownedWith(ctx, ids, p, attack ? UNIT | C.combat : UNIT);
  if (units.length === 0) return false;
  // Detach everyone first, so a field that only this group used becomes available again.
  for (const i of units) stopMoving(ctx, i);
  // Every unit gets its own slot in a formation around the point (systems/formation.ts), chosen for all orders of this
  // tick together at the start of the unit part of system 2; the order keeps the point itself in ordX/ordY.
  for (const i of units)
    replaceOrder(ctx, i, attack ? ORDER_ATTACK_MOVE : ORDER_MOVE, x, y, SLOT_PENDING);
  return true;
}

/**
 * Attack: an enemy (visible) for every unit with a weapon. Data 0.21.0 (Raiders, sim 0.18.0; contract 2, bevestigd in
 * fase-0 sectie 23 besluit 3): an enemy slave or captive is freed by touch, so every unit walks up to it (orders.ts
 * attack); a Slaver may also go for a neutral wanderer it can catch.
 */
export function applyAttack(ctx: SimContext, p: number, pl: CommandPayload<'Attack'>): boolean {
  const w = ctx.world;
  const t = isInt(pl.target) ? w.resolve(pl.target) : -1;
  if (t < 0 || !w.has(t, C.health) || w.owner[t] === p) return false;
  let any = false;
  for (const i of ownedWith(ctx, pl.ids, p, UNIT | C.combat)) {
    const free = liberatable(ctx, i, t);
    const wanderer = !free && wandererFor(ctx, i, t);
    if (
      !free &&
      !wanderer &&
      ((w.owner[t] === OWNER_NEUTRAL && w.creepCamp[t] === 0) ||
        w.damage[i]! <= 0 ||
        !isEnemy(w, i, t))
    )
      continue;
    replaceOrder(ctx, i, ORDER_ATTACK, 0, 0, pl.target);
    w.target[i] = pl.target;
    any = true;
  }
  return any;
}

const ROLE_MILITIA = ROLES.indexOf('militia');

const ROLE_ROBOT = ROLES.indexOf('robot');

/**
 * Guard (protocol 0.15.0, sim 0.24.0; voorstel, ter bevestiging door de architect, fase-0 sectie 5): bewaakmodus op een
 * eigen voltooide Kooi (provides kooi, ook het Raiderkamp) of een node met scrap. Alleen vechters: rol militia of robot,
 * met een wapen, niet de held en geen slaaf. De order (ORDER_GUARD, ordT het doel) loopt in systems/orders.ts guard.
 */
export function applyGuard(ctx: SimContext, p: number, pl: CommandPayload<'Guard'>): boolean {
  const w = ctx.world;
  const t = isInt(pl.targetId) ? w.resolve(pl.targetId) : -1;
  if (t < 0) return false;
  const node = w.has(t, C.resource);
  if (node ? w.amount[t]! <= 0 : !isOwnKooi(ctx, p, t)) return false;
  let any = false;
  for (const i of ownedWith(ctx, pl.ids, p, UNIT | C.combat)) {
    if (w.has(i, C.hero) || w.slaveState[i] !== SLAVE_NONE || w.damage[i]! <= 0) continue;
    if (w.role[i] !== ROLE_MILITIA && w.role[i] !== ROLE_ROBOT) continue;
    stopMoving(ctx, i);
    replaceOrder(ctx, i, ORDER_GUARD, 0, 0, pl.targetId);
    any = true;
  }
  return any;
}

/**
 * Stop (en Cancel op een unit): de speler wil dat hij echt stopt. Een bouwer vergeet zijn bouwplaats en helpt ook niet
 * vanzelf bij een bouwplaats in de buurt (`buildHold`) tot hij een nieuw bevel krijgt.
 */
export function applyStop(ctx: SimContext, p: number, ids: readonly number[]): boolean {
  const w = ctx.world;
  const units = ownedWith(ctx, ids, p, UNIT);
  for (const i of units) {
    refundCraft(ctx, i);
    w.clearOrders(i);
    w.target[i] = NO_ENTITY;
    w.resumeSite[i] = NO_ENTITY;
    w.buildHold[i] = 1;
    stopMoving(ctx, i);
  }
  return units.length > 0;
}

export function applyGather(ctx: SimContext, p: number, pl: CommandPayload<'Gather'>): boolean {
  const w = ctx.world;
  const node = isInt(pl.nodeId) ? w.resolve(pl.nodeId) : -1;
  if (node < 0 || !w.has(node, C.resource)) return false;
  let any = false;
  for (const i of ownedWith(ctx, pl.ids, p, UNIT)) {
    const t = ctx.unitType(w.typeId[i]!);
    if (t === undefined || t.gatherAmount <= 0) continue;
    // a slave only within the work radius of its cage (data 0.21.0)
    if (!reachesPoint(workReach(ctx, i), w.x[node]!, w.y[node]!)) continue;
    const carry = w.carry[i]!;
    // its own spot on the ring around the node follows at the start of the unit part of system 2 (formation.ts)
    replaceOrder(ctx, i, ORDER_GATHER, SPOT_PENDING, SPOT_PENDING, pl.nodeId);
    w.carry[i] = carry;
    any = true;
  }
  return any;
}

/** Of de speler dit gebouwtype mag plaatsen: eigen factie, geen hoofdgebouw, alle prereqTech onderzocht. */
export function canPlaceType(ctx: SimContext, p: number, typeId: number): boolean {
  const bt = ctx.buildingType(typeId);
  if (bt === undefined) return false;
  return (
    bt.factionId === ctx.players[p]!.factionId &&
    (bt.provides & PROVIDES_HQ) === 0 &&
    hasTechs(ctx, p, bt.prereqTech)
  );
}

/**
 * Build: (x, y) is het midden van de footprint (cel van (x, y) min de halve footprint is de oorsprong). Alleen units
 * met de rol bouwer. Staat er op die plek al een eigen bouwplaats van dit type, dan helpen ze daar (zonder kosten);
 * zo wordt een rechtsklik op een bouwplaats in de client (Build met het typeId en het midden van die plaats) "help
 * bouwen". Elke bouwer onthoudt de plaats (`resumeSite`) tot een nieuw bouwbevel of Stop. `claim` zijn de extra
 * plaatsingsbits van een claimgebouw dat Claim plaatst (de laag van CLAIM_TIERS waarmee claimSite de plek vond), 0 voor
 * een gewone Build.
 */
export function applyBuild(
  ctx: SimContext,
  p: number,
  pl: CommandPayload<'Build'>,
  claim = 0,
): boolean {
  const w = ctx.world;
  if (!isInt(pl.typeId) || !isInt(pl.x) || !isInt(pl.y) || !inMap(ctx.map, pl.x, pl.y))
    return false;
  const asked = ctx.buildingType(pl.typeId);
  if (asked === undefined) return false;
  // win route C (sim 0.25.0): Build with a project type (ruin or restored) on a part restores the ruin there, or helps
  // at the own restoring part; the site is always of the restored type
  const kind = projectKindOf(ctx, asked.typeId);
  const bt = kind < 0 ? asked : ctx.buildingType(ctx.config.project!.parts[kind]!.restoredTypeId)!;
  const { fx, fy } = footprintOrigin(pl.x, pl.y, bt.footprintW, bt.footprintH);
  // a slave builder only within the work radius of its cage, a claim building (data 0.21.0, slaves.ts) and a project
  // part excepted
  const provides = bt.provides;
  const builders = ownedWith(ctx, pl.ids, p, UNIT).filter(
    (i) =>
      canBuild(ctx, i) &&
      (kind >= 0 || mayBuildAt(ctx, i, provides, fx, fy, bt.footprintW, bt.footprintH)),
  );
  if (builders.length === 0) return false;
  let site = ownSiteAt(ctx, p, bt.typeId, fx, fy);
  if (site < 0 && kind >= 0) {
    site = restoreRuinAt(ctx, p, bt, fx, fy);
    if (site < 0) return false;
  } else if (site < 0) {
    if (!canPlaceType(ctx, p, bt.typeId) || ctx.ps.scrap[p]! < bt.scrapCost) return false;
    // the placement rule (systems/placement.ts): free margin, depot aisle, no node or claim point
    if (placementReasonAt(ctx, bt, fx, fy, claim, p) !== PLACE_OK) return false;
    site = createBuilding(ctx, bt, p, fx, fy, false);
    if (site < 0) return false;
    ctx.ps.scrap[p] = ctx.ps.scrap[p]! - bt.scrapCost;
  }
  const siteId = w.idOf(site);
  if (w.bstate[site] !== BSTATE_SITE) return true; // bouwtijd 0: meteen af
  for (const i of builders) {
    replaceOrder(ctx, i, ORDER_BUILD, 0, 0, siteId);
    w.resumeSite[i] = siteId;
  }
  return true;
}

/** Eigen bouwplaats van dit type met precies deze oorsprong, of -1. */
function ownSiteAt(ctx: SimContext, p: number, typeId: number, fx: number, fy: number): number {
  const w = ctx.world;
  if (fx < 0 || fy < 0 || fx >= ctx.map.w || fy >= ctx.map.h) return -1;
  const b = ctx.terrain.occ[fy * ctx.map.w + fx]! - 1;
  const isSameSite =
    b >= 0 &&
    w.owner[b] === p &&
    w.typeId[b] === typeId &&
    w.bstate[b] === BSTATE_SITE &&
    w.fx[b] === fx &&
    w.fy[b] === fy;
  return isSameSite ? b : -1;
}

/**
 * Cancel: een eigen bouwplaats verdwijnt met teruggave; een voltooid eigen gebouw stopt zijn onderzoek met teruggave,
 * en het hoofdgebouw stopt daarnaast ook het oplappen van de held (allebei, in die volgorde, elk met teruggave); een
 * unit stopt (een betaalde omscholing wordt terugbetaald). Teruggave: cancelRefundPermille van de prijs.
 */
export function applyCancel(ctx: SimContext, p: number, ids: readonly number[]): boolean {
  const w = ctx.world;
  let any = false;
  for (const i of ownedWith(ctx, ids, p, C.building)) {
    if (w.bstate[i] === BSTATE_SITE) {
      const bt = ctx.buildingType(w.typeId[i]!);
      if (bt !== undefined) ctx.ps.scrap[p] = ctx.ps.scrap[p]! + refundOf(ctx, bt.scrapCost);
      // win route C (sim 0.25.0): an own restoring part goes back to a ruin, with the refund of the restore
      if (isProjectPart(ctx, i)) revertToRuin(ctx, i);
      else removeBuilding(ctx, i);
      any = true;
      continue;
    }
    if (w.research[i] !== 0) {
      // the price that was paid, not the current one (a hero passive or Intelligence can change it meanwhile)
      ctx.ps.scrap[p] = ctx.ps.scrap[p]! + refundOf(ctx, w.researchPaid[i]!);
      w.research[i] = 0;
      w.researchPaid[i] = 0;
      w.work[i] = 0;
      any = true;
    }
    // data 0.16.0: robotproductie of training stoppen, met teruggave van wat de run kostte
    if (w.job[i] !== 0) {
      let cost = 0;
      if (w.jobKind[i] === JOB_PRODUCE) {
        cost = ctx.unitType(w.job[i]!)?.scrapCost ?? 0;
        refundCores(ctx, p, ctx.unitType(w.job[i]!)?.fusionCores ?? 0); // sim 0.32.0
      } else if (w.jobKind[i] === JOB_TRAIN) {
        const tr = ctx.config.training[w.job[i]! - 1];
        cost = tr === undefined ? 0 : trainCost(ctx, p, tr);
      }
      ctx.ps.scrap[p] = ctx.ps.scrap[p]! + refundOf(ctx, cost);
      w.job[i] = 0;
      w.jobKind[i] = JOB_NONE;
      w.jobWork[i] = 0;
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
export function applyResearch(ctx: SimContext, p: number, techId: number): boolean {
  const t = isInt(techId) ? ctx.config.techs[techId] : undefined;
  if (t === undefined || t.factionId !== ctx.players[p]!.factionId) return false;
  const cost = researchCost(ctx, p, t);
  if (hasTechs(ctx, p, [t.techId]) || !hasTechs(ctx, p, t.prereqTech) || ctx.ps.scrap[p]! < cost)
    return false;
  const w = ctx.world;
  let lab = -1;
  for (let i = 0; i < w.highWater; i++) {
    if (!w.has(i, C.building) || w.owner[i] !== p) continue;
    if (w.research[i] === t.techId + 1) return false; // al in onderzoek
    if (
      lab < 0 &&
      w.typeId[i] === t.buildingTypeId &&
      w.bstate[i] === BSTATE_DONE &&
      w.research[i] === 0 &&
      w.job[i] === 0
    )
      lab = i;
  }
  if (lab < 0) return false;
  ctx.ps.scrap[p] = ctx.ps.scrap[p]! - cost;
  w.research[lab] = t.techId + 1;
  w.researchPaid[lab] = cost;
  w.work[lab] = 0;
  return true;
}

/** Omscholen in de werkplaats naar het type dat `pick` per unit kiest (0 = niet). */
export function applyCraftTo(
  ctx: SimContext,
  p: number,
  ids: readonly number[],
  pick: (i: number, factionRoles: readonly number[]) => number,
): boolean {
  const w = ctx.world;
  const roles = ctx.config.factions[ctx.players[p]!.factionId]!.roleTypeIds;
  const slaves = slaveRulesOf(ctx, p) !== null;
  let any = false;
  for (const i of ownedWith(ctx, ids, p, UNIT)) {
    if (w.has(i, C.hero) || isRobot(ctx, i)) continue; // de held en robots scholen niet om
    const typeId = pick(i, roles);
    const t = typeId === 0 ? undefined : ctx.unitType(typeId);
    if (
      t === undefined ||
      t.factionId !== ctx.players[p]!.factionId ||
      t.producedAtTypeId !== 0 || // een robot wordt nieuw gebouwd (Produce), nooit omgeschoold
      !hasTechs(ctx, p, t.prereqTech)
    )
      continue;
    // data 0.21.0 (Raiders): a slave retrains only to another slave loadout (at a cage), never to a soldier; the
    // fighters of a faction with slaves never retrain (they come from the tents and never work)
    const isSlave = w.slaveState[i] === SLAVE_SLAVE;
    if (isSlave !== t.slave || (slaves && !isSlave)) continue;
    if (t.typeId === w.typeId[i]) continue;
    if (w.orderType(i) === ORDER_CRAFT && w.ordX[w.currentOrder(i)] === t.typeId) continue; // al onderweg
    replaceOrder(ctx, i, ORDER_CRAFT, t.typeId, 0, 0);
    any = true;
  }
  return any;
}

export function applyCraft(ctx: SimContext, p: number, pl: CommandPayload<'Craft'>): boolean {
  if (!isInt(pl.loadoutId) || pl.loadoutId < 0 || pl.loadoutId >= HERO_TYPE_BASE - UNIT_TYPE_BASE)
    return false;
  const typeId = unitTypeId(pl.loadoutId);
  return applyCraftTo(ctx, p, pl.ids, () => typeId);
}
