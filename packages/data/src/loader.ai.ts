import { ARCHETYPES, type LoadoutData } from './loader.types.js';
import { AI_SITES, type AiScriptData } from './loader.types.game.js';
import { metersToUnits, pctToPermille, secondsToTicks } from './units.js';
import type { LoadContext } from './loader.parse.js';
import { ref } from './loader.util.js';

// Part of the pure loader (see loader.ts): no IO, no clock; falls under the determinism lint.

/** Stage 11: AI scripts (needs the converted loadouts for robots.builders); at most one per faction and opponent. */
export function convertAiScripts(ctx: LoadContext, loadouts: LoadoutData[]): AiScriptData[] {
  const { aiRaw, factionIx, loadoutIx, buildingIx, techIx, trainingIx } = ctx;
  // data 0.26.0 (voorstel, ter bevestiging door de architect): robots.builders names a produced loadout with canBuild
  const builderRobotRef = (where: string, key: string, factionId: number): number => {
    const l = loadouts[ref(loadoutIx, 'loadout', where, key)]!;
    if (!l.canBuild || l.producedAt < 0 || l.factionId !== factionId)
      throw new Error(
        `${where}: '${key}' is geen bouwrobot van deze factie (canBuild en producedAt)`,
      );
    return l.id;
  };
  const aiScripts: AiScriptData[] = aiRaw.map((a, id) => {
    const where = `data/ai '${a.id}'`;
    return {
      id,
      key: a.id,
      factionId: ref(factionIx, 'factie', where, a.faction),
      buildOrder: a.buildOrder.map((o) => ({
        atTick: secondsToTicks(o.atS),
        buildingId: ref(buildingIx, 'gebouw', where, o.buildingId),
        site: AI_SITES.indexOf(o.site ?? 'hq'),
      })),
      attackTimersTicks: a.attackTimersS.map((s) => secondsToTicks(s)),
      militiaPermille: pctToPermille(a.militiaPct),
      militiaPermilleMax: pctToPermille(a.militiaPctMax),
      militiaPermillePerMin: pctToPermille(a.militiaPctPerMin),
      threatMilitiaPermille: pctToPermille(a.threatMilitiaPct),
      builders: a.builders,
      housingBuildingId: ref(buildingIx, 'gebouw', where, a.housingBuildingId),
      housingFreeBeds: a.housingFreeBeds,
      research: a.research.map((t) => ref(techIx, 'tech', where, t)),
      researchFromTicks: secondsToTicks(a.researchFromS),
      armyLoadouts: a.armyLoadouts.map((l) => ref(loadoutIx, 'loadout', where, l)),
      richScrap: Math.trunc(a.richScrap),
      richBuilds: a.richBuilds.map((o) => ({
        buildingId: ref(buildingIx, 'gebouw', where, o.buildingId),
        site: AI_SITES.indexOf(o.site),
      })),
      scavengersPerNode: a.scavengersPerNode,
      claimFromTicks: secondsToTicks(a.claimFromS),
      claimSafeRadiusU: metersToUnits(a.claimSafeRadiusM),
      claimFarFromTicks: secondsToTicks(a.claimFarFromS),
      heroClaimRadiusU: metersToUnits(a.heroClaimRadiusM ?? 0),
      defendRadiusU: metersToUnits(a.defendRadiusM),
      rallySite: AI_SITES.indexOf(a.rallySite),
      rallyRadiusU: metersToUnits(a.rallyRadiusM),
      waveIntervalTicks: secondsToTicks(a.waveIntervalS),
      waveJitterTicks: secondsToTicks(a.waveJitterS),
      waveMinArmy: a.waveMinArmy,
      waveArmyGrowth: a.waveArmyGrowth,
      waveMaxWaitTicks: secondsToTicks(a.waveMaxWaitS),
      pushMinArmy: a.pushMinArmy,
      pushFromTicks: secondsToTicks(a.pushFromS),
      robots:
        a.robots === undefined
          ? null
          : {
              sequence: a.robots.sequence.map((l) =>
                ref(loadoutIx, 'loadout', `${where} robots`, l),
              ),
              fromTicks: secondsToTicks(a.robots.fromS),
              max: a.robots.max,
              countAsArmy: a.robots.countAsArmy ?? false,
              reservePop: a.robots.reservePop ?? 0,
              builders:
                a.robots.builders === undefined
                  ? null
                  : {
                      loadout: builderRobotRef(
                        `${where} robots.builders`,
                        a.robots.builders.loadoutId,
                        ref(factionIx, 'factie', where, a.faction),
                      ),
                      max: a.robots.builders.max,
                      fromTicks: secondsToTicks(a.robots.builders.fromS),
                    },
            },
      reserve:
        a.reserve === undefined
          ? null
          : {
              fromTicks: secondsToTicks(a.reserve.fromS),
              minArmy: a.reserve.minArmy,
              robotsFirstFromTicks: secondsToTicks(a.reserve.robotsFirstFromS),
            },
      training:
        a.training === undefined
          ? null
          : {
              sequence: a.training.sequence.map((t) =>
                ref(trainingIx, 'training', `${where} training`, t),
              ),
              fromTicks: secondsToTicks(a.training.fromS),
            },
      raidPlan:
        a.raidPlan === undefined
          ? null
          : {
              fighterMix: a.raidPlan.fighterMix.map((m) => ({
                loadoutId: ref(loadoutIx, 'loadout', `${where} raidPlan fighterMix`, m.loadoutId),
                weight: m.weight,
              })),
              harass: ((hr) =>
                hr === undefined
                  ? null
                  : {
                      loadoutId: ref(
                        loadoutIx,
                        'loadout',
                        `${where} raidPlan harass`,
                        hr.loadoutId,
                      ),
                      fromTicks: secondsToTicks(hr.fromS),
                      max: hr.max,
                      retreatHpPermille: pctToPermille(hr.retreatHpPct),
                      targets: hr.targets,
                    })(a.raidPlan.harass),
              slaveRaids: ((sr) =>
                sr === undefined
                  ? null
                  : {
                      slaverLoadoutId: ref(
                        loadoutIx,
                        'loadout',
                        `${where} raidPlan slaveRaids`,
                        sr.slaverLoadoutId,
                      ),
                      fromTicks: secondsToTicks(sr.fromS),
                      slavers: sr.slavers,
                      escort: sr.escort,
                      maxRaidTicks: secondsToTicks(sr.maxRaidS),
                      retryTicks: secondsToTicks(sr.retryS),
                    })(a.raidPlan.slaveRaids),
              workers:
                a.raidPlan.workers === undefined
                  ? null
                  : { scavengers: a.raidPlan.workers.scavengers },
              mixInOrder: a.raidPlan.mixInOrder === true,
              garrison: { minFighters: a.raidPlan.garrison.minFighters },
              dominancePush: {
                fromTicks: secondsToTicks(a.raidPlan.dominancePush.fromS),
                minArmy: a.raidPlan.dominancePush.minArmy,
              },
            },
      creeps:
        a.creeps === undefined
          ? null
          : {
              fromTicks: secondsToTicks(a.creeps.fromS),
              maxPathU: metersToUnits(a.creeps.maxPathM),
              tiers: a.creeps.tiers.map((t) => ({ tier: t.tier, minArmy: t.minArmy })),
            },
      project:
        a.project === undefined
          ? null
          : {
              restoreFromTicks:
                a.project.restoreFromS === undefined ? -1 : secondsToTicks(a.project.restoreFromS),
              restoreMinArmy: a.project.restoreMinArmy,
              builders: a.project.builders,
              sabotageKinds: a.project.sabotageKinds,
              sabotageMinArmy: a.project.sabotageMinArmy,
              rallyAtParts: a.project.rallyAtParts,
            },
      versusFactionId: a.versus === undefined ? -1 : ref(factionIx, 'factie', where, a.versus),
      heroArchetype: ARCHETYPES.indexOf(a.heroArchetype ?? 'krijger'),
      liberate:
        a.liberate === undefined
          ? null
          : {
              minFree: a.liberate.minFree,
              units: a.liberate.units,
              radiusU: metersToUnits(a.liberate.radiusM),
            },
      defendHqFirst: a.defendHqFirst ?? false,
      allInWithoutNodes: a.allInWithoutNodes,
    };
  });
  // data 0.24.0: at most one script per faction and opponent (the default one has no versus)
  for (let i = 0; i < aiScripts.length; i++)
    for (let j = 0; j < i; j++) {
      const a = aiScripts[i]!;
      const b = aiScripts[j]!;
      if (a.factionId === b.factionId && a.versusFactionId === b.versusFactionId)
        throw new Error(
          `data/ai '${a.key}': same faction and opponent as '${b.key}' (one script per faction and versus)`,
        );
    }
  return aiScripts;
}
