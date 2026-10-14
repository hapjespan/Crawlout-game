import type { FrameBundle, PlayerStatus } from '@crawlout/protocol';
import { MAX_PLAYERS } from '@crawlout/protocol';
import type { SimBuildingType, SimConfig, SimEnv, SimInit, SimMap, SimPlayer, SimUnitType } from './config.js';
import { envHash, validateEnv } from './config.js';
import { C, NO_ENTITY, NO_FIELD, World } from './ecs/world.js';
import { createBuilding, createUnit, footprintFree } from './entities.js';
import { EventBuffer } from './events.js';
import { FlowFields, MAX_FLOW_FIELDS } from './flowfield.js';
import { isInt } from './math/int.js';
import { Rng } from './rng.js';
import { writeSnapshot } from './snapshot.js';
import { setupStart } from './start.js';
import type { StateParts } from './state.js';
import { StateHeader, deserializeState, hashState, serializeState } from './state.js';
import { aiSystem } from './systems/ai.js';
import { Census, takeCensus } from './systems/census.js';
import { ClaimScratch, claimsSystem, updateClaimPoints } from './systems/claims.js';
import { cleanupSystem } from './systems/cleanup.js';
import { combatSystem } from './systems/combat.js';
import type { SimCommand } from './systems/commands.js';
import { applyCommands, normalizeCommand } from './systems/commands.js';
import type { SimContext } from './systems/common.js';
import { GlobalState, NO_WINNER, PlayerState, Terrain, WIN_DOMINANCE, WIN_SURRENDER, inMap, setFlowField, walkableAt } from './systems/common.js';
import { economySystem } from './systems/economy.js';
import { Auras, auraSystem, heroStatus } from './systems/hero.js';
import { MovementScratch, movementSystem } from './systems/movement.js';
import { OrdersScratch, ordersSystem } from './systems/orders.js';

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

  private tickNo = 0;
  private readonly envHashValue: number;
  private readonly header = new StateHeader();
  private readonly parts: StateParts;
  private readonly moveScratch: MovementScratch;
  private readonly ordersScratch = new OrdersScratch();
  private readonly claimScratch = new ClaimScratch();
  private readonly census = new Census();
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
    this.flow = new FlowFields(env.map.w, env.map.h, this.terrain.walk);
    this.moveScratch = new MovementScratch(env.map.w, env.map.h);
    for (const u of env.config.unitTypes) this.unitTypes[u.typeId] = u;
    for (const b of env.config.buildingTypes) this.buildingTypes[b.typeId] = b;
    this.rng = new Rng(seed);
    this.globals.winner = NO_WINNER;
    this.parts = { world: this.world, flow: this.flow, ps: this.ps, globals: this.globals };
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
    if (this.tickNo !== 0 || this.world.highWater !== 0) throw new Error('start() alleen op een verse sim');
    setupStart(this);
    this.indexClaimPoints();
    // Punten binnen de straal van een hoofdgebouw zijn meteen van die speler (besluit sprint 2), zonder events.
    updateClaimPoints(this, this.claimScratch, true);
    this.hashDirty = true;
  }

  /**
   * Zet de bundel voor een frame klaar. Elk commando wordt hier met zod gevalideerd (contract 2); ongeldige
   * commando's vallen stil weg. De bundel voor frame f wordt uitgevoerd door de tick van frame f.
   * Een bundel voor een al uitgevoerd frame, of een tweede bundel voor hetzelfde frame, is een programmeerfout.
   */
  applyBundle(bundle: FrameBundle): void {
    if (!isInt(bundle.frame) || bundle.frame < this.tickNo) throw new Error(`bundel voor frame ${bundle.frame}, sim staat op ${this.tickNo}`);
    if (this.pending.has(bundle.frame)) throw new Error(`dubbele bundel voor frame ${bundle.frame}`);
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
  tick(): number {
    const f = this.tickNo;
    this.events.clear();
    // 1 commando's van deze tick
    const cmds = this.pending.get(f);
    if (cmds !== undefined) {
      this.pending.delete(f);
      applyCommands(this, cmds);
    }
    // 2 orders en AI
    aiSystem(this, this.census);
    ordersSystem(this, this.ordersScratch);
    // 3 flow fields, gebudgetteerd
    this.flow.step(this.config.flowFieldBudget);
    // 4 beweging plus separatie (eerst de ability-zones van deze tick, ook voor gevecht)
    auraSystem(this, this.auras);
    movementSystem(this, this.moveScratch);
    // 5 gevecht
    combatSystem(this);
    // 6 economie: verzamelen, bouwen, omscholen, huisvestingsgroei
    economySystem(this, this.census);
    // 7 claims en winroutes
    claimsSystem(this, this.claimScratch, this.census);
    // 8 dood en opruimen, presentatie voor de snapshot
    cleanupSystem(this);
    this.tickNo = f + 1;
    // 9 hash
    this.lastHash = this.computeHash();
    this.hashDirty = false;
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
    return writeSnapshot(this.world, this.events, this.tickNo > 0 ? this.tickNo - 1 : 0, this.hash());
  }

  /** Spelerstatus voor de HUD (queryMessage, contract 1). hero is null als de factie geen held heeft. */
  playerStatus(playerId: number): PlayerStatus {
    if (!isInt(playerId) || playerId < 0 || playerId >= this.playerCount) throw new Error(`onbekende speler ${playerId}`);
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
    };
  }

  /** De winnaar, of null zolang het potje loopt. */
  winner(): SimWinner | null {
    const g = this.globals;
    if (g.winner === NO_WINNER) return null;
    const reason: WinReason = g.reason === WIN_DOMINANCE ? 'dominance' : g.reason === WIN_SURRENDER ? 'surrender' : 'destruction';
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
    if (!isInt(spec.x) || !isInt(spec.y) || !inMap(this.map, spec.x, spec.y) || !walkableAt(this, spec.x, spec.y)) return NO_ENTITY;
    const i = createUnit(this, t, spec.owner, spec.x, spec.y, spec.yaw ?? 0);
    if (i < 0) return NO_ENTITY;
    this.hashDirty = true;
    return this.world.idOf(i);
  }

  /** Gebouw-helper voor tests en tools: footprint met oorsprong (fx, fy) in cellen. NO_ENTITY als het niet past. */
  spawnBuilding(typeId: number, owner: number, fx: number, fy: number, done = true): number {
    const bt = this.buildingTypes[typeId];
    if (bt === undefined || !isInt(owner) || owner < 0 || owner >= this.playerCount) return NO_ENTITY;
    if (!footprintFree(this, fx, fy, bt.footprintW, bt.footprintH)) return NO_ENTITY;
    const i = createBuilding(this, bt, owner, fx, fy, done);
    if (i < 0) return NO_ENTITY;
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
    this.hashDirty = true;
  }
}

/** Maakt een nieuwe sim met startopstelling (tenzij opts.start === false). Valideert de invoer; gooit bij ongeldige invoer. */
export function createSim(init: SimInit, opts: CreateSimOptions = {}): Sim {
  if (!isInt(init.seed) || init.seed < 0 || init.seed > 0xffffffff) throw new Error(`SimInit ongeldig: seed ${init.seed}`);
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
