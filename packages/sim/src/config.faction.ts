import type { SimEffect } from './config.types.js';

export interface SimFaction {
  readonly factionId: number;
  /** In bestandsvolgorde (contract 2, startopstelling). */
  readonly startUnits: readonly { readonly typeId: number; readonly count: number }[];
  readonly startScrap: number;
  /** Bewoners per minuut zolang er vrije bedden zijn; de sim telt per tick op tot ticksPerMinute. */
  readonly housingGrowthPerMin: number;
  /** Het hoofdgebouw (provides hq) dat in start() op de spawn komt. */
  readonly hqTypeId: number;
  /** Unittype van een nieuwe bewoner uit huisvestingsgroei; 0 = geen groei. */
  readonly settlerTypeId: number;
  /** Per rol (index in ROLES) het unittype waar SetRole naartoe omschoolt; 0 = niet beschikbaar. */
  readonly roleTypeIds: readonly number[];
  /** Index in SimConfig.aiScripts voor AI-spelers van deze factie, -1 = geen script. */
  readonly aiScript: number;
  /**
   * Data 0.24.0 (proposal, to be confirmed by the architect; ai/*.json versus): per opponent factionId the script index
   * an AI of this faction plays against that opponent, -1 = aiScript. Length = factions.length.
   */
  readonly aiScriptVersus: readonly number[];
  /** Het gebouw dat het Claim-commando bouwt (provides claim, geen hoofdgebouw); 0 = geen. */
  readonly claimTypeId: number;
  /** De held van deze factie (index in SimConfig.heroes), -1 = geen held. */
  readonly heroId: number;
  /**
   * Vangnet (data 0.16.0, safetyNet radiobaken_instroom): onder threshold bewoners en met een voltooid baken komt er elke
   * intervalTicks een bewoner van typeId bij het baken, hoogstens maxArrivals keer per potje. null = geen vangnet.
   */
  readonly safetyNet: {
    /** SAFETY_NET_BEACON (radiobaken_instroom) or SAFETY_NET_TENTS (tenten_instroom, data 0.21.0). */
    readonly action: number;
    readonly threshold: number;
    readonly intervalTicks: number;
    readonly maxArrivals: number;
    readonly typeId: number;
  } | null;
  /** Technicus-regel (data 0.16.0); null voor een factie zonder robots. */
  readonly robotRules: {
    readonly robotsPerTechnician: number;
    /** Indices in ROLES. */
    readonly technicianRoles: readonly number[];
    readonly penaltyPermille: number;
  } | null;
  /** Slave rules (data 0.21.0, Raiders); null for a faction without slaves. */
  readonly slaves: SimSlaveRules | null;
  /** Loot from razed buildings and killed gatherers (data 0.21.0); null without. */
  readonly plunder: SimPlunder | null;
  /** Tribute from held claim points of one kind (data 0.21.0); null without. */
  readonly tribute: SimTribute | null;
  /** Chems of the SPECIAL channel chems (data 0.21.0), by faction-local index; empty for another channel. */
  readonly chems: readonly SimChem[];
  /** Veteran promotion (data 0.38.0, sim 0.32.0, the Garde; proposal); null without. */
  readonly veterancy: SimVeterancy | null;
  /** Fusion cores (data 0.38.0, sim 0.32.0, the Garde; proposal); null without. */
  readonly fusionCores: SimFusionCores | null;
  /** The power armour of the map (data 0.39.0, sim 0.33.0, the Garde; proposal); null without. */
  readonly mapPowerArmor: SimMapPowerArmor | null;
}

/** Map power armour (systems/garde.powerArmor.ts): a frame of typeId for whoever holds a powerArmor claim point. */
export interface SimMapPowerArmor {
  readonly typeId: number;
  readonly respawnTicks: number;
  /** hp and damage of a frame of a player of another faction, in permille (1000 = full). */
  readonly otherQualityPermille: number;
}

/** Veteran promotion (systems/garde.ts): unit types that gain ranks, ranks by ascending kills (permille bonuses). */
export interface SimVeterancy {
  readonly typeIds: readonly number[];
  readonly ranks: readonly {
    readonly kills: number;
    readonly hpPermille: number;
    readonly damagePermille: number;
  }[];
}

/** Fusion cores (systems/garde.ts): crafted one at a time in a completed building of buildingTypeId. */
export interface SimFusionCores {
  readonly buildingTypeId: number;
  readonly scrapCost: number;
  readonly craftTicks: number;
  readonly maxStock: number;
  readonly prereqTech: readonly number[];
}

/** Safety net actions (SimFaction.safetyNet.action). */
export const SAFETY_NET_BEACON = 0;
export const SAFETY_NET_TENTS = 1;

/** Slave rules of a faction (data 0.21.0 factions slaves), in sim units. */
export interface SimSlaveRules {
  /** Unit type a captive becomes after the cage transition. */
  readonly capturedTypeId: number;
  /** A unit of another player is caught only farther than this from its owner's nearest headquarters (centre). */
  readonly minDistanceFromOwnerBase: number;
  readonly touchTicks: number;
  readonly touchRange: number;
  readonly guardRadius: number;
  readonly freedSpeedPermille: number;
  /**
   * The guard rule (data 0.29.0, sim 0.24.0; voorstel, ter bevestiging door content en de architect; systems/slaves.ts
   * revolts): a Kooi within cageNear of a node (node centre to footprint edge) guards the slaves there with cageGuards;
   * a node without one needs ceil(n * noCageGuards / noCageSlaves), or ceil(n / guardModeSlavesPerGuard) with a guard
   * in guard mode on it. Own fighters within guardRadius of the Kooi footprint or a node of the group count as guards.
   */
  readonly cageNear: number;
  readonly revoltGuardRadius: number;
  readonly cageGuards: number;
  readonly guardModeSlavesPerGuard: number;
  readonly noCageGuards: number;
  readonly noCageSlaves: number;
  /** An escaped slave walks this far away from its Kooi or node. */
  readonly escapeDist: number;
  readonly graceTicks: number;
  readonly emptyGraceTicks: number;
  readonly escapePermille: number;
  readonly repeatTicks: number;
}

/** Plunder (data 0.21.0 factions plunder), permille. */
export interface SimPlunder {
  readonly buildingLootPermille: number;
  /** For a razed drop-off building (provides hq, workshop or depot), on top of buildingLootPermille. */
  readonly depotLootMultiplierPermille: number;
  readonly carryLootPermille: number;
  /** Tech id of the bonus, -1 = none. */
  readonly bonusTech: number;
  readonly bonusPermille: number;
}

/** Tribute (data 0.21.0 factions tribute). */
export interface SimTribute {
  /** Index in CLAIM_KINDS (fromData.ts) of the claim points that pay. */
  readonly claimKind: number;
  readonly scrapPerMin: number;
  readonly bonusTech: number;
  readonly bonusPermille: number;
}

/** One chem (data 0.21.0 factions chems), by faction-local index. */
export interface SimChem {
  readonly requiresTech: number;
  readonly doseScrap: number;
  readonly activeTicks: number;
  readonly crashTicks: number;
  readonly cooldownTicks: number;
  /** damagePct and speedPct for every dosed unit (EFFECT_TARGET_ALL), S and A for the hero (EFFECT_TARGET_HERO). */
  readonly effects: readonly SimEffect[];
  readonly crash: readonly SimEffect[];
  /** Refined: with requiresTech the active and crash durations change by these permille; null without. */
  readonly refined: {
    readonly requiresTech: number;
    readonly activePermille: number;
    readonly crashPermille: number;
  } | null;
}

/** Plaats van een gebouw uit de AI-bouwvolgorde (AI_SITES in packages/data). */
export const AI_SITE_HQ = 0;
export const AI_SITE_CLAIM = 1;
export const AI_SITE_FRONT = 2;

/** Scripted AI (ai/*.json, balans speltest 14 oktober). Tijden in ticks, afstanden in eenheden, aandelen in promille. */
export interface SimAiScript {
  /** site: AI_SITE_*. */
  readonly buildOrder: readonly {
    readonly atTick: number;
    readonly typeId: number;
    readonly site?: number;
  }[];
  /** De eerste aanvalsgolven; daarna elke waveIntervalTicks (plus 0..waveJitterTicks via sim.rng). */
  readonly attackTimersTicks: readonly number[];
  /** Deel van de bewoners dat de AI tot militie omschoolt aan het begin, in promille (ai/*.json militiaPct). */
  readonly militiaPermille: number;
  readonly militiaPermilleMax: number;
  readonly militiaPermillePerMin: number;
  readonly threatMilitiaPermille: number;
  readonly builders: number;
  /** Gebouwtype voor extra bedden; 0 = geen. */
  readonly housingTypeId: number;
  readonly housingFreeBeds: number;
  readonly research: readonly number[];
  readonly researchFromTicks: number;
  /** Unit-typeIds voor het leger, in voorkeursvolgorde. */
  readonly armyTypeIds: readonly number[];
  /** Boven deze voorraad: militie omscholen naar armyTypeIds[0] en richBuilds bouwen. */
  readonly richScrap: number;
  readonly richBuilds: readonly { readonly typeId: number; readonly site: number }[];
  readonly scavengersPerNode: number;
  readonly claimFromTicks: number;
  /** Een claimpunt verder dan claimSafeRadius van het hoofdgebouw neemt hij pas vanaf claimFarFromTicks, met escorte. */
  readonly claimSafeRadius: number;
  readonly claimFarFromTicks: number;
  /** An idle hero claims a neutral claim point within this distance by standing there (0 = off; data 0.20.0). */
  readonly heroClaimRadius: number;
  readonly defendRadius: number;
  /** AI_SITE_*: verzamelpunt tussen de golven. */
  readonly rallySite: number;
  readonly rallyRadius: number;
  readonly waveIntervalTicks: number;
  readonly waveJitterTicks: number;
  readonly waveMinArmy: number;
  readonly waveArmyGrowth: number;
  readonly waveMaxWaitTicks: number;
  /** Een golf met minder militie is een raid op claimpunten; vanaf pushMinArmy gaat hij naar het vijandelijke hoofdgebouw. */
  readonly pushMinArmy: number;
  /** Vóór dit frame is elke golf een raid. */
  readonly pushFromTicks: number;
  /** Zonder bruikbare scrap-node gaat elke golf naar het vijandelijke hoofdgebouw, met de plunderaars mee. */
  readonly allInWithoutNodes: boolean;
  /** Robotproductie (data 0.16.0): unit-typeIds cyclisch vanaf fromTicks, tot max levende robots; null = geen. */
  readonly robots: {
    readonly typeIds: readonly number[];
    readonly fromTicks: number;
    readonly max: number;
    /** Data 0.17.0: robots count with their popCost toward waveMinArmy, pushMinArmy and reserve.minArmy. */
    readonly countAsArmy: boolean;
    /** Data 0.17.0: the AI keeps this much pop free for robots (housing only up to popCapMax - reservePop beds). */
    readonly reservePop: number;
    /**
     * Data 0.26.0 (voorstel, ter bevestiging door de architect): builder robots (a type with canBuild) besides typeIds:
     * from fromTicks on up to max of them (alive plus in production); null = none.
     */
    readonly builders: {
      readonly typeId: number;
      readonly max: number;
      readonly fromTicks: number;
    } | null;
  } | null;
  /**
   * Spending rules for the tech tree (data 0.17.0): from fromTicks on, the next research (or training run) that only
   * misses scrap is saved for while the AI has at least minArmy militia and no threat; null = never.
   */
  readonly reserve: {
    readonly fromTicks: number;
    readonly minArmy: number;
    /** From then on robots come before research in the order of goals. */
    readonly robotsFirstFromTicks: number;
  } | null;
  /** SPECIAL training (data 0.17.0): programIds in order (a program n times = up to n points); null = none. */
  readonly training: { readonly programIds: readonly number[]; readonly fromTicks: number } | null;
  /** Raider plan (data 0.21.0 ai raidPlan): the script then runs the Raider AI (systems/aiRaiders.ts); null = Dwellers. */
  readonly raidPlan: SimRaidPlan | null;
  /**
   * Creep camps (data 0.25.0): from fromTicks, with no threat, an idle army of at least minArmy for the camp's tier
   * clears the nearest living camp within maxPath over land (systems/creeps.ts aiCreepRun). Absent or null = never.
   */
  readonly creeps?: {
    readonly fromTicks: number;
    readonly maxPath: number;
    readonly tiers: readonly { readonly tier: number; readonly minArmy: number }[];
  } | null;
  /**
   * Win route C (data 0.31.0, systems/aiProject.ts; voorstel, ter bevestiging door de architect): restore from
   * restoreFromTicks (-1 = never) with an army of restoreMinArmy and no threat, `builders` builders per restore; sabotage
   * an opponent who holds sabotageKinds kinds (or runs his countdown) with an idle army of sabotageMinArmy; rally at the
   * own parts. Absent or null = the AI ignores the Bouwproject.
   */
  readonly project?: {
    readonly restoreFromTicks: number;
    readonly restoreMinArmy: number;
    readonly builders: number;
    readonly sabotageKinds: number;
    readonly sabotageMinArmy: number;
    readonly rallyAtParts: boolean;
  } | null;
  /**
   * Liberation (data 0.24.0 ai liberate, proposal): with at least minFree idle militia and no threat, up to `units` of
   * them go (Attack) to the visible enemy slave or captive nearest the headquarters within `radius` of an own building;
   * null = never.
   */
  readonly liberate: {
    readonly minFree: number;
    readonly units: number;
    readonly radius: number;
  } | null;
  /**
   * Data 0.24.0 (ai defendHqFirst, proposal): while an enemy stands within defendRadius of the headquarters, every militia
   * and robot that is not on a push turns to that threat.
   */
  readonly defendHqFirst: boolean;
}

/** Raid plan of the Raider AI (ai/*.json raidPlan), in sim units. */
export interface SimRaidPlan {
  /** Fighters from the tents, cyclic by weight (a type without its techs is skipped). */
  readonly fighterMix: readonly { readonly typeId: number; readonly weight: number }[];
  /** Null = no harass (data 0.38.0). */
  readonly harass: {
    readonly typeId: number;
    readonly fromTicks: number;
    readonly max: number;
    readonly retreatHpPermille: number;
  } | null;
  /** Null = no slave raids (data 0.38.0). */
  readonly slaveRaids: {
    readonly slaverTypeId: number;
    readonly fromTicks: number;
    readonly slavers: number;
    readonly escort: number;
    readonly maxRaidTicks: number;
    readonly retryTicks: number;
  } | null;
  readonly garrisonMinFighters: number;
  readonly dominancePush: { readonly fromTicks: number; readonly minArmy: number };
  /**
   * Data 0.38.0 (sim 0.32.0, proposal): a faction without slaves produces its free workers (the cheapest builder and
   * scavenger loadout of a building): `builders` builders and scavengers up to `scavengers`; null = slave workers.
   */
  readonly workers: { readonly scavengers: number } | null;
  /** Data 0.38.0 (proposal): produce the fighter mix strictly in its cycle order (a building waits for its turn). */
  readonly mixInOrder: boolean;
  /**
   * Data 0.43.0 (sim 0.34.0, the Garde AI; proposal): support units (the Klerk, systems/aiGarde.ts). From fromTicks the
   * AI keeps one per `perArmy` fighters, at most `max`; they are no fighters, `withWave` of the free ones go with every
   * wave, push and sabotage and the rest stand with the defence. Null = none.
   */
  readonly support: {
    readonly typeId: number;
    readonly fromTicks: number;
    readonly max: number;
    readonly perArmy: number;
    readonly withWave: number;
  } | null;
  /**
   * Data 0.43.0 (sim 0.34.0, the Garde AI; proposal): the airlift (the Vertibird, systems/aiGarde.ts). From fromTicks
   * the AI keeps `max` transports; while the rally point lies at least `minPath` over land from the headquarters, an
   * empty transport above minHpPermille within `gather` of home loads at least minLoad free fighters within `gather`
   * of it and sets them down at the rally point. Null = none.
   */
  readonly airlift: {
    readonly typeId: number;
    readonly fromTicks: number;
    readonly max: number;
    readonly minArmy: number;
    readonly minPath: number;
    readonly gather: number;
    readonly minLoad: number;
    readonly minHpPermille: number;
  } | null;
}
