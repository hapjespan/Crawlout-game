import { ENTITY_FLAG, EVENT_TYPE } from '@crawlout/protocol';
import { C, NO_ENTITY } from '../ecs/world.js';
import { idiv } from '../math/int.js';
import type { SimContext } from './common.js';
import { distToRect2, face, isEnemy, withinReach } from './common.js';
import { grantXp } from './hero.js';
import { SPECIAL_L, heroOf, heroSpecial, scalePermille } from '../effects.js';

// Systeem 5: gevecht. Elke unit met een doel in bereik en een lege cooldown schiet: schade (plus ability-zones) maal
// de damage-matrix (promille) op het pantser van het doel. Hitscan, geen projectielen. Dood en opruimen gebeuren pas in
// systeem 8, dus units die deze tick sneuvelen schieten deze tick nog terug: de volgorde van de ids geeft geen voordeel.
// De held: een kans van L maal luckCritPermille op een kritiek schot (+critDamagePermille, via sim.rng), en
// xpPerKill voor elke vijandelijke unit die door zijn schot onder 0 hp zakt.
// Turrets (besluit 8, fase-0 sectie 14): een voltooid gebouw met een wapen heeft Combat. Het beweegt niet en heeft geen
// orders: het houdt zijn doel zolang dat een vijand binnen range is, en kiest anders zelf de dichtstbijzijnde vijand
// binnen range (units voor gebouwen, tiebreak laagste id; nooit iets neutraals). Het doel kiest hij alleen als hij kan
// schieten, zodat een turret zonder vijanden niets kost behalve deze controle.

export function combatSystem(ctx: SimContext): void {
  const w = ctx.world;
  const matrix = ctx.config.damageMatrix;
  const need = C.combat | C.health;
  for (let i = 0; i < w.highWater; i++) {
    if (!w.has(i, need)) continue;
    if (w.cooldown[i]! > 0) w.cooldown[i] = w.cooldown[i]! - 1;
    if ((w.mask[i]! & C.building) !== 0) turretAim(ctx, i);
    const tid = w.target[i]!;
    if (tid === NO_ENTITY || w.cooldown[i]! > 0 || w.damage[i]! <= 0) continue;
    const t = w.resolve(tid);
    if (t < 0 || !isEnemy(w, i, t) || !withinReach(w, i, t, w.range[i]!)) continue;
    const mult = matrix[w.damageType[i]!]![w.armorType[t]!]!;
    let dmg = ctx.auras.any ? scalePermille(w.damage[i]!, ctx.auras.damage[i]!) : w.damage[i]!;
    const hero = (w.mask[i]! & C.hero) !== 0;
    if (hero) {
      const chance = heroSpecial(ctx, w.owner[i]!, SPECIAL_L) * ctx.config.special.luckCritPermille;
      if (chance > 0 && ctx.rng.nextInt(1000) < chance) dmg = scalePermille(dmg, ctx.config.special.critDamagePermille);
    }
    const before = w.hp[t]!;
    w.hp[t] = before - idiv(dmg * mult, 1000);
    if (hero && before > 0 && w.hp[t]! <= 0 && (w.mask[t]! & C.unit) !== 0) {
      const h = heroOf(ctx, w.owner[i]!);
      if (h !== undefined) grantXp(ctx, w.owner[i]!, h.xpPerKill);
    }
    w.cooldown[i] = w.cooldownMax[i]!;
    face(w, i, w.x[t]!, w.y[t]!);
    const sid = w.idOf(i);
    ctx.events.push(EVENT_TYPE.shotFired, sid, tid, w.x[i]!, w.y[i]!);
    ctx.events.push(EVENT_TYPE.hit, tid, sid, w.x[t]!, w.y[t]!);
  }
}

/** Turret i: doel houden of opnieuw kiezen (zie boven). Zet ook flags.inCombat voor de snapshot. */
function turretAim(ctx: SimContext, i: number): void {
  const w = ctx.world;
  const r = w.range[i]!;
  const cur = w.target[i]! === NO_ENTITY ? -1 : w.resolve(w.target[i]!);
  let t = cur >= 0 && isEnemy(w, i, cur) && withinReach(w, i, cur, r) ? cur : -1;
  if (t < 0 && w.cooldown[i]! <= 0 && w.damage[i]! > 0) t = turretAcquire(ctx, i, r);
  w.target[i] = t < 0 ? NO_ENTITY : w.idOf(t);
  w.flags[i] = t < 0 ? 0 : ENTITY_FLAG.inCombat;
}

function turretAcquire(ctx: SimContext, i: number, r: number): number {
  const w = ctx.world;
  const x = w.x[i]!;
  const y = w.y[i]!;
  let bestU = -1;
  let bestUD = 0;
  let bestB = -1;
  let bestBD = 0;
  for (let j = 0; j < w.highWater; j++) {
    if (!isEnemy(w, i, j)) continue;
    if ((w.mask[j]! & C.building) !== 0) {
      if (bestU >= 0) continue;
      const d = distToRect2(x, y, w.fx[j]!, w.fy[j]!, w.fw[j]!, w.fh[j]!);
      if (d <= r * r && (bestB < 0 || d < bestBD)) {
        bestB = j;
        bestBD = d;
      }
    } else {
      const dx = w.x[j]! - x;
      const dy = w.y[j]! - y;
      const rr = r + w.radius[j]!;
      if (dx > rr || -dx > rr || dy > rr || -dy > rr) continue;
      const d = dx * dx + dy * dy;
      if (d <= rr * rr && (bestU < 0 || d < bestUD)) {
        bestU = j;
        bestUD = d;
      }
    }
  }
  return bestU >= 0 ? bestU : bestB;
}
