import { ZodError, type ZodTypeAny, type z } from 'zod';
import {
  AiScript,
  AiSite,
  ArmorType,
  EffectStat,
  Building,
  DamageMatrix,
  DamageType,
  Faction,
  Hero,
  Loadout,
  Perk,
  RepairTarget,
  Role,
  SimTuning,
  Stat,
  Tech,
  Training,
  BodyType,
  CaptureTarget,
  Provides,
  Archetype,
  Creeps,
} from './schemas.js';
import {
  metersToUnits,
  mpsToUnitsPerTick,
  pctToPermille,
  perSecondToMilliPerTick,
  secondsToTicks,
} from './units.js';

// De loader: PUUR. Geen fs, geen IO, geen klok. Krijgt geparste JSON, valideert met de zod-schema's,
// rekent om naar sim-eenheden (integers) en geeft numerieke ids terug (index op gesorteerde string-id).
// Valt onder de determinisme-lint (fase-0 sectie 7). Bestanden inlezen doet node.ts.

/** Geparste JSON-inhoud van data/ (zonder maps). Elk veld is nog onvalideerd (`unknown`). */
export interface RawGameData {
  /** Inhoud van data/VERSION (semver, witruimte wordt genegeerd). */
  version: string;
  factions: unknown;
  loadouts: unknown;
  buildings: unknown;
  tech: unknown;
  heroes: unknown;
  perks: unknown;
  /** Inhoud van data/training.json (data 0.16.0). */
  training: unknown;
  damageMatrix: unknown;
  /** Inhoud van data/sim.json. */
  sim: unknown;
  /** Alle bestanden uit data/ai/, in elke volgorde (de loader sorteert op id). */
  ai: unknown[];
  /** Contents of data/creeps.json (data 0.25.0); absent = no creep camps. */
  creeps?: unknown;
}

// Vaste volgorde van de enums: de index is de numerieke waarde in GameData.
export const ARMOR_TYPES = ArmorType.options;
export const DAMAGE_TYPES = DamageType.options;
export const BODY_TYPES = BodyType.options;
export const ROLES = Role.options;
export const ARCHETYPES = Archetype.options;
export const PROVIDES = Provides.options;
export const STATS = Stat.options;
/** Doelen die een support-robot kan repareren; de index staat in LoadoutData.repair.targets. */
export const REPAIR_TARGETS = RepairTarget.options;
/** Doelen van een Slaver; de index staat in CaptureData.targets. */
export const CAPTURE_TARGETS = CaptureTarget.options;

export interface EffectData {
  stat: EffectStat;
  /** String-id of vrij doel ('held', 'alle'); de sim lost dit zelf op. */
  target: string;
  /** Pct-stat: promille. M-stat: sim-eenheden. S-stat: ticks. Anders: ruw geheel getal. Zie convertDelta. */
  delta: number;
}

export interface RobotRulesData {
  /** Eén technicus (een levende bewoner met een rol uit technicianRoles) dekt zoveel robots. */
  robotsPerTechnician: number;
  /** Indices in ROLES. */
  technicianRoles: number[];
  /** Een robot zonder technicus werkt op (1000 - robotPenaltyPermille) promille: 1000 = werkt niet. */
  robotPenaltyPermille: number;
}

// Raiders (data 0.21.0; bevestigd in fase-0 sectie 23 besluit 2). Alleen data, de sim leest ze nog niet.
// Elk blok is null of een lege lijst voor een factie of record zonder het veld.

export interface SlaveRulesData {
  /** Loadout-id waar een gevangene na de Kooi-transitie een slaaf van wordt. */
  capturedLoadoutId: number;
  /** Roven alleen verder dan dit van het hoofdgebouw van de eigenaar van het doel. */
  minDistanceFromOwnerBaseU: number;
  liberation: {
    touchTicks: number;
    touchRangeU: number;
    guardRadiusU: number;
    /** Bonus op de loopsnelheid van de bevrijde slaaf in promille. */
    freedSpeedPermille: number;
  };
  revolt: {
    garrisonRadiusU: number;
    slavesPerGuard: number;
    minGuards: number;
    graceTicks: number;
    emptyGraceTicks: number;
    escapePermille: number;
    repeatTicks: number;
  };
}

export interface PlunderRulesData {
  buildingLootPermille: number;
  depotLootMultiplierPermille: number;
  carryLootPermille: number;
  /** tech-id, of -1 zonder bonus. */
  bonusTech: number;
  bonusPermille: number;
}

export interface TributeData {
  /** Waarde van MapDef.claimPoints[].kind. */
  claimKind: string;
  /** Scrap per minuut per bezet punt, ruw (de sim rekent zelf naar ticks). */
  scrapPerMin: number;
  /** tech-id, of -1 zonder bonus. */
  bonusTech: number;
  bonusPermille: number;
}

export interface ChemData {
  /** Index in FactionData.chems (per factie, op volgorde van het bestand: de chem-ids zijn niet globaal). */
  id: number;
  key: string;
  naam: string;
  flavourText: string;
  requiresTech: number;
  doseScrap: number;
  activeTicks: number;
  crashTicks: number;
  cooldownTicks: number;
  effects: EffectData[];
  crash: EffectData[];
  /** Verfijnde stoffen: tech en procentuele aanpassing (promille) van werkings- en crashduur; null zonder. */
  refined: { requiresTech: number; activePermille: number; crashPermille: number } | null;
}

export interface CaptureData {
  rangeU: number;
  captureTicks: number;
  /** Indices in CAPTURE_TARGETS. */
  targets: number[];
  maxHpPermille: number;
}

export interface UnitAuraData {
  radiusU: number;
  /** Indices in FactionData.chems van de factie van de unit. */
  chems: number[];
  trigger: 'gevecht';
}

export interface CageData {
  capacity: number;
  transitionTicks: number;
  workRadiusU: number;
}

export interface HeroAuraData {
  radiusU: number;
  effects: AbilityEffectData[];
}

export interface RaidPlanData {
  fighterMix: { loadoutId: number; weight: number }[];
  harass: {
    loadoutId: number;
    fromTicks: number;
    max: number;
    retreatHpPermille: number;
    targets: 'gatherers';
  };
  slaveRaids: {
    slaverLoadoutId: number;
    fromTicks: number;
    slavers: number;
    escort: number;
    maxRaidTicks: number;
    retryTicks: number;
  };
  garrison: { minFighters: number };
  dominancePush: { fromTicks: number; minArmy: number };
}

export interface FactionData {
  id: number;
  key: string;
  naam: string;
  bodyTypes: number[]; // index in BODY_TYPES
  startUnits: { loadoutId: number; count: number }[];
  startScrap: number;
  /** Bewoners per minuut, ruw (de sim rekent zelf naar ticks). */
  housingGrowthPerMin: number;
  /**
   * Vangnet (data 0.16.0). Bij action radiobaken_instroom: zolang het aantal eigen bewoners (levende units van bodyType human, zonder
   * held en robots) onder threshold ligt en er een voltooid gebouw met provides beacon staat, komt er elke intervalTicks een bewoner
   * van loadoutId bij het baken, zonder bedden-eis en binnen popCapMax, hoogstens maxArrivals keer per speler per potje.
   */
  safetyNet: {
    threshold: number;
    action: string;
    intervalTicks: number;
    maxArrivals: number;
    /** loadout-id van de bewoner die aankomt; -1 als de actie geen aankomst heeft. */
    loadoutId: number;
  };
  /** De technicus-regel (data 0.16.0); null voor een factie zonder robots. */
  robotRules: RobotRulesData | null;
  uniqueUnits: number[]; // loadout-ids
  uniqueBuildings: number[]; // building-ids
  specialChannel: 'training' | 'chems' | 'tech';
  /** Slavenregels (data 0.21.0, Raiders); null voor een factie zonder slaven. */
  slaves: SlaveRulesData | null;
  /** Buit uit gesloopte gebouwen en gedode verzamelaars (data 0.21.0); null zonder. */
  plunder: PlunderRulesData | null;
  /** Tribute van een bezet neutraal claimpunt (data 0.21.0); null zonder. */
  tribute: TributeData | null;
  /** Chems van het SPECIAL-kanaal chems (data 0.21.0); leeg bij een ander kanaal. */
  chems: ChemData[];
}

export interface LoadoutData {
  id: number;
  key: string;
  factionId: number;
  bodyType: number; // index in BODY_TYPES
  role: number; // index in ROLES
  weapon: string;
  armorType: number; // index in ARMOR_TYPES
  damageType: number; // index in DAMAGE_TYPES
  hpI: number;
  damage: number;
  rangeU: number;
  speedUPT: number;
  cooldownTicks: number;
  scrapCost: number;
  craftTicks: number;
  /** Scrap per verzamelronde (integer); 0 voor niet-verzamelaars. */
  gatherAmount: number;
  /** Ticks per verzamelronde; 0 voor niet-verzamelaars. */
  gatherTicks: number;
  popCost: number;
  prereqTech: number[]; // tech-ids
  visuals: { meshSlots: Record<string, string> };
  /** Gebouw-id waar de unit nieuw gebouwd wordt (robots), of -1: omscholen van een bewoner in de werkplaats. */
  producedAt: number;
  /** Support-robot (data 0.16.0); null voor de rest. */
  repair: RepairData | null;
  /** Belegering (data 0.16.0); null voor de rest. */
  siege: SiegeData | null;
  /** Slaaf (data 0.21.0): arbeider die nooit vecht, werkt binnen de Kooi-straal en bevrijdbaar is. */
  slave: boolean;
  /** Slaver (data 0.21.0); null voor de rest. */
  capture: CaptureData | null;
  /** Chem-dealer (data 0.21.0); null voor de rest. */
  aura: UnitAuraData | null;
  /** Sight radius from the unit's centre (data 0.22.0, fog of war): sightM, else sim.json vision.unitSightM. */
  sightU: number;
}

export interface RepairData {
  /** Herstel in duizendsten hp per tick (12 hp/s is 600): optellen, per 1000 een hele hp. */
  milliHpPerTick: number;
  rangeU: number;
  seekRangeU: number;
  /** Indices in REPAIR_TARGETS. */
  targets: number[];
}

export interface SiegeData {
  /** Extra schade tegen gebouwen in promille (1500 = 150 procent extra), bovenop de damage-matrix. */
  vsBuildingsPermille: number;
  buildingsFirst: boolean;
}

export interface TurretNetworkData {
  /** tech-id die het netwerk activeert. */
  requiresTech: number;
  radiusU: number;
  /** Promille extra schade per andere eigen voltooide turret binnen radiusU. */
  damagePermillePerTurret: number;
  /** Bovengrens van de netwerkbonus in promille. */
  maxDamagePermille: number;
}

export interface BuildingData {
  id: number;
  key: string;
  factionId: number;
  hpI: number;
  armorType: number;
  scrapCost: number;
  buildTicks: number;
  footprint: { w: number; h: number }; // cellen van 1 m
  beds: number;
  provides: number[]; // indices in PROVIDES
  prereqTech: number[];
  visuals: { mesh: string };
  /** Alleen turrets; 0 voor de rest. */
  damage: number;
  damageType: number; // index in DAMAGE_TYPES
  rangeU: number;
  cooldownTicks: number;
  /** Turret-netwerk (data 0.16.0); null voor een gebouw zonder. */
  network: TurretNetworkData | null;
  /** Kooi (data 0.21.0, provides kooi); null voor de rest. */
  cage: CageData | null;
  /** Afstand tot het eigen hoofdgebouw (data 0.21.0); null zonder regel. */
  placement: { minFromHqU: number; maxFromHqU: number } | null;
  /**
   * Sight beyond the footprint edge (data 0.22.0, fog of war): sightM, else rangeM + vision.turretSightExtraM for a
   * turret, else vision.buildingSightM. The sim adds half the larger footprint side to get a radius from the centre.
   */
  sightU: number;
}

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
  } | null;
  /** Spending rules for the tech tree (data 0.17.0); null without. */
  reserve: { fromTicks: number; minArmy: number; robotsFirstFromTicks: number } | null;
  /** SPECIAL training of the AI (data 0.17.0): training-program ids in order; null without. */
  training: { sequence: number[]; fromTicks: number } | null;
  /** Roofplan van het Raider-script (data 0.21.0); null zonder. */
  raidPlan: RaidPlanData | null;
  /** When the AI clears creep camps (data 0.25.0); null = never. */
  creeps: AiCreepsData | null;
  /** Data 0.24.0 (proposal): the opponent faction this script is for; -1 = the faction's default script. */
  versusFactionId: number;
  /** Data 0.24.0 (proposal): liberation of enemy-held slaves; null without. */
  liberate: { minFree: number; units: number; radiusU: number } | null;
  /** Data 0.24.0 (proposal): an enemy at the headquarters draws every militia and robot not on a push. */
  defendHqFirst: boolean;
  allInWithoutNodes: boolean;
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

/** data/creeps.json (data 0.25.0). The bandit loadouts themselves are in GameData.loadouts (factionId NEUTRAL_FACTION_ID). */
export interface CreepsData {
  /** Loadout ids of the bandits, in the order of creeps.json units. */
  units: number[];
  /** Dutch name of each bandit (creeps.json naam), in the same order as units: for the selection panel. */
  names: string[];
  /** Sorted by tier. */
  tiers: CreepTierData[];
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
  /** damageMatrix[damageTypeIndex][armorTypeIndex] = multiplier in promille (1000 = 100 procent). */
  damageMatrix: number[][];
  sim: SimTuningData;
}

/** Dominantie-regel van een map in sim-eenheden (maps worden door packages/map geladen; deze omrekening is de enige plek). */
export interface DominanceData {
  pointsRequired: number;
  /** Tijdslimiet in ticks. */
  ticks: number;
}

/** Rekent MapDef.dominance om naar sim-eenheden. */
export function convertDominance(d: { pointsRequired: number; minutes: number }): DominanceData {
  return { pointsRequired: d.pointsRequired, ticks: secondsToTicks(d.minutes * 60) };
}

function parseWith<S extends ZodTypeAny>(file: string, schema: S, value: unknown): z.infer<S> {
  const result = schema.safeParse(value);
  if (result.success) return result.data as z.infer<S>;
  throw new Error(`data/${file}: ${formatZodError(result.error)}`);
}

function formatZodError(error: ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
}

function parseList<S extends ZodTypeAny>(file: string, schema: S, value: unknown): z.infer<S>[] {
  if (!Array.isArray(value)) throw new Error(`data/${file}: verwacht een array`);
  return value.map((item: unknown, index: number) => parseWith(`${file}[${index}]`, schema, item));
}

const compareIds = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Sorteert op string-id (tiebreak is de id zelf; dubbele ids zijn een fout) en geeft record plus numerieke id. */
function sortById<T extends { id: string }>(file: string, records: T[]): T[] {
  const sorted = [...records].sort((a, b) => compareIds(a.id, b.id));
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.id === sorted[i - 1]!.id)
      throw new Error(`data/${file}: dubbele id '${sorted[i]!.id}'`);
  }
  return sorted;
}

type IdIndex = ReadonlyMap<string, number>;

function indexOf(records: { id: string }[]): IdIndex {
  const map = new Map<string, number>();
  records.forEach((record, i) => map.set(record.id, i));
  return map;
}

function ref(index: IdIndex, what: string, where: string, key: string): number {
  const found = index.get(key);
  if (found === undefined) throw new Error(`${where}: onbekende ${what} '${key}'`);
  return found;
}

/** Omrekening van een effect-delta op basis van het stat-suffix: Pct naar promille, M naar eenheden, S naar ticks. */
export function convertDelta(stat: EffectStat, delta: number): number {
  if (stat.length === 1) return Math.trunc(delta); // SPECIAL-letter, geen suffix
  if (stat.endsWith('Pct')) return pctToPermille(delta);
  if (stat.endsWith('M')) return metersToUnits(delta);
  if (stat.endsWith('S')) return secondsToTicks(delta);
  return Math.trunc(delta);
}

const convertEffects = (
  effects: { stat: EffectStat; target: string; delta: number }[],
): EffectData[] =>
  effects.map((e) => ({ stat: e.stat, target: e.target, delta: convertDelta(e.stat, e.delta) }));

/** Cumulatieve som van xp per stap: [100, 200] wordt [100, 300]. */
export function cumulate(steps: readonly number[]): number[] {
  const out: number[] = [];
  let total = 0;
  for (const step of steps) {
    total += step;
    out.push(total);
  }
  return out;
}

function parseVersion(version: string): { text: string; packed: number } {
  const text = version.trim();
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (!match) throw new Error(`data/VERSION: ongeldige semver '${text}'`);
  return { text, packed: Number(match[1]) * 1000000 + Number(match[2]) * 1000 + Number(match[3]) };
}

/**
 * Valideert en converteert de ruwe data naar GameData (sim-eenheden, numerieke ids).
 * Gooit een Error met bestandsnaam en pad bij elke ongeldigheid (onbekend veld, dangling referentie, dubbele id).
 * Pure functie: zelfde input geeft altijd gelijke output.
 */
export function loadGameData(raw: RawGameData): GameData {
  const version = parseVersion(raw.version);

  const factionsRaw = sortById('factions.json', parseList('factions.json', Faction, raw.factions));
  const loadoutsRaw = sortById('loadouts.json', parseList('loadouts.json', Loadout, raw.loadouts));
  const buildingsRaw = sortById(
    'buildings.json',
    parseList('buildings.json', Building, raw.buildings),
  );
  const techRaw = sortById('tech.json', parseList('tech.json', Tech, raw.tech));
  const heroesRaw = sortById('heroes.json', parseList('heroes.json', Hero, raw.heroes));
  const perksRaw = sortById('perks.json', parseList('perks.json', Perk, raw.perks));
  const trainingRaw = sortById('training.json', parseList('training.json', Training, raw.training));
  const matrixRaw = parseWith('damage-matrix.json', DamageMatrix, raw.damageMatrix);
  const simRaw = parseWith('sim.json', SimTuning, raw.sim);
  const aiRaw = sortById(
    'ai/*.json',
    raw.ai.map((item, index) => parseWith(`ai/[${index}]`, AiScript, item)),
  );

  const factionIx = indexOf(factionsRaw);
  const loadoutIx = indexOf(loadoutsRaw);
  const buildingIx = indexOf(buildingsRaw);
  const techIx = indexOf(techRaw);
  const perkIx = indexOf(perksRaw);
  const trainingIx = indexOf(trainingRaw);

  const idx = <T extends readonly string[]>(options: T, value: T[number]): number =>
    options.indexOf(value);

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
                garrisonRadiusU: metersToUnits(f.slaves.revolt.garrisonRadiusM),
                slavesPerGuard: f.slaves.revolt.slavesPerGuard,
                minGuards: f.slaves.revolt.minGuards,
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
    };
  });

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
    };
  });

  // Creep camps (data 0.25.0): the bandit loadouts follow the faction loadouts (ids loadoutsRaw.length + k, in the
  // order of creeps.json units), so no faction loadout changes id; their faction is NEUTRAL_FACTION_ID.
  const creepsRaw =
    raw.creeps === undefined
      ? { units: [], tiers: [] }
      : parseWith('creeps.json', Creeps, raw.creeps);
  const creepIx = new Map<string, number>();
  creepsRaw.units.forEach((u, k) => {
    if (loadoutIx.has(u.id) || creepIx.has(u.id))
      throw new Error(`data/creeps.json: dubbele id '${u.id}'`);
    creepIx.set(u.id, loadoutsRaw.length + k);
  });
  for (const u of creepsRaw.units) {
    loadouts.push({
      id: creepIx.get(u.id)!,
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
    });
  }
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
  };

  const buildings: BuildingData[] = buildingsRaw.map((b, id) => {
    const where = `data/buildings.json '${b.id}'`;
    return {
      id,
      key: b.id,
      factionId: ref(factionIx, 'factie', where, b.faction),
      hpI: Math.trunc(b.hp),
      armorType: idx(ARMOR_TYPES, b.armorType),
      scrapCost: Math.trunc(b.scrapCost),
      buildTicks: secondsToTicks(b.buildS),
      footprint: { w: b.footprint.w, h: b.footprint.h },
      beds: b.beds,
      provides: b.provides.map((p) => idx(PROVIDES, p)),
      prereqTech: b.prereqTech.map((t) => ref(techIx, 'tech', where, t)),
      visuals: { mesh: b.visuals.mesh },
      damage: Math.trunc(b.damage ?? 0),
      damageType: b.damageType === undefined ? 0 : idx(DAMAGE_TYPES, b.damageType),
      rangeU: metersToUnits(b.rangeM ?? 0),
      cooldownTicks: secondsToTicks(b.cooldownS ?? 0),
      network:
        b.network === undefined
          ? null
          : {
              requiresTech: ref(techIx, 'tech', `${where} network`, b.network.requiresTech),
              radiusU: metersToUnits(b.network.radiusM),
              damagePermillePerTurret: pctToPermille(b.network.damagePctPerTurret),
              maxDamagePermille: pctToPermille(b.network.maxDamagePct),
            },
      cage:
        b.cage === undefined
          ? null
          : {
              capacity: b.cage.capacity,
              transitionTicks: secondsToTicks(b.cage.transitionS),
              workRadiusU: metersToUnits(b.cage.workRadiusM),
            },
      placement:
        b.placement === undefined
          ? null
          : {
              minFromHqU: metersToUnits(b.placement.minFromHqM),
              maxFromHqU: metersToUnits(b.placement.maxFromHqM),
            },
      sightU: metersToUnits(
        b.sightM ??
          (b.provides.includes('turret')
            ? (b.rangeM ?? 0) + simRaw.vision.turretSightExtraM
            : simRaw.vision.buildingSightM),
      ),
    };
  });

  const tech: TechData[] = techRaw.map((t, id) => {
    const where = `data/tech.json '${t.id}'`;
    return {
      id,
      key: t.id,
      factionId: ref(factionIx, 'factie', where, t.faction),
      scrapCost: Math.trunc(t.scrapCost),
      researchTicks: secondsToTicks(t.researchS),
      buildingId: ref(buildingIx, 'gebouw', where, t.building),
      prereqTech: t.prereqTech.map((p) => ref(techIx, 'tech', where, p)),
      effects: convertEffects(t.effects),
    };
  });

  const heroes: HeroData[] = heroesRaw.map((h, id) => {
    const where = `data/heroes.json '${h.id}'`;
    return {
      id,
      key: h.id,
      factionId: ref(factionIx, 'factie', where, h.faction),
      archetype: idx(ARCHETYPES, h.archetype),
      special: [
        h.special.S,
        h.special.P,
        h.special.E,
        h.special.C,
        h.special.I,
        h.special.A,
        h.special.L,
      ],
      naam: h.naam,
      xpThresholds: cumulate(h.xpPerLevel),
      xpPerKill: h.xpPerKill,
      xpPerDiscovery: h.xpPerDiscovery,
      xpPerAssist: h.xpPerAssist,
      xpAssistRadiusU: metersToUnits(h.xpAssistRadiusM),
      abilities: h.abilities.map((a) => ({
        id: a.id,
        naam: a.naam,
        cooldownTicks: secondsToTicks(a.cooldownS),
        rangeU: metersToUnits(a.rangeM),
        radiusU: metersToUnits(a.radiusM),
        durationTicks: secondsToTicks(a.durationS),
        effects: a.effects.map((e) => ({
          stat: e.stat,
          side: e.side,
          target: e.target,
          delta: convertDelta(e.stat, e.delta),
        })),
      })),
      passives: convertEffects(h.passives),
      aura:
        h.aura === undefined
          ? null
          : {
              radiusU: metersToUnits(h.aura.radiusM),
              effects: h.aura.effects.map((e) => ({
                stat: e.stat,
                side: e.side,
                target: e.target,
                delta: convertDelta(e.stat, e.delta),
              })),
            },
      xpPerCapture: h.xpPerCapture ?? 0,
      baseLoadoutId:
        h.baseLoadoutId === undefined
          ? -1
          : ref(loadoutIx, 'loadout', `${where} baseLoadoutId`, h.baseLoadoutId),
      perkPool: h.perkPool.map((p) => ref(perkIx, 'perk', where, p)),
      reviveScrap: Math.trunc(h.reviveScrap),
      reviveTicks: secondsToTicks(h.reviveS),
      revivePenaltyPermille: pctToPermille(h.revivePenaltyPct),
      maxRevives: h.maxRevives,
      sightU: metersToUnits(h.sightM ?? simRaw.vision.heroSightM),
    };
  });

  const perks: PerkData[] = perksRaw.map((p, id) => ({
    id,
    key: p.id,
    naam: p.naam,
    flavourText: p.flavourText,
    requires: { stat: idx(STATS, p.requires.stat), min: p.requires.min },
    effects: convertEffects(p.effects),
  }));

  const training: TrainingProgramData[] = trainingRaw.map((t, id) => {
    const where = `data/training.json '${t.id}'`;
    return {
      id,
      key: t.id,
      factionId: ref(factionIx, 'factie', where, t.faction),
      special: idx(STATS, t.special),
      buildingId: ref(buildingIx, 'gebouw', where, t.building),
      scrapCost: Math.trunc(t.scrapCost),
      scrapCostStep: Math.trunc(t.scrapCostStep),
      trainTicks: secondsToTicks(t.trainS),
      trainTicksStep: secondsToTicks(t.trainSStep),
      pointsPerRun: t.pointsPerRun,
      maxPoints: t.maxPoints,
      prereqTech: t.prereqTech.map((p) => ref(techIx, 'tech', where, p)),
    };
  });

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
              harass: {
                loadoutId: ref(
                  loadoutIx,
                  'loadout',
                  `${where} raidPlan harass`,
                  a.raidPlan.harass.loadoutId,
                ),
                fromTicks: secondsToTicks(a.raidPlan.harass.fromS),
                max: a.raidPlan.harass.max,
                retreatHpPermille: pctToPermille(a.raidPlan.harass.retreatHpPct),
                targets: a.raidPlan.harass.targets,
              },
              slaveRaids: {
                slaverLoadoutId: ref(
                  loadoutIx,
                  'loadout',
                  `${where} raidPlan slaveRaids`,
                  a.raidPlan.slaveRaids.slaverLoadoutId,
                ),
                fromTicks: secondsToTicks(a.raidPlan.slaveRaids.fromS),
                slavers: a.raidPlan.slaveRaids.slavers,
                escort: a.raidPlan.slaveRaids.escort,
                maxRaidTicks: secondsToTicks(a.raidPlan.slaveRaids.maxRaidS),
                retryTicks: secondsToTicks(a.raidPlan.slaveRaids.retryS),
              },
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
      versusFactionId: a.versus === undefined ? -1 : ref(factionIx, 'factie', where, a.versus),
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
    damageMatrix,
    sim: {
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
    },
  };
}
