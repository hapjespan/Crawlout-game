import { ARMOR_TYPES, DAMAGE_TYPES, type RawGameData } from './loader.types.js';
import type { GameData } from './loader.types.game.js';
import type { SimTuning } from './schemas.js';
import { metersToUnits, pctToPermille, secondsToTicks } from './units.js';
import { parseVersion } from './loader.util.js';
import { parseRawData } from './loader.parse.js';
import { convertFactions } from './loader.factions.js';
import { convertCreeps, convertLoadouts } from './loader.loadouts.js';
import { convertBuildings, convertProject } from './loader.buildings.js';
import { convertHeroes, convertPerks, convertTech, convertTraining } from './loader.progression.js';
import { convertAiScripts } from './loader.ai.js';
import { convertSurvival } from './loader.survival.js';

// De loader: PUUR. Geen fs, geen IO, geen klok. Krijgt geparste JSON, valideert met de zod-schema's,
// rekent om naar sim-eenheden (integers) en geeft numerieke ids terug (index op gesorteerde string-id).
// Valt onder de determinisme-lint (fase-0 sectie 7). Bestanden inlezen doet node.ts.

// The work is split into stage functions in sibling loader.*.ts files, called in a fixed order below.

export {
  ARMOR_TYPES,
  DAMAGE_TYPES,
  BODY_TYPES,
  ROLES,
  ARCHETYPES,
  PROVIDES,
  STATS,
  REPAIR_TARGETS,
  CAPTURE_TARGETS,
} from './loader.types.js';
export type {
  RawGameData,
  EffectData,
  RobotRulesData,
  SlaveRulesData,
  PlunderRulesData,
  TributeData,
  ChemData,
  CaptureData,
  UnitAuraData,
  CageData,
  HeroAuraData,
  RaidPlanData,
  FactionData,
  LoadoutData,
  RepairData,
  SiegeData,
  TurretNetworkData,
  BuildingData,
} from './loader.types.js';
export { AI_SITES, NEUTRAL_FACTION_ID } from './loader.types.game.js';
export type {
  TechData,
  AbilityEffectData,
  AbilityData,
  HeroData,
  PerkData,
  TrainingProgramData,
  AiScriptData,
  AiProjectData,
  AiCreepsData,
  CreepTierData,
  CreepTakeoverData,
  ProjectPartData,
  ProjectData,
  CreepsData,
  SimTuningData,
  GuardTuningData,
  BaseDefenseTuningData,
  VisionTuningData,
  PlacementTuningData,
  FormationTuningData,
  GameData,
} from './loader.types.game.js';
export type { RawSurvival, SurvivalData, SurvivalWaveData } from './loader.survival.js';
export { convertDelta, convertDominance, cumulate, type DominanceData } from './loader.util.js';

/**
 * Valideert en converteert de ruwe data naar GameData (sim-eenheden, numerieke ids).
 * Gooit een Error met bestandsnaam en pad bij elke ongeldigheid (onbekend veld, dangling referentie, dubbele id).
 * Pure functie: zelfde input geeft altijd gelijke output.
 */
export function loadGameData(raw: RawGameData): GameData {
  const version = parseVersion(raw.version);
  const ctx = parseRawData(raw);
  const factions = convertFactions(ctx);
  const loadouts = convertLoadouts(ctx);
  const creeps = convertCreeps(ctx, raw, loadouts);
  const survival = convertSurvival(ctx, raw, loadouts);
  const buildings = convertBuildings(ctx);
  const project = convertProject(ctx, raw, buildings);
  const tech = convertTech(ctx);
  const heroes = convertHeroes(ctx);
  const perks = convertPerks(ctx);
  const training = convertTraining(ctx);
  const aiScripts = convertAiScripts(ctx, loadouts);
  const { matrixRaw, simRaw } = ctx;

  // Vaste volgorde via de enum-lijsten; nooit via Object.keys.
  const damageMatrix = DAMAGE_TYPES.map((damageType) =>
    ARMOR_TYPES.map((armorType) => pctToPermille(matrixRaw[damageType][armorType] ?? 0)),
  );

  return {
    dataVersion: version.text,
    dataVersionPacked: version.packed,
    factions,
    loadouts,
    buildings,
    tech,
    heroes,
    perks,
    training,
    aiScripts,
    creeps,
    survival,
    project,
    damageMatrix,
    sim: convertSimTuning(simRaw),
  };
}

/** Last stage: the global sim tuning (sim.json) in sim units. */
function convertSimTuning(simRaw: SimTuning): GameData['sim'] {
  return {
    unitRadiusU: metersToUnits(simRaw.unitRadiusM),
    arriveRadiusU: metersToUnits(simRaw.arriveRadiusM),
    separationPermille: pctToPermille(simRaw.separationPct),
    pathSectorCells: simRaw.pathSectorCells,
    pathEntranceMaxCells: simRaw.pathEntranceMaxCells,
    pathCacheCells: simRaw.pathCacheCells,
    walkAnimStep: simRaw.walkAnimStep,
    aggroRangeU: metersToUnits(simRaw.aggroRangeM),
    interactRangeU: metersToUnits(simRaw.interactRangeM),
    claimRadiusU: metersToUnits(simRaw.claimRadiusM),
    popCapMax: simRaw.popCapMax,
    corpseTicks: secondsToTicks(simRaw.corpseS),
    cancelRefundPermille: pctToPermille(simRaw.cancelRefundPct),
    specialStrengthDamagePermille: pctToPermille(simRaw.specialStrengthDamagePct),
    specialPerceptionRangeU: metersToUnits(simRaw.specialPerceptionRangeM),
    specialEnduranceHpPermille: pctToPermille(simRaw.specialEnduranceHpPct),
    specialCharismaGrowthPermille: pctToPermille(simRaw.specialCharismaGrowthPct),
    specialIntelligenceResearchPermille: pctToPermille(simRaw.specialIntelligenceResearchPct),
    specialAgilitySpeedPermille: pctToPermille(simRaw.specialAgilitySpeedPct),
    specialLuckCritPermille: pctToPermille(simRaw.specialLuckCritPct),
    critDamagePermille: pctToPermille(simRaw.critDamagePct),
    builderAutoHelpRadiusU: metersToUnits(simRaw.builderAutoHelpRadiusM),
    formation: {
      gapU: metersToUnits(simRaw.formation.gapM),
      widthPermille: pctToPermille(simRaw.formation.widthPct),
      slackU: metersToUnits(simRaw.formation.slackM),
      directRangeU: metersToUnits(simRaw.formation.directRangeM),
      gatherRingU: metersToUnits(simRaw.formation.gatherRingM),
    },
    placement: {
      clearanceU: metersToUnits(simRaw.placement.clearanceM),
      depotClearanceU: metersToUnits(simRaw.placement.depotClearanceM),
      buildRangeU: metersToUnits(simRaw.placement.buildRangeM),
      claimBuildRangeU: metersToUnits(simRaw.placement.claimBuildRangeM),
    },
    autoGatherRadiusU: metersToUnits(simRaw.autoGatherRadiusM),
    exclusiveRadiusU: metersToUnits(simRaw.exclusiveRadiusM),
    heroClaimTicks: secondsToTicks(simRaw.heroClaimS),
    contestFlipTicks: secondsToTicks(simRaw.contestFlipS),
    vision: { cellU: metersToUnits(simRaw.vision.cellM) },
    baseDefense: {
      survival: simRaw.baseDefense.survival,
      skirmish: simRaw.baseDefense.skirmish,
      radiusU: metersToUnits(simRaw.baseDefense.radiusM),
      calmTicks: secondsToTicks(simRaw.baseDefense.calmS),
      retargetU: metersToUnits(simRaw.baseDefense.retargetM),
    },
    guard: {
      standU: metersToUnits(simRaw.guard.standM),
      leashU: metersToUnits(simRaw.guard.leashM),
    },
  };
}
