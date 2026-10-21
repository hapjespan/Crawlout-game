import { AiSite, type EffectStat } from './schemas.js';
import type { SurvivalData } from './loader.survival.js';
import type {
  BuildingData,
  EffectData,
  FactionData,
  HeroAuraData,
  LoadoutData,
  RaidPlanData,
} from './loader.types.js';

// Part of the pure loader (see loader.ts): no IO, no clock; falls under the determinism lint.
// Tech, heroes, perks, training, AI scripts, creeps, project, sim tuning and the GameData record itself.

export interface TechData {
  id: number;
  key: string;
  factionId: number;
  scrapCost: number;
  researchTicks: number;
  buildingId: number;
  prereqTech: number[];
  effects: EffectData[];
}

export interface AbilityEffectData {
  stat: EffectStat;
  side: 'enemy' | 'ally';
  target: string;
  /** Zelfde omrekening als EffectData.delta (convertDelta). */
  delta: number;
}

export interface AbilityData {
  id: string;
  naam: string;
  cooldownTicks: number;
  /** Max afstand van de held tot het doelpunt, in eenheden. */
  rangeU: number;
  /** Straal van het effectgebied, in eenheden. */
  radiusU: number;
  durationTicks: number;
  effects: AbilityEffectData[];
}

export interface HeroData {
  id: number;
  key: string;
  factionId: number;
  archetype: number; // index in ARCHETYPES
  special: [number, number, number, number, number, number, number]; // volgorde van STATS: S P E C I A L
  naam: string;
  /** Cumulatieve xp-drempels: xpThresholds[i] = totale xp om level i+2 te bereiken. Maxlevel = lengte + 1. Strikt stijgend, integers. */
  xpThresholds: number[];
  xpPerKill: number;
  xpPerDiscovery: number;
  /** xp per vijandelijke unit die een eigen unit of turret doodt binnen xpAssistRadiusU van de levende held. */
  xpPerAssist: number;
  xpAssistRadiusU: number;
  abilities: AbilityData[];
  /** Passieve effecten voor de speler zolang de held leeft (data 0.16.0); zelfde omrekening en semantiek als perk-effecten. */
  passives: EffectData[];
  /** Intimidatie-aura rond de held (data 0.21.0); null zonder. */
  aura: HeroAuraData | null;
  /** xp per geroofde gevangene (data 0.21.0); 0 zonder. */
  xpPerCapture: number;
  /** loadout-id van het basis-loadout van de held (data 0.21.0), of -1: de sim kiest het militie-loadout van de factie. */
  baseLoadoutId: number;
  perkPool: number[]; // perk-ids
  reviveScrap: number;
  reviveTicks: number;
  revivePenaltyPermille: number;
  /** Aantal keer oplappen voordat de held leeg is. */
  maxRevives: number;
  /** Sight radius (data 0.22.0, fog of war): sightM, else sim.json vision.heroSightM. */
  sightU: number;
}

export interface PerkData {
  id: number;
  key: string;
  naam: string;
  flavourText: string;
  requires: { stat: number; min: number }; // stat = index in STATS
  effects: EffectData[];
}

export interface TrainingProgramData {
  id: number;
  key: string;
  factionId: number;
  /** Index in STATS (S P E C I A L). */
  special: number;
  /** Gebouw-id waar het programma loopt (provides training). */
  buildingId: number;
  /** Kosten van de eerste run en de extra kosten per al getraind punt op die letter. */
  scrapCost: number;
  scrapCostStep: number;
  /** Duur van de eerste run en de extra duur per al getraind punt, in ticks. */
  trainTicks: number;
  trainTicksStep: number;
  pointsPerRun: number;
  /** Hoogstens zoveel getrainde punten per letter. */
  maxPoints: number;
  prereqTech: number[];
}

/** Plaats van een AI-gebouw (AiSite): index in AI_SITES. */
export const AI_SITES = AiSite.options;

export interface AiScriptData {
  id: number;
  key: string;
  factionId: number;
  /** site: index in AI_SITES (0 = hq). */
  buildOrder: { atTick: number; buildingId: number; site: number }[];
  attackTimersTicks: number[];
  /** Deel van de bewoners dat de AI omschoolt tot militie, in promille (aan het begin). */
  militiaPermille: number;
  militiaPermilleMax: number;
  /** Stijging van het militie-aandeel per minuut speeltijd, in promille. */
  militiaPermillePerMin: number;
  threatMilitiaPermille: number;
  builders: number;
  housingBuildingId: number;
  housingFreeBeds: number;
  /** tech-ids in volgorde. */
  research: number[];
  researchFromTicks: number;
  /** loadout-ids in voorkeursvolgorde. */
  armyLoadouts: number[];
  richScrap: number;
  /** site: index in AI_SITES. */
  richBuilds: { buildingId: number; site: number }[];
  scavengersPerNode: number;
  claimFromTicks: number;
  claimSafeRadiusU: number;
  claimFarFromTicks: number;
  /** An idle hero claims a neutral point within this distance by standing there (0 = off; data 0.20.0). */
  heroClaimRadiusU: number;
  defendRadiusU: number;
  /** index in AI_SITES. */
  rallySite: number;
  rallyRadiusU: number;
  waveIntervalTicks: number;
  waveJitterTicks: number;
  waveMinArmy: number;
  waveArmyGrowth: number;
  waveMaxWaitTicks: number;
  pushMinArmy: number;
  pushFromTicks: number;
  /** Robotproductie (data 0.16.0); null als het script geen robots bouwt. */
  /**
   * countAsArmy (data 0.17.0): robots count with their popCost toward the army thresholds; reservePop: the AI keeps
   * this much pop free for robots (0 = none).
   */
  robots: {
    sequence: number[];
    fromTicks: number;
    max: number;
    countAsArmy: boolean;
    reservePop: number;
    /** Data 0.26.0 (voorstel, ter bevestiging door de architect): builder robots besides the sequence; null without. */
    builders: { loadout: number; max: number; fromTicks: number } | null;
  } | null;
  /** Spending rules for the tech tree (data 0.17.0); null without. */
  reserve: { fromTicks: number; minArmy: number; robotsFirstFromTicks: number } | null;
  /** SPECIAL training of the AI (data 0.17.0): training-program ids in order; null without. */
  training: { sequence: number[]; fromTicks: number } | null;
  /** Roofplan van het Raider-script (data 0.21.0); null zonder. */
  raidPlan: RaidPlanData | null;
  /** When the AI clears creep camps (data 0.25.0); null = never. */
  creeps: AiCreepsData | null;
  /** How the AI treats the Bouwproject (data 0.31.0, win route C); null = it ignores it. */
  project: AiProjectData | null;
  /** Data 0.24.0 (proposal): the opponent faction this script is for; -1 = the faction's default script. */
  versusFactionId: number;
  /** Data 0.39.0 (hero choice, proposal): index in ARCHETYPES of the hero an AI of this script plays; krijger if absent. */
  heroArchetype: number;
  /** Data 0.24.0 (proposal): liberation of enemy-held slaves; null without. */
  liberate: { minFree: number; units: number; radiusU: number } | null;
  /** Data 0.24.0 (proposal): an enemy at the headquarters draws every militia and robot not on a push. */
  defendHqFirst: boolean;
  allInWithoutNodes: boolean;
}

/** ai/*.json `project` in sim units (data 0.31.0, win route C; voorstel, ter bevestiging door content en de architect). */
export interface AiProjectData {
  /** -1 = never restore. */
  restoreFromTicks: number;
  restoreMinArmy: number;
  builders: number;
  sabotageKinds: number;
  sabotageMinArmy: number;
  rallyAtParts: boolean;
}

/** ai/*.json `creeps` in sim units (data 0.25.0). */
export interface AiCreepsData {
  fromTicks: number;
  maxPathU: number;
  /** Per camp tier the idle army it takes; a tier without an entry is never attacked. */
  tiers: { tier: number; minArmy: number }[];
}

/** The neutral faction of the creep loadouts (data 0.25.0): LoadoutData.factionId of a bandit. */
export const NEUTRAL_FACTION_ID = -1;

/** One tier of creep camp (data/creeps.json tiers, data 0.25.0) in sim units. */
export interface CreepTierData {
  tier: number;
  naam: string;
  /** Loadout ids (in GameData.loadouts, the neutral ones), one entry per bandit, in file order. */
  units: number[];
  aggroRadiusU: number;
  leashRadiusU: number;
  /** 0 = never. */
  respawnTicks: number;
  lootScrap: number;
  heroXp: number;
  heroXpRadiusU: number;
}

/**
 * Camp takeover of one faction (data/creeps.json takeover, data 0.27.0; voorstel, ter bevestiging door de architect)
 * in sim units: per camp tier the surrender rule and the outpost yield.
 */
export interface CreepTakeoverData {
  factionId: number;
  /** Sorted by tier; every tier exists in CreepsData.tiers. */
  tiers: {
    tier: number;
    /** 0..1000 of the summed max hp of the living bandits. */
    surrenderPermille: number;
    minUnits: number;
    /** 0 = the outpost yields nothing. */
    yieldTicks: number;
    yieldMax: number;
  }[];
}

/**
 * One part of the Bouwproject (data/project.json parts, data 0.31.0; voorstel, ter bevestiging door content en de
 * architect), in file order (the index is the part kind in MapDef.projectSites and PlayerStatus.project).
 */
export interface ProjectPartData {
  key: string;
  naam: string;
  /** Building id (index in GameData.buildings) of the restored part; its key is the part id. */
  buildingId: number;
  /** Building id of the ruin (key `<id>_ruin`): same footprint, no beds, never attacked. */
  ruinBuildingId: number;
  /** For the holder of the restored part, with the semantics of a researched tech. */
  effects: EffectData[];
}

/** data/project.json (data 0.31.0) in sim units; parts empty without the file. */
export interface ProjectData {
  countdownTicks: number;
  pauseTicks: number;
  parts: ProjectPartData[];
}

/** data/creeps.json (data 0.25.0). The bandit loadouts themselves are in GameData.loadouts (factionId NEUTRAL_FACTION_ID). */
export interface CreepsData {
  /** Loadout ids of the bandits, in the order of creeps.json units. */
  units: number[];
  /** Dutch name of each bandit (creeps.json naam), in the same order as units: for the selection panel. */
  names: string[];
  /** Sorted by tier. */
  tiers: CreepTierData[];
  /** Camp takeover per faction (data 0.27.0), ascending factionId; empty = every faction clears camps. */
  takeover: CreepTakeoverData[];
}

/** Sim-tuning in sim-eenheden (integers). */
export interface SimTuningData {
  unitRadiusU: number;
  arriveRadiusU: number;
  separationPermille: number;
  /** Hiërarchische padvinding (data 0.11.0): sectorzijde, langste ingang en geheugenbudget, alle drie in cellen. */
  pathSectorCells: number;
  pathEntranceMaxCells: number;
  pathCacheCells: number;
  walkAnimStep: number;
  aggroRangeU: number;
  interactRangeU: number;
  claimRadiusU: number;
  popCapMax: number;
  corpseTicks: number;
  /** Teruggave bij Cancel in promille (1000 = volle prijs). */
  cancelRefundPermille: number;
  /** SPECIAL van de held, per punt van de letter (sprint 3, ter review). */
  specialStrengthDamagePermille: number;
  specialPerceptionRangeU: number;
  specialEnduranceHpPermille: number;
  specialCharismaGrowthPermille: number;
  specialIntelligenceResearchPermille: number;
  specialAgilitySpeedPermille: number;
  specialLuckCritPermille: number;
  critDamagePermille: number;
  /** Een bouwer zonder taak helpt bij een eigen bouwplaats binnen deze afstand (tot de rand van de footprint; data 0.8.0). */
  builderAutoHelpRadiusU: number;
  /** Group-order spreading (data 0.15.0): formation slots, arrival slack, straight-walk range, worker ring. */
  formation: FormationTuningData;
  /** Building placement margins (data 0.18.0; bevestigd in fase-0 sectie 22 besluit 4 tot 6). */
  placement: PlacementTuningData;
  /** New scavenger settlers of a human player gather at the nearest reachable node within this radius (0 = off). */
  autoGatherRadiusU: number;
  /** A scrap node within this distance of a held claim point is exclusive to its owner (data 0.20.0; bevestigd in fase-0 sectie 22 besluit 4 tot 6). */
  exclusiveRadiusU: number;
  /** The hero claims a free point by standing in its circle this long (0 = off; data 0.20.0, bevestigd in fase-0 sectie 22 besluit 4 tot 6). */
  heroClaimTicks: number;
  /** A tower-less (hero) claim goes over after this long with enemies and none of the holder in the circle. */
  contestFlipTicks: number;
  /** Fog of war (data 0.22.0; bevestigd in fase-0 sectie 23 besluit 1): the vision grid. Default sight radii are resolved onto each record (sightU). */
  vision: VisionTuningData;
  /** Guard mode (data 0.29.0; voorstel, ter bevestiging door de architect): the Guard command. */
  guard: GuardTuningData;
  /** Base defence (data 0.35.0; voorstel, ter bevestiging door de architect). */
  baseDefense: BaseDefenseTuningData;
}

/** sim.json `baseDefense` in sim units (data 0.35.0). */
export interface BaseDefenseTuningData {
  survival: boolean;
  skirmish: boolean;
  radiusU: number;
  calmTicks: number;
}

/** sim.json `guard` in sim units (data 0.29.0). */
export interface GuardTuningData {
  standU: number;
  leashU: number;
}

/** sim.json `vision` in sim units (data 0.22.0). */
export interface VisionTuningData {
  /** Side of a vision cell in sim units (cellM * 256: 256, 512 or 1024). */
  cellU: number;
}

/** sim.json `placement` in sim units. */
export interface PlacementTuningData {
  clearanceU: number;
  depotClearanceU: number;
  /** Territory (data 0.20.0, bevestigd in fase-0 sectie 22 besluit 4 tot 6): range around own buildings and around a claim post; 0 = off. */
  buildRangeU: number;
  claimBuildRangeU: number;
}

/** sim.json `formation` in sim units. */
export interface FormationTuningData {
  gapU: number;
  widthPermille: number;
  slackU: number;
  directRangeU: number;
  gatherRingU: number;
}

export interface GameData {
  /** Semver uit data/VERSION, ongewijzigd. Hoort in replay en hash-seed. */
  dataVersion: string;
  /** Semver als integer (major*1_000_000 + minor*1_000 + patch), handig voor een hash-seed. */
  dataVersionPacked: number;
  /** Alle arrays staan op numerieke id: records[i].id === i. Gesorteerd op string-id. */
  factions: FactionData[];
  loadouts: LoadoutData[];
  buildings: BuildingData[];
  tech: TechData[];
  heroes: HeroData[];
  perks: PerkData[];
  /** Trainingsprogramma's (data 0.16.0). */
  training: TrainingProgramData[];
  aiScripts: AiScriptData[];
  /** Creep camps (data/creeps.json, data 0.25.0); empty without the file. */
  creeps: CreepsData;
  /** Survival co-op (data 0.33.0; voorstel, ter bevestiging door de architect); null without data/survival. */
  survival: SurvivalData | null;
  /**
   * Win route C, Bouwproject (data/project.json, data 0.31.0); no parts without the file. The part buildings are in
   * `buildings` after the faction buildings (factionId NEUTRAL_FACTION_ID).
   */
  project: ProjectData;
  /** damageMatrix[damageTypeIndex][armorTypeIndex] = multiplier in promille (1000 = 100 procent). */
  damageMatrix: number[][];
  sim: SimTuningData;
}
