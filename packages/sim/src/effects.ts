import { EFFECT_TARGET_ALL, EFFECT_TARGET_HERO, MAX_SPEED, SPECIAL_COUNT } from './config.js';
import type { SimBuildingType, SimEffect, SimHero, SimTech } from './config.js';
import { BSTATE_DONE, C } from './ecs/world.js';
import { PROVIDES_TURRET, statIndex } from './fromData.js';
import { clampI, idiv } from './math/int.js';
import type { SimContext } from './systems/common.js';

// Effecten van onderzochte techs (tech.json effects[]) en van de perks van een levende held (perks.json effects[]) op
// de stats van de eigen units, gebouwen en de held. Afgeleid: de bron is de tech-bitset per speler (PlayerState.tech)
// en de perk-bitset van de held; de stats op de entities (maxHp, damage, speed, range) worden bij elke wijziging
// opnieuw berekend (refreshPlayer) en bij het maken van een entity gezet. Pct-stats tellen op in promille bovenop
// 1000 (100%), M-stats in eenheden bovenop het basisgetal (contract 3: "optelbaar bij het basisgetal").
//
// Held (Spelfundament 5): "Dood: de perks vallen weg" — perk-effecten gelden alleen zolang de held leeft. "Elke oplap
// kost 20% van perks en health" — na r keer oplappen werken perks op (1000 - r * revivePenaltyPermille) promille van
// hun delta en is de maxHp van de held met dezelfde factor geschaald; na maxRevives keer is de held leeg.

/** Toestand van de held van een speler (PlayerState.heroState). */
export const HERO_NONE = 0;
export const HERO_ALIVE = 1;
export const HERO_DEAD = 2;
export const HERO_REVIVING = 3;
export const HERO_EMPTY = 4;

export const STAT_HP = statIndex('hpPct');
export const STAT_DAMAGE = statIndex('damagePct');
export const STAT_SPEED = statIndex('speedPct');
export const STAT_RANGE = statIndex('rangeM');
export const STAT_GATHER = statIndex('gatherRatePct');
export const STAT_BUILD_TIME = statIndex('buildTimePct');
export const STAT_RESEARCH_TIME = statIndex('researchTimePct');
/** Kosten van onderzoek (data 0.16.0, de passieven van de Opziener). */
export const STAT_RESEARCH_COST = statIndex('researchCostPct');

/** Eerste SPECIAL-stat (S); P E C I A L volgen in die volgorde. */
export const STAT_SPECIAL = statIndex('S');
export const SPECIAL_S = 0;
export const SPECIAL_P = 1;
export const SPECIAL_E = 2;
export const SPECIAL_C = 3;
export const SPECIAL_I = 4;
export const SPECIAL_A = 5;
export const SPECIAL_L = 6;

/** De held van de factie van speler p, of undefined. */
export function heroOf(ctx: SimContext, p: number): SimHero | undefined {
  const id = ctx.config.factions[ctx.players[p]!.factionId]!.heroId;
  return id < 0 ? undefined : ctx.config.heroes[id];
}

/** Schaal van perks en health (promille) na `revives` keer oplappen. */
export function reviveScale(h: SimHero, revives: number): number {
  const v = 1000 - revives * h.revivePenaltyPermille;
  return v < 0 ? 0 : v;
}

const matches = (e: SimEffect, stat: number, typeId: number, isHero: boolean): boolean =>
  e.stat === stat &&
  (e.target === EFFECT_TARGET_ALL ||
    (e.target === EFFECT_TARGET_HERO ? isHero : e.typeId === typeId));

/** Of speler p alle techs in `list` heeft onderzocht. */
export function hasTechs(ctx: SimContext, p: number, list: readonly number[]): boolean {
  const bits = ctx.ps.tech[p]!;
  for (const t of list) if (((bits >>> t) & 1) === 0) return false;
  return true;
}

/** Som van de deltas van alle actieve effecten van speler p op `stat` voor een entity van type typeId (of de held). */
export function effectSum(
  ctx: SimContext,
  p: number,
  stat: number,
  typeId: number,
  isHero: boolean,
): number {
  let sum = 0;
  const bits = ctx.ps.tech[p]!;
  if (bits !== 0) {
    for (const t of ctx.config.techs) {
      if (((bits >>> t.techId) & 1) === 0) continue;
      for (const e of t.effects) if (matches(e, stat, typeId, isHero)) sum += e.delta;
    }
  }
  if (ctx.ps.heroState[p] !== HERO_ALIVE) return sum;
  // perks en (data 0.16.0) de passieven van de held: alleen zolang hij leeft, geschaald met de oplap-straf
  const perks = ctx.ps.heroPerks[p]!;
  const h = heroOf(ctx, p);
  if (h === undefined || (perks === 0 && h.passives.length === 0)) return sum;
  const scale = reviveScale(h, ctx.ps.heroRevives[p]!);
  if (perks !== 0) {
    for (const pk of ctx.config.perks) {
      if (((perks >>> pk.perkId) & 1) === 0) continue;
      for (const e of pk.effects)
        if (matches(e, stat, typeId, isHero)) sum += idiv(e.delta * scale, 1000);
    }
  }
  for (const e of h.passives)
    if (matches(e, stat, typeId, isHero)) sum += idiv(e.delta * scale, 1000);
  return sum;
}

/** Kosten van een onderzoek voor speler p: scrapCost plus researchCostPct (data 0.16.0), niet negatief. */
export function researchCost(ctx: SimContext, p: number, t: SimTech): number {
  return scalePermille(t.scrapCost, effectSum(ctx, p, STAT_RESEARCH_COST, t.buildingTypeId, false));
}

/**
 * Bonus van het turret-netwerk (data 0.16.0) voor voltooid gebouw i, in promille schade: met de tech requiresTech,
 * damagePermillePerTurret per andere voltooide, levende eigen turret (provides turret) waarvan het midden binnen radius
 * van het midden van i ligt (grens inclusief), hoogstens maxDamagePermille. 0 zonder netwerk of tech.
 */
export function networkBonus(ctx: SimContext, i: number, bt: SimBuildingType): number {
  const n = bt.network;
  const w = ctx.world;
  const p = w.owner[i]!;
  if (n === null || w.bstate[i] !== BSTATE_DONE || !hasTechs(ctx, p, [n.requiresTech])) return 0;
  const r = n.radius;
  const idx = ctx.index;
  idx.refresh(w);
  let count = 0;
  for (let k = 0; k < idx.buildingCount; k++) {
    const j = idx.buildings[k]!;
    if (j === i || w.owner[j] !== p || w.bstate[j] !== BSTATE_DONE || w.hp[j]! <= 0) continue;
    const ot = ctx.buildingType(w.typeId[j]!);
    if (ot === undefined || (ot.provides & PROVIDES_TURRET) === 0) continue;
    const dx = w.x[j]! - w.x[i]!;
    const dy = w.y[j]! - w.y[i]!;
    if (dx > r || -dx > r || dy > r || -dy > r || dx * dx + dy * dy > r * r) continue;
    count++;
  }
  const bonus = count * n.damagePermillePerTurret;
  return bonus < n.maxDamagePermille ? bonus : n.maxDamagePermille;
}

/** Stats van alle voltooide turrets van speler p opnieuw (het netwerk na een turret die af komt, sneuvelt of weg is). */
export function refreshTurrets(ctx: SimContext, p: number): void {
  const w = ctx.world;
  const idx = ctx.index;
  idx.refresh(w);
  for (let k = 0; k < idx.buildingCount; k++) {
    const j = idx.buildings[k]!;
    if (w.owner[j] !== p || w.bstate[j] !== BSTATE_DONE) continue;
    const bt = ctx.buildingType(w.typeId[j]!);
    if (bt !== undefined && bt.network !== null) applyStats(ctx, j, false);
  }
}

/** SPECIAL-letter k (SPECIAL_*) van de held van p: basis uit de data plus effecten op die letter. 0 zonder held. */
export function heroSpecial(ctx: SimContext, p: number, k: number): number {
  const h = heroOf(ctx, p);
  return h === undefined
    ? 0
    : h.special[k]! +
        ctx.ps.trained[p * SPECIAL_COUNT + k]! +
        effectSum(ctx, p, STAT_SPECIAL + k, h.typeId, true);
}

/** SPECIAL-bonus voor de hele speler (C, I): alleen zolang de held leeft. letter maal promille per punt, anders 0. */
export function liveHeroBonus(ctx: SimContext, p: number, k: number, perPoint: number): number {
  return ctx.ps.heroState[p] === HERO_ALIVE ? heroSpecial(ctx, p, k) * perPoint : 0;
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
export const workRate = (one: number, timePermille: number): number =>
  idiv(one * 1000, clampI(1000 + timePermille, 1, 0x7fffffff));

/**
 * Zet maxHp, damage, speed en range van entity i uit het basistype plus de effecten van de eigenaar.
 * grow: een hogere maxHp verhoogt hp evenveel (onderzoek); anders blijft hp staan (omscholen). hp nooit boven maxHp.
 */
export function applyStats(ctx: SimContext, i: number, grow: boolean): void {
  const w = ctx.world;
  const p = w.owner[i]!;
  const typeId = w.typeId[i]!;
  const oldMax = w.maxHp[i]!;
  if (w.has(i, C.hero)) {
    const h = heroOf(ctx, p);
    const t = h === undefined ? undefined : ctx.unitType(h.baseTypeId);
    if (h === undefined || t === undefined) return;
    const sp = ctx.config.special;
    const special = (k: number): number => heroSpecial(ctx, p, k);
    const hp = scalePermille(
      t.maxHp,
      special(SPECIAL_E) * sp.enduranceHpPermille + effectSum(ctx, p, STAT_HP, h.typeId, true),
    );
    w.maxHp[i] = Math.max(1, idiv(hp * reviveScale(h, ctx.ps.heroRevives[p]!), 1000));
    w.damage[i] = scalePermille(
      t.damage,
      special(SPECIAL_S) * sp.strengthDamagePermille +
        effectSum(ctx, p, STAT_DAMAGE, h.typeId, true),
    );
    const speed = scalePermille(
      t.speed,
      special(SPECIAL_A) * sp.agilitySpeedPermille + effectSum(ctx, p, STAT_SPEED, h.typeId, true),
    );
    w.speed[i] = clampI(speed, 0, MAX_SPEED);
    w.range[i] = Math.max(
      0,
      t.range +
        special(SPECIAL_P) * sp.perceptionRangeU +
        effectSum(ctx, p, STAT_RANGE, h.typeId, true),
    );
  } else if (w.has(i, C.building)) {
    const bt = ctx.buildingType(typeId);
    if (bt === undefined) return;
    w.maxHp[i] = Math.max(1, scalePermille(bt.maxHp, effectSum(ctx, p, STAT_HP, typeId, false)));
    if (bt.damage > 0) {
      // turret (besluit 8): tech- en perk-effecten op het gebouwtype gelden net als op een unit
      // het turret-netwerk (data 0.16.0) telt op in dezelfde som als tech en perks
      w.damage[i] = scalePermille(
        bt.damage,
        effectSum(ctx, p, STAT_DAMAGE, typeId, false) + networkBonus(ctx, i, bt),
      );
      w.range[i] = Math.max(0, bt.range + effectSum(ctx, p, STAT_RANGE, typeId, false));
      w.cooldownMax[i] = bt.cooldown;
    }
  } else if (w.has(i, C.unit | C.health)) {
    const t = ctx.unitType(typeId);
    if (t === undefined) return;
    w.maxHp[i] = Math.max(1, scalePermille(t.maxHp, effectSum(ctx, p, STAT_HP, typeId, false)));
    w.damage[i] = scalePermille(t.damage, effectSum(ctx, p, STAT_DAMAGE, typeId, false));
    w.speed[i] = clampI(
      scalePermille(t.speed, effectSum(ctx, p, STAT_SPEED, typeId, false)),
      0,
      MAX_SPEED,
    );
    w.range[i] = Math.max(0, t.range + effectSum(ctx, p, STAT_RANGE, typeId, false));
  } else return;
  const newMax = w.maxHp[i]!;
  if (grow && newMax > oldMax) w.hp[i] = w.hp[i]! + newMax - oldMax;
  if (w.hp[i]! > newMax) w.hp[i] = newMax;
}

/** Na een wijziging in de effecten van speler p (onderzoek, perk, held dood of terug): stats van al zijn units en gebouwen opnieuw. */
export function refreshPlayer(ctx: SimContext, p: number): void {
  const w = ctx.world;
  for (let i = 0; i < w.highWater; i++) {
    if (w.alive[i] !== 1 || w.owner[i] !== p || !w.has(i, C.health)) continue;
    applyStats(ctx, i, true);
  }
}
