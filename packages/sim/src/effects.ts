import { EFFECT_TARGET_ALL, EFFECT_TARGET_HERO, MAX_SPEED } from './config.js';
import type { SimEffect } from './config.js';
import { C } from './ecs/world.js';
import { statIndex } from './fromData.js';
import { clampI, idiv } from './math/int.js';
import type { SimContext } from './systems/common.js';

// Effecten van onderzochte techs (tech.json effects[]) op de stats van de eigen units en gebouwen. Afgeleid: de bron is
// de tech-bitset per speler (PlayerState.tech); de stats op de entities (maxHp, damage, speed, range) worden bij elke
// wijziging opnieuw berekend (refreshPlayer) en bij het maken van een entity gezet. Pct-stats tellen op in promille
// bovenop 1000 (100%), M-stats in eenheden bovenop het basisgetal (contract 3: "optelbaar bij het basisgetal").

export const STAT_HP = statIndex('hpPct');
export const STAT_DAMAGE = statIndex('damagePct');
export const STAT_SPEED = statIndex('speedPct');
export const STAT_RANGE = statIndex('rangeM');
export const STAT_GATHER = statIndex('gatherRatePct');
export const STAT_BUILD_TIME = statIndex('buildTimePct');
export const STAT_RESEARCH_TIME = statIndex('researchTimePct');

const matches = (e: SimEffect, stat: number, typeId: number, isHero: boolean): boolean =>
  e.stat === stat && (e.target === EFFECT_TARGET_ALL || (e.target === EFFECT_TARGET_HERO ? isHero : e.typeId === typeId));

/** Of speler p alle techs in `list` heeft onderzocht. */
export function hasTechs(ctx: SimContext, p: number, list: readonly number[]): boolean {
  const bits = ctx.ps.tech[p]!;
  for (const t of list) if (((bits >>> t) & 1) === 0) return false;
  return true;
}

/** Som van de deltas van alle actieve effecten van speler p op `stat` voor een entity van type typeId (of de held). */
export function effectSum(ctx: SimContext, p: number, stat: number, typeId: number, isHero: boolean): number {
  let sum = 0;
  const bits = ctx.ps.tech[p]!;
  if (bits !== 0) {
    for (const t of ctx.config.techs) {
      if (((bits >>> t.techId) & 1) === 0) continue;
      for (const e of t.effects) if (matches(e, stat, typeId, isHero)) sum += e.delta;
    }
  }
  return sum;
}

/** Scrap per verzamelrit van unit i: gatherAmount van zijn type plus gatherRatePct van de eigenaar. */
export function gatherAmountOf(ctx: SimContext, i: number): number {
  const w = ctx.world;
  const t = ctx.unitType(w.typeId[i]!);
  if (t === undefined || t.gatherAmount <= 0) return 0;
  return scalePermille(t.gatherAmount, effectSum(ctx, w.owner[i]!, STAT_GATHER, t.typeId, false));
}

/** base maal (1000 + promille) / 1000, niet negatief. */
export const scalePermille = (base: number, permille: number): number => {
  const v = idiv(base * (1000 + permille), 1000);
  return v < 0 ? 0 : v;
};

/**
 * Tijd-effect (buildTimePct, researchTimePct) als werk per tick in duizendsten (PROGRESS_ONE = 1000 zonder effect):
 * -20% tijd geeft 1250 per tick. Minstens 1 in de noemer, zodat -100% of minder meteen klaar is.
 */
export const workRate = (one: number, timePermille: number): number => idiv(one * 1000, clampI(1000 + timePermille, 1, 0x7fffffff));

/**
 * Zet maxHp, damage, speed en range van entity i uit het basistype plus de effecten van de eigenaar.
 * grow: een hogere maxHp verhoogt hp evenveel (onderzoek); anders blijft hp staan (omscholen). hp nooit boven maxHp.
 */
export function applyStats(ctx: SimContext, i: number, grow: boolean): void {
  const w = ctx.world;
  const p = w.owner[i]!;
  const typeId = w.typeId[i]!;
  const oldMax = w.maxHp[i]!;
  if (w.has(i, C.building)) {
    const bt = ctx.buildingType(typeId);
    if (bt === undefined) return;
    w.maxHp[i] = Math.max(1, scalePermille(bt.maxHp, effectSum(ctx, p, STAT_HP, typeId, false)));
  } else if (w.has(i, C.unit | C.health)) {
    const t = ctx.unitType(typeId);
    if (t === undefined) return;
    w.maxHp[i] = Math.max(1, scalePermille(t.maxHp, effectSum(ctx, p, STAT_HP, typeId, false)));
    w.damage[i] = scalePermille(t.damage, effectSum(ctx, p, STAT_DAMAGE, typeId, false));
    w.speed[i] = clampI(scalePermille(t.speed, effectSum(ctx, p, STAT_SPEED, typeId, false)), 0, MAX_SPEED);
    w.range[i] = Math.max(0, t.range + effectSum(ctx, p, STAT_RANGE, typeId, false));
  } else return;
  const newMax = w.maxHp[i]!;
  if (grow && newMax > oldMax) w.hp[i] = w.hp[i]! + newMax - oldMax;
  if (w.hp[i]! > newMax) w.hp[i] = newMax;
}

/** Na een wijziging in de effecten van speler p (onderzoek klaar): stats van al zijn units en gebouwen opnieuw. */
export function refreshPlayer(ctx: SimContext, p: number): void {
  const w = ctx.world;
  for (let i = 0; i < w.highWater; i++) {
    if (w.alive[i] !== 1 || w.owner[i] !== p || !w.has(i, C.health)) continue;
    applyStats(ctx, i, true);
  }
}
