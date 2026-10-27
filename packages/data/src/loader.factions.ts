import { BODY_TYPES, ROLES, type FactionData } from './loader.types.js';
import { metersToUnits, pctToPermille, secondsToTicks } from './units.js';
import type { LoadContext } from './loader.parse.js';
import { convertEffects, idx, ref } from './loader.util.js';

// Part of the pure loader (see loader.ts): no IO, no clock; falls under the determinism lint.

/** Stage 2: factions with their safety net, robot rules and the Raider blocks (slaves, plunder, tribute, chems). */
export function convertFactions(ctx: LoadContext): FactionData[] {
  const { factionsRaw, loadoutIx, buildingIx, techIx } = ctx;
  const factions: FactionData[] = factionsRaw.map((f, id) => {
    const where = `data/factions.json '${f.id}'`;
    return {
      id,
      key: f.id,
      naam: f.naam,
      bodyTypes: f.bodyTypes.map((b) => idx(BODY_TYPES, b)),
      startUnits: f.startUnits.map((u) => ({
        loadoutId: ref(loadoutIx, 'loadout', where, u.loadoutId),
        count: u.count,
      })),
      startScrap: Math.trunc(f.startScrap),
      housingGrowthPerMin: Math.trunc(f.housingGrowthPerMin),
      safetyNet: {
        threshold: f.safetyNet.threshold,
        action: f.safetyNet.action,
        intervalTicks: secondsToTicks(f.safetyNet.intervalS ?? 0),
        maxArrivals: f.safetyNet.maxArrivals ?? 0,
        loadoutId:
          f.safetyNet.loadoutId === undefined
            ? -1
            : ref(loadoutIx, 'loadout', `${where} safetyNet`, f.safetyNet.loadoutId),
      },
      robotRules:
        f.robotRules === undefined
          ? null
          : {
              robotsPerTechnician: f.robotRules.robotsPerTechnician,
              technicianRoles: f.robotRules.technicianRoles.map((r) => idx(ROLES, r)),
              robotPenaltyPermille: pctToPermille(f.robotRules.robotPenaltyPct),
            },
      uniqueUnits: f.uniqueUnits.map((u) => ref(loadoutIx, 'loadout', where, u)),
      uniqueBuildings: f.uniqueBuildings.map((b) => ref(buildingIx, 'gebouw', where, b)),
      specialChannel: f.specialChannel,
      slaves:
        f.slaves === undefined
          ? null
          : {
              capturedLoadoutId: ref(
                loadoutIx,
                'loadout',
                `${where} slaves`,
                f.slaves.capturedLoadoutId,
              ),
              minDistanceFromOwnerBaseU: metersToUnits(f.slaves.minDistanceFromOwnerBaseM),
              liberation: {
                touchTicks: secondsToTicks(f.slaves.liberation.touchS),
                touchRangeU: metersToUnits(f.slaves.liberation.touchRangeM),
                guardRadiusU: metersToUnits(f.slaves.liberation.guardRadiusM),
                freedSpeedPermille: pctToPermille(f.slaves.liberation.freedSpeedPct),
              },
              revolt: {
                cageNearU: metersToUnits(f.slaves.revolt.cageNearM),
                guardRadiusU: metersToUnits(f.slaves.revolt.guardRadiusM),
                cageGuards: f.slaves.revolt.cageGuards,
                guardModeSlavesPerGuard: f.slaves.revolt.guardModeSlavesPerGuard,
                noCageGuards: f.slaves.revolt.noCageGuards,
                noCageSlaves: f.slaves.revolt.noCageSlaves,
                escapeU: metersToUnits(f.slaves.revolt.escapeM),
                graceTicks: secondsToTicks(f.slaves.revolt.graceS),
                emptyGraceTicks: secondsToTicks(f.slaves.revolt.emptyGraceS),
                escapePermille: pctToPermille(f.slaves.revolt.escapePct),
                repeatTicks: secondsToTicks(f.slaves.revolt.repeatS),
              },
            },
      plunder:
        f.plunder === undefined
          ? null
          : {
              buildingLootPermille: pctToPermille(f.plunder.buildingLootPct),
              depotLootMultiplierPermille: pctToPermille(f.plunder.depotLootMultiplierPct),
              carryLootPermille: pctToPermille(f.plunder.carryLootPct),
              bonusTech:
                f.plunder.bonusTech === undefined
                  ? -1
                  : ref(techIx, 'tech', `${where} plunder`, f.plunder.bonusTech),
              bonusPermille: pctToPermille(f.plunder.bonusPct ?? 0),
            },
      tribute:
        f.tribute === undefined
          ? null
          : {
              claimKind: f.tribute.claimKind,
              scrapPerMin: Math.trunc(f.tribute.scrapPerMin),
              bonusTech:
                f.tribute.bonusTech === undefined
                  ? -1
                  : ref(techIx, 'tech', `${where} tribute`, f.tribute.bonusTech),
              bonusPermille: pctToPermille(f.tribute.bonusPct ?? 0),
            },
      chems: (f.chems ?? []).map((c, id) => {
        const chemWhere = `${where} chem '${c.id}'`;
        return {
          id,
          key: c.id,
          naam: c.naam,
          flavourText: c.flavourText,
          requiresTech: ref(techIx, 'tech', chemWhere, c.requiresTech),
          doseScrap: Math.trunc(c.doseScrap),
          activeTicks: secondsToTicks(c.activeS),
          crashTicks: secondsToTicks(c.crashS),
          cooldownTicks: secondsToTicks(c.cooldownS),
          effects: convertEffects(c.effects),
          crash: convertEffects(c.crash),
          refined:
            c.refined === undefined
              ? null
              : {
                  requiresTech: ref(techIx, 'tech', `${chemWhere} refined`, c.refined.requiresTech),
                  activePermille: pctToPermille(c.refined.activePct),
                  crashPermille: pctToPermille(c.refined.crashPct),
                },
        };
      }),
      veterancy:
        f.veterancy === undefined
          ? null
          : {
              loadouts: f.veterancy.loadouts.map((l) =>
                ref(loadoutIx, 'loadout', `${where} veterancy`, l),
              ),
              ranks: f.veterancy.ranks.map((r) => ({
                key: r.id,
                kills: r.kills,
                hpPermille: pctToPermille(r.hpPct),
                damagePermille: pctToPermille(r.damagePct),
              })),
            },
      fusionCores:
        f.fusionCores === undefined
          ? null
          : {
              buildingId: ref(buildingIx, 'gebouw', `${where} fusionCores`, f.fusionCores.building),
              scrapCost: Math.trunc(f.fusionCores.scrapCost),
              craftTicks: secondsToTicks(f.fusionCores.craftS),
              maxStock: f.fusionCores.maxStock,
              prereqTech: f.fusionCores.prereqTech.map((t) =>
                ref(techIx, 'tech', `${where} fusionCores`, t),
              ),
            },
      mapPowerArmor:
        f.mapPowerArmor === undefined
          ? null
          : {
              loadoutId: ref(
                loadoutIx,
                'loadout',
                `${where} mapPowerArmor`,
                f.mapPowerArmor.loadout,
              ),
              respawnTicks: secondsToTicks(f.mapPowerArmor.respawnS),
              otherQualityPermille: pctToPermille(f.mapPowerArmor.otherQualityPct),
            },
    };
  });
  return factions;
}
