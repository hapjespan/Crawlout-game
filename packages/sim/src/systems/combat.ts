import { ENTITY_FLAG, EVENT_TYPE } from '@crawlout/protocol';
import { C, NO_ENTITY } from '../ecs/world.js';
import { idiv } from '../math/int.js';
import type { SimContext } from './common.js';
import { distToRect2, face, isEnemy, withinReach } from './common.js';
import { grantXp, heroIndex } from './hero.js';
import { robotRate } from './robots.js';
import { SPECIAL_L, heroOf, heroSpecial, scalePermille } from '../effects.js';
import { veteranKill } from './garde.js';
import { isStunned } from './garde.flags.js';
import { overloadHit } from './garde.klerk.js';
import { captureOf, captureTick } from './slaves.js';
import { creepAwake } from './creeps.js';
import { noteBaseHit } from './defense.js';

// Systeem 5: gevecht. Elke unit met een doel in bereik en een lege cooldown schiet: schade (plus ability-zones) maal
// de damage-matrix (promille) op het pantser van het doel. Hitscan, geen projectielen. Dood en opruimen gebeuren pas in
// systeem 8, dus units die deze tick sneuvelen schieten deze tick nog terug: de volgorde van de ids geeft geen voordeel.
// De held: een kans van L maal luckCritPermille op een kritiek schot (+critDamagePermille, via sim.rng), en
// xpPerKill voor elke vijandelijke unit die door zijn schot onder 0 hp zakt. Balans speltest 14 oktober: zakt een
// vijandelijke unit onder 0 hp door een schot van een eigen unit of turret binnen xpAssistRadius van de levende held,
// dan krijgt die held xpPerAssist (de held leert van het gevecht om hem heen, niet alleen van zijn eigen schoten).
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
    // a Slaver (data 0.21.0) holds a capturable target instead of hitting it (systems/slaves.ts)
    const cap = captureOf(ctx, i);
    if (cap !== null && captureTick(ctx, i, cap)) continue;
    const tid = w.target[i]!;
    if (tid === NO_ENTITY || w.cooldown[i]! > 0 || w.damage[i]! <= 0) continue;
    const t = w.resolve(tid);
    if (t < 0 || !isEnemy(w, i, t) || !withinReach(w, i, t, w.range[i]!)) continue;
    if (ctx.garde.active && isStunned(ctx, i)) continue; // sim 0.33.0: overloaded power armour
    // technicus-regel (data 0.16.0): een ongedekte robot schiet trager (langere cooldown), bij 0 promille niet
    const rate = robotRate(ctx, i);
    if (rate <= 0) continue;
    const mult = matrix[w.damageType[i]!]![w.armorType[t]!]!;
    let dmg = ctx.auras.any ? scalePermille(w.damage[i]!, ctx.auras.damage[i]!) : w.damage[i]!;
    // belegering (data 0.16.0): extra schade tegen gebouwen bovenop de damage-matrix
    if ((w.mask[t]! & C.building) !== 0 && (w.mask[i]! & C.unit) !== 0) {
      const siege = ctx.unitType(w.typeId[i]!)?.siege;
      if (siege !== undefined && siege !== null)
        dmg = scalePermille(dmg, siege.vsBuildingsPermille);
    }
    const hero = (w.mask[i]! & C.hero) !== 0;
    if (hero) {
      const chance = heroSpecial(ctx, w.owner[i]!, SPECIAL_L) * ctx.config.special.luckCritPermille;
      if (chance > 0 && ctx.rng.nextInt(1000) < chance)
        dmg = scalePermille(dmg, ctx.config.special.critDamagePermille);
    }
    const before = w.hp[t]!;
    let hit = idiv(dmg * mult, 1000);
    // the armour aura of the Paladin-Commander (sim 0.32.0, damageTakenPct): only where an aura sets it
    if (ctx.auras.any && ctx.auras.taken[t] !== 0) hit = scalePermille(hit, ctx.auras.taken[t]!);
    w.hp[t] = before - hit;
    // who razes or kills it plunders it (data 0.21.0, systems/plunder.ts)
    w.lastHit[t] = w.owner[i]! + 1;
    noteBaseHit(ctx, i, t); // base defence (sim 0.29.0)
    overloadHit(ctx, i, t); // sim 0.33.0: the Klerk overloads enemy power armour
    if (
      before > 0 &&
      w.hp[t]! <= 0 &&
      (w.mask[t]! & C.unit) !== 0 &&
      w.owner[i]! < ctx.playerCount
    ) {
      killXp(ctx, i, t, hero);
      veteranKill(ctx, i); // sim 0.32.0: veteran promotion of the Garde
    }
    w.cooldown[i] = rate >= 1000 ? w.cooldownMax[i]! : idiv(w.cooldownMax[i]! * 1000, rate);
    face(w, i, w.x[t]!, w.y[t]!);
    const sid = w.idOf(i);
    ctx.events.push(EVENT_TYPE.shotFired, sid, tid, w.x[i]!, w.y[i]!);
    ctx.events.push(EVENT_TYPE.hit, tid, sid, w.x[t]!, w.y[t]!);
  }
}

/** xp voor de held van de schutter i bij de dood van vijandelijke unit t: xpPerKill als hij zelf schoot, anders xpPerAssist binnen de straal. */
function killXp(ctx: SimContext, i: number, t: number, hero: boolean): void {
  const p = ctx.world.owner[i]!;
  const h = heroOf(ctx, p);
  if (h === undefined) return;
  if (hero) {
    grantXp(ctx, p, h.xpPerKill);
    return;
  }
  const k = h.xpPerAssist > 0 ? heroIndex(ctx, p) : -1;
  if (k < 0) return;
  const w = ctx.world;
  const r = h.xpAssistRadius;
  const dx = w.x[t]! - w.x[k]!;
  const dy = w.y[t]! - w.y[k]!;
  if (dx > r || -dx > r || dy > r || -dy > r || dx * dx + dy * dy > r * r) return;
  grantXp(ctx, p, h.xpPerAssist);
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
    if (w.creepCamp[j] !== 0 && !creepAwake(ctx, j)) continue; // a sleeping camp (sim 0.20.0)
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
