// Contract 1: snapshot sim naar render. Eén transferable ArrayBuffer per tick.
// Header, dan SoA-arrays per entity (gesorteerd op elementgrootte voor alignment), dan events.

export const SNAPSHOT_HEADER_BYTES = 12; // tick u32, hash u32, entityCount u16, eventCount u16

export const ENTITY_FIELDS = {
  id: { bytes: 4, ctor: Uint32Array },
  x: { bytes: 4, ctor: Int32Array },
  y: { bytes: 4, ctor: Int32Array },
  typeId: { bytes: 2, ctor: Uint16Array },
  yaw: { bytes: 2, ctor: Uint16Array },
  animT: { bytes: 2, ctor: Uint16Array }, // 0..65535 = 0..100% van de clip
  owner: { bytes: 1, ctor: Uint8Array },
  anim: { bytes: 1, ctor: Uint8Array },
  hpPct: { bytes: 1, ctor: Uint8Array },
  flags: { bytes: 1, ctor: Uint8Array },
} as const;
export type EntityField = keyof typeof ENTITY_FIELDS;

export const ENTITY_FLAG = { selected: 1 << 0, dead: 1 << 1, carrying: 1 << 2, inCombat: 1 << 3 } as const;

export const EVENT_TYPE = {
  spawn: 1,
  death: 2,
  shotFired: 3, // a = schutter, b = doel
  hit: 4,
  buildingPlaced: 5,
  buildingDone: 6,
  claimTaken: 7,
  resourceDepleted: 8,
  heroLevel: 9,
} as const;
export type EventType = keyof typeof EVENT_TYPE;

export const EVENT_FIELDS = {
  a: { bytes: 4, ctor: Uint32Array },
  b: { bytes: 4, ctor: Uint32Array },
  x: { bytes: 4, ctor: Int32Array },
  y: { bytes: 4, ctor: Int32Array },
  type: { bytes: 1, ctor: Uint8Array },
} as const;
export type EventField = keyof typeof EVENT_FIELDS;

const align4 = (n: number): number => (n + 3) & ~3;
const align2 = (n: number): number => (n + 1) & ~1;

export interface SnapshotLayout {
  totalBytes: number;
  entity: Record<EntityField, number>; // byte-offset van elk SoA-array
  event: Record<EventField, number>;
}

/** Byte-offsets voor een snapshot met entityCount entities en eventCount events. Sim en render gebruiken dezelfde functie. */
export function snapshotLayout(entityCount: number, eventCount: number): SnapshotLayout {
  let off = SNAPSHOT_HEADER_BYTES;
  const entity = {} as Record<EntityField, number>;
  for (const key of Object.keys(ENTITY_FIELDS) as EntityField[]) {
    const f = ENTITY_FIELDS[key];
    off = f.bytes === 4 ? align4(off) : f.bytes === 2 ? align2(off) : off;
    entity[key] = off;
    off += f.bytes * entityCount;
  }
  const event = {} as Record<EventField, number>;
  for (const key of Object.keys(EVENT_FIELDS) as EventField[]) {
    const f = EVENT_FIELDS[key];
    off = f.bytes === 4 ? align4(off) : off;
    event[key] = off;
    off += f.bytes * eventCount;
  }
  return { totalBytes: align4(off), entity, event };
}

export interface SnapshotHeader {
  tick: number;
  hash: number;
  entityCount: number;
  eventCount: number;
}

export function readSnapshotHeader(buf: ArrayBuffer): SnapshotHeader {
  const v = new DataView(buf);
  return { tick: v.getUint32(0, true), hash: v.getUint32(4, true), entityCount: v.getUint16(8, true), eventCount: v.getUint16(10, true) };
}

export function writeSnapshotHeader(buf: ArrayBuffer, h: SnapshotHeader): void {
  const v = new DataView(buf);
  v.setUint32(0, h.tick, true);
  v.setUint32(4, h.hash, true);
  v.setUint16(8, h.entityCount, true);
  v.setUint16(10, h.eventCount, true);
}

// Spelerstatus gaat apart, op verzoek van de UI (queryMessage), niet in elke snapshot.
export interface PlayerStatus {
  playerId: number;
  scrap: number;
  settlers: number;
  pop: number;
  popCap: number;
  beds: number;
  hero: { level: number; xp: number; special: [number, number, number, number, number, number, number]; perks: number[] } | null;
}
