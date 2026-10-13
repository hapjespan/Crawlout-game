import { EVENT_TYPE } from '@crawlout/protocol';
import { C, NO_ENTITY } from '../ecs/world.js';
import { idiv } from '../math/int.js';
import type { SimContext } from './common.js';
import { face, isEnemy, withinReach } from './common.js';
import { grantXp } from './hero.js';
import { SPECIAL_L, heroOf, heroSpecial, scalePermille } from '../effects.js';

// Systeem 5: gevecht. Elke unit met een doel in bereik en een lege cooldown schiet: schade (plus ability-zones) maal
// de damage-matrix (promille) op het pantser van het doel. Hitscan, geen projectielen. Dood en opruimen gebeuren pas in
// systeem 8, dus units die deze tick sneuvelen schieten deze tick nog terug: de volgorde van de ids geeft geen voordeel.
// De held: een kans van L maal luckCritPermille op een kritiek schot (+critDamagePermille, via sim.rng), en
// xpPerKill voor elke vijandelijke unit die door zijn schot onder 0 hp zakt.

export function combatSystem(ctx: SimContext): void {
  const w = ctx.world;
  const matrix = ctx.config.damageMatrix;
  const need = C.combat | C.health;
  for (let i = 0; i < w.highWater; i++) {
    if (!w.has(i, need)) continue;
    if (w.cooldown[i]! > 0) w.cooldown[i] = w.cooldown[i]! - 1;
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
