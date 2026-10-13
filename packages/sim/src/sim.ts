import { EVENT_TYPE } from '@crawlout/protocol';
import type { CommandEnvelope, FrameBundle } from '@crawlout/protocol';
import type { SimConfig, SimEnv, SimInit, SimMap, SimUnitType } from './config.js';
import { envHash, validateEnv } from './config.js';
import { C, NO_ENTITY, NO_FIELD, NO_GOAL, World } from './ecs/world.js';
import { EventBuffer } from './events.js';
import { FlowFields, MAX_FLOW_FIELDS } from './flowfield.js';
import { isInt } from './math/int.js';
import { Rng } from './rng.js';
import { writeSnapshot } from './snapshot.js';
import { StateHeader, deserializeState, hashState, serializeState } from './state.js';
import { applyCommands } from './systems/commands.js';
import type { SimContext } from './systems/common.js';
import { inMap, passableAt, setFlowField } from './systems/common.js';
import { MovementScratch, movementSystem } from './systems/movement.js';

export interface SpawnUnitSpec {
  readonly typeId: number;
  readonly owner: number;
  readonly x: number;
  readonly y: number;
  readonly yaw?: number;
}

/** Leesbare kijk op één unit, voor tests en debug. De renderer gebruikt snapshots, nooit dit. */
export interface UnitView {
  readonly id: number;
  readonly typeId: number;
  readonly owner: number;
  readonly x: number;
  readonly y: number;
  readonly yaw: number;
  readonly hp: number;
  readonly moving: boolean;
  readonly flowField: number;
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
  readonly map: SimMap;
  readonly config: SimConfig;
  readonly playerCount: number;
  readonly rng: Rng;
  readonly events = new EventBuffer();

  private tickNo = 0;
  private readonly envHashValue: number;
  private readonly header = new StateHeader();
  private readonly moveScratch: MovementScratch;
  private readonly unitTypes: (SimUnitType | undefined)[] = [];
  private readonly pending = new Map<number, readonly CommandEnvelope[]>();
  private lastHash = 0;
  private hashDirty = true;

  /** Gebruik createSim() of deserialize(). */
  constructor(env: SimEnv, seed: number) {
    validateEnv(env);
    this.map = env.map;
    this.config = env.config;
    this.playerCount = env.playerCount;
    this.envHashValue = envHash(env);
    this.flow = new FlowFields(env.map);
    this.moveScratch = new MovementScratch(env.map.w, env.map.h);
    for (const u of env.config.unitTypes) this.unitTypes[u.typeId] = u;
    this.rng = new Rng(seed);
  }

  /** Het volgende frame dat tick() uitvoert; gelijk aan het aantal uitgevoerde ticks. */
  get frame(): number {
    return this.tickNo;
  }

  /**
   * Zet de bundel voor een frame klaar. De bundel voor frame f wordt uitgevoerd door de tick van frame f.
   * Een bundel voor een al uitgevoerd frame, of een tweede bundel voor hetzelfde frame, is een programmeerfout.
   */
  applyBundle(bundle: FrameBundle): void {
    if (!isInt(bundle.frame) || bundle.frame < this.tickNo) throw new Error(`bundel voor frame ${bundle.frame}, sim staat op ${this.tickNo}`);
    if (this.pending.has(bundle.frame)) throw new Error(`dubbele bundel voor frame ${bundle.frame}`);
    this.pending.set(bundle.frame, bundle.commands);
  }

  /** Of de bundel voor `frame` (standaard het volgende frame) er is. De worker-schil tickt alleen dan. */
  hasBundle(frame: number = this.tickNo): boolean {
    return this.pending.has(frame);
  }

  /** Eén tick: systemen 1 tot en met 9 in vaste volgorde. Geeft de state-hash na deze tick. */
  tick(): number {
    const f = this.tickNo;
    this.events.clear();
    // 1 commando's van deze tick
    const cmds = this.pending.get(f);
    if (cmds !== undefined) {
      this.pending.delete(f);
      applyCommands(this, cmds);
    }
    // 2 orders en AI: in sprint 1 alleen Move, afgehandeld in beweging
    // 3 flow fields, gebudgetteerd
    this.flow.step(this.config.flowFieldBudget);
    // 4 beweging plus separatie
    movementSystem(this, this.moveScratch);
    // 5 gevecht, 6 economie, 7 claims en winroutes, 8 dood en opruimen: sprint 2
    this.tickNo = f + 1;
    // 9 hash
    this.lastHash = this.computeHash();
    this.hashDirty = false;
    return this.lastHash;
  }

  /** FNV-1a 32-bit over de volledige state (tick, RNG, envHash, alle componentarrays, flow-field-state). */
  hash(): number {
    if (this.hashDirty) {
      this.lastHash = this.computeHash();
      this.hashDirty = false;
    }
    return this.lastHash;
  }

  private computeHash(): number {
    return hashState(this.header, this.world, this.flow, this.scalars());
  }

  private scalars(): { tick: number; rng: number; envHash: number } {
    return { tick: this.tickNo, rng: this.rng.state, envHash: this.envHashValue };
  }

  /** Volledige state in één ArrayBuffer. deserialize(serialize()) geeft dezelfde hash. */
  serialize(): ArrayBuffer {
    return serializeState(this.header, this.world, this.flow, this.scalars());
  }

  /** Snapshot voor de renderer (contract 1), als nieuwe transferable ArrayBuffer. Tick in de header = laatst uitgevoerde frame. */
  writeSnapshot(): ArrayBuffer {
    return writeSnapshot(this.world, this.events, this.tickNo > 0 ? this.tickNo - 1 : 0, this.hash());
  }

  /**
   * Spawn-helper voor tests, scenario's en (later) de startopstelling. Geeft de entity-id, of NO_ENTITY (0)
   * als het type onbekend is, de eigenaar ongeldig, de positie buiten de map of geblokkeerd, of de wereld vol.
   */
  spawnUnit(spec: SpawnUnitSpec): number {
    const t = isInt(spec.typeId) ? this.unitTypes[spec.typeId] : undefined;
    if (t === undefined) return NO_ENTITY;
    if (!isInt(spec.owner) || spec.owner < 0 || spec.owner >= this.playerCount) return NO_ENTITY;
    if (!isInt(spec.x) || !isInt(spec.y) || !inMap(this.map, spec.x, spec.y) || !passableAt(this.map, spec.x, spec.y)) return NO_ENTITY;
    const w = this.world;
    const i = w.alloc();
    if (i < 0) return NO_ENTITY;
    w.mask[i] = C.transform | C.movement | C.health | C.owner | C.unit | C.orders;
    w.x[i] = spec.x;
    w.y[i] = spec.y;
    w.yaw[i] = (spec.yaw ?? 0) & 0xffff;
    w.speed[i] = t.speed;
    w.radius[i] = t.radius;
    w.flowField[i] = NO_FIELD;
    w.goalX[i] = NO_GOAL;
    w.goalY[i] = NO_GOAL;
    w.hp[i] = t.maxHp;
    w.maxHp[i] = t.maxHp;
    w.armorType[i] = t.armorType;
    w.owner[i] = spec.owner;
    w.typeId[i] = t.typeId;
    w.bodyType[i] = t.bodyType;
    w.loadoutId[i] = t.loadoutId;
    w.role[i] = t.role;
    const id = w.idOf(i);
    this.events.push(EVENT_TYPE.spawn, id, t.typeId, spec.x, spec.y);
    this.hashDirty = true;
    return id;
  }

  /** Verwijdert een entity direct (tests; sprint 2 krijgt een doodsysteem). False bij een ongeldige id. */
  destroyEntity(id: number): boolean {
    const i = this.world.resolve(id);
    if (i < 0) return false;
    setFlowField(this, i, NO_FIELD);
    this.events.push(EVENT_TYPE.death, id, 0, this.world.x[i]!, this.world.y[i]!);
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
    return {
      id,
      typeId: w.typeId[i]!,
      owner: w.owner[i]!,
      x: w.x[i]!,
      y: w.y[i]!,
      yaw: w.yaw[i]!,
      hp: w.hp[i]!,
      moving: w.ordCount[i]! > 0,
      flowField: w.flowField[i]!,
    };
  }

  /** @internal Laadt een geserialiseerde state in deze (verse) sim. */
  loadState(buf: ArrayBuffer): void {
    const s = deserializeState(buf, this.world, this.flow, this.envHashValue);
    this.tickNo = s.tick;
    this.rng.state = s.rng;
    // afgeleide data opnieuw opbouwen
    const w = this.world;
    this.flow.refcount.fill(0);
    for (let i = 0; i < w.highWater; i++) {
      if (w.alive[i] !== 1) continue;
      const f = w.flowField[i]!;
      if (f === NO_FIELD) continue;
      if (f >= MAX_FLOW_FIELDS) throw new Error(`state: entity ${i} wijst naar flow field ${f}`);
      this.flow.refcount[f] = this.flow.refcount[f]! + 1;
    }
    this.flow.rebuild();
    this.hashDirty = true;
  }
}

/** Maakt een nieuwe sim. Valideert de invoer eenmalig; gooit bij ongeldige invoer. */
export function createSim(init: SimInit): Sim {
  if (!isInt(init.seed) || init.seed < 0 || init.seed > 0xffffffff) throw new Error(`SimInit ongeldig: seed ${init.seed}`);
  const { seed, ...env } = init;
  return new Sim(env, seed);
}

/** Laadt een state uit serialize(). De omgeving (map, config, spelers) moet dezelfde zijn; anders gooit hij. */
export function deserialize(buf: ArrayBuffer, env: SimEnv): Sim {
  const sim = new Sim(env, 0);
  sim.loadState(buf);
  return sim;
}
