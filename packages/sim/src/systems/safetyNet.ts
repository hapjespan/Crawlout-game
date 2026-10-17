import { SAFETY_NET_TENTS } from '../config.js';
import { BSTATE_DONE } from '../ecs/world.js';
import { createUnit } from '../entities.js';
import { PROVIDES_BEACON, PROVIDES_TENT } from '../fromData.js';
import { imod } from '../math/int.js';
import type { Census } from './census.js';
import type { SimContext } from './common.js';
import { SPAWN_SPREAD, cellCenterOf, nthFreeCellAround, playerInTurn } from './common.js';
import { autoGather } from './orders.js';

// Vangnet van de factie (data 0.16.0, factions safetyNet; Spelfundament 4 en 11), systeem 6 na de huisvestingsgroei,
// in de doordraaiende beurtvolgorde. Twee acties, één regel:
//  - radiobaken_instroom (Dwellers): zolang een speler minder dan threshold bewoners heeft (levende eigen units zonder
//    de held en zonder robots) en een voltooid gebouw met provides beacon;
//  - tenten_instroom (Raiders, data 0.21.0, sim 0.18.0): zolang hij minder dan threshold vechters heeft (Census.fighters:
//    role militia, zonder de held, slaven en gevangenen) en een voltooid gebouw met provides tent;
// en nog geen maxArrivals aankomsten en ruimte in popCapMax (bedden spelen geen rol), loopt één timer per speler; na
// intervalTicks komt er een unit van typeId naast het voltooide baken (de tent) met de laagste id en begint de timer
// opnieuw. Zodra niet meer aan de voorwaarde voldaan is, gaat de timer terug naar 0 (niets opsparen).

/** Het voltooide gebouw van speler p met een van de provides-bits in `mask`, met de laagste index, of -1. */
function firstOf(ctx: SimContext, p: number, mask: number): number {
  const w = ctx.world;
  const idx = ctx.index;
  idx.refresh(w);
  for (let k = 0; k < idx.buildingCount; k++) {
    const j = idx.buildings[k]!;
    if (w.owner[j] !== p || w.bstate[j] !== BSTATE_DONE || w.hp[j]! <= 0) continue;
    const bt = ctx.buildingType(w.typeId[j]!);
    if (bt !== undefined && (bt.provides & mask) !== 0) return j;
  }
  return -1;
}

/** Na takeCensus (economy.ts): de tellingen van de census gelden voor deze tick en worden bijgewerkt bij een aankomst. */
export function safetyNetSystem(ctx: SimContext, census: Census): void {
  for (let k = 0; k < ctx.playerCount; k++) netFor(ctx, census, playerInTurn(ctx, k));
}

function netFor(ctx: SimContext, census: Census, p: number): void {
  const ps = ctx.ps;
  const net = ctx.config.factions[ctx.players[p]!.factionId]!.safetyNet;
  const t = net === null ? undefined : ctx.unitType(net.typeId);
  const tents = net !== null && net.action === SAFETY_NET_TENTS;
  const count = tents ? census.fighters[p]! : census.settlers[p]!;
  const site =
    net === null ||
    t === undefined ||
    ps.defeated[p] !== 0 ||
    count >= net.threshold ||
    ps.netArrivals[p]! >= net.maxArrivals ||
    census.totalPop(p) + t.popCost > ctx.config.popCapMax
      ? -1
      : firstOf(ctx, p, tents ? PROVIDES_TENT : PROVIDES_BEACON);
  if (site < 0 || net === null || t === undefined) {
    ps.netTimer[p] = 0;
    return;
  }
  ps.netTimer[p] = ps.netTimer[p]! + 1;
  if (ps.netTimer[p]! < net.intervalTicks) return;
  const w = ctx.world;
  const c = nthFreeCellAround(
    ctx,
    w.fx[site]!,
    w.fy[site]!,
    w.fw[site]!,
    w.fh[site]!,
    imod(ctx.frame, SPAWN_SPREAD),
  );
  if (c < 0) return; // geen plek: de timer blijft vol staan tot er plek is
  const at = cellCenterOf(ctx.map, c);
  const u = createUnit(ctx, t, p, at.x, at.y, 0);
  if (u < 0) return;
  autoGather(ctx, u);
  ps.netTimer[p] = 0;
  ps.netArrivals[p] = ps.netArrivals[p]! + 1;
  census.settlers[p] = census.settlers[p]! + 1;
  census.pop[p] = census.pop[p]! + t.popCost;
  if (tents) census.fighters[p] = census.fighters[p]! + 1;
}
