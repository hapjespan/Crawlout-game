import { MAX_PLAYERS, UNITS_PER_METER } from '@crawlout/protocol';
import { isInt } from './math/int.js';
import { FNV_OFFSET, fnv1a, fnv1aInt, fnv1aString } from './math/fnv.js';

// De grens van de sim: alles in sim-eenheden (integers). De adapter in fromData.ts vult deze types uit GameData
// (packages/data) en MapGrid (packages/map); de sim leest nooit meters, seconden of JSON en importeert packages/map niet.

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
}

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
  /** Het gebouw dat het Claim-commando bouwt (provides claim, geen hoofdgebouw); 0 = geen. */
  readonly claimTypeId: number;
  /** De held van deze factie (index in SimConfig.heroes), -1 = geen held. */
  readonly heroId: number;
  /**
   * Vangnet (data 0.16.0, safetyNet radiobaken_instroom): onder threshold bewoners en met een voltooid baken komt er elke
   * intervalTicks een bewoner van typeId bij het baken, hoogstens maxArrivals keer per potje. null = geen vangnet.
   */
  readonly safetyNet: {
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
}

export interface SimConfig {
  /** data/VERSION; gaat de hash-seed in, zodat een replay nooit stil op andere data draait. */
  readonly dataVersion: string;
  readonly unitTypes: readonly SimUnitType[];
  readonly buildingTypes: readonly SimBuildingType[];
  /** Op factionId: factions[k].factionId === k. */
  readonly factions: readonly SimFaction[];
  readonly aiScripts: readonly SimAiScript[];
  /** Op techId; hoogstens MAX_TECHS (bitset per speler). */
  readonly techs: readonly SimTech[];
  /** Op heroId. */
  readonly heroes: readonly SimHero[];
  /** Op perkId; hoogstens MAX_PERKS (bitset per held). */
  readonly perks: readonly SimPerk[];
  /** Trainingsprogramma's op programId (data 0.16.0). */
  readonly training: readonly SimTraining[];
  readonly special: SimSpecialTuning;
  /** damageMatrix[damageType][armorType] in promille (1000 = normale schade). */
  readonly damageMatrix: readonly (readonly number[])[];
  /** Ticks in een minuut, voor housingGrowthPerMin (omgerekend door de adapter, niet door de sim). */
  readonly ticksPerMinute: number;
  /** Afstand (eenheden) waarbinnen een Move-order klaar is. */
  readonly arriveRadius: number;
  /** Deel van de overlap dat separatie per tick oplost, in promille (0..1000). */
  readonly separationPermille: number;
  /** Padvinding: sectorzijde in cellen (macht van 2, 4..64); bepaalt de padgraaf en dus de paden. */
  readonly pathSectorCells: number;
  /** Padvinding: langste ingang per knopenpaar op een sectorgrens, in cellen (1..pathSectorCells). */
  readonly pathEntranceMaxCells: number;
  /**
   * Padvinding: geheugenbudget van de regiovelden in cellen. Alleen snelheid, nooit de uitkomst (regiovelden zijn
   * een cache van een pure functie), dus niet in de envHash.
   */
  readonly pathCacheCells: number;
  /** animT-stap per tick (0..65535 wrapt). */
  readonly walkAnimStep: number;
  /** Afstand waarbinnen militie (en elke unit op AttackMove) zelf een doel kiest. */
  readonly aggroRange: number;
  /** Reikwijdte voor verzamelen, afleveren, bouwen en omscholen: afstand tot node of footprint. */
  readonly interactRange: number;
  /**
   * Straal rond een claimpunt (besluit sprint 2, sectie 13): een voltooid gebouw met provides claim waarvan de footprint
   * hierbinnen ligt houdt het punt; een scrap-node hierbinnen van een bezet punt is exclusief voor de eigenaar.
   */
  readonly claimRadius: number;
  /** Bovengrens van de pop-cap, los van het aantal bedden. */
  readonly popCapMax: number;
  /** Ticks dat een gedode unit als lijk (anim death) blijft staan. */
  readonly corpseTicks: number;
  /** Teruggave bij Cancel van een bouwplaats of een betaalde omscholing, in promille van de prijs (1000 = alles). */
  readonly cancelRefundPermille: number;
  /** Een bouwer zonder taak helpt vanzelf bij een eigen bouwplaats binnen deze afstand (tot de rand van de footprint). */
  readonly builderAutoHelpRadius: number;
  /** Group-order spreading: formation slots, arrival slack, straight-walk range and the worker ring at a node. */
  readonly formation: SimFormationTuning;
}

/** Formation and arrival spreading for group orders (sim.json `formation`), in sim units. */
export interface SimFormationTuning {
  /** Free space between neighbouring slots; slot spacing is twice the largest unit radius plus this. */
  readonly gap: number;
  /** Columns ~ sqrt(units * widthPermille / 1000); above 1000 a formation is wider than deep. */
  readonly widthPermille: number;
  /** Within this distance of its slot, touching a blocking stationary unit counts as arrived (contact rule). */
  readonly slack: number;
  /** Within this distance of its slot, with a clear line, a unit leaves its flow field and walks straight. */
  readonly directRange: number;
  /** Radius of the ring of worker slots around a scrap node. */
  readonly gatherRing: number;
}

/** Eén speler in de startopstelling, in playerId-volgorde. */
export interface SimPlayer {
  readonly factionId: number;
  /** AI-speler (LobbyPlayer.ai): de sim geeft zelf zijn commando's in systeemstap 2. */
  readonly ai: boolean;
}

export interface SimInit {
  readonly seed: number;
  readonly players: readonly SimPlayer[];
  readonly map: SimMap;
  readonly config: SimConfig;
}

/** Alles wat geen state is maar wel nodig is om een geserialiseerde state te laden. */
export type SimEnv = Omit<SimInit, 'seed'>;

/**
 * Geometrie: maximale mapzijde in cellen; houdt celindices en coordinaten ruim binnen int32. Nagerekend voor de grote
 * map (sim-xl): bij 1024 is een coordinaat hoogstens 1024 * 256 = 262.144 (de grote map van 384: 98.304), een celindex
 * hoogstens 2^20, een kwadraat van een afstand hoogstens 2 * 262.144^2 (ongeveer 1,4e11, ruim onder 2^53 voor isqrt en
 * de vergelijkingen), en past de lokale regio-index van de padvinding (hoogstens S*S/2) in een Uint16.
 */
export const MAX_MAP_CELLS_SIDE = 1024;
/** Geometrie: bovengrens snelheid, kleiner dan een cel, zodat een unit nooit door een muur van 1 cel tunnelt. */
export const MAX_SPEED = UNITS_PER_METER >> 1;
/** Geometrie: bovengrens unitstraal; de separatie-grid gaat uit van buckets van 2 m. */
export const MAX_RADIUS = UNITS_PER_METER;
/** Geometrie: grootste footprint-zijde in cellen (past in Uint8 en in de ringzoeker rond gebouwen). */
export const MAX_FOOTPRINT = 32;
/** Geometrie van de state: onderzochte techs staan per speler in een uint32-bitset. */
export const MAX_TECHS = 32;
/** Geometrie van de state: gekozen perks staan per held in een uint32-bitset. */
export const MAX_PERKS = 32;
/** Geometrie van de state: abilities per held (cooldown en zone per slot). */
export const MAX_ABILITIES = 4;
/** SPECIAL heeft zeven letters. */
export const SPECIAL_COUNT = 7;
/** Aantal effect-stats (EffectStat in packages/data): hpPct .. researchTimePct, de zeven SPECIAL-letters en researchCostPct. */
export const EFFECT_STAT_COUNT = 15;
/** Geometrie van de state: getrainde punten per letter staan in een uint8 per speler en letter. */
export const MAX_TRAINED_POINTS = 255;
/** Grens voor bouw- en onderzoekstijd in ticks: voortgang telt in duizendsten van een tick (PROGRESS_ONE) in een int32. */
export const MAX_WORK_TICKS = 2_000_000;
const U16 = 0xffff;
const I31 = 0x7fffffff;

function req(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`SimInit ongeldig: ${msg}`);
}

const intIn = (v: unknown, lo: number, hi: number): boolean => isInt(v) && v >= lo && v <= hi;

function checkPoint(map: SimMap, p: SimPoint, what: string): void {
  req(
    intIn(p.x, 0, (map.w << 8) - 1) && intIn(p.y, 0, (map.h << 8) - 1),
    `${what} (${p.x},${p.y}) ligt buiten de map`,
  );
}

/** Valideert de invoer eenmalig voor de eerste tick. Gooit bij ongeldige invoer. */
export function validateEnv(env: SimEnv): void {
  const { map, config, players } = env;
  req(intIn(players.length, 1, MAX_PLAYERS), `aantal spelers ${players.length}`);
  req(
    intIn(map.w, 1, MAX_MAP_CELLS_SIDE) && intIn(map.h, 1, MAX_MAP_CELLS_SIDE),
    `mapmaat ${map.w}x${map.h}`,
  );
  req(map.passable.length === map.w * map.h, 'passable heeft niet w*h cellen');
  for (let i = 0; i < map.passable.length; i++)
    req(map.passable[i]! <= 1, `passable[${i}] is geen 0 of 1`);
  req(
    map.spawns.length >= players.length,
    `map heeft ${map.spawns.length} spawns voor ${players.length} spelers`,
  );
  for (const s of map.spawns) checkPoint(map, s, 'spawn');
  for (const n of map.scrapNodes) {
    checkPoint(map, n, 'scrap-node');
    req(intIn(n.amount, 0, I31), 'scrap-node amount');
  }
  for (const c of map.claimPoints) {
    checkPoint(map, c, 'claimpunt');
    req(intIn(c.kind, 0, 0xff), 'claimpunt kind');
  }
  req(
    intIn(map.dominance.pointsRequired, 1, 0xff) && intIn(map.dominance.ticks, 1, I31),
    'dominance',
  );

  req(
    typeof config.dataVersion === 'string' && config.dataVersion.length > 0,
    'dataVersion ontbreekt',
  );
  req(intIn(config.arriveRadius, 0, MAX_RADIUS * 4), 'arriveRadius');
  req(intIn(config.separationPermille, 0, 1000), 'separationPermille');
  req(
    intIn(config.pathSectorCells, 4, 64) &&
      (config.pathSectorCells & (config.pathSectorCells - 1)) === 0,
    'pathSectorCells (macht van 2, 4..64)',
  );
  req(intIn(config.pathEntranceMaxCells, 1, config.pathSectorCells), 'pathEntranceMaxCells');
  req(intIn(config.pathCacheCells, 1, 1 << 26), 'pathCacheCells');
  req(intIn(config.walkAnimStep, 0, U16), 'walkAnimStep');
  req(intIn(config.ticksPerMinute, 1, I31), 'ticksPerMinute');
  req(intIn(config.aggroRange, 0, MAX_MAP_CELLS_SIDE << 8), 'aggroRange');
  req(intIn(config.interactRange, 0, MAX_MAP_CELLS_SIDE << 8), 'interactRange');
  req(intIn(config.claimRadius, 0, MAX_MAP_CELLS_SIDE << 8), 'claimRadius');
  req(intIn(config.popCapMax, 0, 4096), 'popCapMax');
  req(intIn(config.corpseTicks, 0, U16), 'corpseTicks');
  req(intIn(config.cancelRefundPermille, 0, 1000), 'cancelRefundPermille');
  req(intIn(config.builderAutoHelpRadius, 0, MAX_MAP_CELLS_SIDE << 8), 'builderAutoHelpRadius');
  const f = config.formation;
  req(intIn(f.gap, 0, MAX_RADIUS * 8), 'formation.gap');
  req(intIn(f.widthPermille, 1, 100000), 'formation.widthPermille');
  req(intIn(f.slack, 0, MAX_RADIUS * 16), 'formation.slack');
  req(intIn(f.directRange, 0, MAX_MAP_CELLS_SIDE << 8), 'formation.directRange');
  req(intIn(f.gatherRing, 0, MAX_RADIUS * 16), 'formation.gatherRing');

  const armorCount = config.damageMatrix[0]?.length ?? 0;
  req(config.damageMatrix.length > 0 && armorCount > 0, 'damageMatrix leeg');
  for (const row of config.damageMatrix) {
    req(row.length === armorCount, 'damageMatrix niet rechthoekig');
    for (const v of row) req(intIn(v, 0, 100000), 'damageMatrix-waarde');
  }

  const unitIds = new Set<number>();
  for (const u of config.unitTypes) {
    const at = `unittype ${u.typeId}`;
    req(intIn(u.typeId, 1, U16) && !unitIds.has(u.typeId), `${at}: typeId ongeldig of dubbel`);
    unitIds.add(u.typeId);
    req(intIn(u.maxHp, 1, I31), `${at}: maxHp`);
    req(intIn(u.speed, 0, MAX_SPEED), `${at}: speed (max ${MAX_SPEED})`);
    req(intIn(u.radius, 0, MAX_RADIUS), `${at}: radius (max ${MAX_RADIUS})`);
    req(
      intIn(u.armorType, 0, armorCount - 1) &&
        intIn(u.damageType, 0, config.damageMatrix.length - 1),
      `${at}: armor- of damageType`,
    );
    req(
      intIn(u.bodyType, 0, 0xff) && intIn(u.role, 0, 0xff) && intIn(u.loadoutId, 0, U16),
      `${at}: bodyType, role of loadoutId`,
    );
    req(intIn(u.factionId, 0, config.factions.length - 1), `${at}: factionId`);
    req(
      intIn(u.damage, 0, I31) &&
        intIn(u.range, 0, MAX_MAP_CELLS_SIDE << 8) &&
        intIn(u.cooldown, 0, I31),
      `${at}: gevecht`,
    );
    req(intIn(u.gatherAmount, 0, I31) && intIn(u.gatherTicks, 0, I31), `${at}: verzamelen`);
    req(u.gatherAmount === 0 || u.gatherTicks > 0, `${at}: gatherAmount zonder gatherTicks`);
    req(
      intIn(u.scrapCost, 0, I31) && intIn(u.craftTicks, 0, I31) && intIn(u.popCost, 0, 0xff),
      `${at}: kosten`,
    );
    for (const t of u.prereqTech) req(intIn(t, 0, U16), `${at}: prereqTech`);
    if (u.repair !== null)
      req(
        intIn(u.repair.milliHpPerTick, 0, I31) &&
          intIn(u.repair.range, 0, MAX_MAP_CELLS_SIDE << 8) &&
          intIn(u.repair.seekRange, 0, MAX_MAP_CELLS_SIDE << 8),
        `${at}: repair`,
      );
    if (u.siege !== null) req(intIn(u.siege.vsBuildingsPermille, 0, 100000), `${at}: siege`);
  }
  const buildingIds = new Set<number>();
  for (const b of config.buildingTypes) {
    const at = `gebouwtype ${b.typeId}`;
    req(
      intIn(b.typeId, 1, U16) && !buildingIds.has(b.typeId) && !unitIds.has(b.typeId),
      `${at}: typeId ongeldig of dubbel`,
    );
    buildingIds.add(b.typeId);
    req(intIn(b.maxHp, 1, I31) && intIn(b.armorType, 0, armorCount - 1), `${at}: hp of armorType`);
    req(
      intIn(b.scrapCost, 0, I31) &&
        intIn(b.buildTicks, 0, MAX_WORK_TICKS) &&
        intIn(b.beds, 0, 0xffff),
      `${at}: kosten, bouwtijd of bedden`,
    );
    req(
      intIn(b.footprintW, 1, MAX_FOOTPRINT) && intIn(b.footprintH, 1, MAX_FOOTPRINT),
      `${at}: footprint`,
    );
    req(
      intIn(b.provides, 0, 0xffff) && intIn(b.factionId, 0, config.factions.length - 1),
      `${at}: provides of factionId`,
    );
    for (const t of b.prereqTech) req(intIn(t, 0, U16), `${at}: prereqTech`);
    req(
      intIn(b.damage, 0, I31) && intIn(b.damageType, 0, config.damageMatrix.length - 1),
      `${at}: damage of damageType`,
    );
    req(
      intIn(b.range, 0, MAX_MAP_CELLS_SIDE << 8) && intIn(b.cooldown, 0, I31),
      `${at}: range of cooldown`,
    );
    if (b.network !== null)
      req(
        intIn(b.network.requiresTech, 0, U16) &&
          intIn(b.network.radius, 0, MAX_MAP_CELLS_SIDE << 8) &&
          intIn(b.network.damagePermillePerTurret, 0, 100000) &&
          intIn(b.network.maxDamagePermille, 0, 100000),
        `${at}: network`,
      );
  }
  for (const u of config.unitTypes)
    req(
      u.producedAtTypeId === 0 || buildingIds.has(u.producedAtTypeId),
      `unittype ${u.typeId}: producedAtTypeId`,
    );
  config.factions.forEach((f, k) => {
    const at = `factie ${k}`;
    req(f.factionId === k, `${at}: factionId moet de index zijn`);
    for (const s of f.startUnits)
      req(unitIds.has(s.typeId) && intIn(s.count, 1, 1024), `${at}: startUnits`);
    req(
      intIn(f.startScrap, 0, I31) && intIn(f.housingGrowthPerMin, 0, I31),
      `${at}: startScrap of housingGrowthPerMin`,
    );
    req(buildingIds.has(f.hqTypeId), `${at}: hqTypeId`);
    req(f.settlerTypeId === 0 || unitIds.has(f.settlerTypeId), `${at}: settlerTypeId`);
    for (const t of f.roleTypeIds) req(t === 0 || unitIds.has(t), `${at}: roleTypeIds`);
    req(intIn(f.aiScript, -1, config.aiScripts.length - 1), `${at}: aiScript`);
    req(f.claimTypeId === 0 || buildingIds.has(f.claimTypeId), `${at}: claimTypeId`);
    if (f.safetyNet !== null)
      req(
        intIn(f.safetyNet.threshold, 0, 4096) &&
          intIn(f.safetyNet.intervalTicks, 1, I31) &&
          intIn(f.safetyNet.maxArrivals, 0, I31) &&
          unitIds.has(f.safetyNet.typeId),
        `${at}: safetyNet`,
      );
    if (f.robotRules !== null)
      req(
        intIn(f.robotRules.robotsPerTechnician, 0, 4096) &&
          intIn(f.robotRules.penaltyPermille, 0, 1000) &&
          f.robotRules.technicianRoles.every((r) => intIn(r, 0, 0xff)),
        `${at}: robotRules`,
      );
  });
  const checkEffects = (effects: readonly SimEffect[], at: string): void => {
    for (const e of effects) {
      req(
        intIn(e.stat, 0, EFFECT_STAT_COUNT - 1) && intIn(e.delta, -I31, I31),
        `${at}: effect stat of delta`,
      );
      req(intIn(e.target, EFFECT_TARGET_ALL, EFFECT_TARGET_TYPE), `${at}: effect-doel`);
      req(
        e.target === EFFECT_TARGET_TYPE
          ? unitIds.has(e.typeId) || buildingIds.has(e.typeId)
          : e.typeId === 0,
        `${at}: effect-typeId`,
      );
    }
  };
  req(config.techs.length <= MAX_TECHS, `meer dan ${MAX_TECHS} techs`);
  config.techs.forEach((t, k) => {
    const at = `tech ${k}`;
    req(
      t.techId === k && intIn(t.factionId, 0, config.factions.length - 1),
      `${at}: techId of factionId`,
    );
    req(
      intIn(t.scrapCost, 0, I31) &&
        intIn(t.researchTicks, 0, MAX_WORK_TICKS) &&
        buildingIds.has(t.buildingTypeId),
      `${at}: kosten, tijd of gebouw`,
    );
    for (const q of t.prereqTech) req(intIn(q, 0, config.techs.length - 1), `${at}: prereqTech`);
    checkEffects(t.effects, at);
  });
  for (const u of config.unitTypes)
    for (const t of u.prereqTech)
      req(intIn(t, 0, config.techs.length - 1), `unittype ${u.typeId}: prereqTech`);
  for (const b of config.buildingTypes) {
    for (const t of b.prereqTech)
      req(intIn(t, 0, config.techs.length - 1), `gebouwtype ${b.typeId}: prereqTech`);
    if (b.network !== null)
      req(
        intIn(b.network.requiresTech, 0, config.techs.length - 1),
        `gebouwtype ${b.typeId}: network.requiresTech`,
      );
  }
  config.training.forEach((tr, k) => {
    const at = `training ${k}`;
    req(
      tr.programId === k &&
        intIn(tr.factionId, 0, config.factions.length - 1) &&
        intIn(tr.special, 0, SPECIAL_COUNT - 1) &&
        buildingIds.has(tr.buildingTypeId),
      `${at}: id, factie, letter of gebouw`,
    );
    req(
      intIn(tr.scrapCost, 0, I31) &&
        intIn(tr.scrapCostStep, 0, I31) &&
        intIn(tr.trainTicks, 1, MAX_WORK_TICKS) &&
        intIn(tr.trainTicksStep, 0, MAX_WORK_TICKS) &&
        intIn(tr.pointsPerRun, 1, MAX_TRAINED_POINTS) &&
        intIn(tr.maxPoints, 0, MAX_TRAINED_POINTS),
      `${at}: kosten, tijd of punten`,
    );
    for (const q of tr.prereqTech) req(intIn(q, 0, config.techs.length - 1), `${at}: prereqTech`);
  });
  req(config.perks.length <= MAX_PERKS, `meer dan ${MAX_PERKS} perks`);
  config.perks.forEach((pk, k) => {
    req(
      pk.perkId === k &&
        intIn(pk.requiresStat, 0, SPECIAL_COUNT - 1) &&
        intIn(pk.requiresMin, -I31, I31),
      `perk ${k}: id of requires`,
    );
    checkEffects(pk.effects, `perk ${k}`);
  });
  const sp = config.special;
  for (const v of [
    sp.strengthDamagePermille,
    sp.perceptionRangeU,
    sp.enduranceHpPermille,
    sp.charismaGrowthPermille,
    sp.intelligenceResearchPermille,
    sp.agilitySpeedPermille,
  ]) {
    req(intIn(v, -100000, 100000), 'special-tuning');
  }
  req(
    intIn(sp.luckCritPermille, 0, 1000) && intIn(sp.critDamagePermille, 0, 100000),
    'special-tuning: luckCritPermille of critDamagePermille',
  );
  config.heroes.forEach((hr, k) => {
    const at = `held ${k}`;
    req(
      hr.heroId === k &&
        intIn(hr.typeId, 1, U16) &&
        !unitIds.has(hr.typeId) &&
        !buildingIds.has(hr.typeId),
      `${at}: heroId of typeId`,
    );
    req(
      intIn(hr.factionId, 0, config.factions.length - 1) && unitIds.has(hr.baseTypeId),
      `${at}: factionId of baseTypeId`,
    );
    req(
      hr.special.length === SPECIAL_COUNT && hr.special.every((v) => intIn(v, 0, 100)),
      `${at}: special`,
    );
    req(
      hr.xpThresholds.every((v, j) => intIn(v, 1, I31) && (j === 0 || v > hr.xpThresholds[j - 1]!)),
      `${at}: xpThresholds`,
    );
    req(
      intIn(hr.xpPerKill, 0, I31) &&
        intIn(hr.xpPerDiscovery, 0, I31) &&
        intIn(hr.xpPerAssist, 0, I31),
      `${at}: xp`,
    );
    req(intIn(hr.xpAssistRadius, 0, MAX_MAP_CELLS_SIDE << 8), `${at}: xpAssistRadius`);
    req(hr.abilities.length <= MAX_ABILITIES, `${at}: meer dan ${MAX_ABILITIES} abilities`);
    for (const a of hr.abilities) {
      req(
        intIn(a.cooldownTicks, 0, I31) && intIn(a.durationTicks, 0, I31),
        `${at}: ability-tijden`,
      );
      req(
        intIn(a.rangeU, 0, MAX_MAP_CELLS_SIDE << 8) && intIn(a.radiusU, 0, MAX_MAP_CELLS_SIDE << 8),
        `${at}: ability-afstanden`,
      );
      for (const e of a.effects) {
        req(
          intIn(e.stat, 0, EFFECT_STAT_COUNT - 1) && intIn(e.delta, -100000, 100000),
          `${at}: ability-effect`,
        );
        req(
          intIn(e.side, AURA_SIDE_ENEMY, AURA_SIDE_ALLY) &&
            intIn(e.target, AURA_TARGET_UNITS, AURA_TARGET_ALL),
          `${at}: ability-effect kant of doel`,
        );
      }
    }
    for (const q of hr.perkPool) req(intIn(q, 0, config.perks.length - 1), `${at}: perkPool`);
    checkEffects(hr.passives, `${at}: passives`);
    req(
      intIn(hr.reviveScrap, 0, I31) &&
        intIn(hr.reviveTicks, 0, I31) &&
        intIn(hr.revivePenaltyPermille, 0, 1000) &&
        intIn(hr.maxRevives, 0, 1000),
      `${at}: oplappen`,
    );
  });
  config.factions.forEach((f, k) =>
    req(intIn(f.heroId, -1, config.heroes.length - 1), `factie ${k}: heroId`),
  );
  for (const s of config.aiScripts) {
    for (const o of s.buildOrder)
      req(
        intIn(o.atTick, 0, I31) &&
          buildingIds.has(o.typeId) &&
          intIn(o.site ?? 0, AI_SITE_HQ, AI_SITE_FRONT),
        'aiScript buildOrder',
      );
    for (const t of s.attackTimersTicks) req(intIn(t, 0, I31), 'aiScript attackTimersTicks');
    for (const v of [
      s.militiaPermille,
      s.militiaPermilleMax,
      s.militiaPermillePerMin,
      s.threatMilitiaPermille,
    ])
      req(intIn(v, 0, 1000), 'aiScript militie-aandeel');
    req(s.housingTypeId === 0 || buildingIds.has(s.housingTypeId), 'aiScript housingTypeId');
    for (const t of s.research) req(intIn(t, 0, config.techs.length - 1), 'aiScript research');
    req(
      s.armyTypeIds.length > 0 && s.armyTypeIds.every((t) => unitIds.has(t)),
      'aiScript armyTypeIds',
    );
    req(
      intIn(s.builders, 0, 1024) &&
        intIn(s.housingFreeBeds, 0, 4096) &&
        intIn(s.scavengersPerNode, 1, 4096),
      'aiScript aantallen',
    );
    req(
      intIn(s.waveMinArmy, 0, 4096) &&
        intIn(s.waveArmyGrowth, 0, 4096) &&
        intIn(s.richScrap, 0, I31),
      'aiScript golven',
    );
    for (const o of s.richBuilds)
      req(
        buildingIds.has(o.typeId) && intIn(o.site, AI_SITE_HQ, AI_SITE_FRONT),
        'aiScript richBuilds',
      );
    for (const t of [s.researchFromTicks, s.claimFromTicks, s.waveJitterTicks, s.waveMaxWaitTicks])
      req(intIn(t, 0, I31), 'aiScript tijden');
    req(intIn(s.waveIntervalTicks, 1, I31), 'aiScript waveIntervalTicks');
    req(
      intIn(s.defendRadius, 0, MAX_MAP_CELLS_SIDE << 8) &&
        intIn(s.rallyRadius, 0, MAX_MAP_CELLS_SIDE << 8),
      'aiScript afstanden',
    );
    req(intIn(s.rallySite, AI_SITE_HQ, AI_SITE_FRONT), 'aiScript rallySite');
    req(intIn(s.pushFromTicks, 0, I31), 'aiScript pushFromTicks');
    req(
      intIn(s.pushMinArmy, 0, 4096) && typeof s.allInWithoutNodes === 'boolean',
      'aiScript pushMinArmy of allInWithoutNodes',
    );
    req(
      intIn(s.claimSafeRadius, 0, MAX_MAP_CELLS_SIDE << 8) && intIn(s.claimFarFromTicks, 0, I31),
      'aiScript claim-escorte',
    );
    if (s.robots !== null)
      req(
        s.robots.typeIds.length > 0 &&
          s.robots.typeIds.every((t) => unitIds.has(t)) &&
          intIn(s.robots.fromTicks, 0, I31) &&
          intIn(s.robots.max, 0, 4096) &&
          typeof s.robots.countAsArmy === 'boolean' &&
          intIn(s.robots.reservePop, 0, 4096),
        'aiScript robots',
      );
    if (s.reserve !== null)
      req(
        intIn(s.reserve.fromTicks, 0, I31) &&
          intIn(s.reserve.minArmy, 0, 4096) &&
          intIn(s.reserve.robotsFirstFromTicks, 0, I31),
        'aiScript reserve',
      );
    if (s.training !== null)
      req(
        s.training.programIds.length > 0 &&
          s.training.programIds.every((t) => intIn(t, 0, config.training.length - 1)) &&
          intIn(s.training.fromTicks, 0, I31),
        'aiScript training',
      );
  }
  for (const p of players) {
    req(
      intIn(p.factionId, 0, config.factions.length - 1),
      `speler met onbekende factie ${p.factionId}`,
    );
    req(typeof p.ai === 'boolean', 'speler zonder ai-vlag');
  }
}

const hashInts = (h: number, vs: readonly number[]): number => {
  let x = fnv1aInt(h, vs.length);
  for (const v of vs) x = fnv1aInt(x, v);
  return x;
};

const hashEffects = (h: number, effects: readonly SimEffect[]): number => {
  let x = fnv1aInt(h, effects.length);
  for (const e of effects) x = hashInts(x, [e.stat, e.target, e.typeId, e.delta]);
  return x;
};

/**
 * Hash van de omgeving (dataVersion, config, map, spelers) in vaste veldvolgorde. Gaat de state-header in,
 * zodat twee clients met andere data, een andere map of andere spelers op tick 0 al verschillen.
 */
export function envHash(env: SimEnv): number {
  const { map, config: c, players } = env;
  let h = fnv1aString(FNV_OFFSET, c.dataVersion);
  h = hashInts(h, [
    c.ticksPerMinute,
    c.arriveRadius,
    c.separationPermille,
    c.pathSectorCells,
    c.pathEntranceMaxCells,
    c.walkAnimStep,
    c.aggroRange,
    c.interactRange,
    c.claimRadius,
    c.popCapMax,
    c.corpseTicks,
    c.cancelRefundPermille,
    c.builderAutoHelpRadius,
    c.formation.gap,
    c.formation.widthPermille,
    c.formation.slack,
    c.formation.directRange,
    c.formation.gatherRing,
  ]);
  h = fnv1aInt(h, c.unitTypes.length);
  for (const u of c.unitTypes) {
    h = hashInts(h, [
      u.typeId,
      u.loadoutId,
      u.factionId,
      u.bodyType,
      u.role,
      u.armorType,
      u.maxHp,
      u.speed,
      u.radius,
      u.damage,
      u.damageType,
    ]);
    h = hashInts(h, [
      u.range,
      u.cooldown,
      u.gatherAmount,
      u.gatherTicks,
      u.scrapCost,
      u.craftTicks,
      u.popCost,
    ]);
    h = hashInts(h, u.prereqTech);
    h = hashInts(h, [u.producedAtTypeId]);
    h = hashInts(
      h,
      u.repair === null
        ? [0]
        : [
            1,
            u.repair.milliHpPerTick,
            u.repair.range,
            u.repair.seekRange,
            u.repair.buildings ? 1 : 0,
            u.repair.robots ? 1 : 0,
          ],
    );
    h = hashInts(
      h,
      u.siege === null ? [0] : [1, u.siege.vsBuildingsPermille, u.siege.buildingsFirst ? 1 : 0],
    );
  }
  h = fnv1aInt(h, c.buildingTypes.length);
  for (const b of c.buildingTypes) {
    h = hashInts(h, [
      b.typeId,
      b.buildingId,
      b.factionId,
      b.maxHp,
      b.armorType,
      b.scrapCost,
      b.buildTicks,
      b.footprintW,
      b.footprintH,
      b.beds,
      b.provides,
    ]);
    h = hashInts(h, b.prereqTech);
    h = hashInts(h, [b.damage, b.damageType, b.range, b.cooldown]);
    const n = b.network;
    h = hashInts(
      h,
      n === null
        ? [0]
        : [1, n.requiresTech, n.radius, n.damagePermillePerTurret, n.maxDamagePermille],
    );
  }
  h = fnv1aInt(h, c.factions.length);
  for (const f of c.factions) {
    h = hashInts(h, [
      f.factionId,
      f.startScrap,
      f.housingGrowthPerMin,
      f.hqTypeId,
      f.settlerTypeId,
      f.aiScript,
      f.claimTypeId,
      f.heroId,
    ]);
    h = fnv1aInt(h, f.startUnits.length);
    for (const s of f.startUnits) h = hashInts(h, [s.typeId, s.count]);
    h = hashInts(h, f.roleTypeIds);
    const sn = f.safetyNet;
    h = hashInts(
      h,
      sn === null ? [0] : [1, sn.threshold, sn.intervalTicks, sn.maxArrivals, sn.typeId],
    );
    const rr = f.robotRules;
    h = hashInts(h, rr === null ? [0] : [1, rr.robotsPerTechnician, rr.penaltyPermille]);
    if (rr !== null) h = hashInts(h, rr.technicianRoles);
  }
  h = fnv1aInt(h, c.aiScripts.length);
  for (const s of c.aiScripts) {
    h = fnv1aInt(h, s.buildOrder.length);
    for (const o of s.buildOrder) h = hashInts(h, [o.atTick, o.typeId, o.site ?? AI_SITE_HQ]);
    h = hashInts(h, s.attackTimersTicks);
    h = hashInts(h, [
      s.militiaPermille,
      s.militiaPermilleMax,
      s.militiaPermillePerMin,
      s.threatMilitiaPermille,
      s.builders,
    ]);
    h = hashInts(h, [
      s.housingTypeId,
      s.housingFreeBeds,
      s.researchFromTicks,
      s.richScrap,
      s.scavengersPerNode,
      s.claimFromTicks,
    ]);
    h = fnv1aInt(h, s.richBuilds.length);
    for (const o of s.richBuilds) h = hashInts(h, [o.typeId, o.site]);
    h = hashInts(h, s.research);
    h = hashInts(h, s.armyTypeIds);
    h = hashInts(h, [
      s.claimSafeRadius,
      s.claimFarFromTicks,
      s.pushMinArmy,
      s.pushFromTicks,
      s.allInWithoutNodes ? 1 : 0,
    ]);
    h = hashInts(h, [
      s.defendRadius,
      s.rallySite,
      s.rallyRadius,
      s.waveIntervalTicks,
      s.waveJitterTicks,
      s.waveMinArmy,
      s.waveArmyGrowth,
      s.waveMaxWaitTicks,
    ]);
    h = hashInts(
      h,
      s.robots === null
        ? [0]
        : [1, s.robots.fromTicks, s.robots.max, s.robots.countAsArmy ? 1 : 0, s.robots.reservePop],
    );
    if (s.robots !== null) h = hashInts(h, s.robots.typeIds);
    h = hashInts(
      h,
      s.reserve === null
        ? [0]
        : [1, s.reserve.fromTicks, s.reserve.minArmy, s.reserve.robotsFirstFromTicks],
    );
    h = hashInts(h, s.training === null ? [0] : [1, s.training.fromTicks]);
    if (s.training !== null) h = hashInts(h, s.training.programIds);
  }
  h = fnv1aInt(h, c.techs.length);
  for (const t of c.techs) {
    h = hashInts(h, [t.techId, t.factionId, t.scrapCost, t.researchTicks, t.buildingTypeId]);
    h = hashInts(h, t.prereqTech);
    h = hashEffects(h, t.effects);
  }
  h = fnv1aInt(h, c.perks.length);
  for (const pk of c.perks) {
    h = hashInts(h, [pk.perkId, pk.requiresStat, pk.requiresMin]);
    h = hashEffects(h, pk.effects);
  }
  h = fnv1aInt(h, c.training.length);
  for (const tr of c.training) {
    h = hashInts(h, [
      tr.programId,
      tr.factionId,
      tr.special,
      tr.buildingTypeId,
      tr.scrapCost,
      tr.scrapCostStep,
      tr.trainTicks,
      tr.trainTicksStep,
      tr.pointsPerRun,
      tr.maxPoints,
    ]);
    h = hashInts(h, tr.prereqTech);
  }
  h = fnv1aInt(h, c.heroes.length);
  for (const hr of c.heroes) {
    h = hashInts(h, [
      hr.heroId,
      hr.typeId,
      hr.factionId,
      hr.baseTypeId,
      hr.xpPerKill,
      hr.xpPerDiscovery,
      hr.xpPerAssist,
      hr.xpAssistRadius,
    ]);
    h = hashInts(h, [hr.reviveScrap, hr.reviveTicks, hr.revivePenaltyPermille, hr.maxRevives]);
    h = hashInts(h, hr.special);
    h = hashInts(h, hr.xpThresholds);
    h = hashInts(h, hr.perkPool);
    h = hashEffects(h, hr.passives);
    h = fnv1aInt(h, hr.abilities.length);
    for (const a of hr.abilities) {
      h = hashInts(h, [a.cooldownTicks, a.rangeU, a.radiusU, a.durationTicks]);
      h = fnv1aInt(h, a.effects.length);
      for (const e of a.effects) h = hashInts(h, [e.stat, e.side, e.target, e.delta]);
    }
  }
  const sp = c.special;
  h = hashInts(h, [
    sp.strengthDamagePermille,
    sp.perceptionRangeU,
    sp.enduranceHpPermille,
    sp.charismaGrowthPermille,
    sp.intelligenceResearchPermille,
    sp.agilitySpeedPermille,
    sp.luckCritPermille,
    sp.critDamagePermille,
  ]);
  h = fnv1aInt(h, c.damageMatrix.length);
  for (const row of c.damageMatrix) h = hashInts(h, row);

  h = fnv1aInt(h, players.length);
  for (const p of players) h = hashInts(h, [p.factionId, p.ai ? 1 : 0]);

  h = hashInts(h, [map.w, map.h]);
  h = fnv1a(h, map.passable);
  h = fnv1aInt(h, map.spawns.length);
  for (const s of map.spawns) h = hashInts(h, [s.x, s.y]);
  h = fnv1aInt(h, map.scrapNodes.length);
  for (const n of map.scrapNodes) h = hashInts(h, [n.x, n.y, n.amount]);
  h = fnv1aInt(h, map.claimPoints.length);
  for (const p of map.claimPoints) h = hashInts(h, [p.x, p.y, p.kind]);
  return hashInts(h, [map.dominance.pointsRequired, map.dominance.ticks]);
}
