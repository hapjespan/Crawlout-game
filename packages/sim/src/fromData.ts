import { EffectStat, PROVIDES, ROLES, buildingTypeId, heroTypeId, secondsToTicks, unitTypeId } from '@crawlout/data';
import type { AbilityEffectData, EffectData, GameData, LoadoutData } from '@crawlout/data';
import type { SimAuraEffect, SimConfig, SimEffect, SimFaction, SimHero, SimMap, SimPlayer } from './config.js';
import {
  AURA_SIDE_ALLY,
  AURA_SIDE_ENEMY,
  AURA_TARGET_ALL,
  AURA_TARGET_TURRETS,
  AURA_TARGET_UNITS,
  EFFECT_TARGET_ALL,
  EFFECT_TARGET_HERO,
  EFFECT_TARGET_TYPE,
} from './config.js';

/** Volgorde van de effect-stats (EffectStat in packages/data); de index gaat de sim in (SimEffect.stat). */
export const EFFECT_STATS = EffectStat.options;
export type EffectStatName = (typeof EFFECT_STATS)[number];
export const statIndex = (name: EffectStatName): number => EFFECT_STATS.indexOf(name);

/** Vrije doelen in effects[].target (contract 3); anders is het doel een loadout- of gebouw-id. */
export const TARGET_ALL = 'alle';
export const TARGET_HERO = 'held';

/** Stats die een ability-zone kan zetten (de sim past ze per tick toe op units in de straal). */
const AURA_STATS: readonly EffectStatName[] = ['speedPct', 'damagePct'];

function simAuraEffect(e: AbilityEffectData, where: string): SimAuraEffect {
  if (!AURA_STATS.includes(e.stat)) throw new Error(`${where}: ability-effect '${e.stat}' kan de sim (nog) niet toepassen; alleen ${AURA_STATS.join(', ')}`);
  const target = e.target === 'units' ? AURA_TARGET_UNITS : e.target === 'turrets' ? AURA_TARGET_TURRETS : AURA_TARGET_ALL;
  return { stat: statIndex(e.stat), side: e.side === 'enemy' ? AURA_SIDE_ENEMY : AURA_SIDE_ALLY, target, delta: e.delta };
}

/** Effect uit GameData naar SimEffect: het doel wordt alles, de held, of één unit- of gebouwtype. Gooit bij een onbekend doel. */
function simEffect(data: GameData, e: EffectData, where: string): SimEffect {
  const stat = statIndex(e.stat);
  if (e.target === TARGET_ALL) return { stat, target: EFFECT_TARGET_ALL, typeId: 0, delta: e.delta };
  if (e.target === TARGET_HERO) return { stat, target: EFFECT_TARGET_HERO, typeId: 0, delta: e.delta };
  const l = data.loadouts.find((x) => x.key === e.target);
  if (l !== undefined) return { stat, target: EFFECT_TARGET_TYPE, typeId: unitTypeId(l.id), delta: e.delta };
  const b = data.buildings.find((x) => x.key === e.target);
  if (b !== undefined) return { stat, target: EFFECT_TARGET_TYPE, typeId: buildingTypeId(b.id), delta: e.delta };
  throw new Error(`${where}: onbekend effect-doel '${e.target}'`);
}

// De enige adapter van de data-loader (GameData, al in sim-eenheden) en de map-loader (MapGrid) naar de grens van de sim.
// Client en replay gebruiken allebei deze functies, zodat er één afspraak is over typeIds, rollen en startopstelling.

/** Volgorde van MapDef.claimPoints[].kind; de index gaat de sim in. */
export const CLAIM_KINDS = ['scrap', 'settlement', 'powerArmor'] as const;
export type ClaimKind = (typeof CLAIM_KINDS)[number];

const providesBit = (name: (typeof PROVIDES)[number]): number => 1 << PROVIDES.indexOf(name);
/** Bits in SimBuildingType.provides. */
export const PROVIDES_HQ = providesBit('hq');
export const PROVIDES_WORKSHOP = providesBit('werkplaats');
export const PROVIDES_CLAIM = providesBit('claim');

const ROLE_SCAVENGER = ROLES.indexOf('scavenger');

/** Het loadout waar SetRole naartoe omschoolt: binnen de factie, zonder prereqTech, goedkoopste, dan laagste id. */
function defaultLoadoutForRole(data: GameData, factionId: number, role: number): LoadoutData | undefined {
  let best: LoadoutData | undefined;
  for (const l of data.loadouts) {
    if (l.factionId !== factionId || l.role !== role || l.prereqTech.length > 0) continue;
    if (best === undefined || l.scrapCost < best.scrapCost) best = l;
  }
  return best;
}

/** GameData naar SimConfig. Gooit als een factie geen hoofdgebouw (provides hq) heeft. */
export function simConfigFromGameData(data: GameData): SimConfig {
  const t = data.sim;
  const factions: SimFaction[] = data.factions.map((f) => {
    let hq: number | undefined;
    for (const b of data.buildings) {
      if (hq === undefined && b.factionId === f.id && b.provides.includes(PROVIDES.indexOf('hq'))) hq = b.id;
    }
    if (hq === undefined) throw new Error(`factie ${f.key}: geen gebouw met provides hq`);
    const roleTypeIds = ROLES.map((_, role) => {
      const l = defaultLoadoutForRole(data, f.id, role);
      return l === undefined ? 0 : unitTypeId(l.id);
    });
    const aiScript = data.aiScripts.findIndex((a) => a.factionId === f.id);
    // Claim-commando (besluit sprint 2): het goedkoopste gebouw met provides claim dat geen hoofdgebouw is, dan laagste id.
    let claim: (typeof data.buildings)[number] | undefined;
    for (const b of data.buildings) {
      if (b.factionId !== f.id || !b.provides.includes(PROVIDES.indexOf('claim')) || b.provides.includes(PROVIDES.indexOf('hq'))) continue;
      if (claim === undefined || b.scrapCost < claim.scrapCost) claim = b;
    }
    return {
      factionId: f.id,
      startUnits: f.startUnits.map((u) => ({ typeId: unitTypeId(u.loadoutId), count: u.count })),
      startScrap: f.startScrap,
      housingGrowthPerMin: f.housingGrowthPerMin,
      hqTypeId: buildingTypeId(hq),
      settlerTypeId: roleTypeIds[ROLE_SCAVENGER] ?? 0,
      roleTypeIds,
      aiScript,
      claimTypeId: claim === undefined ? 0 : buildingTypeId(claim.id),
      // De eerste held van de factie (laagste id): de lobby kent nog geen heldkeuze.
      heroId: data.heroes.findIndex((h) => h.factionId === f.id),
    };
  });
  const heroes: SimHero[] = data.heroes.map((h) => {
    const base = factions[h.factionId]!.roleTypeIds[ROLES.indexOf('militia')] ?? 0;
    if (base === 0) throw new Error(`held ${h.key}: factie heeft geen militie-loadout als basis`);
    return {
      heroId: h.id,
      typeId: heroTypeId(h.id),
      factionId: h.factionId,
      baseTypeId: base,
      special: [...h.special],
      xpThresholds: [...h.xpThresholds],
      xpPerKill: h.xpPerKill,
      xpPerDiscovery: h.xpPerDiscovery,
      abilities: h.abilities.map((a) => ({
        cooldownTicks: a.cooldownTicks,
        rangeU: a.rangeU,
        radiusU: a.radiusU,
        durationTicks: a.durationTicks,
        effects: a.effects.map((e) => simAuraEffect(e, `held ${h.key} ability ${a.id}`)),
      })),
      perkPool: [...h.perkPool],
      reviveScrap: h.reviveScrap,
      reviveTicks: h.reviveTicks,
      revivePenaltyPermille: h.revivePenaltyPermille,
      maxRevives: h.maxRevives,
    };
  });
  return {
    dataVersion: data.dataVersion,
    unitTypes: data.loadouts.map((l) => ({
      typeId: unitTypeId(l.id),
      loadoutId: l.id,
      factionId: l.factionId,
      bodyType: l.bodyType,
      role: l.role,
      armorType: l.armorType,
      maxHp: l.hpI,
      speed: l.speedUPT,
      radius: t.unitRadiusU,
      damage: l.damage,
      damageType: l.damageType,
      range: l.rangeU,
      cooldown: l.cooldownTicks,
      gatherAmount: l.gatherAmount,
      gatherTicks: l.gatherTicks,
      scrapCost: l.scrapCost,
      craftTicks: l.craftTicks,
      popCost: l.popCost,
      prereqTech: [...l.prereqTech],
    })),
    buildingTypes: data.buildings.map((b) => ({
      typeId: buildingTypeId(b.id),
      buildingId: b.id,
      factionId: b.factionId,
      maxHp: b.hpI,
      armorType: b.armorType,
      scrapCost: b.scrapCost,
      buildTicks: b.buildTicks,
      footprintW: b.footprint.w,
      footprintH: b.footprint.h,
      beds: b.beds,
      provides: b.provides.reduce((m, p) => m | (1 << p), 0),
      prereqTech: [...b.prereqTech],
      damage: b.damage,
      damageType: b.damageType,
      range: b.rangeU,
      cooldown: b.cooldownTicks,
    })),
    factions,
    aiScripts: data.aiScripts.map((a) => ({
      buildOrder: a.buildOrder.map((o) => ({ atTick: o.atTick, typeId: buildingTypeId(o.buildingId) })),
      attackTimersTicks: [...a.attackTimersTicks],
      militiaPermille: a.militiaPermille,
    })),
    techs: data.tech.map((t) => ({
      techId: t.id,
      factionId: t.factionId,
      scrapCost: t.scrapCost,
      researchTicks: t.researchTicks,
      buildingTypeId: buildingTypeId(t.buildingId),
      prereqTech: [...t.prereqTech],
      effects: t.effects.map((e) => simEffect(data, e, `tech ${t.key}`)),
    })),
    heroes,
    perks: data.perks.map((pk) => ({
      perkId: pk.id,
      requiresStat: pk.requires.stat,
      requiresMin: pk.requires.min,
      effects: pk.effects.map((e) => simEffect(data, e, `perk ${pk.key}`)),
    })),
    special: {
      strengthDamagePermille: t.specialStrengthDamagePermille,
      perceptionRangeU: t.specialPerceptionRangeU,
      enduranceHpPermille: t.specialEnduranceHpPermille,
      charismaGrowthPermille: t.specialCharismaGrowthPermille,
      intelligenceResearchPermille: t.specialIntelligenceResearchPermille,
      agilitySpeedPermille: t.specialAgilitySpeedPermille,
      luckCritPermille: t.specialLuckCritPermille,
      critDamagePermille: t.critDamagePermille,
    },
    damageMatrix: data.damageMatrix.map((row) => [...row]),
    ticksPerMinute: secondsToTicks(60),
    arriveRadius: t.arriveRadiusU,
    separationPermille: t.separationPermille,
    flowFieldBudget: t.flowFieldBudget,
    walkAnimStep: t.walkAnimStep,
    aggroRange: t.aggroRangeU,
    interactRange: t.interactRangeU,
    claimRadius: t.claimRadiusU,
    popCapMax: t.popCapMax,
    corpseTicks: t.corpseTicks,
    cancelRefundPermille: t.cancelRefundPermille,
  };
}

/** Wat simMapFromGrid nodig heeft: MapGrid uit packages/map (structureel) plus de dominantie in ticks (convertDominance). */
export interface SimMapSource {
  readonly w: number;
  readonly h: number;
  readonly passable: Uint8Array;
  readonly spawns: readonly { readonly ux: number; readonly uy: number }[];
  readonly scrapNodes: readonly { readonly ux: number; readonly uy: number; readonly amount: number }[];
  readonly claimPoints: readonly { readonly ux: number; readonly uy: number; readonly kind: string }[];
  readonly dominance: { readonly pointsRequired: number; readonly ticks: number };
}

/** MapGrid (plus dominantie in ticks) naar SimMap. */
export function simMapFromGrid(grid: SimMapSource): SimMap {
  return {
    w: grid.w,
    h: grid.h,
    passable: grid.passable,
    spawns: grid.spawns.map((s) => ({ x: s.ux, y: s.uy })),
    scrapNodes: grid.scrapNodes.map((n) => ({ x: n.ux, y: n.uy, amount: n.amount })),
    claimPoints: grid.claimPoints.map((c) => {
      const kind = CLAIM_KINDS.indexOf(c.kind as ClaimKind);
      if (kind < 0) throw new Error(`onbekend claimpunt-soort ${c.kind}`);
      return { x: c.ux, y: c.uy, kind };
    }),
    dominance: { pointsRequired: grid.dominance.pointsRequired, ticks: grid.dominance.ticks },
  };
}

/**
 * Spelers uit het start-bericht (LobbyPlayer[]) naar SimPlayer[], in playerId-volgorde. playerId moet 0..n-1 zijn:
 * spawns[i] hoort bij playerId i. Gooit bij een onbekende factie of een gat in de playerIds.
 */
export function simPlayersFromLobby(data: GameData, players: readonly { playerId: number; faction: string; ai: boolean }[]): SimPlayer[] {
  const sorted = [...players].sort((a, b) => a.playerId - b.playerId);
  return sorted.map((p, i) => {
    if (p.playerId !== i) throw new Error(`playerIds moeten 0..${players.length - 1} zijn, kreeg ${p.playerId} op plek ${i}`);
    const f = data.factions.find((x) => x.key === p.faction);
    if (f === undefined) throw new Error(`speler ${p.playerId}: onbekende factie ${p.faction}`);
    return { factionId: f.id, ai: p.ai };
  });
}
