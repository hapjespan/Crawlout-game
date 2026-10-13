import { describe, expect, it } from 'vitest';
import {
  ANGLE_FULL,
  ANIM,
  ANIM_NAMES,
  CommandEnvelope,
  ENTITY_GEN_BITS,
  ENTITY_INDEX_BITS,
  LobbyPlayer,
  MAX_ENTITIES,
  MAX_PLAYERS,
  OWNER_NEUTRAL,
  Replay,
  SEED_MAX,
  SNAPSHOT_HEADER_BYTES,
  ServerMessage,
  YAW_PLUS_X,
  YAW_PLUS_Y,
  readSnapshotHeader,
  snapshotLayout,
  writeSnapshotHeader,
} from './index.js';

describe('besluiten sprint 1', () => {
  it('yaw: 0 is +x, een kwart slag is +y', () => {
    expect(YAW_PLUS_X).toBe(0);
    expect(YAW_PLUS_Y).toBe(ANGLE_FULL / 4);
  });
  it('anim-ids volgen de clipvolgorde van de artist-brief', () => {
    expect(ANIM_NAMES.map((n) => ANIM[n])).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(ANIM.idle).toBe(0);
    expect(ANIM.walk).toBe(1);
    expect(ANIM.death).toBe(7);
  });
  it('entity-id: index past in de hoge bits, generatie in de lage, samen uint32', () => {
    expect(ENTITY_INDEX_BITS + ENTITY_GEN_BITS).toBe(32);
    expect(MAX_ENTITIES).toBeLessThanOrEqual(1 << ENTITY_INDEX_BITS);
  });
  it('een LobbyPlayer draagt een ai-vlag en de seed is een uint32', () => {
    expect(LobbyPlayer.safeParse({ playerId: 1, name: 'ai', faction: 'dwellers', ready: true, online: true }).success).toBe(false);
    expect(LobbyPlayer.safeParse({ playerId: 1, name: 'ai', faction: 'dwellers', ready: true, online: true, ai: true }).success).toBe(true);
    const base = { dataVersion: '0.2.0', map: 'rustbelt', players: [], settings: { mode: 'skirmish', delayFrames: 4 }, bundles: [], hashes: [] };
    expect(Replay.safeParse({ ...base, seed: SEED_MAX }).success).toBe(true);
    expect(Replay.safeParse({ ...base, seed: SEED_MAX + 1 }).success).toBe(false);
  });
  it('dominanceMinutes is optioneel: zonder override geldt de waarde uit de map', () => {
    const start = { kind: 'start', seed: 1, map: 'rustbelt', players: [], settings: { mode: 'skirmish', delayFrames: 4 }, dataVersion: '0.2.0', you: 0 };
    expect(ServerMessage.safeParse(start).success).toBe(true);
  });
});

describe('besluiten sprint 2', () => {
  it('de neutrale eigenaar past in het owner-byte en botst niet met een speler', () => {
    expect(OWNER_NEUTRAL).toBe(255);
    expect(OWNER_NEUTRAL).toBeGreaterThanOrEqual(MAX_PLAYERS);
  });
  it('Build draagt typeId en het midden van de footprint; Claim een pointId', () => {
    expect(CommandEnvelope.safeParse({ frame: 0, playerId: 0, seq: 0, type: 'Build', payload: { ids: [1], typeId: 1025, x: 5248, y: 5248 } }).success).toBe(true);
    expect(CommandEnvelope.safeParse({ frame: 0, playerId: 0, seq: 0, type: 'Claim', payload: { ids: [1], pointId: 7 } }).success).toBe(true);
  });
});

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
