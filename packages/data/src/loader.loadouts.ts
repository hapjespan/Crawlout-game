import {
  ARMOR_TYPES,
  BODY_TYPES,
  CAPTURE_TARGETS,
  DAMAGE_TYPES,
  REPAIR_TARGETS,
  ROLES,
  type LoadoutData,
  type RawGameData,
} from './loader.types.js';
import { NEUTRAL_FACTION_ID, type CreepsData } from './loader.types.game.js';
import { Creeps, type CreepUnit, type SimTuning } from './schemas.js';
import {
  metersToUnits,
  mpsToUnitsPerTick,
  pctToPermille,
  perSecondToMilliPerTick,
  secondsToTicks,
} from './units.js';
import type { LoadContext } from './loader.parse.js';
import { idx, parseWith, ref } from './loader.util.js';

// Part of the pure loader (see loader.ts): no IO, no clock; falls under the determinism lint.

/** Stage 3: the faction loadouts in id order. */
export function convertLoadouts(ctx: LoadContext): LoadoutData[] {
  const { factionsRaw, loadoutsRaw, factionIx, techIx, buildingIx, simRaw } = ctx;
  const chemKeysOfFaction = (factionKey: string): string[] =>
    (factionsRaw.find((f) => f.id === factionKey)?.chems ?? []).map((c) => c.id);

  const loadouts: LoadoutData[] = loadoutsRaw.map((l, id) => {
    const where = `data/loadouts.json '${l.id}'`;
    return {
      id,
      key: l.id,
      factionId: ref(factionIx, 'factie', where, l.faction),
      bodyType: idx(BODY_TYPES, l.bodyType),
      role: idx(ROLES, l.role),
      weapon: l.weapon,
      armorType: idx(ARMOR_TYPES, l.armorType),
      damageType: idx(DAMAGE_TYPES, l.damageType),
      hpI: Math.trunc(l.hp),
      damage: Math.trunc(l.damage),
      rangeU: metersToUnits(l.rangeM),
      speedUPT: mpsToUnitsPerTick(l.speedMps),
      cooldownTicks: secondsToTicks(l.cooldownS),
      scrapCost: Math.trunc(l.scrapCost),
      craftTicks: secondsToTicks(l.craftS),
      gatherAmount: l.gatherAmount,
      gatherTicks: secondsToTicks(l.gatherS),
      popCost: l.popCost,
      prereqTech: l.prereqTech.map((t) => ref(techIx, 'tech', where, t)),
      visuals: { meshSlots: { ...l.visuals.meshSlots } },
      producedAt:
        l.producedAt === undefined
          ? -1
          : ref(buildingIx, 'gebouw', `${where} producedAt`, l.producedAt),
      repair:
        l.repair === undefined
          ? null
          : {
              milliHpPerTick: perSecondToMilliPerTick(l.repair.repairRateHpPerS),
              rangeU: metersToUnits(l.repair.rangeM),
              seekRangeU: metersToUnits(l.repair.seekRangeM),
              targets: l.repair.targets.map((t) => idx(REPAIR_TARGETS, t)),
            },
      siege:
        l.siege === undefined
          ? null
          : {
              vsBuildingsPermille: pctToPermille(l.siege.vsBuildingsDamagePct),
              buildingsFirst: l.siege.buildingsFirst,
            },
      slave: l.slave === true,
      capture:
        l.capture === undefined
          ? null
          : {
              rangeU: metersToUnits(l.capture.rangeM),
              captureTicks: secondsToTicks(l.capture.captureS),
              targets: l.capture.targets.map((t) => idx(CAPTURE_TARGETS, t)),
              maxHpPermille: pctToPermille(l.capture.maxHpPct),
            },
      aura:
        l.aura === undefined
          ? null
          : {
              radiusU: metersToUnits(l.aura.radiusM),
              chems: l.aura.chems.map((c) => {
                const found = chemKeysOfFaction(l.faction).indexOf(c);
                if (found < 0) throw new Error(`${where} aura: onbekende chem '${c}'`);
                return found;
              }),
              trigger: l.aura.trigger,
            },
      sightU: metersToUnits(l.sightM ?? simRaw.vision.unitSightM),
      canBuild: l.canBuild === true,
    };
  });
  return loadouts;
}

/** The neutral (factionless, militia, free) loadout of a creep or survival unit; `id` is its numeric loadout id. */
export function neutralLoadout(u: CreepUnit, id: number, simRaw: SimTuning): LoadoutData {
  return {
    id,
    key: u.id,
    factionId: NEUTRAL_FACTION_ID,
    bodyType: idx(BODY_TYPES, u.bodyType),
    role: idx(ROLES, 'militia'),
    weapon: u.weapon,
    armorType: idx(ARMOR_TYPES, u.armorType),
    damageType: idx(DAMAGE_TYPES, u.damageType),
    hpI: Math.trunc(u.hp),
    damage: Math.trunc(u.damage),
    rangeU: metersToUnits(u.rangeM),
    speedUPT: mpsToUnitsPerTick(u.speedMps),
    cooldownTicks: secondsToTicks(u.cooldownS),
    scrapCost: 0,
    craftTicks: 0,
    gatherAmount: 0,
    gatherTicks: 0,
    popCost: 1,
    prereqTech: [],
    visuals: { meshSlots: { ...u.visuals.meshSlots } },
    producedAt: -1,
    repair: null,
    siege: null,
    slave: false,
    capture: null,
    aura: null,
    sightU: metersToUnits(u.sightM ?? simRaw.vision.unitSightM),
    canBuild: false,
  };
}

/** Stage 4: creep camps; appends the bandit loadouts to `loadouts` (after the faction loadouts). */
export function convertCreeps(
  ctx: LoadContext,
  raw: RawGameData,
  loadouts: LoadoutData[],
): CreepsData {
  const { loadoutsRaw, factionIx, loadoutIx, simRaw } = ctx;
  // Creep camps (data 0.25.0): the bandit loadouts follow the faction loadouts (ids loadoutsRaw.length + k, in the
  // order of creeps.json units), so no faction loadout changes id; their faction is NEUTRAL_FACTION_ID.
  const creepsRaw: Creeps =
    raw.creeps === undefined
      ? { units: [], tiers: [] }
      : parseWith('creeps.json', Creeps, raw.creeps);
  const creepIx = new Map<string, number>();
  creepsRaw.units.forEach((u, k) => {
    if (loadoutIx.has(u.id) || creepIx.has(u.id))
      throw new Error(`data/creeps.json: dubbele id '${u.id}'`);
    creepIx.set(u.id, loadoutsRaw.length + k);
  });
  for (const u of creepsRaw.units) loadouts.push(neutralLoadout(u, creepIx.get(u.id)!, simRaw));
  const tierSeen = new Set<number>();
  const creeps: CreepsData = {
    units: creepsRaw.units.map((u) => creepIx.get(u.id)!),
    names: creepsRaw.units.map((u) => u.naam),
    tiers: [...creepsRaw.tiers]
      .sort((a, b) => a.tier - b.tier)
      .map((t) => {
        const where = `data/creeps.json tier ${t.tier}`;
        if (tierSeen.has(t.tier)) throw new Error(`${where}: dubbele tier`);
        tierSeen.add(t.tier);
        return {
          tier: t.tier,
          naam: t.naam,
          units: t.units.flatMap((e) => {
            const id = creepIx.get(e.unitId);
            if (id === undefined) throw new Error(`${where}: onbekende bandiet '${e.unitId}'`);
            return Array.from({ length: e.count }, () => id);
          }),
          aggroRadiusU: metersToUnits(t.aggroRadiusM),
          leashRadiusU: metersToUnits(t.leashRadiusM),
          respawnTicks: secondsToTicks(t.respawnS),
          lootScrap: t.lootScrap,
          heroXp: t.heroXp,
          heroXpRadiusU: metersToUnits(t.heroXpRadiusM),
        };
      }),
    takeover: (creepsRaw.takeover ?? [])
      .map((r) => {
        const where = `data/creeps.json takeover '${r.faction}'`;
        const factionId = ref(factionIx, 'factie', where, r.faction);
        const seen = new Set<number>();
        return {
          factionId,
          tiers: [...r.tiers]
            .sort((a, b) => a.tier - b.tier)
            .map((t) => {
              if (!tierSeen.has(t.tier)) throw new Error(`${where}: onbekende tier ${t.tier}`);
              if (seen.has(t.tier)) throw new Error(`${where}: dubbele tier ${t.tier}`);
              seen.add(t.tier);
              return {
                tier: t.tier,
                surrenderPermille: pctToPermille(t.surrenderHpPct),
                minUnits: t.minUnits,
                yieldTicks: secondsToTicks(t.yieldS),
                yieldMax: t.yieldMax,
              };
            }),
        };
      })
      .sort((a, b) => a.factionId - b.factionId),
  };
  for (let k = 1; k < creeps.takeover.length; k++)
    if (creeps.takeover[k]!.factionId === creeps.takeover[k - 1]!.factionId)
      throw new Error('data/creeps.json takeover: dubbele factie');
  return creeps;
}
