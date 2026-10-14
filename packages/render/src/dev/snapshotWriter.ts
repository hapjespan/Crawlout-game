// Writes snapshot buffers by the contract. Dev and test only: in the game the sim worker writes them.
import { snapshotLayout, writeSnapshotHeader } from '@crawlout/protocol';
import { parseSnapshot, type SnapshotView } from '../snapshot/parse.js';

/** Allocates a zeroed snapshot with header filled in and returns writable SoA views into it. */
export function allocSnapshot(
  tick: number,
  hash: number,
  entityCount: number,
  eventCount: number,
): SnapshotView {
  const buf = new ArrayBuffer(snapshotLayout(entityCount, eventCount).totalBytes);
  writeSnapshotHeader(buf, { tick, hash, entityCount, eventCount });
  return parseSnapshot(buf);
}

export interface EntityRecord {
  id: number;
  x: number;
  y: number;
  typeId?: number;
  yaw?: number;
  animT?: number;
  owner?: number;
  anim?: number;
  hpPct?: number;
  flags?: number;
}

export interface EventRecord {
  type: number;
  a?: number;
  b?: number;
  x?: number;
  y?: number;
}

/** Encodes plain records into one snapshot buffer. */
export function encodeSnapshot(
  tick: number,
  hash: number,
  entities: readonly EntityRecord[],
  events: readonly EventRecord[] = [],
): ArrayBuffer {
  const s = allocSnapshot(tick, hash, entities.length, events.length);
  const e = s.entities;
  entities.forEach((r, i) => {
    e.id[i] = r.id;
    e.x[i] = r.x;
    e.y[i] = r.y;
    e.typeId[i] = r.typeId ?? 0;
    e.yaw[i] = r.yaw ?? 0;
    e.animT[i] = r.animT ?? 0;
    e.owner[i] = r.owner ?? 0;
    e.anim[i] = r.anim ?? 0;
    e.hpPct[i] = r.hpPct ?? 100;
    e.flags[i] = r.flags ?? 0;
  });
  const v = s.events;
  events.forEach((r, i) => {
    v.type[i] = r.type;
    v.a[i] = r.a ?? 0;
    v.b[i] = r.b ?? 0;
    v.x[i] = r.x ?? 0;
    v.y[i] = r.y ?? 0;
  });
  return s.buffer;
}
