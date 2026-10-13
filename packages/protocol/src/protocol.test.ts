import { describe, expect, it } from 'vitest';
import { CommandEnvelope, snapshotLayout, readSnapshotHeader, writeSnapshotHeader, SNAPSHOT_HEADER_BYTES } from './index.js';

describe('CommandEnvelope', () => {
  it('accepteert een geldig Move-commando', () => {
    const r = CommandEnvelope.safeParse({ frame: 10, playerId: 0, seq: 1, type: 'Move', payload: { ids: [1, 2], x: 2560, y: 512 } });
    expect(r.success).toBe(true);
  });
  it('weigert een payload die niet bij het type hoort', () => {
    const r = CommandEnvelope.safeParse({ frame: 10, playerId: 0, seq: 1, type: 'Move', payload: { ids: [1], target: 5 } });
    expect(r.success).toBe(false);
  });
  it('weigert meer dan 64 entity-ids', () => {
    const ids = Array.from({ length: 65 }, (_, i) => i);
    const r = CommandEnvelope.safeParse({ frame: 0, playerId: 0, seq: 0, type: 'Stop', payload: { ids } });
    expect(r.success).toBe(false);
  });
});

describe('snapshotLayout', () => {
  it('legt 4-byte arrays op 4-byte grenzen en groeit met de aantallen', () => {
    const a = snapshotLayout(10, 3);
    expect(a.entity.id % 4).toBe(0);
    expect(a.entity.x % 4).toBe(0);
    expect(a.event.a % 4).toBe(0);
    expect(a.totalBytes).toBeGreaterThan(SNAPSHOT_HEADER_BYTES);
    expect(snapshotLayout(20, 3).totalBytes).toBeGreaterThan(a.totalBytes);
  });
  it('schrijft en leest de header', () => {
    const buf = new ArrayBuffer(SNAPSHOT_HEADER_BYTES);
    writeSnapshotHeader(buf, { tick: 123, hash: 0xdeadbeef, entityCount: 7, eventCount: 2 });
    expect(readSnapshotHeader(buf)).toEqual({ tick: 123, hash: 0xdeadbeef, entityCount: 7, eventCount: 2 });
  });
});
