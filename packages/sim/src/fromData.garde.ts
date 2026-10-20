// The Garde, round A (data 0.38.0, sim 0.32.0; proposal for the architect, docs/garde.md items 1, 2 and 7): the
// GameData-to-SimConfig adapters of veteran promotion, fusion cores and the raid plan with optional harass, slave
// raids and free workers.
import { type FactionData, type AiScriptData, unitTypeId, buildingTypeId } from '@crawlout/data';
import type { SimFusionCores, SimRaidPlan, SimVeterancy } from './config.js';

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
