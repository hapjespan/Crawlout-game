import { ANIM, ENTITY_FLAG, EVENT_TYPE } from '@crawlout/protocol';
import { BSTATE_SITE, C, NO_ENTITY, ORDER_BUILD, ORDER_CRAFT, ORDER_GATHER, PHASE_CRAFT, PHASE_WORK } from '../ecs/world.js';
import { PROGRESS_ONE, makeCorpse, removeBuilding } from '../entities.js';
import { clampI, idiv } from '../math/int.js';
import type { SimContext } from './common.js';
import { isEnemy } from './common.js';
import { heroDied } from './hero.js';

// Systeem 8: dood en opruimen, daarna de presentatie (anim, animT, flags) die de snapshot in gaat.
// Een unit met hp <= 0 wordt een lijk (anim death, flag dead) tot corpseTicks op is; een gebouw verdwijnt meteen en
// geeft zijn cellen vrij. Events: death (a = id, b = typeId).

const ANIM_FULL = 0xffff;

/** Fractie a/b als animT (0..65535). */
const frac = (a: number, b: number): number => (b <= 0 ? ANIM_FULL : clampI(idiv(a * ANIM_FULL, b), 0, ANIM_FULL));

export function cleanupSystem(ctx: SimContext): void {
  const w = ctx.world;
  const corpseTicks = ctx.config.corpseTicks;
  for (let i = 0; i < w.highWater; i++) {
    if (w.alive[i] !== 1) continue;
    const m = w.mask[i]!;
    if ((m & C.corpse) !== 0) {
      // bestaande lijken: timer af, dan weg
      w.work[i] = w.work[i]! - 1;
      if (w.work[i]! <= 0) w.free(i);
      continue;
    }
    if ((m & C.health) === 0 || w.hp[i]! > 0) continue;
    ctx.events.push(EVENT_TYPE.death, w.idOf(i), w.typeId[i]!, w.x[i]!, w.y[i]!);
    const owner = w.owner[i]!;
    if ((m & C.building) !== 0) removeBuilding(ctx, i);
    else if (corpseTicks > 0) makeCorpse(ctx, i);
    else w.free(i);
    if ((m & C.hero) !== 0) heroDied(ctx, owner);
  }
  presentation(ctx);
}

function presentation(ctx: SimContext): void {
  const w = ctx.world;
  const step = ctx.config.walkAnimStep;
  const corpseTicks = ctx.config.corpseTicks;
  for (let i = 0; i < w.highWater; i++) {
    if (w.alive[i] !== 1) continue;
    const m = w.mask[i]!;
    if ((m & C.corpse) !== 0) {
      w.anim[i] = ANIM.death;
      w.animT[i] = frac(corpseTicks - w.work[i]!, corpseTicks);
      w.flags[i] = ENTITY_FLAG.dead;
      continue;
    }
    if ((m & C.building) !== 0) {
      const bt = ctx.buildingType(w.typeId[i]!);
      const site = w.bstate[i] === BSTATE_SITE;
      w.anim[i] = site ? ANIM.build : ANIM.idle;
      w.animT[i] = site && bt !== undefined ? frac(w.progress[i]!, bt.buildTicks * PROGRESS_ONE) : 0;
      continue;
    }
    if ((m & C.claim) !== 0) {
      w.animT[i] = w.claimProgress[i]!; // al 0..65535 (systeem 7)
      continue;
    }
    if ((m & C.unit) === 0) continue;
    let flags = 0;
    if (w.carry[i]! > 0) flags |= ENTITY_FLAG.carrying;
    const tid = w.target[i]!;
    const t = tid === NO_ENTITY ? -1 : w.resolve(tid);
    const fighting = t >= 0 && isEnemy(w, i, t);
    if (fighting) flags |= ENTITY_FLAG.inCombat;
    w.flags[i] = flags;
    const ord = w.orderType(i);
    if (w.mvOn[i] === 1) {
      w.anim[i] = ANIM.walk;
      w.animT[i] = (w.animT[i]! + step) & 0xffff;
    } else if (fighting) {
      w.anim[i] = ANIM.attack1;
      w.animT[i] = frac(w.cooldownMax[i]! - w.cooldown[i]!, w.cooldownMax[i]!);
    } else if (ord === ORDER_GATHER && w.phase[i] === PHASE_WORK) {
      w.anim[i] = ANIM.gather;
      w.animT[i] = frac(w.work[i]!, ctx.unitType(w.typeId[i]!)?.gatherTicks ?? 0);
    } else if (ord === ORDER_BUILD && w.phase[i] === PHASE_WORK) {
      w.anim[i] = ANIM.build;
      w.animT[i] = (w.animT[i]! + step) & 0xffff;
    } else if (ord === ORDER_CRAFT && w.phase[i] === PHASE_CRAFT) {
      w.anim[i] = ANIM.build;
      w.animT[i] = (w.animT[i]! + step) & 0xffff;
    } else {
      w.anim[i] = ANIM.idle;
      w.animT[i] = (w.animT[i]! + step) & 0xffff;
    }
  }
}
