import { MAX_ENTITIES } from '@crawlout/protocol';
import type { World } from './ecs/world.js';
import type { FlowFields } from './flowfield.js';
import { MAX_FLOW_FIELDS } from './flowfield.js';
import { FNV_OFFSET, fnv1a } from './math/fnv.js';
import type { GlobalState, PlayerState } from './systems/common.js';

// Volledige state als één reeks byte-chunks in vaste volgorde. serialize() plakt ze achter elkaar in één
// ArrayBuffer; hash() is FNV-1a 32-bit over precies dezelfde bytes. Daardoor geldt per constructie:
// hash(state) === fnv1a(serialize(state)), en serialize -> deserialize geeft dezelfde hash.
//
// Byte-volgorde: de chunks zijn views op typed arrays en dus platform-endian. Alle doelplatforms
// (x86, ARM in browsers en Node) zijn little-endian; het formaat is daarmee little-endian. De assert hieronder
// laat een big-endian platform meteen bij het laden falen in plaats van stil andere hashes te geven.
if (new Uint8Array(new Uint16Array([1]).buffer)[0] !== 1) throw new Error('sim: big-endian platform; state en hash vereisen little-endian');

export const STATE_MAGIC = 0x4c575243; // 'CRWL' als little-endian bytes
export const STATE_FORMAT_VERSION = 5;

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

const bytesOf = (a: Uint8Array | Uint16Array | Uint32Array | Int32Array, elements: number): Uint8Array =>
  new Uint8Array(a.buffer, a.byteOffset, elements * a.BYTES_PER_ELEMENT);

/** Alles behalve de header: entities, flow fields, spelers en globale state. */
export interface StateParts {
  readonly world: World;
  readonly flow: FlowFields;
  readonly ps: PlayerState;
  readonly globals: GlobalState;
}

/** De chunks na de header, gemaakt op basis van de huidige highWater en freeCount. */
function bodyChunks(p: StateParts): Uint8Array[] {
  const { world: w, flow: ff, ps } = p;
  const out: Uint8Array[] = [bytesOf(w.freeStack, w.freeCount)];
  for (const s of w.stateArrays) out.push(bytesOf(s.array, w.highWater * s.perEntity));
  for (const a of [ff.active, ff.tx0, ff.ty0, ff.tw, ff.th, ff.processed]) out.push(bytesOf(a, MAX_FLOW_FIELDS));
  const players = [ps.scrap, ps.growth, ps.domTicks, ps.defeated, ps.hadHq, ps.aiBuild, ps.aiAttack, ps.aiWaveAt, ps.tech];
  players.push(ps.heroState, ps.heroEnt, ps.heroLevel, ps.heroXp, ps.heroPerks, ps.heroPending, ps.heroRevives, ps.heroTimer);
  players.push(ps.abCooldown, ps.zoneX, ps.zoneY, ps.zoneTicks);
  for (const a of players) out.push(bytesOf(a, a.length));
  out.push(bytesOf(p.globals.words, p.globals.words.length));
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
export function deserializeState(buf: ArrayBuffer, p: StateParts, expectedEnvHash: number): StateScalars {
  const w = p.world;
  const src = new Uint8Array(buf);
  const header = new StateHeader();
  if (src.length < header.bytes.length) throw new Error('state: buffer te kort voor de header');
  header.bytes.set(src.subarray(0, header.bytes.length));
  const h = header.words;
  if (h[H.magic] !== STATE_MAGIC) throw new Error('state: geen Crawlout-state (magic klopt niet)');
  if (h[H.version] !== STATE_FORMAT_VERSION) throw new Error(`state: formatversie ${h[H.version]}, verwacht ${STATE_FORMAT_VERSION}`);
  if (h[H.maxEntities] !== MAX_ENTITIES || h[H.maxFlowFields] !== MAX_FLOW_FIELDS) throw new Error('state: andere capaciteiten');
  if (h[H.envHash] !== expectedEnvHash) throw new Error('state: andere data, config of map (envHash klopt niet)');
  const highWater = h[H.highWater]!;
  const freeCount = h[H.freeCount]!;
  if (highWater > MAX_ENTITIES || freeCount > highWater) throw new Error('state: highWater of freeCount buiten bereik');
  w.highWater = highWater;
  w.freeCount = freeCount;

  let off = header.bytes.length;
  for (const c of bodyChunks(p)) {
    if (off + c.length > src.length) throw new Error('state: buffer te kort');
    c.set(src.subarray(off, off + c.length));
    off += c.length;
  }
  if (off !== src.length) throw new Error('state: onverwachte bytes na het einde');
  return { tick: h[H.tick]!, rng: h[H.rng]!, envHash: h[H.envHash]! };
}
