import type { SimContext } from './common.js';

// The Garde, round B (sim 0.33.0; proposal for the architect): per-entity questions the movement, combat and steering ask,
// only true where a Garde player plays (garde.active), so every other match runs as before.

/** Unit i flies (loadouts flying, the Vertibird): straight over any terrain, no flow field, walls or separation. */
export function isFlying(ctx: SimContext, i: number): boolean {
  return ctx.garde.active && ctx.unitType(ctx.world.typeId[i]!)?.flying === true;
}

/** Unit i is stunned by an overload this tick (garde.klerk.ts): it neither moves nor fires. */
export function isStunned(ctx: SimContext, i: number): boolean {
  return ctx.garde.active && ctx.frame < ctx.garde.stunUntil[i]!;
}
