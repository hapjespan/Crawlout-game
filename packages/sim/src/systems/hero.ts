import { EVENT_TYPE, MAX_ENTITIES } from '@crawlout/protocol';
import type { CommandPayload, HeroStatus } from '@crawlout/protocol';
import { AURA_SIDE_ENEMY, AURA_TARGET_TURRETS, MAX_ABILITIES, SPECIAL_COUNT } from '../config.js';
import { BSTATE_DONE, C } from '../ecs/world.js';
import {
  HERO_ALIVE,
  HERO_DEAD,
  HERO_EMPTY,
  HERO_NONE,
  HERO_REVIVING,
  STAT_DAMAGE,
  STAT_SPEED,
  applyStats,
  heroOf,
  heroSpecial,
  refreshPlayer,
} from '../effects.js';
import { PROVIDES_HQ } from '../fromData.js';
import { isInt } from '../math/int.js';
import type { Census } from './census.js';
import type { SimContext } from './common.js';
import { cellCenterOf, face, inMap, nthFreeCellAround } from './common.js';

// De held (Spelfundament 5, contract 1 HeroStatus). Eén per speler: de eerste held van zijn factie (SimFaction.heroId).
//  - Hij spawnt in de startopstelling naast het hoofdgebouw, als unit met C.hero en typeId heroTypeId(heroId). Lichaam,
//    wapen en basisstats komen van SimHero.baseTypeId; SPECIAL, perks en techs schalen ze (effects.ts).
//  - xp: xpPerKill per vijandelijke unit die hij zelf doodt (systeem 5), xpPerDiscovery per claimpunt dat zijn speler
//    voor het eerst neemt (systeem 7). Elk level (xpThresholds) geeft een perk-keuze (pendingPerks) en event heroLevel.
//  - PickPerk: een perk uit zijn perkPool die hij nog niet heeft en waarvoor zijn SPECIAL hoog genoeg is.
//  - HeroAbility: een zone op een punt binnen rangeU (of op de held als rangeU 0 is); zolang de zone duurt geven de
//    effecten per tick promille op speed en damage van units in de straal (auraSystem, voor systeem 4 en 5).
//  - Dood: de perks vallen weg (effects.ts). Oplappen met Recruit op het eigen hoofdgebouw: reviveScrap meteen,
//    reviveTicks later staat hij naast het hoofdgebouw, met revivePenaltyPermille minder perks en health per keer.
//    Na maxRevives keer oplappen is de held bij de volgende dood leeg (HERO_EMPTY).

/** Snelheid- en schade-promille per entity uit actieve ability-zones; afgeleid, elke tick opnieuw (geen state). */
export class Auras {
  any = false;
  readonly speed = new Int32Array(MAX_ENTITIES);
  readonly damage = new Int32Array(MAX_ENTITIES);
}

/** Maakt de held van speler p op (x, y). Geeft de index of -1. Zet heroEnt en heroState. */
export function createHero(ctx: SimContext, p: number, x: number, y: number): number {
  const h = heroOf(ctx, p);
  const base = h === undefined ? undefined : ctx.unitType(h.baseTypeId);
  if (h === undefined || base === undefined) return -1;
  const w = ctx.world;
  const i = w.alloc();
  if (i < 0) return -1;
  w.mask[i] = C.transform | C.movement | C.health | C.owner | C.unit | C.orders | C.combat | C.hero;
  w.x[i] = x;
  w.y[i] = y;
  w.owner[i] = p;
  w.typeId[i] = h.typeId;
  w.loadoutId[i] = base.loadoutId;
  w.bodyType[i] = base.bodyType;
  w.role[i] = base.role;
  w.armorType[i] = base.armorType;
  w.radius[i] = base.radius;
  w.damageType[i] = base.damageType;
  w.cooldownMax[i] = base.cooldown;
  ctx.ps.heroEnt[p] = w.idOf(i);
  ctx.ps.heroState[p] = HERO_ALIVE;
  applyStats(ctx, i, false);
  w.hp[i] = w.maxHp[i]!;
  ctx.events.push(EVENT_TYPE.spawn, w.idOf(i), h.typeId, x, y);
  return i;
}

/** Startopstelling: level 1 en de held op cel c naast het hoofdgebouw, kijkend naar (lookX, lookY). */
export function spawnStartHero(ctx: SimContext, p: number, c: number, lookX: number, lookY: number): void {
  if (heroOf(ctx, p) === undefined) return;
  ctx.ps.heroLevel[p] = 1;
  const at = cellCenterOf(ctx.map, c);
  const i = createHero(ctx, p, at.x, at.y);
  if (i < 0) throw new Error('start: wereld vol');
  face(ctx.world, i, lookX, lookY);
}

/** xp voor de held van p (ook als hij dood is, niet als hij leeg is); elk nieuw level geeft een perk-keuze. */
export function grantXp(ctx: SimContext, p: number, amount: number): void {
  const ps = ctx.ps;
  const st = ps.heroState[p]!;
  const h = heroOf(ctx, p);
  if (h === undefined || st === HERO_NONE || st === HERO_EMPTY || amount <= 0) return;
  ps.heroXp[p] = ps.heroXp[p]! + amount;
  const w = ctx.world;
  while (ps.heroLevel[p]! - 1 < h.xpThresholds.length && ps.heroXp[p]! >= h.xpThresholds[ps.heroLevel[p]! - 1]!) {
    ps.heroLevel[p] = ps.heroLevel[p]! + 1;
    ps.heroPending[p] = ps.heroPending[p]! + 1;
    const e = w.resolve(ps.heroEnt[p]!);
    ctx.events.push(EVENT_TYPE.heroLevel, ps.heroEnt[p]!, ps.heroLevel[p]!, e >= 0 ? w.x[e]! : 0, e >= 0 ? w.y[e]! : 0);
  }
}

/** De held van p is gesneuveld (systeem 8, na makeCorpse): perks vallen weg; na maxRevives keer oplappen is hij leeg. */
export function heroDied(ctx: SimContext, p: number): void {
  const ps = ctx.ps;
  const h = heroOf(ctx, p);
  ps.heroEnt[p] = 0;
  ps.heroState[p] = h !== undefined && ps.heroRevives[p]! < h.maxRevives ? HERO_DEAD : HERO_EMPTY;
  refreshPlayer(ctx, p);
}

/** Index van de levende held van p, of -1. */
export function heroIndex(ctx: SimContext, p: number): number {
  return ctx.ps.heroState[p] === HERO_ALIVE ? ctx.world.resolve(ctx.ps.heroEnt[p]!) : -1;
}

/** Systeem 6 (held): cooldowns en zones aftellen, oplappen afronden zodra er een hoofdgebouw is. */
export function heroSystem(ctx: SimContext, census: Census): void {
  const ps = ctx.ps;
  for (let p = 0; p < ctx.playerCount; p++) {
    for (let a = 0; a < MAX_ABILITIES; a++) {
      const k = p * MAX_ABILITIES + a;
      if (ps.abCooldown[k]! > 0) ps.abCooldown[k] = ps.abCooldown[k]! - 1;
      if (ps.zoneTicks[k]! > 0) ps.zoneTicks[k] = ps.zoneTicks[k]! - 1;
    }
    if (ps.heroState[p] !== HERO_REVIVING) continue;
    if (ps.heroTimer[p]! > 0) ps.heroTimer[p] = ps.heroTimer[p]! - 1;
    const hq = census.hq[p]!;
    if (ps.heroTimer[p]! > 0 || hq < 0) continue;
    const w = ctx.world;
    const c = nthFreeCellAround(ctx, w.fx[hq]!, w.fy[hq]!, w.fw[hq]!, w.fh[hq]!, 0);
    if (c < 0) continue;
    ps.heroRevives[p] = ps.heroRevives[p]! + 1;
    const at = cellCenterOf(ctx.map, c);
    if (createHero(ctx, p, at.x, at.y) >= 0) refreshPlayer(ctx, p);
  }
}

/** Voor systeem 4 en 5: promille op speed en damage van units binnen actieve zones. */
export function auraSystem(ctx: SimContext, auras: Auras): void {
  const ps = ctx.ps;
  const w = ctx.world;
  auras.any = false;
  for (let k = 0; k < ctx.playerCount * MAX_ABILITIES; k++) if (ps.zoneTicks[k]! > 0) auras.any = true;
  if (!auras.any) return;
  auras.speed.fill(0, 0, w.highWater);
  auras.damage.fill(0, 0, w.highWater);
  for (let p = 0; p < ctx.playerCount; p++) {
    const h = heroOf(ctx, p);
    if (h === undefined) continue;
    for (let a = 0; a < h.abilities.length; a++) {
      const k = p * MAX_ABILITIES + a;
      if (ps.zoneTicks[k]! <= 0) continue;
      const ab = h.abilities[a]!;
      const zx = ps.zoneX[k]!;
      const zy = ps.zoneY[k]!;
      const r = ab.radiusU;
      for (let i = 0; i < w.highWater; i++) {
        if (!w.has(i, C.unit | C.health)) continue;
        const o = w.owner[i]!;
        if (o >= ctx.playerCount) continue;
        const dx = w.x[i]! - zx;
        const dy = w.y[i]! - zy;
        if (dx > r || -dx > r || dy > r || -dy > r || dx * dx + dy * dy > r * r) continue;
        for (const e of ab.effects) {
          if (e.target === AURA_TARGET_TURRETS) continue; // units zijn geen turrets; turrets schieten nog niet in de sim
          if ((e.side === AURA_SIDE_ENEMY) === (o === p)) continue;
          if (e.stat === STAT_SPEED) auras.speed[i] = auras.speed[i]! + e.delta;
          else if (e.stat === STAT_DAMAGE) auras.damage[i] = auras.damage[i]! + e.delta;
        }
      }
    }
  }
}

/** PickPerk: heroId is de held-id uit de data (HeroStatus.heroId). */
export function applyPickPerk(ctx: SimContext, p: number, pl: CommandPayload<'PickPerk'>): boolean {
  const ps = ctx.ps;
  const h = heroOf(ctx, p);
  if (h === undefined || pl.heroId !== h.heroId || !isInt(pl.perkId)) return false;
  const st = ps.heroState[p]!;
  if (st === HERO_NONE || st === HERO_EMPTY || ps.heroPending[p]! <= 0) return false;
  const perk = ctx.config.perks[pl.perkId];
  if (perk === undefined || !h.perkPool.includes(perk.perkId) || ((ps.heroPerks[p]! >>> perk.perkId) & 1) !== 0) return false;
  if (heroSpecial(ctx, p, perk.requiresStat) < perk.requiresMin) return false;
  ps.heroPerks[p] = (ps.heroPerks[p]! | (1 << perk.perkId)) >>> 0;
  ps.heroPending[p] = ps.heroPending[p]! - 1;
  refreshPlayer(ctx, p);
  return true;
}

/** HeroAbility: abilityId is de index in de abilities van de held; doel is target, anders (x, y), anders de held zelf. */
export function applyHeroAbility(ctx: SimContext, p: number, pl: CommandPayload<'HeroAbility'>): boolean {
  const ps = ctx.ps;
  const w = ctx.world;
  const h = heroOf(ctx, p);
  const i = heroIndex(ctx, p);
  if (h === undefined || i < 0 || pl.heroId !== h.heroId || !isInt(pl.abilityId)) return false;
  const ab = h.abilities[pl.abilityId];
  const k = p * MAX_ABILITIES + pl.abilityId;
  if (ab === undefined || ps.abCooldown[k]! > 0) return false;
  let x = w.x[i]!;
  let y = w.y[i]!;
  if (ab.rangeU > 0) {
    if (pl.target !== undefined) {
      const t = w.resolve(pl.target);
      if (t < 0) return false;
      x = w.x[t]!;
      y = w.y[t]!;
    } else if (pl.x !== undefined && pl.y !== undefined) {
      if (!inMap(ctx.map, pl.x, pl.y)) return false;
      x = pl.x;
      y = pl.y;
    }
    const dx = x - w.x[i]!;
    const dy = y - w.y[i]!;
    if (dx * dx + dy * dy > ab.rangeU * ab.rangeU) return false;
  }
  ps.zoneX[k] = x;
  ps.zoneY[k] = y;
  ps.zoneTicks[k] = ab.durationTicks;
  ps.abCooldown[k] = ab.cooldownTicks;
  ctx.events.push(EVENT_TYPE.abilityZone, w.idOf(i), pl.abilityId, x, y); // besluit sprint 3 (architect): de renderer toont de zone
  return true;
}

/**
 * Recruit (buildingId = id van het eigen voltooide hoofdgebouw): de gesneuvelde held oplappen voor reviveScrap; na
 * reviveTicks staat hij naast het hoofdgebouw (heroSystem). De data kent geen andere rekrutering.
 */
export function applyRecruit(ctx: SimContext, p: number, pl: CommandPayload<'Recruit'>): boolean {
  const ps = ctx.ps;
  const w = ctx.world;
  const b = isInt(pl.buildingId) ? w.resolve(pl.buildingId) : -1;
  if (b < 0 || !w.has(b, C.building) || w.owner[b] !== p || w.bstate[b] !== BSTATE_DONE) return false;
  const bt = ctx.buildingType(w.typeId[b]!);
  const h = heroOf(ctx, p);
  if (bt === undefined || (bt.provides & PROVIDES_HQ) === 0 || h === undefined) return false;
  if (ps.heroState[p] !== HERO_DEAD || ps.scrap[p]! < h.reviveScrap) return false;
  ps.scrap[p] = ps.scrap[p]! - h.reviveScrap;
  ps.heroState[p] = HERO_REVIVING;
  ps.heroTimer[p] = h.reviveTicks;
  return true;
}

/** Cancel op het hoofdgebouw tijdens het oplappen: terug naar dood, teruggave volgens refund. */
export function cancelRevive(ctx: SimContext, p: number, b: number, refund: (cost: number) => number): boolean {
  const ps = ctx.ps;
  const bt = ctx.buildingType(ctx.world.typeId[b]!);
  const h = heroOf(ctx, p);
  if (bt === undefined || (bt.provides & PROVIDES_HQ) === 0 || h === undefined || ps.heroState[p] !== HERO_REVIVING) return false;
  ps.scrap[p] = ps.scrap[p]! + refund(h.reviveScrap);
  ps.heroState[p] = HERO_DEAD;
  ps.heroTimer[p] = 0;
  return true;
}

/** HeroStatus voor PlayerStatus.hero (contract 1), of null zonder held. */
export function heroStatus(ctx: SimContext, p: number): HeroStatus | null {
  const ps = ctx.ps;
  const h = heroOf(ctx, p);
  if (h === undefined || ps.heroState[p] === HERO_NONE) return null;
  const level = ps.heroLevel[p]!;
  const xp = ps.heroXp[p]!;
  const special: number[] = [];
  for (let k = 0; k < SPECIAL_COUNT; k++) special.push(heroSpecial(ctx, p, k));
  const perks: number[] = [];
  for (const pk of ctx.config.perks) if (((ps.heroPerks[p]! >>> pk.perkId) & 1) !== 0) perks.push(pk.perkId);
  // Op maxlevel is er geen volgende drempel: xpNext is dan de laatste drempel (die al gehaald is).
  const xpNext = level - 1 < h.xpThresholds.length ? h.xpThresholds[level - 1]! : (h.xpThresholds[h.xpThresholds.length - 1] ?? xp);
  return {
    heroId: h.heroId,
    level,
    xp,
    xpNext,
    special: special as HeroStatus['special'],
    perks,
    pendingPerks: ps.heroPending[p]!,
    revivesLeft: ps.heroState[p] === HERO_EMPTY ? 0 : h.maxRevives - ps.heroRevives[p]!,
  };
}
