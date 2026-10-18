// Split from commands.ts to stay under the 5,000-token file limit; commands.ts re-exports the public surface.
// Holds: applyCommands, applyCommand, applyClaim, claimSite.
import { type SimContext, WIN_SURRENDER } from './common.js';
import { type ClaimSite, claimSiteIn, placementInput, placeAs } from './placement.js';
import type { CommandPayload } from '@crawlout/protocol';
import { isInt } from '../math/int.js';
import { C, BSTATE_SITE } from '../ecs/world.js';
import { PROVIDES_CLAIM } from '../fromData.js';
import { inClaimRadius } from './claims.js';
import { ROLES } from '@crawlout/data';
import { applyRecruit, applyHeroAbility, applyPickPerk } from './hero.js';
import { applyProduce } from './robots.js';
import { applyTrain } from './training.js';
import {
  applyAttack,
  applyBuild,
  applyCancel,
  applyCraft,
  applyCraftTo,
  applyGather,
  applyGuard,
  applyMove,
  applyResearch,
  applyStop,
} from './commands.part1.js';
import type { SimCommand } from './commands.part1.js';

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
      return applyCraftTo(
        ctx,
        p,
        cmd.payload.ids,
        (_i, factionRoles) => factionRoles[ROLES.indexOf(cmd.payload.role)] ?? 0,
      );
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
    case 'Produce':
      return applyProduce(ctx, p, cmd.payload);
    case 'Train':
      return applyTrain(ctx, p, cmd.payload);
    case 'Guard':
      return applyGuard(ctx, p, cmd.payload);
    case 'Surrender':
      ctx.ps.defeated[p] = WIN_SURRENDER;
      ctx.ps.domTicks[p] = 0;
      return true;
    default:
      return false;
  }
}

/**
 * Claim (besluit sprint 2, contract 2): de bouwers bouwen het claimgebouw van hun factie (SimFaction.claimTypeId) binnen
 * claimRadius van het punt, als Build. Staat daar al een eigen bouwplaats met provides claim, dan helpen ze daar.
 * Anders kiest de sim de vrije plek die het dichtst bij het punt ligt (ring voor ring rond de cel van het punt, het
 * punt zelf blijft vrij; tiebreak scanvolgorde) en waarvan de footprint binnen de straal valt en aan de plaatsingsregel
 * voldoet (systems/placement.ts: vrije rand, geen node of claimpunt erin). Is er zo geen plek (nodes, rotsen of
 * gebouwen dicht bij het punt), dan zoekt hij opnieuw met een node naast de footprint en ten slotte zonder rand
 * (placement.ts CLAIM_TIERS, data 0.20.0): een vrij punt is altijd te claimen. Een punt dat al van de speler is, of
 * zonder enige vrije begaanbare plek binnen de straal, is ongeldig.
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
    if (st === undefined || (st.provides & PROVIDES_CLAIM) === 0 || !inClaimRadius(ctx, b, point))
      continue;
    return applyBuild(ctx, p, { ids: pl.ids, typeId: st.typeId, x: w.x[b]!, y: w.y[b]! });
  }
  if (w.owner[point] === p) return false;
  const at = claimSite(ctx, point, bt.footprintW, bt.footprintH, placeAs(bt));
  if (at === null) return false;
  return applyBuild(ctx, p, { ids: pl.ids, typeId: bt.typeId, x: at.x, y: at.y }, at.as);
}

/**
 * Where Claim puts a claim building of fw x fh cells at claim point pt (placement.ts claimSiteIn: the nearest spot within
 * claimRadius that passes the placement rule for a claim building, with two relaxed fallbacks so that a free point can
 * always be claimed), or null. `as` is placeAs of the building.
 */
export function claimSite(
  ctx: SimContext,
  pt: number,
  fw: number,
  fh: number,
  as = 0,
): ClaimSite | null {
  const w = ctx.world;
  return claimSiteIn(placementInput(ctx), w.x[pt]!, w.y[pt]!, fw, fh, as, ctx.config.claimRadius);
}
