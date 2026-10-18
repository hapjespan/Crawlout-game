import type { SimSurvivalMap } from './config.survival.js';
/** Punt in sim-eenheden (1 m = 256). */
export interface SimPoint {
  readonly x: number;
  readonly y: number;
}

export interface SimScrapNode extends SimPoint {
  readonly amount: number;
}

export interface SimClaimPoint extends SimPoint {
  /** Index in CLAIM_KINDS (fromData.ts). Informatief; elk claimpunt telt mee voor dominantie. */
  readonly kind: number;
}

/** Map plus features. Posities in sim-eenheden; passable in cellen van 1 m (256 eenheden), rij voor rij. */
export interface SimMap {
  readonly w: number;
  readonly h: number;
  /** 1 = begaanbaar, 0 = geblokkeerd. Gebouwen blokkeren daarbovenop cellen in de sim zelf. */
  readonly passable: Uint8Array;
  /** Startposities; spawns[i] hoort bij playerId i. */
  readonly spawns: readonly SimPoint[];
  readonly scrapNodes: readonly SimScrapNode[];
  readonly claimPoints: readonly SimClaimPoint[];
  /** Winroute B: pointsRequired claimpunten gedurende ticks vasthouden. */
  readonly dominance: { readonly pointsRequired: number; readonly ticks: number };
  /**
   * Creep camps (sim 0.20.0, data 0.25.0; bevestigd in fase-0 sectie 23 besluit 5): the centre of each bandit camp
   * and its tier (SimConfig.creepTiers). Absent or empty = no camps (the programmatic test maps).
   */
  readonly creepCamps?: readonly SimCreepCamp[];
  /**
   * Win route C, Bouwproject (sim 0.25.0, data 0.31.0; voorstel, ter bevestiging door de architect): the ruined parts
   * of the strip mall, in map order. Absent or empty = no Bouwproject (the game type Skirmish, the test maps).
   */
  readonly projectSites?: readonly SimProjectSite[];
  /**
   * Survival co-op (sim 0.27.0; voorstel, ter bevestiging door de architect): edges and build zones of the game type
   * Survival (MatchSettings.mode 'survival'). Absent = no survival (Skirmish, Bouwproject, the test maps).
   */
  readonly survival?: SimSurvivalMap;
}

/** A part of the strip mall on the map: the centre of its footprint (units, a cell centre) and its kind. */
export interface SimProjectSite extends SimPoint {
  /** Index in SimConfig.project.parts. */
  readonly kind: number;
}

/** One kind of part of the Bouwproject (data/project.json parts) in sim units. */
export interface SimProjectPart {
  /** Building type of the restored part (beds, sight, hp; buildTicks and scrapCost are the restore). */
  readonly restoredTypeId: number;
  /** Building type of the ruin: same footprint, neutral, never a target. */
  readonly ruinTypeId: number;
  /** For the holder of a restored part of this kind, like a researched tech (counted once per kind). */
  readonly effects: readonly SimEffect[];
}

/** Win route C (data/project.json): the countdown, the pause after a hit, the kinds of part. */
export interface SimProject {
  readonly countdownTicks: number;
  readonly pauseTicks: number;
  readonly parts: readonly SimProjectPart[];
}

/** A creep camp of the map: its centre (units) and tier. */
export interface SimCreepCamp extends SimPoint {
  readonly tier: number;
}

/** One tier of creep camp (data/creeps.json tiers) in sim units. */
export interface SimCreepTier {
  readonly tier: number;
  /** Unit typeIds of the bandits (neutral loadouts), one per bandit, in order. */
  readonly typeIds: readonly number[];
  readonly aggroRadius: number;
  readonly leashRadius: number;
  /** 0 = a cleared camp stays empty. */
  readonly respawnTicks: number;
  readonly lootScrap: number;
  readonly heroXp: number;
  readonly heroXpRadius: number;
}

/**
 * Camp takeover of one faction (data/creeps.json takeover, data 0.27.0, sim 0.22.0; voorstel, ter bevestiging door de
 * architect): per camp tier the surrender rule and the outpost yield (systems/creeps.ts).
 */
export interface SimCreepTakeover {
  readonly factionId: number;
  /** Ascending tier, each a tier of SimConfig.creepTiers. */
  readonly tiers: readonly {
    readonly tier: number;
    /** The camp surrenders at this share (0..1000) of the summed max hp of its living bandits. */
    readonly surrenderPermille: number;
    /** Units of the taker within the leash circle needed. */
    readonly minUnits: number;
    /** A bandit for the owner of the outpost every this many ticks; 0 = none. */
    readonly yieldTicks: number;
    readonly yieldMax: number;
  }[];
}

/** The faction of a neutral unit type (the bandits of the creep camps, data 0.25.0). */
export const NEUTRAL_FACTION = -1;

/** Eén unittype (body plus loadout) in sim-eenheden. typeId = unitTypeId(loadoutId) uit @crawlout/data. */
export interface SimUnitType {
  readonly typeId: number;
  readonly loadoutId: number;
  readonly factionId: number;
  readonly bodyType: number;
  /** Index in ROLES: 0 scavenger, 1 builder, 2 militia. */
  readonly role: number;
  readonly armorType: number;
  readonly maxHp: number;
  readonly speed: number; // eenheden per tick
  readonly radius: number; // eenheden, voor separatie
  readonly damage: number;
  readonly damageType: number;
  readonly range: number; // eenheden
  readonly cooldown: number; // ticks tussen twee schoten
  readonly gatherAmount: number; // scrap per rit, 0 = verzamelt niet
  readonly gatherTicks: number;
  readonly scrapCost: number; // kosten van omscholen in de werkplaats
  readonly craftTicks: number;
  readonly popCost: number;
  /** Tech-ids die de speler onderzocht moet hebben voor Craft of SetRole naar dit type. */
  readonly prereqTech: readonly number[];
  /**
   * Robots (data 0.16.0): gebouw-typeId waar dit type nieuw gebouwd wordt (Produce), 0 = omscholen van een bewoner in
   * de werkplaats (Craft). Een unit van een type met producedAtTypeId !== 0 is een robot: geen bed, geen omscholing.
   */
  readonly producedAtTypeId: number;
  /** Support-robot die repareert, of null. */
  readonly repair: SimRepair | null;
  /** Belegering, of null. */
  readonly siege: SimSiege | null;
  /** Sight radius from the unit's centre (units; fog of war, data 0.22.0). The hero uses SimHero.sight instead. */
  readonly sight: number;
  /**
   * Raiders (sim 0.18.0, data 0.21.0 loadouts slave): a worker that never fights, is bound to a Kooi, works only within
   * its work radius and can be liberated (systems/slaves.ts).
   */
  readonly slave: boolean;
  /** Slaver (data 0.21.0 loadouts capture), or null. */
  readonly capture: SimCapture | null;
  /** Chem-dealer (data 0.21.0 loadouts aura), or null. */
  readonly aura: SimUnitAura | null;
  /**
   * Data 0.26.0 (voorstel, ter bevestiging door de architect; loadouts canBuild): a robot that builds like a builder
   * (Build, Claim, help at a site, resume a site; systems/common.ts canBuild). False for every other type.
   */
  readonly canBuild: boolean;
}

/** Capture (Slaver, data 0.21.0): catches a beaten-down human of another player (or a neutral wanderer). */
export interface SimCapture {
  /** Reach to the target (to its edge, as a weapon range). */
  readonly range: number;
  /** Ticks the Slaver holds the target within range, uninterrupted. */
  readonly captureTicks: number;
  /** Neutral wanderers (escaped slaves) may be caught. */
  readonly wanderers: boolean;
  /** Units of another player may be caught (outside their owner's base radius). */
  readonly residents: boolean;
  /** Only a target at or below this share of its max hp, in permille. */
  readonly maxHpPermille: number;
}

/** Chem-dealer aura (data 0.21.0): doses own units around it in a fight. */
export interface SimUnitAura {
  readonly radius: number;
  /** Indices in SimFaction.chems of the dealer's faction, in order of preference. */
  readonly chems: readonly number[];
}

/** Reparatie (data 0.16.0, loadouts repair): een vrije unit zoekt zelf een beschadigd eigen doel en herstelt het. */
export interface SimRepair {
  /** Herstel in duizendsten hp per tick. */
  readonly milliHpPerTick: number;
  /** Afstand (tot de rand van een footprint, of de rand van een unit) waarbinnen hij repareert. */
  readonly range: number;
  /** Afstand waarbinnen een vrije unit zelf een doel zoekt. */
  readonly seekRange: number;
  readonly buildings: boolean;
  readonly robots: boolean;
}

/** Belegering (data 0.16.0, loadouts siege). */
export interface SimSiege {
  /** Extra schade tegen gebouwen in promille, bovenop de damage-matrix. */
  readonly vsBuildingsPermille: number;
  /** Kiest zelf eerst gebouwen als doel (anders units eerst, zoals iedereen). */
  readonly buildingsFirst: boolean;
}

/** Turret-netwerk (data 0.16.0, buildings network). */
export interface SimTurretNetwork {
  readonly requiresTech: number;
  /** Midden tot midden, grens inclusief. */
  readonly radius: number;
  readonly damagePermillePerTurret: number;
  readonly maxDamagePermille: number;
}

/** Trainingsprogramma (data 0.16.0, training.json). Op programId: training[k].programId === k. */
export interface SimTraining {
  readonly programId: number;
  readonly factionId: number;
  /** Index in de SPECIAL-volgorde S P E C I A L. */
  readonly special: number;
  readonly buildingTypeId: number;
  readonly scrapCost: number;
  readonly scrapCostStep: number;
  readonly trainTicks: number;
  readonly trainTicksStep: number;
  readonly pointsPerRun: number;
  readonly maxPoints: number;
  readonly prereqTech: readonly number[];
}

/** Eén gebouwtype. typeId = buildingTypeId(buildingId) uit @crawlout/data. */
export interface SimBuildingType {
  readonly typeId: number;
  readonly buildingId: number;
  readonly factionId: number;
  readonly maxHp: number;
  readonly armorType: number;
  readonly scrapCost: number;
  readonly buildTicks: number;
  readonly footprintW: number; // cellen
  readonly footprintH: number;
  readonly beds: number;
  /** Bitmasker over PROVIDES (packages/data): bit k = PROVIDES[k]. */
  readonly provides: number;
  readonly prereqTech: readonly number[];
  /**
   * Wapen van een turret (besluit 8, fase-0 sectie 14): damage > 0 geeft het voltooide gebouw Combat. Het kiest zelf
   * een vijand binnen range (eenheden, vanaf het midden) en schiet elke cooldown ticks. 0 voor gebouwen zonder wapen.
   */
  readonly damage: number;
  readonly damageType: number;
  readonly range: number;
  readonly cooldown: number;
  /** Turret-netwerk (data 0.16.0), of null. */
  readonly network: SimTurretNetwork | null;
  /** Sight beyond the footprint edge (units; fog of war, data 0.22.0); the radius from the centre adds half the larger side. */
  readonly sight: number;
  /** Kooi (data 0.21.0, provides kooi): slaves bound here, the transition of a captive, the work radius; or null. */
  readonly cage: SimCage | null;
  /** Placement rule (data 0.21.0): centre-to-centre distance to an own headquarters within [min, max]; or null. */
  readonly hqRange: { readonly min: number; readonly max: number } | null;
}

/** Kooi (data 0.21.0, buildings cage). */
export interface SimCage {
  /** Slaves (and captives on their way) bound to this cage at most. */
  readonly capacity: number;
  /** Ticks a captive stands at the cage before it is a slave. */
  readonly transitionTicks: number;
  /** A slave of this cage gathers and builds only within this distance of it (centre to node, centre to footprint). */
  readonly workRadius: number;
}

/** Doel van een effect: alles van de speler, de held, of één unit- of gebouwtype (typeId). */
export const EFFECT_TARGET_ALL = 0;
export const EFFECT_TARGET_HERO = 1;
export const EFFECT_TARGET_TYPE = 2;

/**
 * Eén effect van een tech of perk (contract 3, effects[]). stat is de index in EFFECT_STATS (EffectStat in packages/data);
 * delta in sim-eenheden: Pct-stats promille, M-stats eenheden, S-stats ticks, SPECIAL-letters ruw.
 */
export interface SimEffect {
  readonly stat: number;
  /** EFFECT_TARGET_*. */
  readonly target: number;
  /** Unit- of gebouw-typeId bij EFFECT_TARGET_TYPE, anders 0. */
  readonly typeId: number;
  readonly delta: number;
}

/** Eén tech (tech.json). Op techId: techs[k].techId === k. */
export interface SimTech {
  readonly techId: number;
  readonly factionId: number;
  readonly scrapCost: number;
  readonly researchTicks: number;
  /** Gebouwtype waarin de tech onderzocht wordt (lab, werkplaats). */
  readonly buildingTypeId: number;
  readonly prereqTech: readonly number[];
  readonly effects: readonly SimEffect[];
}

/** Eén perk (perks.json). Op perkId: perks[k].perkId === k. */
export interface SimPerk {
  readonly perkId: number;
  /** Index in de SPECIAL-volgorde S P E C I A L. */
  readonly requiresStat: number;
  readonly requiresMin: number;
  readonly effects: readonly SimEffect[];
}

/** Kant en doel van een ability-effect (heroes.json abilities[].effects[]). */
export const AURA_SIDE_ENEMY = 0;
export const AURA_SIDE_ALLY = 1;
export const AURA_TARGET_UNITS = 0;
export const AURA_TARGET_TURRETS = 1;
export const AURA_TARGET_ALL = 2;

/** Effect van een ability op alles binnen de straal zolang de zone duurt. Alleen speed- en damage-stats (STAT in effects.ts). */
export interface SimAuraEffect {
  readonly stat: number;
  readonly side: number;
  readonly target: number;
  /** Promille. */
  readonly delta: number;
}

export interface SimAbility {
  readonly cooldownTicks: number;
  /** Max afstand van de held tot het doelpunt (0 = op de held). */
  readonly rangeU: number;
  readonly radiusU: number;
  readonly durationTicks: number;
  readonly effects: readonly SimAuraEffect[];
}

/** Eén held (heroes.json). Op heroId: heroes[k].heroId === k. typeId = heroTypeId(heroId) uit @crawlout/data. */
export interface SimHero {
  readonly heroId: number;
  readonly typeId: number;
  readonly factionId: number;
  /** Unittype dat lichaam, wapen en basisstats levert (het militie-loadout van de factie); SPECIAL schaalt daarop. */
  readonly baseTypeId: number;
  /** S P E C I A L. */
  readonly special: readonly number[];
  /** Cumulatieve xp per level: xpThresholds[k] = xp voor level k + 2. */
  readonly xpThresholds: readonly number[];
  readonly xpPerKill: number;
  readonly xpPerDiscovery: number;
  /** xp per vijandelijke unit die een eigen unit of turret (niet de held zelf) doodt binnen xpAssistRadius van de levende held. */
  readonly xpPerAssist: number;
  readonly xpAssistRadius: number;
  readonly abilities: readonly SimAbility[];
  /** Passieve effecten voor de speler zolang de held leeft (data 0.16.0), met de semantiek van perk-effecten. */
  readonly passives: readonly SimEffect[];
  /** perkIds waaruit de held kiest. */
  readonly perkPool: readonly number[];
  readonly reviveScrap: number;
  readonly reviveTicks: number;
  /** Per keer oplappen gaat dit deel van perks en health weg, in promille. */
  readonly revivePenaltyPermille: number;
  readonly maxRevives: number;
  /** Sight radius of the living hero (units; fog of war, data 0.22.0). */
  readonly sight: number;
  /** Aura around the living hero (data 0.21.0, the Warlord's intimidation): speed and damage, like an ability zone. */
  readonly aura: { readonly radius: number; readonly effects: readonly SimAuraEffect[] } | null;
  /** xp for every capture by an own Slaver (data 0.21.0). */
  readonly xpPerCapture: number;
}

/** SPECIAL van de held, per punt van de letter (sim.json, ter review). */
export interface SimSpecialTuning {
  readonly strengthDamagePermille: number;
  readonly perceptionRangeU: number;
  readonly enduranceHpPermille: number;
  readonly charismaGrowthPermille: number;
  readonly intelligenceResearchPermille: number;
  readonly agilitySpeedPermille: number;
  readonly luckCritPermille: number;
  readonly critDamagePermille: number;
}
