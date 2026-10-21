// Split from fromData.ts to stay under the 5,000-token file limit; fromData.ts re-exports the public surface.
// Holds: simConfigFromGameData.
import {
  type GameData,
  ARCHETYPES,
  PROVIDES,
  ROLES,
  unitTypeId,
  buildingTypeId,
  heroTypeId,
  REPAIR_TARGETS,
  CAPTURE_TARGETS,
  secondsToTicks,
} from '@crawlout/data';
import {
  type SimConfig,
  type SimFaction,
  SAFETY_NET_TENTS,
  SAFETY_NET_BEACON,
  type SimChem,
  type SimHero,
} from './config.js';
import {
  ROLE_SCAVENGER,
  claimKindIndex,
  defaultLoadoutForRole,
  simAuraEffect,
  simChemEffect,
  simEffect,
} from './fromData.part1.js';
import { simSurvivalFromData } from './fromData.part4.js';
import {
  simFusionCores,
  simGardeUnit,
  simMapPowerArmor,
  simRaidPlan,
  simVeterancy,
} from './fromData.garde.js';

/** GameData naar SimConfig. Gooit als een factie geen hoofdgebouw (provides hq) heeft. */
export function simConfigFromGameData(data: GameData): SimConfig {
  const t = data.sim;
  const factions: SimFaction[] = data.factions.map((f) => {
    let hq: number | undefined;
    for (const b of data.buildings) {
      if (hq === undefined && b.factionId === f.id && b.provides.includes(PROVIDES.indexOf('hq')))
        hq = b.id;
    }
    if (hq === undefined) throw new Error(`factie ${f.key}: geen gebouw met provides hq`);
    const roleTypeIds = ROLES.map((_, role) => {
      const l = defaultLoadoutForRole(data, f.id, role);
      return l === undefined ? 0 : unitTypeId(l.id);
    });
    // data 0.24.0: the default script has no versus; a versus script per opponent faction
    const aiScript = data.aiScripts.findIndex((a) => a.factionId === f.id && a.versusFactionId < 0);
    const aiScriptVersus = data.factions.map((g) =>
      data.aiScripts.findIndex((a) => a.factionId === f.id && a.versusFactionId === g.id),
    );
    // Claim-commando (besluit sprint 2): het goedkoopste gebouw met provides claim dat geen hoofdgebouw is, dan laagste id.
    let claim: (typeof data.buildings)[number] | undefined;
    for (const b of data.buildings) {
      if (
        b.factionId !== f.id ||
        !b.provides.includes(PROVIDES.indexOf('claim')) ||
        b.provides.includes(PROVIDES.indexOf('hq'))
      )
        continue;
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
      aiScriptVersus,
      claimTypeId: claim === undefined ? 0 : buildingTypeId(claim.id),
      // De Krijger van de factie (data 0.39.0, held-keuze), anders de eerste held (laagste id); SimPlayer.heroId kiest
      // een andere (sim 0.33.0).
      heroId: defaultHeroId(data, f.id),
      safetyNet:
        f.safetyNet.loadoutId < 0
          ? null
          : {
              action:
                f.safetyNet.action === 'tenten_instroom' ? SAFETY_NET_TENTS : SAFETY_NET_BEACON,
              threshold: f.safetyNet.threshold,
              intervalTicks: f.safetyNet.intervalTicks,
              maxArrivals: f.safetyNet.maxArrivals,
              typeId: unitTypeId(f.safetyNet.loadoutId),
            },
      robotRules:
        f.robotRules === null
          ? null
          : {
              robotsPerTechnician: f.robotRules.robotsPerTechnician,
              technicianRoles: [...f.robotRules.technicianRoles],
              penaltyPermille: f.robotRules.robotPenaltyPermille,
            },
      slaves:
        f.slaves === null
          ? null
          : {
              capturedTypeId: unitTypeId(f.slaves.capturedLoadoutId),
              minDistanceFromOwnerBase: f.slaves.minDistanceFromOwnerBaseU,
              touchTicks: f.slaves.liberation.touchTicks,
              touchRange: f.slaves.liberation.touchRangeU,
              guardRadius: f.slaves.liberation.guardRadiusU,
              freedSpeedPermille: f.slaves.liberation.freedSpeedPermille,
              cageNear: f.slaves.revolt.cageNearU,
              revoltGuardRadius: f.slaves.revolt.guardRadiusU,
              cageGuards: f.slaves.revolt.cageGuards,
              guardModeSlavesPerGuard: f.slaves.revolt.guardModeSlavesPerGuard,
              noCageGuards: f.slaves.revolt.noCageGuards,
              noCageSlaves: f.slaves.revolt.noCageSlaves,
              escapeDist: f.slaves.revolt.escapeU,
              graceTicks: f.slaves.revolt.graceTicks,
              emptyGraceTicks: f.slaves.revolt.emptyGraceTicks,
              escapePermille: f.slaves.revolt.escapePermille,
              repeatTicks: f.slaves.revolt.repeatTicks,
            },
      plunder: f.plunder === null ? null : { ...f.plunder },
      tribute:
        f.tribute === null
          ? null
          : {
              claimKind: claimKindIndex(f.tribute.claimKind),
              scrapPerMin: f.tribute.scrapPerMin,
              bonusTech: f.tribute.bonusTech,
              bonusPermille: f.tribute.bonusPermille,
            },
      chems: f.chems.map((c): SimChem => ({
        requiresTech: c.requiresTech,
        doseScrap: c.doseScrap,
        activeTicks: c.activeTicks,
        crashTicks: c.crashTicks,
        cooldownTicks: c.cooldownTicks,
        effects: c.effects.map((e) => simChemEffect(data, e, `chem ${c.key}`)),
        crash: c.crash.map((e) => simChemEffect(data, e, `chem ${c.key} crash`)),
        refined: c.refined === null ? null : { ...c.refined },
      })),
      veterancy: simVeterancy(f),
      fusionCores: simFusionCores(f),
      mapPowerArmor: simMapPowerArmor(f),
    };
  });
  const heroes: SimHero[] = data.heroes.map((h) => {
    // data 0.21.0: baseLoadoutId when set, else the militia loadout of the faction (the default before)
    const base =
      h.baseLoadoutId >= 0
        ? unitTypeId(h.baseLoadoutId)
        : (factions[h.factionId]!.roleTypeIds[ROLES.indexOf('militia')] ?? 0);
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
      xpPerAssist: h.xpPerAssist,
      xpAssistRadius: h.xpAssistRadiusU,
      abilities: h.abilities.map((a) => ({
        cooldownTicks: a.cooldownTicks,
        rangeU: a.rangeU,
        radiusU: a.radiusU,
        durationTicks: a.durationTicks,
        effects: a.effects.map((e) => simAuraEffect(e, `held ${h.key} ability ${a.id}`)),
      })),
      passives: h.passives.map((e) => simEffect(data, e, `held ${h.key} passives`)),
      perkPool: [...h.perkPool],
      reviveScrap: h.reviveScrap,
      reviveTicks: h.reviveTicks,
      revivePenaltyPermille: h.revivePenaltyPermille,
      maxRevives: h.maxRevives,
      sight: h.sightU,
      aura:
        h.aura === null
          ? null
          : {
              radius: h.aura.radiusU,
              effects: h.aura.effects.map((e) => simAuraEffect(e, `held ${h.key} aura`)),
            },
      xpPerCapture: h.xpPerCapture,
    };
  });
  const survival = simSurvivalFromData(data.survival);
  return {
    ...(survival === undefined ? {} : { survival }),
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
      producedAtTypeId: l.producedAt < 0 ? 0 : buildingTypeId(l.producedAt),
      repair:
        l.repair === null
          ? null
          : {
              milliHpPerTick: l.repair.milliHpPerTick,
              range: l.repair.rangeU,
              seekRange: l.repair.seekRangeU,
              buildings: l.repair.targets.includes(REPAIR_TARGETS.indexOf('building')),
              robots: l.repair.targets.includes(REPAIR_TARGETS.indexOf('robot')),
              vehicles: l.repair.targets.includes(REPAIR_TARGETS.indexOf('vehicle')),
            },
      siege:
        l.siege === null
          ? null
          : {
              vsBuildingsPermille: l.siege.vsBuildingsPermille,
              buildingsFirst: l.siege.buildingsFirst,
            },
      sight: l.sightU,
      slave: l.slave,
      canBuild: l.canBuild,
      fusionCores: l.fusionCores,
      ...simGardeUnit(l),
      capture:
        l.capture === null
          ? null
          : {
              range: l.capture.rangeU,
              captureTicks: l.capture.captureTicks,
              wanderers: l.capture.targets.includes(CAPTURE_TARGETS.indexOf('wanderer')),
              residents: l.capture.targets.includes(CAPTURE_TARGETS.indexOf('resident')),
              maxHpPermille: l.capture.maxHpPermille,
            },
      aura: l.aura === null ? null : { radius: l.aura.radiusU, chems: [...l.aura.chems] },
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
      network:
        b.network === null
          ? null
          : {
              requiresTech: b.network.requiresTech,
              radius: b.network.radiusU,
              damagePermillePerTurret: b.network.damagePermillePerTurret,
              maxDamagePermille: b.network.maxDamagePermille,
            },
      sight: b.sightU,
      cage:
        b.cage === null
          ? null
          : {
              capacity: b.cage.capacity,
              transitionTicks: b.cage.transitionTicks,
              workRadius: b.cage.workRadiusU,
            },
      hqRange:
        b.placement === null ? null : { min: b.placement.minFromHqU, max: b.placement.maxFromHqU },
    })),
    factions,
    aiScripts: data.aiScripts.map((a) => ({
      buildOrder: a.buildOrder.map((o) => ({
        atTick: o.atTick,
        typeId: buildingTypeId(o.buildingId),
        site: o.site,
      })),
      attackTimersTicks: [...a.attackTimersTicks],
      militiaPermille: a.militiaPermille,
      militiaPermilleMax: a.militiaPermilleMax,
      militiaPermillePerMin: a.militiaPermillePerMin,
      threatMilitiaPermille: a.threatMilitiaPermille,
      builders: a.builders,
      housingTypeId: buildingTypeId(a.housingBuildingId),
      housingFreeBeds: a.housingFreeBeds,
      research: [...a.research],
      researchFromTicks: a.researchFromTicks,
      armyTypeIds: a.armyLoadouts.map((l) => unitTypeId(l)),
      richScrap: a.richScrap,
      richBuilds: a.richBuilds.map((o) => ({ typeId: buildingTypeId(o.buildingId), site: o.site })),
      scavengersPerNode: a.scavengersPerNode,
      claimFromTicks: a.claimFromTicks,
      claimSafeRadius: a.claimSafeRadiusU,
      claimFarFromTicks: a.claimFarFromTicks,
      heroClaimRadius: a.heroClaimRadiusU,
      defendRadius: a.defendRadiusU,
      rallySite: a.rallySite,
      rallyRadius: a.rallyRadiusU,
      waveIntervalTicks: a.waveIntervalTicks,
      waveJitterTicks: a.waveJitterTicks,
      waveMinArmy: a.waveMinArmy,
      waveArmyGrowth: a.waveArmyGrowth,
      waveMaxWaitTicks: a.waveMaxWaitTicks,
      pushMinArmy: a.pushMinArmy,
      pushFromTicks: a.pushFromTicks,
      allInWithoutNodes: a.allInWithoutNodes,
      robots:
        a.robots === null
          ? null
          : {
              typeIds: a.robots.sequence.map((l) => unitTypeId(l)),
              fromTicks: a.robots.fromTicks,
              max: a.robots.max,
              countAsArmy: a.robots.countAsArmy,
              reservePop: a.robots.reservePop,
              builders:
                a.robots.builders === null
                  ? null
                  : {
                      typeId: unitTypeId(a.robots.builders.loadout),
                      max: a.robots.builders.max,
                      fromTicks: a.robots.builders.fromTicks,
                    },
            },
      reserve: a.reserve === null ? null : { ...a.reserve },
      training:
        a.training === null
          ? null
          : { programIds: [...a.training.sequence], fromTicks: a.training.fromTicks },
      raidPlan: simRaidPlan(a.raidPlan),
      liberate:
        a.liberate === null
          ? null
          : { minFree: a.liberate.minFree, units: a.liberate.units, radius: a.liberate.radiusU },
      defendHqFirst: a.defendHqFirst,
      creeps:
        a.creeps === null
          ? null
          : {
              fromTicks: a.creeps.fromTicks,
              maxPath: a.creeps.maxPathU,
              tiers: a.creeps.tiers.map((t) => ({ tier: t.tier, minArmy: t.minArmy })),
            },
      project: a.project === null ? null : { ...a.project },
    })),
    creepTiers: data.creeps.tiers.map((t) => ({
      tier: t.tier,
      typeIds: t.units.map((l) => unitTypeId(l)),
      aggroRadius: t.aggroRadiusU,
      leashRadius: t.leashRadiusU,
      respawnTicks: t.respawnTicks,
      lootScrap: t.lootScrap,
      heroXp: t.heroXp,
      heroXpRadius: t.heroXpRadiusU,
    })),
    project: {
      countdownTicks: data.project.countdownTicks,
      pauseTicks: data.project.pauseTicks,
      parts: data.project.parts.map((k) => ({
        restoredTypeId: buildingTypeId(k.buildingId),
        ruinTypeId: buildingTypeId(k.ruinBuildingId),
        effects: k.effects.map((e) => simEffect(data, e, `projectdeel ${k.key}`)),
      })),
    },
    creepTakeover: data.creeps.takeover.map((r) => ({
      factionId: r.factionId,
      tiers: r.tiers.map((t) => ({ ...t })),
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
    training: data.training.map((tr) => ({
      programId: tr.id,
      factionId: tr.factionId,
      special: tr.special,
      buildingTypeId: buildingTypeId(tr.buildingId),
      scrapCost: tr.scrapCost,
      scrapCostStep: tr.scrapCostStep,
      trainTicks: tr.trainTicks,
      trainTicksStep: tr.trainTicksStep,
      pointsPerRun: tr.pointsPerRun,
      maxPoints: tr.maxPoints,
      prereqTech: [...tr.prereqTech],
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
    pathSectorCells: t.pathSectorCells,
    pathEntranceMaxCells: t.pathEntranceMaxCells,
    pathCacheCells: t.pathCacheCells,
    walkAnimStep: t.walkAnimStep,
    aggroRange: t.aggroRangeU,
    interactRange: t.interactRangeU,
    claimRadius: t.claimRadiusU,
    popCapMax: t.popCapMax,
    corpseTicks: t.corpseTicks,
    cancelRefundPermille: t.cancelRefundPermille,
    builderAutoHelpRadius: t.builderAutoHelpRadiusU,
    formation: {
      gap: t.formation.gapU,
      widthPermille: t.formation.widthPermille,
      slack: t.formation.slackU,
      directRange: t.formation.directRangeU,
      gatherRing: t.formation.gatherRingU,
    },
    placement: {
      clearance: t.placement.clearanceU,
      depotClearance: t.placement.depotClearanceU,
      buildRange: t.placement.buildRangeU,
      claimBuildRange: t.placement.claimBuildRangeU,
    },
    autoGatherRadius: t.autoGatherRadiusU,
    exclusiveRadius: t.exclusiveRadiusU,
    heroClaimTicks: t.heroClaimTicks,
    contestFlipTicks: t.contestFlipTicks,
    visionCell: t.vision.cellU,
    guard: { stand: t.guard.standU, leash: t.guard.leashU },
    baseDefense: {
      survival: t.baseDefense.survival,
      skirmish: t.baseDefense.skirmish,
      radius: t.baseDefense.radiusU,
      calmTicks: t.baseDefense.calmTicks,
    },
  };
}

/** The hero of a faction when a player chooses none: its Krijger, else its first hero (lowest id), -1 = none. */
export function defaultHeroId(data: GameData, factionId: number): number {
  const krijger = data.heroes.findIndex(
    (h) => h.factionId === factionId && h.archetype === ARCHETYPES.indexOf('krijger'),
  );
  return krijger >= 0 ? krijger : data.heroes.findIndex((h) => h.factionId === factionId);
}
