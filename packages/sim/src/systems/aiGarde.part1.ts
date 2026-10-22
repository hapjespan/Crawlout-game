// Split from aiGarde.ts to stay under the 5,000-token file limit; aiGarde.ts re-exports the public surface.
// Holds: supportWave, produceGarde.
import type { SimContext } from './common.js';
import type { SimRaidPlan } from '../config.js';
import type { Tally } from './aiRaiders.part1.js';
import { applyCommand } from './commands.js';
import { hasTechs } from '../effects.js';
import { idiv } from '../math/int.js';
import { BSTATE_DONE, C } from '../ecs/world.js';

// The Garde AI (sim 0.34.0, data 0.43.0, protocol 0.18.0; proposal for the architect; docs/garde.md items 3 and 5).
// The Garde plays the Raider AI (systems/aiRaiders.ts, raidPlan without slaves). Two things of her own, both from the
// script so every number stays in data/ai/*.json:
//  - raidPlan.support (the Klerk): a technician is no fighter. The AI keeps one per `perArmy` fighters up to `max`
//    (alive plus in production), makes it where its loadout is made, sends `withWave` of the free ones along with every
//    wave, push and sabotage (its overload stuns an enemy power armour, systems/garde.klerk.ts) and leaves the rest
//    with the defence, where an idle Klerk repairs the frames and buildings around it;
//  - raidPlan.airlift (the Vertibird): a shuttle between the headquarters and the rally point. See `airlift` in
//    aiGarde.part2.ts for the rule and why it is this one.
// Determinism: every list is walked in ascending entity index (the Tally builds them that way), ties break on the
// lowest index, and nothing here uses the rng.

/**
 * The free technicians that go along with the attack (the first `withWave` of them, ascending index) and the ones that
 * stay with the defence. Both lists are empty without `support`.
 */
export function supportWave(plan: SimRaidPlan, t: Tally): { go: number[]; stay: number[] } {
  const sp = plan.support;
  if (sp === null) return { go: [], stay: [] };
  const n = t.idleTechs.length < sp.withWave ? t.idleTechs.length : sp.withWave;
  return { go: t.idleTechs.slice(0, n), stay: t.idleTechs.slice(n) };
}

/** Whether p has a completed building that makes unit type u, so saving for it is not saving forever. */
function hasProducer(ctx: SimContext, p: number, producedAtTypeId: number): boolean {
  const w = ctx.world;
  for (let i = 0; i < w.highWater; i++)
    if (
      w.alive[i] === 1 &&
      w.owner[i] === p &&
      w.has(i, C.building) &&
      w.bstate[i] === BSTATE_DONE &&
      w.typeId[i] === producedAtTypeId &&
      w.hp[i]! > 0
    )
      return true;
  return false;
}

/**
 * Produce one of unit `typeId` in the first idle own building that makes it (ascending index), while `need` is
 * positive and the scrap above `reserve` covers it. The building is pushed onto `used` so the fighter mix skips it.
 * Returns the cost it still waits for when `save` is set and only the scrap is missing, else 0.
 */
function produceOne(
  ctx: SimContext,
  p: number,
  typeId: number,
  need: number,
  t: Tally,
  used: number[],
  reserve: number,
  save: boolean,
): number {
  if (need <= 0) return 0;
  const u = ctx.unitType(typeId);
  if (u === undefined || !hasTechs(ctx, p, u.prereqTech)) return 0;
  if (ctx.ps.scrap[p]! < u.scrapCost + reserve)
    return save && hasProducer(ctx, p, u.producedAtTypeId) ? u.scrapCost : 0;
  const w = ctx.world;
  for (const b of t.idleBuildings) {
    if (used.includes(b) || w.typeId[b] !== u.producedAtTypeId) continue;
    if (
      !applyCommand(ctx, {
        playerId: p,
        seq: 0,
        type: 'Produce',
        payload: { buildingId: w.idOf(b), loadoutId: u.loadoutId },
      })
    )
      continue;
    used.push(b);
    return 0;
  }
  return 0;
}

/**
 * Step 5b (after the free workers, before the fighter mix): the Klerks and the Vertibird of the script. Support units
 * first: they are cheap and the army needs them; the transport only once the support is covered.
 *
 * Returns the scrap the fighter mix must leave alone this tick. A transport costs several fighters (the Vertibird 320
 * against 150 for a frame), so without saving the mix spends every tick's income and the AI never reaches the price:
 * measured on Rustbelt the Garde's stock never passed 297 and no Vertibird was ever built. It only saves once a
 * finished building that makes it stands (else it would save for a hangar it has not built yet), and only while it has
 * fewer than `max`. The Klerk is cheap enough to buy from the flow and never saved for.
 */
export function produceGarde(
  ctx: SimContext,
  p: number,
  plan: SimRaidPlan,
  t: Tally,
  used: number[],
  reserve: number,
): number {
  const tick = ctx.frame;
  const sp = plan.support;
  if (sp !== null && tick >= sp.fromTicks) {
    // one per perArmy fighters, never more than max: a Klerk without an army to walk with is a wasted 60 scrap
    let want = idiv(t.army.length, sp.perArmy);
    if (want > sp.max) want = sp.max;
    produceOne(
      ctx,
      p,
      sp.typeId,
      want - t.techs.length - t.producingTechs,
      t,
      used,
      reserve,
      false,
    );
  }
  const al = plan.airlift;
  // a transport is only worth its price with a wave to carry: measured, the Garde's army collapses late in a match and
  // saving 320 scrap then only starved it further
  if (al === null || tick < al.fromTicks || t.army.length < al.minArmy) return 0;
  return produceOne(
    ctx,
    p,
    al.typeId,
    al.max - t.transports.length - t.producingTransports,
    t,
    used,
    reserve,
    true,
  );
}
