import type { SimAiScript, SimFaction } from './config.faction.js';
import type {
  SimBuildingType,
  SimCreepTakeover,
  SimCreepTier,
  SimHero,
  SimMap,
  SimPerk,
  SimProject,
  SimSpecialTuning,
  SimTech,
  SimTraining,
  SimUnitType,
} from './config.types.js';
import type { SimSurvival } from './config.survival.js';

export interface SimConfig {
  /** data/VERSION; gaat de hash-seed in, zodat een replay nooit stil op andere data draait. */
  readonly dataVersion: string;
  readonly unitTypes: readonly SimUnitType[];
  readonly buildingTypes: readonly SimBuildingType[];
  /** Op factionId: factions[k].factionId === k. */
  readonly factions: readonly SimFaction[];
  readonly aiScripts: readonly SimAiScript[];
  /** Creep camp tiers (data/creeps.json, data 0.25.0), ascending tier; absent = none. */
  readonly creepTiers?: readonly SimCreepTier[];
  /** Camp takeover per faction (data 0.27.0), ascending factionId; absent or empty = every faction clears camps. */
  readonly creepTakeover?: readonly SimCreepTakeover[];
  /** Win route C (data/project.json, data 0.31.0); absent = no Bouwproject (a map with project sites then fails). */
  readonly project?: SimProject;
  /** Survival co-op (data/survival, data 0.33.0, sim 0.27.0); only read with SimMap.survival (the game type Survival). */
  readonly survival?: SimSurvival;
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
   * hierbinnen ligt houdt het punt. Exclusieve scrap-nodes rond een bezet punt: exclusiveRadius (data 0.20.0).
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
  /** Building placement margins (sim.json `placement`, data 0.18.0; systems/placement.ts). */
  readonly placement: SimPlacementTuning;
  /** A new scavenger settler of a human player gathers at the nearest reachable node within this radius; 0 = off. */
  readonly autoGatherRadius: number;
  /**
   * A scrap node within this distance of a held claim point is exclusive to its owner (sim.json exclusiveRadiusM, data
   * 0.20.0; was claimRadius). At least claimRadius.
   */
  readonly exclusiveRadius: number;
  /** Ticks a hero stands in the circle of a free claim point to claim it without a post (0 = off; data 0.20.0). */
  readonly heroClaimTicks: number;
  /** Ticks after which a tower-less claim goes over to an enemy with units in the circle and none of the holder. */
  readonly contestFlipTicks: number;
  /** Fog of war (data 0.22.0): side of a vision cell in units, 256, 512 or 1024 (1, 2 or 4 m; vision.ts). */
  readonly visionCell: number;
  /**
   * Guard mode (sim.json `guard`, data 0.29.0, sim 0.24.0; voorstel, ter bevestiging door de architect): a unit on a
   * Guard order walks back to within `stand` of its target and fights only while it stays within `leash` of it.
   */
  readonly guard: { readonly stand: number; readonly leash: number };
  /**
   * Base defence (sim.json `baseDefense`, data 0.35.0, sim 0.29.0; voorstel, ter bevestiging door de architect;
   * systems/defense.ts): on per game type; `radius` around the HQ outside Survival (in Survival the build zone),
   * `calmTicks` without a threat before everyone resumes.
   */
  readonly baseDefense: {
    readonly survival: boolean;
    readonly skirmish: boolean;
    readonly radius: number;
    readonly calmTicks: number;
    readonly retarget: number;
  };
}

/** Building placement margins (sim.json `placement`), in sim units; the rule works in whole cells, rounded up. */
export interface SimPlacementTuning {
  /** Free walkable ground around every footprint (no building, node or claim point); at least one cell. */
  readonly clearance: number;
  /** No other building this close to a drop-off building (provides hq or workshop); at least `clearance`. */
  readonly depotClearance: number;
  /**
   * Territory (data 0.20.0, bevestigd in fase-0 sectie 22 besluit 6; systems/placement.ts territoryMask): a new footprint touches a cell within this
   * many steps over walkable terrain of an own building; 0 = no territory rule.
   */
  readonly buildRange: number;
  /** The same around an own claim post (provides claim, not hq): the start of building out from a claimed point. */
  readonly claimBuildRange: number;
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

/** Base defence (sim 0.29.0): whether it is on for this env (Survival by the map, else the skirmish toggle). */
export const defenseOn = (env: Pick<SimEnv, 'map' | 'config'>): boolean =>
  env.map.survival !== undefined
    ? env.config.baseDefense.survival
    : env.config.baseDefense.skirmish;
