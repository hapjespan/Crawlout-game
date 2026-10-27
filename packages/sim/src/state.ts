import { MAX_ENTITIES, MAX_PLAYERS } from '@crawlout/protocol';
import type { World } from './ecs/world.js';
import type { FlowFields } from './flowfield.js';
import { MAX_FLOW_FIELDS } from './flowfield.js';
import { MAX_CARGO } from './config.limits.js';
import { FNV_OFFSET, fnv1a } from './math/fnv.js';
import type { GlobalState, PlayerState } from './systems/common.js';
import type { Vision } from './vision.js';
import type { CreepCamps } from './systems/creeps.js';
import type { ProjectState } from './systems/project.js';
import type { SurvivalState } from './systems/survival.js';
import type { DefenseState } from './systems/defense.js';
import type { GardeState } from './systems/garde.js';
import type { DifficultyState } from './difficulty.js';

// Volledige state als één reeks byte-chunks in vaste volgorde. serialize() plakt ze achter elkaar in één
// ArrayBuffer; hash() is FNV-1a 32-bit over precies dezelfde bytes. Daardoor geldt per constructie:
// hash(state) === fnv1a(serialize(state)), en serialize -> deserialize geeft dezelfde hash.
//
// Byte-volgorde: de chunks zijn views op typed arrays en dus platform-endian. Alle doelplatforms
// (x86, ARM in browsers en Node) zijn little-endian; het formaat is daarmee little-endian. De assert hieronder
// laat een big-endian platform meteen bij het laden falen in plaats van stil andere hashes te geven.
if (new Uint8Array(new Uint16Array([1]).buffer)[0] !== 1)
  throw new Error('sim: big-endian platform; state en hash vereisen little-endian');

export const STATE_MAGIC = 0x4c575243; // 'CRWL' als little-endian bytes
/**
 * 12: the Raiders (sim 0.18.0; bevestigd in fase-0 sectie 23 besluit 3): see World and PlayerState.
 * 13: creep camps (sim 0.20.0; bevestigd in fase-0 sectie 23 besluit 5): World.creepCamp and creepHome, and the
 * camp state (systems/creeps.ts CreepCamps) after the explored bitsets.
 * 14: camp takeover (sim 0.22.0; voorstel, ter bevestiging door de architect): CreepCamps.yields after clearedAt.
 * 15: win route C (sim 0.25.0; voorstel, ter bevestiging door de architect): PlayerState.projTicks and aiProjectAt
 * after aiRaidOut, and ProjectState (hit, lastHp per part) after the creep camps.
 * 16: MAX_TECHS 64 (sim 0.31.0, data 0.37.0 the Garde): PlayerState.tech is TECH_WORDS (2) uint32 words per player;
 * the dead threat position (tx, ty) left the defence state (fase-0 sectie 24 besluit 1).
 */
export const STATE_FORMAT_VERSION = 16;

/** Header-velden (uint32), in volgorde. */
const H = {
  magic: 0,
  version: 1,
  tick: 2,
  rng: 3,
  envHash: 4,
  highWater: 5,
  freeCount: 6,
  maxEntities: 7,
  maxFlowFields: 8,
} as const;
const HEADER_WORDS = 9;

export interface StateScalars {
  tick: number;
  rng: number;
  envHash: number;
}

/** Herbruikbare header-buffer per sim, zodat hash() per tick niets alloceert. */
export class StateHeader {
  readonly words = new Uint32Array(HEADER_WORDS);
  readonly bytes = new Uint8Array(this.words.buffer);

  fill(w: World, s: StateScalars): void {
    const h = this.words;
    h[H.magic] = STATE_MAGIC;
    h[H.version] = STATE_FORMAT_VERSION;
    h[H.tick] = s.tick;
    h[H.rng] = s.rng;
    h[H.envHash] = s.envHash;
    h[H.highWater] = w.highWater;
    h[H.freeCount] = w.freeCount;
    h[H.maxEntities] = MAX_ENTITIES;
    h[H.maxFlowFields] = MAX_FLOW_FIELDS;
  }
}

const bytesOf = (
  a: Uint8Array | Uint16Array | Uint32Array | Int32Array,
  elements: number,
): Uint8Array => new Uint8Array(a.buffer, a.byteOffset, elements * a.BYTES_PER_ELEMENT);

/** Alles behalve de header: entities, flow fields, spelers en globale state. */
export interface StateParts {
  readonly world: World;
  readonly flow: FlowFields;
  readonly ps: PlayerState;
  readonly globals: GlobalState;
  /** Fog of war: the explored bitsets per player are state (sim 0.17.0); the visible counts are derived. */
  readonly vision: Vision;
  /** Creep camps (sim 0.20.0): per camp its state, timer and who cleared it when. */
  readonly creeps: CreepCamps;
  /** Win route C (sim 0.25.0): the sabotage pause and the last hp per part. */
  readonly project: ProjectState;
  /** Survival co-op (sim 0.27.0): wave targets and batches, only in the game type Survival (survival.active). */
  readonly survival: SurvivalState;
  /** Base defence (sim 0.29.0): alarms and defence marks, only where it is on (defense.active). */
  readonly defense: DefenseState;
  /** The Garde (sim 0.32.0): veteran ranks and fusion cores, only where a Garde player plays (garde.active). */
  readonly garde: GardeState;
  /** Difficulty (sim 0.37.0): the reaction multiplier rolled in start(), only with a level (difficulty.active). */
  readonly difficulty: DifficultyState;
}

/** De chunks na de header, gemaakt op basis van de huidige highWater en freeCount. */
function bodyChunks(p: StateParts): Uint8Array[] {
  const { world: w, flow: ff, ps } = p;
  const out: Uint8Array[] = [bytesOf(w.freeStack, w.freeCount)];
  for (const s of w.stateArrays) out.push(bytesOf(s.array, w.highWater * s.perEntity));
  for (const a of [ff.active, ff.tx0, ff.ty0, ff.tw, ff.th]) out.push(bytesOf(a, MAX_FLOW_FIELDS));
  const players = [
    ps.scrap,
    ps.growth,
    ps.domTicks,
    ps.defeated,
    ps.hadHq,
    ps.aiBuild,
    ps.aiAttack,
    ps.aiWaveAt,
    ps.aiClaimAt,
    ps.tech,
  ];
  players.push(
    ps.heroState,
    ps.heroEnt,
    ps.heroLevel,
    ps.heroXp,
    ps.heroPerks.subarray(0, MAX_PLAYERS * ps.perkWords),
    ps.heroPending,
    ps.heroRevives,
    ps.heroTimer,
  );
  players.push(ps.abCooldown, ps.zoneX, ps.zoneY, ps.zoneTicks);
  players.push(ps.trained, ps.netTimer, ps.netArrivals, ps.aiRobot);
  players.push(ps.tributeAcc, ps.aiMix, ps.aiRaidAt, ps.aiRaidOut);
  players.push(ps.projTicks, ps.aiProjectAt);
  for (const a of players) out.push(bytesOf(a, a.length));
  out.push(bytesOf(p.globals.words, p.globals.words.length));
  out.push(p.vision.explored);
  const cc = p.creeps;
  for (const a of [cc.state, cc.timer, cc.clearedBy, cc.clearedAt, cc.yields])
    out.push(bytesOf(a, a.length));
  out.push(bytesOf(p.project.hit, p.project.hit.length));
  out.push(bytesOf(p.project.lastHp, p.project.lastHp.length));
  // survival co-op (sim 0.27.0): only in the game type Survival, so every other state keeps its format and hash
  if (p.survival.active)
    for (const a of [p.survival.target, p.survival.batches]) out.push(bytesOf(a, a.length));
  // base defence (sim 0.29.0): only where it is on, the same
  const d = p.defense;
  if (d.active) {
    out.push(bytesOf(d.alarm, d.alarm.length));
    out.push(bytesOf(d.mark, w.highWater));
  }
  // the Garde (sim 0.32.0): only with a Garde player, the same
  const g = p.garde;
  if (g.active) {
    out.push(bytesOf(g.kills, w.highWater), bytesOf(g.rank, w.highWater));
    out.push(bytesOf(g.cores, g.cores.length), bytesOf(g.coreWork, g.coreWork.length));
    // round B (sim 0.33.0)
    const n = w.highWater;
    for (const a of [
      g.stunUntil,
      g.overloadAt,
      g.quality,
      g.cargoN,
      g.paHolder,
      g.paTimer,
      g.paFrame,
    ])
      out.push(bytesOf(a, n));
    for (const a of [g.cargoType, g.cargoHp, g.cargoRank, g.cargoKills])
      out.push(bytesOf(a, n * MAX_CARGO));
  }
  // difficulty (sim 0.37.0): the multiplier rolled in start() is state (a resync has to load it, it never recomputes
  // the roll); only with a level, so every state without one keeps its format and its hash
  if (p.difficulty.active) out.push(bytesOf(p.difficulty.roll, p.difficulty.roll.length));
  return out;
}

export function hashState(header: StateHeader, p: StateParts, s: StateScalars): number {
  header.fill(p.world, s);
  let h = fnv1a(FNV_OFFSET, header.bytes);
  for (const c of bodyChunks(p)) h = fnv1a(h, c);
  return h;
}

export function serializeState(header: StateHeader, p: StateParts, s: StateScalars): ArrayBuffer {
  header.fill(p.world, s);
  const chunks = bodyChunks(p);
  let total = header.bytes.length;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  out.set(header.bytes, 0);
  let off = header.bytes.length;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out.buffer;
}

/**
 * Leest een geserialiseerde state in verse StateParts (alles nul). Controleert magic, versie,
 * capaciteiten en envHash. Geeft de scalars terug; afgeleide data (flow-field-velden, refcounts) bouwt de aanroeper op.
 */
export function deserializeState(
  buf: ArrayBuffer,
  p: StateParts,
  expectedEnvHash: number,
): StateScalars {
  const w = p.world;
  const src = new Uint8Array(buf);
  const header = new StateHeader();
  if (src.length < header.bytes.length) throw new Error('state: buffer te kort voor de header');
  header.bytes.set(src.subarray(0, header.bytes.length));
  const h = header.words;
  if (h[H.magic] !== STATE_MAGIC) throw new Error('state: geen Crawlout-state (magic klopt niet)');
  if (h[H.version] !== STATE_FORMAT_VERSION)
    throw new Error(`state: formatversie ${h[H.version]}, verwacht ${STATE_FORMAT_VERSION}`);
  if (h[H.maxEntities] !== MAX_ENTITIES || h[H.maxFlowFields] !== MAX_FLOW_FIELDS)
    throw new Error('state: andere capaciteiten');
  if (h[H.envHash] !== expectedEnvHash)
    throw new Error('state: andere data, config of map (envHash klopt niet)');
  const highWater = h[H.highWater]!;
  const freeCount = h[H.freeCount]!;
  if (highWater > MAX_ENTITIES || freeCount > highWater)
    throw new Error('state: highWater of freeCount buiten bereik');
  w.highWater = highWater;
  w.freeCount = freeCount;

  let off = header.bytes.length;
  for (const c of bodyChunks(p)) {
    if (off + c.length > src.length) throw new Error('state: buffer te kort');
    c.set(src.subarray(off, off + c.length));
    off += c.length;
  }
  if (off !== src.length) throw new Error('state: onverwachte bytes na het einde');
  validateLoaded(p);
  return { tick: h[H.tick]!, rng: h[H.rng]!, envHash: h[H.envHash]! };
}

/**
 * A resync loads bytes from the network: the allocator (World.alloc and free are its only writers) must hold, or
 * alloc hands out a live index or one past the arrays. Every index below highWater is alive (0 or 1, a live one with a
 * generation) or on the free stack exactly once; an active flow slot targets a rectangle inside the map.
 */
function validateLoaded(p: StateParts): void {
  const { world: w, flow: ff } = p;
  let live = 0;
  for (let i = 0; i < w.highWater; i++) {
    const a = w.alive[i]!;
    if (a > 1 || (a === 1 && w.gen[i] === 0)) throw new Error(`state: entity ${i} ongeldig`);
    live += a;
  }
  const seen = new Uint8Array(w.highWater);
  for (let k = 0; k < w.freeCount; k++) {
    const i = w.freeStack[k]!;
    if (i < 0 || i >= w.highWater || w.alive[i] !== 0 || seen[i] === 1)
      throw new Error(`state: vrije lijst ongeldig op ${k}`);
    seen[i] = 1;
  }
  if (live + w.freeCount !== w.highWater)
    throw new Error('state: levende plus vrije entities ongelijk aan highWater');
  for (let s = 0; s < MAX_FLOW_FIELDS; s++) {
    const a = ff.active[s]!;
    if (a > 1) throw new Error(`state: flow slot ${s} ongeldig`);
    if (a === 0) continue;
    const x0 = ff.tx0[s]!;
    const y0 = ff.ty0[s]!;
    if (
      x0 < 0 ||
      y0 < 0 ||
      ff.tw[s]! < 1 ||
      ff.th[s]! < 1 ||
      x0 + ff.tw[s]! > ff.w ||
      y0 + ff.th[s]! > ff.h
    )
      throw new Error(`state: flow slot ${s} buiten de map`);
  }
}
