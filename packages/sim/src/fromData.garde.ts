// The Garde, round A (data 0.38.0, sim 0.32.0; proposal for the architect, docs/garde.md items 1, 2 and 7): the
// GameData-to-SimConfig adapters of veteran promotion, fusion cores and the raid plan with optional harass, slave
// raids and free workers.
import {
  type FactionData,
  type AiScriptData,
  type LoadoutData,
  unitTypeId,
  buildingTypeId,
} from '@crawlout/data';
import type {
  SimFusionCores,
  SimMapPowerArmor,
  SimRaidPlan,
  SimUnitType,
  SimVeterancy,
} from './config.js';

/** Round B (data 0.39.0, sim 0.33.0; proposal): the power armour of the map. */
export function simMapPowerArmor(f: FactionData): SimMapPowerArmor | null {
  const m = f.mapPowerArmor;
  if (m === null) return null;
  return {
    typeId: unitTypeId(m.loadoutId),
    respawnTicks: m.respawnTicks,
    otherQualityPermille: m.otherQualityPermille,
  };
}

/** Round B (data 0.39.0, sim 0.33.0; proposal): overload, transport and flying of a loadout. */
export function simGardeUnit(
  l: LoadoutData,
): Pick<SimUnitType, 'overload' | 'transport' | 'flying'> {
  return {
    overload:
      l.overload === null
        ? null
        : {
            typeIds: l.overload.targets.map(unitTypeId),
            stunTicks: l.overload.stunTicks,
            cooldownTicks: l.overload.cooldownTicks,
          },
    transport:
      l.transport === null
        ? null
        : { capacity: l.transport.capacity, loadRange: l.transport.loadRangeU },
    flying: l.flying,
  };
}

export function simVeterancy(f: FactionData): SimVeterancy | null {
  const v = f.veterancy;
  if (v === null) return null;
  return {
    typeIds: v.loadouts.map(unitTypeId),
    ranks: v.ranks.map((r) => ({
      kills: r.kills,
      hpPermille: r.hpPermille,
      damagePermille: r.damagePermille,
    })),
  };
}

export function simFusionCores(f: FactionData): SimFusionCores | null {
  const c = f.fusionCores;
  if (c === null) return null;
  return {
    buildingTypeId: buildingTypeId(c.buildingId),
    scrapCost: c.scrapCost,
    craftTicks: c.craftTicks,
    maxStock: c.maxStock,
    prereqTech: [...c.prereqTech],
  };
}

export function simRaidPlan(rp: AiScriptData['raidPlan']): SimRaidPlan | null {
  if (rp === null) return null;
  return {
    fighterMix: rp.fighterMix.map((m) => ({ typeId: unitTypeId(m.loadoutId), weight: m.weight })),
    harass:
      rp.harass === null
        ? null
        : {
            typeId: unitTypeId(rp.harass.loadoutId),
            fromTicks: rp.harass.fromTicks,
            max: rp.harass.max,
            retreatHpPermille: rp.harass.retreatHpPermille,
          },
    slaveRaids:
      rp.slaveRaids === null
        ? null
        : {
            slaverTypeId: unitTypeId(rp.slaveRaids.slaverLoadoutId),
            fromTicks: rp.slaveRaids.fromTicks,
            slavers: rp.slaveRaids.slavers,
            escort: rp.slaveRaids.escort,
            maxRaidTicks: rp.slaveRaids.maxRaidTicks,
            retryTicks: rp.slaveRaids.retryTicks,
          },
    garrisonMinFighters: rp.garrison.minFighters,
    dominancePush: { ...rp.dominancePush },
    workers: rp.workers === null ? null : { scavengers: rp.workers.scavengers },
    mixInOrder: rp.mixInOrder,
  };
}
