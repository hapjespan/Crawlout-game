import { describe, expect, it } from 'vitest';
import {
  ENTITY_FLAG,
  EVENT_TYPE,
  SNAPSHOT_HEADER_BYTES,
  snapshotLayout,
  writeSnapshotHeader,
} from '@crawlout/protocol';
import { encodeSnapshot } from '../dev/snapshotWriter.js';
import { parseSnapshot, SnapshotParseError } from './parse.js';

describe('parseSnapshot', () => {
  it('reads header, every entity field and every event field back', () => {
    const buf = encodeSnapshot(
      42,
      0xdeadbeef,
      [
        {
          id: 7,
          x: -2560,
          y: 1 << 20,
          typeId: 513,
          yaw: 65535,
          animT: 40000,
          owner: 3,
          anim: 2,
          hpPct: 55,
          flags: ENTITY_FLAG.selected | ENTITY_FLAG.carrying,
        },
        {
          id: 0xfffffff0,
          x: 2147483647,
          y: -2147483648,
          typeId: 1,
          yaw: 0,
          animT: 0,
          owner: 7,
          anim: 255,
          hpPct: 0,
          flags: ENTITY_FLAG.dead,
        },
        { id: 9, x: 0, y: 0 },
      ],
      [{ type: EVENT_TYPE.shotFired, a: 7, b: 0xfffffff0, x: -1, y: 99 }],
    );
    const s = parseSnapshot(buf);
    expect(s).toMatchObject({ tick: 42, hash: 0xdeadbeef, entityCount: 3, eventCount: 1 });
    const e = s.entities;
    expect([...e.id]).toEqual([7, 0xfffffff0, 9]);
    expect([...e.x]).toEqual([-2560, 2147483647, 0]);
    expect([...e.y]).toEqual([1 << 20, -2147483648, 0]);
    expect([...e.typeId]).toEqual([513, 1, 0]);
    expect([...e.yaw]).toEqual([65535, 0, 0]);
    expect([...e.animT]).toEqual([40000, 0, 0]);
    expect([...e.owner]).toEqual([3, 7, 0]);
    expect([...e.anim]).toEqual([2, 255, 0]);
    expect([...e.hpPct]).toEqual([55, 0, 100]);
    expect([...e.flags]).toEqual([
      ENTITY_FLAG.selected | ENTITY_FLAG.carrying,
      ENTITY_FLAG.dead,
      0,
    ]);
    expect([...s.events.type]).toEqual([EVENT_TYPE.shotFired]);
    expect([...s.events.a]).toEqual([7]);
    expect([...s.events.b]).toEqual([0xfffffff0]);
    expect([...s.events.x]).toEqual([-1]);
    expect([...s.events.y]).toEqual([99]);
  });

  it('uses the protocol layout: views sit at the snapshotLayout offsets without copying', () => {
    const buf = encodeSnapshot(1, 0, [{ id: 1, x: 2, y: 3 }], [{ type: 1 }]);
    const layout = snapshotLayout(1, 1);
    const s = parseSnapshot(buf);
    expect(buf.byteLength).toBe(layout.totalBytes);
    expect(s.entities.x.buffer).toBe(buf);
    expect(s.entities.x.byteOffset).toBe(layout.entity.x);
    expect(s.entities.flags.byteOffset).toBe(layout.entity.flags);
    expect(s.events.type.byteOffset).toBe(layout.event.type);
  });

  it('accepts an empty snapshot', () => {
    const s = parseSnapshot(encodeSnapshot(5, 1, []));
    expect(s.entityCount).toBe(0);
    expect(s.entities.id.length).toBe(0);
  });

  it('rejects buffers shorter than the header or than the header claims', () => {
    expect(() => parseSnapshot(new ArrayBuffer(SNAPSHOT_HEADER_BYTES - 1))).toThrow(
      SnapshotParseError,
    );
    const buf = new ArrayBuffer(SNAPSHOT_HEADER_BYTES + 8);
    writeSnapshotHeader(buf, { tick: 1, hash: 0, entityCount: 10, eventCount: 0 });
    expect(() => parseSnapshot(buf)).toThrow(/10 entities/);
  });
});
