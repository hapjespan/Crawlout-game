import { describe, expect, it } from 'vitest';
import { ANIM, ENTITY_FLAG, EVENT_TYPE, MAX_PLAYERS, TICK_MS, UNITS_PER_METER, readSnapshotHeader, snapshotLayout } from '@crawlout/protocol';
import { parseSnapshot } from '../snapshot/parse.js';
import { CLIPS } from '../units/rig.js';
import { classifyTypeId, ENTITY_KIND } from '../entities/typeIds.js';
import { FakeSnapshotSource, FAKE_UNIT_TYPE_ID } from './fakeSnapshots.js';

describe('FakeSnapshotSource', () => {
  it('produces contract-sized snapshots of 200 units with increasing ticks', () => {
    const src = new FakeSnapshotSource();
    for (let t = 1; t <= 5; t++) {
      const buf = src.next();
      const h = readSnapshotHeader(buf);
      expect(h.tick).toBe(t);
      expect(h.entityCount).toBe(200);
      expect(buf.byteLength).toBe(snapshotLayout(h.entityCount, h.eventCount).totalBytes);
    }
  });

  it('writes valid field values: unique ids, owners, clips, positions inside the world', () => {
    const src = new FakeSnapshotSource({ count: 200, players: 4, worldSize: 128 });
    let s = parseSnapshot(src.next());
    for (let k = 0; k < 200; k++) s = parseSnapshot(src.next());
    const e = s.entities;
    expect(new Set(e.id).size).toBe(200);
    for (let i = 0; i < s.entityCount; i++) {
      expect(e.owner[i]).toBeLessThan(Math.min(4, MAX_PLAYERS));
      expect(e.anim[i]).toBeLessThan(CLIPS.length);
      expect(e.typeId[i]).toBe(FAKE_UNIT_TYPE_ID);
      expect(e.hpPct[i]).toBe(100);
      expect(e.x[i]).toBeGreaterThanOrEqual(0);
      expect(e.x[i]).toBeLessThanOrEqual(128 * UNITS_PER_METER);
      expect(e.y[i]).toBeGreaterThanOrEqual(0);
      expect(e.y[i]).toBeLessThanOrEqual(128 * UNITS_PER_METER);
    }
  });

  it('starts with every unit walking or running, and walkers move at walking pace', () => {
    const src = new FakeSnapshotSource({ count: 200 });
    const a = parseSnapshot(src.next());
    const b = parseSnapshot(src.next());
    let moving = 0;
    for (let i = 0; i < a.entityCount; i++) {
      expect([ANIM.walk, ANIM.run]).toContain(a.entities.anim[i]);
      const d = Math.hypot(b.entities.x[i]! - a.entities.x[i]!, b.entities.y[i]! - a.entities.y[i]!);
      if (d > 0) moving++;
      // At most run speed (4.2 m/s) per tick, with rounding slack.
      expect(d).toBeLessThanOrEqual((4.3 * UNITS_PER_METER * TICK_MS) / 1000);
    }
    expect(moving).toBeGreaterThan(190);
  });

  it('advances animT within a clip and wraps looping clips', () => {
    const src = new FakeSnapshotSource({ count: 50 });
    const first = parseSnapshot(src.next());
    const id = first.entities.id[0]!;
    const seen: number[] = [first.entities.animT[0]!];
    let wrapped = false;
    for (let t = 0; t < 40; t++) {
      const s = parseSnapshot(src.next());
      const i = s.entities.id.indexOf(id);
      const v = s.entities.animT[i]!;
      if (s.entities.anim[i] === first.entities.anim[0] && v < seen[seen.length - 1]!) wrapped = true;
      seen.push(v);
    }
    expect(new Set(seen).size).toBeGreaterThan(10);
    expect(wrapped).toBe(true); // walk and run clips are at most 1 s, 40 ticks is 2 s
  });

  it('is deterministic for a seed', () => {
    const a = new FakeSnapshotSource({ seed: 99 });
    const b = new FakeSnapshotSource({ seed: 99 });
    for (let t = 0; t < 30; t++) {
      expect(new Uint8Array(a.next())).toEqual(new Uint8Array(b.next()));
    }
  });

  it('mirrors selection and move orders through the snapshot', () => {
    const src = new FakeSnapshotSource({ count: 20 });
    src.setSelected([3, 4]);
    let s = parseSnapshot(src.next());
    const sel = [...s.entities.id].filter((_, i) => (s.entities.flags[i]! & ENTITY_FLAG.selected) !== 0);
    expect(sel.sort((x, y) => x - y)).toEqual([3, 4]);

    const goal = { x: 64 * UNITS_PER_METER, y: 64 * UNITS_PER_METER };
    src.moveTo([3], goal.x, goal.y);
    for (let t = 0; t < 20 * 60; t++) {
      s = parseSnapshot(src.next());
      const i = s.entities.id.indexOf(3);
      if (s.entities.x[i] === goal.x && s.entities.y[i] === goal.y) return;
    }
    throw new Error('unit 3 never reached the move goal');
  });

  it('emits shotFired events in the event section', () => {
    const src = new FakeSnapshotSource({ count: 200 });
    let shots = 0;
    for (let t = 0; t < 20 * 30 && shots === 0; t++) {
      const s = parseSnapshot(src.next());
      for (let k = 0; k < s.eventCount; k++) {
        expect(s.events.type[k]).toBe(EVENT_TYPE.shotFired);
        expect(s.entities.id).toContain(s.events.a[k]);
        shots++;
      }
    }
    expect(shots).toBeGreaterThan(0);
  });

  it('adds non-overlapping buildings, scrap nodes and claim points after the units', () => {
    const footprint = (typeId: number) => ({ w: 2 + (typeId % 4), h: 2 + (typeId % 3) });
    const src = new FakeSnapshotSource({ count: 50, buildings: 40, scrapNodes: 6, claims: 3, footprint });
    const s = parseSnapshot(src.next());
    expect(s.entityCount).toBe(50 + src.structures.length);
    const kinds = [...s.entities.typeId].map(classifyTypeId);
    expect(kinds.filter((k) => k === ENTITY_KIND.building)).toHaveLength(40);
    expect(kinds.filter((k) => k === ENTITY_KIND.scrapNode)).toHaveLength(6);
    expect(kinds.filter((k) => k === ENTITY_KIND.claim)).toHaveLength(3);
    expect(new Set(s.entities.id).size).toBe(s.entityCount);
    const b = src.structures.filter((x) => classifyTypeId(x.typeId) === ENTITY_KIND.building);
    for (let i = 0; i < b.length; i++) {
      for (let j = i + 1; j < b.length; j++) {
        const p = b[i]!;
        const q = b[j]!;
        const apartX = Math.abs(p.x - q.x) * 2 >= (p.footprint.w + q.footprint.w) * UNITS_PER_METER;
        const apartY = Math.abs(p.y - q.y) * 2 >= (p.footprint.h + q.footprint.h) * UNITS_PER_METER;
        expect(apartX || apartY).toBe(true);
      }
    }
  });

  it('emits targeted shots, hits, deaths, respawns and building events in combat mode', () => {
    const src = new FakeSnapshotSource({ count: 200, buildings: 10, claims: 2, combat: true });
    const seen = new Set<number>();
    let targeted = 0;
    for (let t = 0; t < 20 * 20; t++) {
      const s = parseSnapshot(src.next());
      for (let k = 0; k < s.eventCount; k++) {
        seen.add(s.events.type[k]!);
        if (s.events.type[k] === EVENT_TYPE.shotFired && s.events.b[k] !== 0) targeted++;
        if (s.events.type[k] === EVENT_TYPE.death) {
          const i = s.entities.id.indexOf(s.events.a[k]!);
          expect(s.entities.flags[i]! & ENTITY_FLAG.dead).not.toBe(0);
          expect(s.entities.anim[i]).toBe(ANIM.death);
        }
      }
    }
    expect(targeted).toBeGreaterThan(0);
    for (const type of [EVENT_TYPE.shotFired, EVENT_TYPE.hit, EVENT_TYPE.death, EVENT_TYPE.spawn, EVENT_TYPE.buildingPlaced, EVENT_TYPE.buildingDone, EVENT_TYPE.claimTaken]) {
      expect(seen.has(type)).toBe(true);
    }
  });
});
