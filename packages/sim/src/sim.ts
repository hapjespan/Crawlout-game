import type {
  ChemStatus,
  DominanceStatus,
  FogMask,
  FrameBundle,
  PlayerStatus,
  QueueItem,
} from '@crawlout/protocol';
import { ENTITY_NONE, MAX_PLAYERS } from '@crawlout/protocol';
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
import {
  C,
  CHEM_ACTIVE,
  CHEM_CRASH,
  CHEM_NONE,
  JOB_PRODUCE,
  JOB_TRAIN,
  NO_ENTITY,
  NO_FIELD,
  ORDER_CRAFT,
  PHASE_CRAFT,
  PHASE_WORK,
  World,
} from './ecs/world.js';
import { PROGRESS_ONE, createBuilding, createUnit, footprintFree } from './entities.js';
import { EventBuffer } from './events.js';
import { FlowFields, MAX_FLOW_FIELDS } from './flowfield.js';
import { clampI, idiv, isInt } from './math/int.js';
import { Rng } from './rng.js';
import { writeSnapshot } from './snapshot.js';
import { setupStart } from './start.js';
import type { StateParts } from './state.js';
import { StateHeader, deserializeState, hashState, serializeState } from './state.js';
import { AiScratch, aiSystem } from './systems/ai.js';
import { TerrainDistances } from './pathdist.js';
import { Census, takeCensus } from './systems/census.js';
import {
  ClaimScratch,
  claimPointStatus,
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
import {
  EntityIndex,
  GlobalState,
  NO_WINNER,
  PlayerState,
  Terrain,
  WIN_DOMINANCE,
  WIN_SURRENDER,
  inMap,
  nearestOwnBuilding,
  setFlowField,
  walkableAt,
} from './systems/common.js';
import { economySystem } from './systems/economy.js';
import { Auras, auraSystem, heroStatus } from './systems/hero.js';
import { RobotRates, robotRulesSystem } from './systems/robots.js';
import { trainTicks, trainedOf } from './systems/training.js';
import { MovementScratch, movementSystem } from './systems/movement.js';
import { OrdersScratch, craftSiteMask, ordersSystem } from './systems/orders.js';
import { Vision } from './vision.js';

export interface SpawnUnitSpec {
  readonly typeId: number;
  readonly owner: number;
  readonly x: number;
  readonly y: number;
  readonly yaw?: number;
}

/** Soort entity, voor tests, debug en de query-API. */
export type EntityKind = 'unit' | 'hero' | 'corpse' | 'building' | 'scrapNode' | 'claimPoint';

/** Leesbare kijk op één entity, voor tests en debug. De renderer gebruikt snapshots, nooit dit. */
export interface UnitView {
  readonly id: number;
  readonly kind: EntityKind;
  readonly typeId: number;
  readonly owner: number;
  readonly x: number;
  readonly y: number;
  readonly yaw: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly moving: boolean;
  readonly flowField: number;
  readonly role: number;
  readonly loadoutId: number;
  /** Type van de huidige order (ORDER_* in ecs/world.ts), 0 = geen. */
  readonly order: number;
  readonly phase: number;
  readonly target: number;
  /** ordT van de huidige order: de bouwplaats bij Build, de node bij Gather, het doel bij Attack (Move: groepsstraal); 0 = geen order. */
  readonly orderTarget: number;
  /** Bouwer: de onthouden onafgemaakte bouwplaats waar hij zonder taak naar terugkeert, 0 = geen. */
  readonly resumeSite: number;
  readonly carry: number;
  /** Gebouw: 1 in aanbouw, 2 af; anders 0. */
  readonly buildState: number;
  readonly progress: number;
  /** Scrap-node: voorraad. */
  readonly amount: number;
  /** Claimpunt: wie neemt en hoe ver (ticks). */
  readonly claimBy: number;
  readonly claimProgress: number;
}

export type WinReason = 'destruction' | 'dominance' | 'surrender';

export interface SimWinner {
  readonly playerId: number;
  readonly reason: WinReason;
  /** Frame waarin de winnaar vaststond. */
  readonly frame: number;
}

export interface CreateSimOptions {
  /** false: geen startopstelling (lege wereld, voor tests). Standaard true. */
  readonly start?: boolean;
}

/**
 * De lockstep-simulatie. Een pure functie van (seed, env, bundels per frame) naar state.
 *
 * Frames: `frame` is het volgende frame dat tick() uitvoert (begint op 0). tick() voert eerst de commando's
 * uit de bundel voor dat frame uit, daarna de systemen in vaste volgorde, en eindigt met hash(). De hash die
 * tick() teruggeeft hoort bij het zojuist uitgevoerde frame (frame - 1 na afloop).
 */
/**
 * Meetpunt voor de benchmark (bench/profile.ts): tick(probe) roept probe(k) aan na stap k (TICK_STAGES). Geen klok in de
 * sim; de harnas meet de tijd tussen twee aanroepen. Zonder probe verandert er niets.
 */
export type TickProbe = (stage: number) => void;

/** Namen van de meetpunten van TickProbe, op index. */
export const TICK_STAGES = [
  'commands',
  'ai',
  'orders',
  'flow',
  'move',
  'combat',
  'economy',
  'claims',
  'cleanup',
  'vision',
  'hash',
] as const;

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
    this.parts = {
      world: this.world,
      flow: this.flow,
      ps: this.ps,
      globals: this.globals,
      vision: this.vision,
      creeps: this.creeps,
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
    this.indexClaimPoints();
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
    ordersSystem(this, this.ordersScratch);
    creepSystem(this); // sim 0.20.0: the bandits of the creep camps (no orders of their own)
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
    if (!isInt(playerId) || playerId < 0 || playerId >= this.playerCount)
      throw new Error(`onbekende speler ${playerId}`);
    const v = this.vision;
    const explored = v.explored.slice(playerId * v.bytes, (playerId + 1) * v.bytes);
    const visible = new Uint8Array(v.bytes);
    const base = playerId * v.cells;
    for (let c = 0; c < v.cells; c++)
      if (v.count[base + c]! > 0) visible[c >> 3] = visible[c >> 3]! | (1 << (c & 7));
    return {
      frame: this.tickNo > 0 ? this.tickNo - 1 : 0,
      playerId,
      cellsW: v.gw,
      cellsH: v.gh,
      cellUnits: 1 << v.shift,
      explored,
      visible,
    };
  }

  /** Spelerstatus voor de HUD (queryMessage, contract 1). hero is null als de factie geen held heeft. */
  playerStatus(playerId: number): PlayerStatus {
    if (!isInt(playerId) || playerId < 0 || playerId >= this.playerCount)
      throw new Error(`onbekende speler ${playerId}`);
    takeCensus(this, this.census);
    return {
      playerId,
      scrap: this.ps.scrap[playerId]!,
      settlers: this.census.settlers[playerId]!,
      pop: this.census.pop[playerId]!,
      popCap: this.census.popCap(this, playerId),
      beds: this.census.beds[playerId]!,
      hero: heroStatus(this, playerId),
      techs: this.researched(playerId), // besluit sprint 3 (architect): de HUD filtert bouwmenu en craft-opties op prereqTech
      queue: this.queue(playerId),
      dominance: this.dominance(playerId), // protocol 0.6.0: winroute B voor de HUD
      robotPop: this.census.robotPop[playerId]!, // protocol 0.8.0: robots tellen niet voor bedden
      trained: trainedOf(this, playerId) as NonNullable<PlayerStatus['trained']>, // protocol 0.8.0
      chems: this.chems(playerId), // protocol 0.13.0 (voorstel): chem-dosis per eenheid voor de Chem-dealer in de HUD
      claimPoints: claimPointStatus(this), // protocol 0.10.0 (bevestigd in fase-0 sectie 22 besluit 3): claimstand voor de ring in de HUD
    };
  }

  /**
   * Chem per eenheid van een speler (PlayerStatus.chems, protocol 0.13.0, voorstel): elke eigen eenheid met een chem in
   * een fase, oplopend op entity-id (= op index). Leest alleen state; geen wijziging in de hash.
   */
  chems(playerId: number): ChemStatus[] {
    const w = this.world;
    const out: ChemStatus[] = [];
    for (let i = 0; i < w.highWater; i++) {
      if (w.alive[i] !== 1 || w.owner[i] !== playerId || w.chemPhase[i] === CHEM_NONE) continue;
      const ph = w.chemPhase[i]!;
      out.push({
        unitId: w.idOf(i),
        chem: w.chem[i]! - 1,
        phase: ph === CHEM_ACTIVE ? 'active' : ph === CHEM_CRASH ? 'crash' : 'cooldown',
        ticksLeft: w.chemTicks[i]!,
      });
    }
    return out;
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
    const w = this.world;
    const out: QueueItem[] = [];
    for (let i = 0; i < w.highWater; i++) {
      if (
        w.alive[i] !== 1 ||
        w.owner[i] !== playerId ||
        w.research[i] === 0 ||
        !w.has(i, C.building)
      )
        continue;
      const t = this.config.techs[w.research[i]! - 1];
      if (t === undefined) continue;
      const total = t.researchTicks * PROGRESS_ONE;
      out.push({
        kind: 'research',
        buildingId: w.idOf(i),
        unitId: ENTITY_NONE,
        id: t.techId,
        progressPermille: permille(w.work[i]!, total),
      });
    }
    for (let i = 0; i < w.highWater; i++) {
      if (
        w.alive[i] !== 1 ||
        w.owner[i] !== playerId ||
        !w.has(i, C.unit | C.orders) ||
        w.orderType(i) !== ORDER_CRAFT
      )
        continue;
      const phase = w.phase[i]!;
      const t = this.unitTypes[w.ordX[w.currentOrder(i)]!];
      if (t === undefined) continue;
      // bij de werkplaats (systeem 2 zet PHASE_WORK pas binnen interactRange): de werkplaats waar hij staat
      const at =
        phase === PHASE_WORK || phase === PHASE_CRAFT
          ? nearestOwnBuilding(this, playerId, w.x[i]!, w.y[i]!, craftSiteMask(this, t.typeId))
          : -1;
      const progress = phase === PHASE_CRAFT ? permille(w.work[i]!, t.craftTicks) : 0;
      out.push({
        kind: 'craft',
        buildingId: at < 0 ? ENTITY_NONE : w.idOf(at),
        unitId: w.idOf(i),
        id: t.loadoutId,
        progressPermille: progress,
      });
    }
    // data 0.16.0 (protocol 0.8.0): robotproductie en training per gebouw
    for (let i = 0; i < w.highWater; i++) {
      if (w.alive[i] !== 1 || w.owner[i] !== playerId || w.job[i] === 0 || !w.has(i, C.building))
        continue;
      if (w.jobKind[i] === JOB_PRODUCE) {
        const t = this.unitTypes[w.job[i]!];
        if (t === undefined) continue;
        out.push({
          kind: 'produce',
          buildingId: w.idOf(i),
          unitId: ENTITY_NONE,
          id: t.loadoutId,
          progressPermille: permille(w.jobWork[i]!, t.craftTicks),
        });
      } else if (w.jobKind[i] === JOB_TRAIN) {
        const tr = this.config.training[w.job[i]! - 1];
        if (tr === undefined) continue;
        out.push({
          kind: 'train',
          buildingId: w.idOf(i),
          unitId: ENTITY_NONE,
          id: tr.programId,
          progressPermille: permille(w.jobWork[i]!, trainTicks(this, playerId, tr)),
        });
      }
    }
    // oplopend op buildingId, dan unitId (contract 1); bij research is unitId ENTITY_NONE en een gebouw heeft één onderzoek
    out.sort((a, b) => a.buildingId - b.buildingId || a.unitId! - b.unitId!);
    return out;
  }

  /** De winnaar, of null zolang het potje loopt. */
  winner(): SimWinner | null {
    const g = this.globals;
    if (g.winner === NO_WINNER) return null;
    const reason: WinReason =
      g.reason === WIN_DOMINANCE
        ? 'dominance'
        : g.reason === WIN_SURRENDER
          ? 'surrender'
          : 'destruction';
    return { playerId: g.winner, reason, frame: g.frame };
  }

  /** Of een speler af is (hoofdgebouw kwijt of opgegeven). */
  isDefeated(playerId: number): boolean {
    return playerId >= 0 && playerId < MAX_PLAYERS && this.ps.defeated[playerId] !== 0;
  }

  /** Onderzochte tech-ids van een speler, oplopend (debug, tests; de HUD heeft hiervoor nog geen contractveld). */
  researched(playerId: number): number[] {
    const bits = this.ps.tech[playerId] ?? 0;
    const out: number[] = [];
    for (const t of this.config.techs) if (((bits >>> t.techId) & 1) !== 0) out.push(t.techId);
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
    const t = isInt(spec.typeId) ? this.unitTypes[spec.typeId] : undefined;
    if (t === undefined) return NO_ENTITY;
    if (!isInt(spec.owner) || spec.owner < 0 || spec.owner >= this.playerCount) return NO_ENTITY;
    if (
      !isInt(spec.x) ||
      !isInt(spec.y) ||
      !inMap(this.map, spec.x, spec.y) ||
      !walkableAt(this, spec.x, spec.y)
    )
      return NO_ENTITY;
    const i = createUnit(this, t, spec.owner, spec.x, spec.y, spec.yaw ?? 0);
    if (i < 0) return NO_ENTITY;
    this.vision.update(this.world);
    this.hashDirty = true;
    return this.world.idOf(i);
  }

  /** Gebouw-helper voor tests en tools: footprint met oorsprong (fx, fy) in cellen. NO_ENTITY als het niet past. */
  spawnBuilding(typeId: number, owner: number, fx: number, fy: number, done = true): number {
    const bt = this.buildingTypes[typeId];
    if (bt === undefined || !isInt(owner) || owner < 0 || owner >= this.playerCount)
      return NO_ENTITY;
    if (!footprintFree(this, fx, fy, bt.footprintW, bt.footprintH)) return NO_ENTITY;
    const i = createBuilding(this, bt, owner, fx, fy, done);
    if (i < 0) return NO_ENTITY;
    this.vision.update(this.world);
    this.hashDirty = true;
    return this.world.idOf(i);
  }

  /** Zet de scrap van een speler (tests en tools). */
  setScrap(playerId: number, scrap: number): void {
    this.ps.scrap[playerId] = scrap;
    this.hashDirty = true;
  }

  /** Verwijdert een unit direct (tests). False bij een ongeldige id of een gebouw. */
  destroyEntity(id: number): boolean {
    const i = this.world.resolve(id);
    if (i < 0 || this.world.has(i, C.building)) return false;
    setFlowField(this, i, NO_FIELD);
    this.world.free(i);
    this.vision.update(this.world);
    this.hashDirty = true;
    return true;
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
    const w = this.world;
    const i = w.resolve(id);
    if (i < 0) return null;
    const m = w.mask[i]!;
    const kind: EntityKind =
      (m & C.corpse) !== 0
        ? 'corpse'
        : (m & C.building) !== 0
          ? 'building'
          : (m & C.resource) !== 0
            ? 'scrapNode'
            : (m & C.claim) !== 0
              ? 'claimPoint'
              : (m & C.hero) !== 0
                ? 'hero'
                : 'unit';
    const o = w.currentOrder(i);
    return {
      id,
      kind,
      typeId: w.typeId[i]!,
      owner: w.owner[i]!,
      x: w.x[i]!,
      y: w.y[i]!,
      yaw: w.yaw[i]!,
      hp: w.hp[i]!,
      maxHp: w.maxHp[i]!,
      moving: w.mvOn[i] === 1,
      flowField: w.flowField[i]!,
      role: w.role[i]!,
      loadoutId: w.loadoutId[i]!,
      order: o < 0 ? 0 : w.ordType[o]!,
      phase: w.phase[i]!,
      target: w.target[i]!,
      orderTarget: o < 0 ? 0 : w.ordT[o]!,
      resumeSite: w.resumeSite[i]!,
      carry: w.carry[i]!,
      buildState: w.bstate[i]!,
      progress: w.progress[i]!,
      amount: w.amount[i]!,
      claimBy: w.claimBy[i]!,
      claimProgress: w.claimProgress[i]!,
    };
  }

  private indexClaimPoints(): void {
    const w = this.world;
    this.claimPoints.length = 0;
    for (let i = 0; i < w.highWater; i++) if (w.has(i, C.claim)) this.claimPoints.push(i);
  }

  /** @internal Laadt een geserialiseerde state in deze (verse) sim. */
  loadState(buf: ArrayBuffer): void {
    const s = deserializeState(buf, this.parts, this.envHashValue);
    this.tickNo = s.tick;
    this.rng.state = s.rng;
    this.world.structVersion++;
    // afgeleide data opnieuw opbouwen: begaanbaarheid, refcounts, flow fields
    const w = this.world;
    this.terrain.rebuild(w);
    this.flow.refcount.fill(0);
    for (let i = 0; i < w.highWater; i++) {
      if (w.alive[i] !== 1) continue;
      const f = w.flowField[i]!;
      if (f === NO_FIELD) continue;
      if (f >= MAX_FLOW_FIELDS) throw new Error(`state: entity ${i} wijst naar flow field ${f}`);
      this.flow.refcount[f] = this.flow.refcount[f]! + 1;
    }
    this.flow.rebuild();
    this.indexClaimPoints();
    this.vision.rebuild(w);
    this.hashDirty = true;
  }
}

/** a van b in promille, 0..1000 (b <= 0 telt als klaar). */
const permille = (a: number, b: number): number =>
  b <= 0 ? 1000 : clampI(idiv(a * 1000, b), 0, 1000);

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
