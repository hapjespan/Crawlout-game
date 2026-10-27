import type { SimContext } from './common.js';
import type { Tally } from './aiRaiders.part1.js';
import { ROLES } from '@crawlout/data';
import { applyCommand } from './commands.js';
import { hasTechs } from '../effects.js';

// Data 0.38.0 (sim 0.32.0, the Garde; proposal): the Raider AI for a faction without slaves (raidPlan workers). Its
// builders and scavengers are free units that come from a building (Produce: the Initiates from the kazerne), so step 5
// first fills `builders` builders and then scavengers up to workers.scavengers (alive plus in production; the housing
// growth would add free scavengers too), each the cheapest such loadout with its techs that an idle building makes.
// Workers are the income, so they do not wait for the reserve (a build order or tech that waits for scrap).

const ROLE_BUILDER = ROLES.indexOf('builder');
const ROLE_SCAVENGER = ROLES.indexOf('scavenger');

/** The cheapest own loadout of `role` that building type bt makes with p's techs, or 0. */
function workerType(ctx: SimContext, p: number, bt: number, role: number): number {
  const f = ctx.players[p]!.factionId;
  let best = 0;
  let cost = 0;
  for (const u of ctx.config.unitTypes) {
    if (u.factionId !== f || u.role !== role || u.producedAtTypeId !== bt) continue;
    if (!hasTechs(ctx, p, u.prereqTech)) continue;
    if (best === 0 || u.scrapCost < cost) {
      best = u.typeId;
      cost = u.scrapCost;
    }
  }
  return best;
}

/**
 * Produce the missing free workers in idle buildings (pushed onto `used`). False when a worker waits for scrap: the
 * AI then spends nothing else on production this tick.
 */
export function produceWorkers(
  ctx: SimContext,
  p: number,
  workers: { readonly scavengers: number },
  builders: number,
  t: Tally,
  used: number[],
): boolean {
  const w = ctx.world;
  let nb = t.builders.length + t.buildersPlanned;
  let ns = t.scavs.length + t.scavsPlanned;
  for (const b of t.idleBuildings) {
    if (nb >= builders && ns >= workers.scavengers) return true;
    let role = ROLE_BUILDER;
    let typeId = nb < builders ? workerType(ctx, p, w.typeId[b]!, role) : 0;
    if (typeId === 0 && ns < workers.scavengers) {
      role = ROLE_SCAVENGER;
      typeId = workerType(ctx, p, w.typeId[b]!, role);
    }
    if (typeId === 0) continue;
    const u = ctx.unitType(typeId)!;
    if (ctx.ps.scrap[p]! < u.scrapCost) return false;
    const ok = applyCommand(ctx, {
      playerId: p,
      seq: 0,
      type: 'Produce',
      payload: { buildingId: w.idOf(b), loadoutId: u.loadoutId },
    });
    if (!ok) continue;
    used.push(b);
    if (role === ROLE_BUILDER) nb++;
    else ns++;
  }
  return true;
}
