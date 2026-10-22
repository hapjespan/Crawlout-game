// Snapshot parsing: typed-array views over one transferable ArrayBuffer (contract 1, packages/protocol/src/snapshot.ts).
// No copies: every field is a view into the buffer, so parsing costs a few small allocations per tick.
import {
  SNAPSHOT_HEADER_BYTES,
  readSnapshotHeader,
  snapshotLayout,
  type SnapshotHeader,
} from '@crawlout/protocol';

export interface SnapshotEntities {
  id: Uint32Array;
  x: Int32Array;
  y: Int32Array;
  typeId: Uint16Array;
  yaw: Uint16Array;
  animT: Uint16Array;
  owner: Uint8Array;
  anim: Uint8Array;
  hpPct: Uint8Array;
  flags: Uint8Array;
}

export interface SnapshotEvents {
  a: Uint32Array;
  b: Uint32Array;
  x: Int32Array;
  y: Int32Array;
  type: Uint8Array;
}

export interface SnapshotView extends SnapshotHeader {
  buffer: ArrayBuffer;
  entities: SnapshotEntities;
  events: SnapshotEvents;
}

export class SnapshotParseError extends Error {
  override name = 'SnapshotParseError';
}

/** Reads a snapshot buffer into SoA views. Throws SnapshotParseError when the buffer is shorter than its header claims. */
export function parseSnapshot(buf: ArrayBuffer): SnapshotView {
  if (buf.byteLength < SNAPSHOT_HEADER_BYTES) {
    throw new SnapshotParseError(
      `snapshot is ${buf.byteLength} bytes, header alone needs ${SNAPSHOT_HEADER_BYTES}`,
    );
  }
  const header = readSnapshotHeader(buf);
  const n = header.entityCount;
  const m = header.eventCount;
  const layout = snapshotLayout(n, m);
  if (buf.byteLength < layout.totalBytes) {
    throw new SnapshotParseError(
      `snapshot is ${buf.byteLength} bytes, ${n} entities and ${m} events need ${layout.totalBytes}`,
    );
  }
  const e = layout.entity;
  const v = layout.event;
  return {
    ...header,
    buffer: buf,
    entities: {
      id: new Uint32Array(buf, e.id, n),
      x: new Int32Array(buf, e.x, n),
      y: new Int32Array(buf, e.y, n),
      typeId: new Uint16Array(buf, e.typeId, n),
      yaw: new Uint16Array(buf, e.yaw, n),
      animT: new Uint16Array(buf, e.animT, n),
      owner: new Uint8Array(buf, e.owner, n),
      anim: new Uint8Array(buf, e.anim, n),
      hpPct: new Uint8Array(buf, e.hpPct, n),
      flags: new Uint8Array(buf, e.flags, n),
    },
    events: {
      a: new Uint32Array(buf, v.a, m),
      b: new Uint32Array(buf, v.b, m),
      x: new Int32Array(buf, v.x, m),
      y: new Int32Array(buf, v.y, m),
      type: new Uint8Array(buf, v.type, m),
    },
  };
}
