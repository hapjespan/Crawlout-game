import type {
  ChemStatus,
  DominanceStatus,
  FogMask,
  FrameBundle,
  PlayerStatus,
  QueueItem,
} from '@crawlout/protocol';
import { MAX_PLAYERS } from '@crawlout/protocol';
import type {
  SimBuildingType,
  SimConfig,
  SimEnv,
  SimInit,
  SimMap,
  SimPlayer,
  SimUnitType,
} from './config.js';
import { envHash, validateEnv } from './config.js';
import { NO_ENTITY, World } from './ecs/world.js';
import { EventBuffer } from './events.js';
import { FlowFields } from './flowfield.js';
import { isInt } from './math/int.js';
import { Rng } from './rng.js';
import { hasTech } from './techBits.js';
import { writeSnapshot } from './snapshot.js';
import { setupStart } from './start.js';
import type { StateParts } from './state.js';
import { StateHeader, deserializeState, hashState, serializeState } from './state.js';
import { AiScratch, aiSystem } from './systems/ai.js';
import { TerrainDistances } from './pathdist.js';
import { Census } from './systems/census.js';
import {
  ClaimScratch,
  claimsSystem,
  dominanceStatus,
  updateClaimPoints,
} from './systems/claims.js';
import { cleanupSystem } from './systems/cleanup.js';
import { CreepCamps, creepSystem, spawnCreepCamps } from './systems/creeps.js';
import { combatSystem } from './systems/combat.js';
import type { SimCommand } from './systems/commands.js';
import { applyCommands, normalizeCommand } from './systems/commands.js';
import type { SimContext } from './systems/common.js';
import { EntityIndex, GlobalState, NO_WINNER, PlayerState, Terrain } from './systems/common.js';
import { economySystem } from './systems/economy.js';
import { Auras, auraSystem } from './systems/hero.js';
import { RobotRates, robotRulesSystem } from './systems/robots.js';
import { MovementScratch, movementSystem } from './systems/movement.js';
import { OrdersScratch, ordersSystem } from './systems/orders.js';
import { ProjectState, spawnProjectSites } from './systems/project.js';
import { SurvivalState, survivalStatusOf, survivalSystem } from './systems/survival.js';
import { DefenseState, defenseActive, defenseSystem } from './systems/defense.js';
import { GardeState, fusionCoreSystem } from './systems/garde.js';
import { mapPowerArmorSystem } from './systems/garde.powerArmor.js';
import { gardeOn } from './config.hash.garde.js';
import type { SurvivalStatus } from './systems/survival.js';
import { Vision } from './vision.js';
import {
  chemsOf,
  fogMaskOf,
  playerStatusOf,
  queueOf,
  unitViewOf,
  winnerOf,
} from './sim.queries.js';
import {
  destroyEntityIn,
  indexClaimPoints,
  rebuildDerived,
  spawnBuildingIn,
  spawnUnitIn,
} from './sim.spawn.js';
import type {
  CreateSimOptions,
  SimWinner,
  SpawnUnitSpec,
  TickProbe,
  UnitView,
} from './sim.types.js';

export type {
  CreateSimOptions,
  EntityKind,
  SimWinner,
  SpawnUnitSpec,
  TickProbe,
  UnitView,
  WinReason,
} from './sim.types.js';
export { TICK_STAGES } from './sim.types.js';

/**
 * De lockstep-simulatie. Een pure functie van (seed, env, bundels per frame) naar state.
 *
 * Frames: `frame` is het volgende frame dat tick() uitvoert (begint op 0). tick() voert eerst de commando's
 * uit de bundel voor dat frame uit, daarna de systemen in vaste volgorde, en eindigt met hash(). De hash die
 * tick() teruggeeft hoort bij het zojuist uitgevoerde frame (frame - 1 na afloop).
 */
export class Sim implements SimContext {
  readonly world = new World();
  readonly flow: FlowFields;
  readonly terrain: Terrain;
  readonly map: SimMap;
  readonly config: SimConfig;
  readonly players: readonly SimPlayer[];
  readonly playerCount: number;
  readonly rng: Rng;
  readonly events = new EventBuffer();
  readonly ps = new PlayerState();
  readonly globals = new GlobalState();
  /** Indices van de claimpunten (afgeleid; opgebouwd in start() en na deserialize). */
  readonly claimPoints: number[] = [];
  readonly auras = new Auras();
  readonly robotRates = new RobotRates();
  readonly index = new EntityIndex();
  readonly terrainDist: TerrainDistances;
  /** Fog of war (sim 0.17.0): explored per player (state), visible counts (derived). */
  readonly vision: Vision;
  /** Creep camps (sim 0.20.0): state per camp (systems/creeps.ts). */
  readonly creeps = new CreepCamps();
  /** Win route C (sim 0.25.0): the parts of the strip mall (derived indices, map order) and their state. */
  readonly projectParts: number[] = [];
  readonly project = new ProjectState();
  /** Survival co-op (sim 0.27.0): wave state; `active` (derived) only with SimMap.survival. */
  readonly survival = new SurvivalState();
  /** Base defence (sim 0.29.0): `active` (derived) per game type, sim.json baseDefense. */
  readonly defense = new DefenseState();
  /** The Garde (sim 0.32.0): `active` (derived) when a player plays a faction with Garde rules. */
  readonly garde = new GardeState();

  private tickNo = 0;
  private readonly envHashValue: number;
  private readonly header = new StateHeader();
  private readonly parts: StateParts;
  private readonly moveScratch: MovementScratch;
  private readonly ordersScratch = new OrdersScratch();
  private readonly claimScratch = new ClaimScratch();
  private readonly census = new Census();
  private readonly aiScratch = new AiScratch();
  private readonly unitTypes: (SimUnitType | undefined)[] = [];
  private readonly buildingTypes: (SimBuildingType | undefined)[] = [];
  private readonly pending = new Map<number, readonly SimCommand[]>();
  private lastHash = 0;
  private hashDirty = true;

  /** Gebruik createSim() of deserialize(). */
  constructor(env: SimEnv, seed: number) {
    validateEnv(env);
    this.map = env.map;
    this.config = env.config;
    this.players = env.players.map((p) => ({ factionId: p.factionId, ai: p.ai }));
    this.playerCount = env.players.length;
    this.envHashValue = envHash(env);
    this.terrain = new Terrain(env.map);
    this.terrainDist = new TerrainDistances(env.map);
    this.flow = new FlowFields(env.map.w, env.map.h, this.terrain.walk, {
      sectorCells: env.config.pathSectorCells,
      entranceMaxCells: env.config.pathEntranceMaxCells,
      cacheCells: env.config.pathCacheCells,
    });
    this.moveScratch = new MovementScratch(env.map.w, env.map.h);
    for (const u of env.config.unitTypes) this.unitTypes[u.typeId] = u;
    for (const b of env.config.buildingTypes) this.buildingTypes[b.typeId] = b;
    this.rng = new Rng(seed);
    this.globals.winner = NO_WINNER;
    this.vision = new Vision(env.map, env.config, this.playerCount);
    // survival co-op (sim 0.27.0): the game type comes from the map; the players are one team
    this.survival.active = env.map.survival !== undefined;
    this.world.coop = this.survival.active;
    this.defense.active = defenseActive(this);
    this.world.clearOnFree.push(this.defense.mark);
    this.garde.active = gardeOn(env);
    const g = this.garde;
    this.world.clearOnFree.push(g.kills, g.rank, g.stunUntil, g.overloadAt, g.quality, g.cargoN);
    this.parts = {
      world: this.world,
      flow: this.flow,
      ps: this.ps,
      globals: this.globals,
      vision: this.vision,
      creeps: this.creeps,
      project: this.project,
      survival: this.survival,
      defense: this.defense,
      garde: this.garde,
    };
  }

  unitType(typeId: number): SimUnitType | undefined {
    return this.unitTypes[typeId];
  }

  buildingType(typeId: number): SimBuildingType | undefined {
    return this.buildingTypes[typeId];
  }

  /** Het volgende frame dat tick() uitvoert; gelijk aan het aantal uitgevoerde ticks. */
  get frame(): number {
    return this.tickNo;
  }

  /**
   * Startopstelling (map-features, hoofdgebouwen, startunits, startScrap). createSim roept dit aan; alleen
   * bruikbaar op een verse sim voor frame 0.
   */
  start(): void {
    if (this.tickNo !== 0 || this.world.highWater !== 0)
      throw new Error('start() alleen op een verse sim');
    setupStart(this);
    // creep camps (sim 0.20.0): the bandits after the players' start setup
    spawnCreepCamps(this);
    // win route C (sim 0.25.0): the ruins of the strip mall after the camps (only in the game type Bouwproject)
    spawnProjectSites(this, this.projectParts);
    indexClaimPoints(this);
    // Punten binnen de straal van een hoofdgebouw zijn meteen van die speler (besluit sprint 2), zonder events.
    updateClaimPoints(this, this.claimScratch, true);
    // de padgraaf na de hoofdgebouwen meteen bijwerken (afgeleid), zodat tick 0 dat niet hoeft te doen
    this.flow.step();
    // fog of war: the start setup already sees (and explores) its surroundings before frame 0
    this.vision.update(this.world);
    this.hashDirty = true;
  }

  /**
   * Zet de bundel voor een frame klaar. Elk commando wordt hier met zod gevalideerd (contract 2); ongeldige
   * commando's vallen stil weg. De bundel voor frame f wordt uitgevoerd door de tick van frame f.
   * Een bundel voor een al uitgevoerd frame, of een tweede bundel voor hetzelfde frame, is een programmeerfout.
   */
  applyBundle(bundle: FrameBundle): void {
    if (!isInt(bundle.frame) || bundle.frame < this.tickNo)
      throw new Error(`bundel voor frame ${bundle.frame}, sim staat op ${this.tickNo}`);
    if (this.pending.has(bundle.frame))
      throw new Error(`dubbele bundel voor frame ${bundle.frame}`);
    const cmds: SimCommand[] = [];
    for (const c of bundle.commands) {
      const n = normalizeCommand(c);
      if (n !== null) cmds.push(n);
    }
    this.pending.set(bundle.frame, cmds);
  }

  /** Of de bundel voor `frame` (standaard het volgende frame) er is. De worker-schil tickt alleen dan. */
  hasBundle(frame: number = this.tickNo): boolean {
    return this.pending.has(frame);
  }

  /** Aantal aaneengesloten bundels vanaf het volgende frame: zoveel ticks kan de sim nu achter elkaar doen. */
  readyBundles(): number {
    let n = 0;
    while (this.pending.has(this.tickNo + n)) n++;
    return n;
  }

  /** Eén tick: systemen 1 tot en met 9 in vaste volgorde (contract 1). Geeft de state-hash na deze tick. */
  tick(probe?: TickProbe): number {
    const f = this.tickNo;
    this.events.clear();
    // 1 commando's van deze tick
    const cmds = this.pending.get(f);
    if (cmds !== undefined) {
      this.pending.delete(f);
      applyCommands(this, cmds);
    }
    probe?.(0);
    // 2 orders en AI
    aiSystem(this, this.census, this.aiScratch);
    probe?.(1);
    defenseSystem(this); // sim 0.29.0: base defence, front orders before the orders run
    ordersSystem(this, this.ordersScratch);
    creepSystem(this); // sim 0.20.0: the bandits of the creep camps (no orders of their own)
    survivalSystem(this); // sim 0.27.0: the waves of the game type Survival (no orders of their own)
    probe?.(2);
    // 3 flow fields: de padgraaf bijwerken na gewijzigde begaanbaarheid; velden zelf lui en exact (flowfield.ts)
    this.flow.step();
    probe?.(3);
    // 4 beweging plus separatie (eerst de ability-zones van deze tick, ook voor gevecht)
    auraSystem(this, this.auras);
    robotRulesSystem(this, this.robotRates);
    movementSystem(this, this.moveScratch);
    probe?.(4);
    // 5 gevecht
    combatSystem(this);
    probe?.(5);
    // 6 economie: verzamelen, bouwen, omscholen, huisvestingsgroei
    economySystem(this, this.census);
    fusionCoreSystem(this); // sim 0.32.0: the fusion cores of the Garde
    mapPowerArmorSystem(this); // sim 0.33.0: the power armour of the map
    probe?.(6);
    // 7 claims en winroutes
    claimsSystem(this, this.claimScratch, this.census);
    probe?.(7);
    // 8 dood en opruimen, presentatie voor de snapshot
    cleanupSystem(this);
    probe?.(8);
    // 8b fog of war (sim 0.17.0): stamps, explored and visTo of the end-of-tick world; the next tick reads them
    this.vision.update(this.world);
    probe?.(9);
    this.tickNo = f + 1;
    // 9 hash
    this.lastHash = this.computeHash();
    this.hashDirty = false;
    probe?.(10);
    return this.lastHash;
  }

  /** FNV-1a 32-bit over de volledige state (tick, RNG, envHash, entities, flow fields, spelers, winnaar). */
  hash(): number {
    if (this.hashDirty) {
      this.lastHash = this.computeHash();
      this.hashDirty = false;
    }
    return this.lastHash;
  }

  private computeHash(): number {
    return hashState(this.header, this.parts, this.scalars());
  }

  private scalars(): { tick: number; rng: number; envHash: number } {
    return { tick: this.tickNo, rng: this.rng.state, envHash: this.envHashValue };
  }

  /** Volledige state in één ArrayBuffer. deserialize(serialize()) geeft dezelfde hash. */
  serialize(): ArrayBuffer {
    return serializeState(this.header, this.parts, this.scalars());
  }

  /** Snapshot voor de renderer (contract 1), als nieuwe transferable ArrayBuffer. Tick in de header = laatst uitgevoerde frame. */
  writeSnapshot(): ArrayBuffer {
    return writeSnapshot(
      this.world,
      this.events,
      this.tickNo > 0 ? this.tickNo - 1 : 0,
      this.hash(),
    );
  }

  /**
   * The fog of a player on the vision grid (protocol FogMask, 0.11.0; bevestigd in fase-0 sectie 23 besluit 1): explored and visible as bitsets, copies.
   * For the HUD and the render (minimap, fog overlay), on request like the player status.
   */
  fogMask(playerId: number): FogMask {
    return fogMaskOf(this, playerId);
  }

  /** Spelerstatus voor de HUD (queryMessage, contract 1). hero is null als de factie geen held heeft. */
  playerStatus(playerId: number): PlayerStatus {
    return playerStatusOf(this, this.census, playerId);
  }

  /**
   * Chem per eenheid van een speler (PlayerStatus.chems, protocol 0.13.0, voorstel): elke eigen eenheid met een chem in
   * een fase, oplopend op entity-id (= op index). Leest alleen state; geen wijziging in de hash.
   */
  chems(playerId: number): ChemStatus[] {
    return chemsOf(this, playerId);
  }

  /**
   * Dominantie van een speler voor de HUD (PlayerStatus.dominance, protocol 0.6.0): claimpunten en ticks van de speler
   * zelf, en de tegenstander die het dichtst bij dominantie is (null zonder tegenstander die nog meedoet).
   */
  dominance(playerId: number): DominanceStatus {
    if (!isInt(playerId) || playerId < 0 || playerId >= this.playerCount)
      throw new Error(`onbekende speler ${playerId}`);
    return dominanceStatus(this, playerId);
  }

  /**
   * Lopend werk van een speler voor het gebouwpaneel van de HUD (PlayerStatus.queue, speltest 14 oktober, architect-
   * besluit sectie 16): onderzoek per gebouw (unitId ENTITY_NONE) en omscholing per bewoner (unitId = de bewoner,
   * buildingId = de werkplaats waar hij staat, ENTITY_NONE zolang hij onderweg is; 0 promille onderweg en zolang hij op
   * scrap wacht). Oplopend op buildingId, dan unitId.
   */
  queue(playerId: number): QueueItem[] {
    return queueOf(this, playerId);
  }

  /** Survival co-op (sim 0.27.0): waves, next wave and targets for the HUD; null outside the game type Survival. */
  survivalStatus(): SurvivalStatus | null {
    return survivalStatusOf(this);
  }

  /** De winnaar, of null zolang het potje loopt. */
  winner(): SimWinner | null {
    return winnerOf(this);
  }

  /** Of een speler af is (hoofdgebouw kwijt of opgegeven). */
  isDefeated(playerId: number): boolean {
    return playerId >= 0 && playerId < MAX_PLAYERS && this.ps.defeated[playerId] !== 0;
  }

  /** Onderzochte tech-ids van een speler, oplopend (debug, tests; de HUD heeft hiervoor nog geen contractveld). */
  researched(playerId: number): number[] {
    const out: number[] = [];
    if (playerId < 0 || playerId >= MAX_PLAYERS) return out;
    for (const t of this.config.techs) if (hasTech(this.ps, playerId, t.techId)) out.push(t.techId);
    return out;
  }

  /** Ticks dat een speler aaneengesloten genoeg claimpunten houdt (winroute B). */
  dominanceTicks(playerId: number): number {
    return this.ps.domTicks[playerId] ?? 0;
  }

  /**
   * Spawn-helper voor tests en tools (buiten de lockstep om). Geeft de entity-id, of NO_ENTITY (0) als het type
   * onbekend is, de eigenaar ongeldig, de positie buiten de map of geblokkeerd, of de wereld vol.
   */
  spawnUnit(spec: SpawnUnitSpec): number {
    const id = spawnUnitIn(this, spec);
    if (id !== NO_ENTITY) this.hashDirty = true;
    return id;
  }

  /** Gebouw-helper voor tests en tools: footprint met oorsprong (fx, fy) in cellen. NO_ENTITY als het niet past. */
  spawnBuilding(typeId: number, owner: number, fx: number, fy: number, done = true): number {
    const id = spawnBuildingIn(this, typeId, owner, fx, fy, done);
    if (id !== NO_ENTITY) this.hashDirty = true;
    return id;
  }

  /** Zet de scrap van een speler (tests en tools). */
  setScrap(playerId: number, scrap: number): void {
    this.ps.scrap[playerId] = scrap;
    this.hashDirty = true;
  }

  /** Verwijdert een unit direct (tests). False bij een ongeldige id of een gebouw. */
  destroyEntity(id: number): boolean {
    const ok = destroyEntityIn(this, id);
    if (ok) this.hashDirty = true;
    return ok;
  }

  /** Aantal levende entities. */
  get entityCount(): number {
    return this.world.liveCount();
  }

  /** Ids van alle levende entities, oplopend. */
  entityIds(): number[] {
    const w = this.world;
    const out: number[] = [];
    for (let i = 0; i < w.highWater; i++) if (w.alive[i] === 1) out.push(w.idOf(i));
    return out;
  }

  getUnit(id: number): UnitView | null {
    return unitViewOf(this, id);
  }

  /** @internal Laadt een geserialiseerde state in deze (verse) sim. */
  loadState(buf: ArrayBuffer): void {
    const s = deserializeState(buf, this.parts, this.envHashValue);
    this.tickNo = s.tick;
    this.rng.state = s.rng;
    rebuildDerived(this);
    this.hashDirty = true;
  }
}

/** Maakt een nieuwe sim met startopstelling (tenzij opts.start === false). Valideert de invoer; gooit bij ongeldige invoer. */
export function createSim(init: SimInit, opts: CreateSimOptions = {}): Sim {
  if (!isInt(init.seed) || init.seed < 0 || init.seed > 0xffffffff)
    throw new Error(`SimInit ongeldig: seed ${init.seed}`);
  const { seed, ...env } = init;
  const sim = new Sim(env, seed);
  if (opts.start !== false) sim.start();
  return sim;
}

/** Laadt een state uit serialize(). De omgeving (map, config, spelers) moet dezelfde zijn; anders gooit hij. */
export function deserialize(buf: ArrayBuffer, env: SimEnv): Sim {
  const sim = new Sim(env, 0);
  sim.loadState(buf);
  return sim;
}
