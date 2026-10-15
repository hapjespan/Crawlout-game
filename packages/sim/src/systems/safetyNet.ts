import { BSTATE_DONE } from '../ecs/world.js';
import { createUnit } from '../entities.js';
import { PROVIDES_BEACON } from '../fromData.js';
import { imod } from '../math/int.js';
import type { Census } from './census.js';
import type { SimContext } from './common.js';
import { SPAWN_SPREAD, cellCenterOf, nthFreeCellAround, playerInTurn } from './common.js';

// Vangnet van de factie (data 0.16.0, factions safetyNet radiobaken_instroom; Spelfundament 4 en 11), systeem 6 na de
// huisvestingsgroei, in de doordraaiende beurtvolgorde. Zolang een speler minder dan threshold bewoners heeft (levende
// eigen units zonder de held en zonder robots), een voltooid gebouw met provides beacon, nog geen maxArrivals aankomsten
// en ruimte in popCapMax (bedden spelen geen rol), loopt één timer per speler; na intervalTicks komt er een bewoner van
// typeId naast het voltooide baken met de laagste id en begint de timer opnieuw. Zodra niet meer aan de voorwaarde
// voldaan is, gaat de timer terug naar 0 (niets opsparen).

/** Het voltooide baken van speler p met de laagste index, of -1. */
function firstBeacon(ctx: SimContext, p: number): number {
  const w = ctx.world;
  const idx = ctx.index;
  idx.refresh(w);
  for (let k = 0; k < idx.buildingCount; k++) {
    const j = idx.buildings[k]!;
    if (w.owner[j] !== p || w.bstate[j] !== BSTATE_DONE || w.hp[j]! <= 0) continue;
    const bt = ctx.buildingType(w.typeId[j]!);
    if (bt !== undefined && (bt.provides & PROVIDES_BEACON) !== 0) return j;
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
  const beacon =
    net === null ||
    t === undefined ||
    ps.defeated[p] !== 0 ||
    census.settlers[p]! >= net.threshold ||
    ps.netArrivals[p]! >= net.maxArrivals ||
    census.totalPop(p) + t.popCost > ctx.config.popCapMax
      ? -1
      : firstBeacon(ctx, p);
  if (beacon < 0 || net === null || t === undefined) {
    ps.netTimer[p] = 0;
    return;
  }
  ps.netTimer[p] = ps.netTimer[p]! + 1;
  if (ps.netTimer[p]! < net.intervalTicks) return;
  const w = ctx.world;
  const c = nthFreeCellAround(
    ctx,
    w.fx[beacon]!,
    w.fy[beacon]!,
    w.fw[beacon]!,
    w.fh[beacon]!,
    imod(ctx.frame, SPAWN_SPREAD),
  );
  if (c < 0) return; // geen plek: de timer blijft vol staan tot er plek is
  const at = cellCenterOf(ctx.map, c);
  if (createUnit(ctx, t, p, at.x, at.y, 0) < 0) return;
  ps.netTimer[p] = 0;
  ps.netArrivals[p] = ps.netArrivals[p]! + 1;
  census.settlers[p] = census.settlers[p]! + 1;
  census.pop[p] = census.pop[p]! + t.popCost;
}
