import { C } from '../ecs/world.js';
import type { SimContext } from './common.js';

// The Garde, round B (sim 0.33.0, data 0.39.0; proposal for the architect; docs/garde.md item 3), the Klerk:
//  - Repair (loadouts repair with target vehicle, role technician): an idle Klerk repairs the most damaged own frame,
//    Vertibird or completed building within seekRange, like a support robot (systems/robots.ts repairIdle/repairWork).
//  - Overload (loadouts overload): when its hit (system 5) lands on an enemy unit of one of overload.typeIds (the power
//    armour, also a frame of the map) and its cooldown is over, the target is stunned stunTicks long (no moving, no
//    firing; garde.flags.ts isStunned) and the Klerk waits cooldownTicks before the next overload.

/** System 5, after unit i hit t: the overload of the Klerk. */
export function overloadHit(ctx: SimContext, i: number, t: number): void {
  const g = ctx.garde;
  const w = ctx.world;
  if (!g.active || (w.mask[i]! & (C.unit | C.hero)) !== C.unit) return;
  const o = ctx.unitType(w.typeId[i]!)?.overload;
  if (o === undefined || o === null || ctx.frame < g.overloadAt[i]!) return;
  if ((w.mask[t]! & (C.unit | C.hero)) !== C.unit || !o.typeIds.includes(w.typeId[t]!)) return;
  g.stunUntil[t] = ctx.frame + o.stunTicks;
  g.overloadAt[i] = ctx.frame + o.cooldownTicks;
}
