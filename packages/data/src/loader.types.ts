import {
  Archetype,
  ArmorType,
  BodyType,
  CaptureTarget,
  DamageType,
  Provides,
  RepairTarget,
  Role,
  Stat,
  type EffectStat,
} from './schemas.js';
import type { AbilityEffectData } from './loader.types.game.js';

// Part of the pure loader (see loader.ts): no IO, no clock; falls under the determinism lint.
// Input shape, enum orders and the faction, loadout and building records of GameData.

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
  /** Contents of data/project.json (data 0.31.0, win route C); absent = no Bouwproject. */
  project?: unknown;
  /** Contents of data/survival/units.json and waves.json (data 0.33.0, Survival co-op); absent = no survival mode. */
  survival?: { units: unknown; waves: unknown };
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
  /** The guard rule (data 0.29.0; voorstel, ter bevestiging door content en de architect; data/README.md). */
  revolt: {
    cageNearU: number;
    guardRadiusU: number;
    cageGuards: number;
    guardModeSlavesPerGuard: number;
    noCageGuards: number;
    noCageSlaves: number;
    escapeU: number;
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
  /** Null = no harass (data 0.38.0). */
  harass: {
    loadoutId: number;
    fromTicks: number;
    max: number;
    retreatHpPermille: number;
    targets: 'gatherers';
  } | null;
  /** Null = no slave raids (data 0.38.0). */
  slaveRaids: {
    slaverLoadoutId: number;
    fromTicks: number;
    slavers: number;
    escort: number;
    maxRaidTicks: number;
    retryTicks: number;
  } | null;
  /** Data 0.38.0 (proposal): free workers by Produce up to `scavengers`; null = the workers are slaves. */
  workers: { scavengers: number } | null;
  /** Data 0.38.0 (proposal): the fighter mix strictly in cycle order; false when absent. */
  mixInOrder: boolean;
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
  /** Veteran promotion (data 0.38.0, the Garde; proposal); null without. */
  veterancy: VeterancyData | null;
  /** Fusion cores (data 0.38.0, the Garde; proposal); null without. */
  fusionCores: FusionCoresData | null;
}

export interface VeterancyData {
  /** Loadout ids that gain ranks. */
  loadouts: number[];
  /** Ascending kills; hp and damage in permille. */
  ranks: { key: string; kills: number; hpPermille: number; damagePermille: number }[];
}

export interface FusionCoresData {
  buildingId: number;
  scrapCost: number;
  craftTicks: number;
  maxStock: number;
  prereqTech: number[];
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
  /** Data 0.26.0 (voorstel, ter bevestiging door de architect): a robot that builds like a builder (canBuild). */
  canBuild: boolean;
  /** Data 0.38.0 (proposal): fusion cores taken from the stock when the production starts; 0 = none. */
  fusionCores: number;
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
