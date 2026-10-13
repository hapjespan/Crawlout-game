import { PROVIDES, ROLES, buildingTypeId, secondsToTicks, unitTypeId } from '@crawlout/data';
import type { GameData, LoadoutData } from '@crawlout/data';
import type { SimConfig, SimFaction, SimMap, SimPlayer } from './config.js';

// De enige adapter van de data-loader (GameData, al in sim-eenheden) en de map-loader (MapGrid) naar de grens van de sim.
// Client en replay gebruiken allebei deze functies, zodat er één afspraak is over typeIds, rollen en startopstelling.

/** Volgorde van MapDef.claimPoints[].kind; de index gaat de sim in. */
export const CLAIM_KINDS = ['scrap', 'settlement', 'powerArmor'] as const;
export type ClaimKind = (typeof CLAIM_KINDS)[number];

const providesBit = (name: (typeof PROVIDES)[number]): number => 1 << PROVIDES.indexOf(name);
/** Bits in SimBuildingType.provides. */
export const PROVIDES_HQ = providesBit('hq');
export const PROVIDES_WORKSHOP = providesBit('werkplaats');

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
    return {
      factionId: f.id,
      startUnits: f.startUnits.map((u) => ({ typeId: unitTypeId(u.loadoutId), count: u.count })),
      startScrap: f.startScrap,
      housingGrowthPerMin: f.housingGrowthPerMin,
      hqTypeId: buildingTypeId(hq),
      settlerTypeId: roleTypeIds[ROLE_SCAVENGER] ?? 0,
      roleTypeIds,
      aiScript,
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
    })),
    factions,
    aiScripts: data.aiScripts.map((a) => ({
      buildOrder: a.buildOrder.map((o) => ({ atTick: o.atTick, typeId: buildingTypeId(o.buildingId) })),
      attackTimersTicks: [...a.attackTimersTicks],
      militiaPermille: a.militiaPermille,
    })),
    damageMatrix: data.damageMatrix.map((row) => [...row]),
    ticksPerMinute: secondsToTicks(60),
    arriveRadius: t.arriveRadiusU,
    separationPermille: t.separationPermille,
    flowFieldBudget: t.flowFieldBudget,
    walkAnimStep: t.walkAnimStep,
    aggroRange: t.aggroRangeU,
    interactRange: t.interactRangeU,
    claimRadius: t.claimRadiusU,
    claimTicks: t.claimTicks,
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
