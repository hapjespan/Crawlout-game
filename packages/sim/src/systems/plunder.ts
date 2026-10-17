import { C } from '../ecs/world.js';
import { hasTechs, scalePermille } from '../effects.js';
import { PROVIDES_DEPOT, PROVIDES_HQ, PROVIDES_WORKSHOP } from '../fromData.js';
import { idiv } from '../math/int.js';
import type { SimContext } from './common.js';

// Plunder and tribute of the Raiders (Spelfundament 4: "plunderen van depots, tribute van neutrale nederzettingen zolang
// bezet"; data 0.21.0 factions plunder and tribute; sim 0.18.0).
//  - Plunder (system 8, before a dead entity is removed): the owner of the unit or turret that last damaged it
//    (World.lastHit, set in system 5), if his faction plunders and it is not his own: for a building
//    buildingLootPermille of its scrapCost, times depotLootMultiplierPermille for a drop-off building (provides hq,
//    workshop or depot); for a unit the scrap it carried times carryLootPermille. With bonusTech researched
//    bonusPermille more. Rounded down.
//  - Tribute (system 6): every claim point of kind tribute.claimKind that a player of a tribute faction holds (with a
//    post or as a beacon) pays scrapPerMin a minute (bonusPermille more with bonusTech), counted per tick in thousandths
//    and paid per whole scrap (PlayerState.tributeAcc). Neutral settlements of their own do not exist on the maps yet;
//    the settlement claim points of Rustbelt (kind settlement) are those settlements.

const DEPOTS = PROVIDES_HQ | PROVIDES_WORKSHOP | PROVIDES_DEPOT;

/** System 8: the loot of dead entity i (a unit or building with hp <= 0) for its killer's owner. */
export function plunderOnDeath(ctx: SimContext, i: number): void {
  const w = ctx.world;
  const by = w.lastHit[i]! - 1;
  if (by < 0 || by >= ctx.playerCount || by === w.owner[i] || ctx.ps.defeated[by] !== 0) return;
  const pl = ctx.config.factions[ctx.players[by]!.factionId]!.plunder;
  if (pl === null) return;
  let loot = 0;
  if ((w.mask[i]! & C.building) !== 0) {
    const bt = ctx.buildingType(w.typeId[i]!);
    if (bt === undefined) return;
    loot = idiv(bt.scrapCost * pl.buildingLootPermille, 1000);
    if ((bt.provides & DEPOTS) !== 0) loot = idiv(loot * pl.depotLootMultiplierPermille, 1000);
  } else loot = idiv(w.carry[i]! * pl.carryLootPermille, 1000);
  if (loot <= 0) return;
  if (pl.bonusTech >= 0 && hasTechs(ctx, by, [pl.bonusTech]))
    loot = scalePermille(loot, pl.bonusPermille);
  ctx.ps.scrap[by] = ctx.ps.scrap[by]! + loot;
}

/** System 6: tribute of the held claim points for every player of a tribute faction. */
export function tributeSystem(ctx: SimContext): void {
  const w = ctx.world;
  const ps = ctx.ps;
  const tpm = ctx.config.ticksPerMinute * 1000;
  for (let p = 0; p < ctx.playerCount; p++) {
    const tr = ctx.config.factions[ctx.players[p]!.factionId]!.tribute;
    if (tr === null || ps.defeated[p] !== 0) continue;
    let held = 0;
    for (let k = 0; k < ctx.claimPoints.length; k++) {
      const pt = ctx.claimPoints[k]!;
      if (w.owner[pt] === p && ctx.map.claimPoints[k]?.kind === tr.claimKind) held++;
    }
    if (held === 0) continue;
    const perPoint =
      tr.bonusTech >= 0 && hasTechs(ctx, p, [tr.bonusTech])
        ? scalePermille(tr.scrapPerMin * 1000, tr.bonusPermille)
        : tr.scrapPerMin * 1000;
    ps.tributeAcc[p] = ps.tributeAcc[p]! + held * perPoint;
    const whole = idiv(ps.tributeAcc[p]!, tpm);
    if (whole <= 0) continue;
    ps.scrap[p] = ps.scrap[p]! + whole;
    ps.tributeAcc[p] = ps.tributeAcc[p]! - whole * tpm;
  }
}
