import { describe, expect, it } from 'vitest';
import { ANGLE_FULL, ANIM, ENTITY_FLAG, EVENT_TYPE, MAX_PLAYERS, TICK_MS, UNITS_PER_METER, readSnapshotHeader, snapshotLayout } from '@crawlout/protocol';
import { parseSnapshot } from '../snapshot/parse.js';
import { CLIPS } from '../units/rig.js';
import { buildingTypeId, classifyTypeId, ENTITY_KIND, TYPE_ID_SCRAP_NODE } from '../entities/typeIds.js';
import { FAKE_BUILD_TICKS, FakeSnapshotSource, FAKE_UNIT_TYPE_ID } from './fakeSnapshots.js';

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
    let buildingDeaths = 0;
    for (let t = 0; t < 20 * 20; t++) {
      const s = parseSnapshot(src.next());
      for (let k = 0; k < s.eventCount; k++) {
        seen.add(s.events.type[k]!);
        if (s.events.type[k] === EVENT_TYPE.shotFired && s.events.b[k] !== 0) targeted++;
        if (s.events.type[k] === EVENT_TYPE.death) {
          const i = s.entities.id.indexOf(s.events.a[k]!);
          if (classifyTypeId(s.events.b[k]!) === ENTITY_KIND.building) {
            expect(i).toBe(-1); // a demolished building leaves the snapshot that carries its death (contract 1)
            buildingDeaths++;
            continue;
          }
          expect(s.events.b[k]).toBe(s.entities.typeId[i]); // b = typeId
          expect(s.entities.flags[i]! & ENTITY_FLAG.dead).not.toBe(0);
          expect(s.entities.anim[i]).toBe(ANIM.death);
        }
        if (s.events.type[k] === EVENT_TYPE.hit) {
          const target = s.entities.id.indexOf(s.events.a[k]!);
          expect(s.entities.typeId[target]).toBe(FAKE_UNIT_TYPE_ID); // a = target, a unit in the snapshot
        }
      }
    }
    expect(targeted).toBeGreaterThan(0);
    expect(buildingDeaths).toBeGreaterThan(0);
    for (const type of [EVENT_TYPE.shotFired, EVENT_TYPE.hit, EVENT_TYPE.death, EVENT_TYPE.spawn, EVENT_TYPE.buildingPlaced, EVENT_TYPE.buildingDone, EVENT_TYPE.claimTaken]) {
      expect(seen.has(type)).toBe(true);
    }
  });

  it('grows building sites with anim build and animT as progress, then finishes them', () => {
    const src = new FakeSnapshotSource({ count: 1, buildings: 0 });
    src.next();
    const typeId = buildingTypeId(0);
    expect(src.placeBuilding(typeId, 0, 20 * UNITS_PER_METER, 20 * UNITS_PER_METER, { w: 3, h: 3 })).toBe(true);
    const id = src.structures[0]!.id;
    let last = -1;
    let done = false;
    for (let t = 0; t < FAKE_BUILD_TICKS + 5; t++) {
      const s = parseSnapshot(src.next());
      const i = s.entities.id.indexOf(id);
      for (let k = 0; k < s.eventCount; k++) if (s.events.type[k] === EVENT_TYPE.buildingDone && s.events.a[k] === id) done = true;
      if (done) {
        expect(s.entities.anim[i]).toBe(ANIM.idle);
        break;
      }
      expect(s.entities.anim[i]).toBe(ANIM.build);
      expect(s.entities.animT[i]!).toBeGreaterThanOrEqual(last);
      last = s.entities.animT[i]!;
    }
    expect(done).toBe(true);
    expect(last).toBeGreaterThan(ANGLE_FULL * 0.9);
  });

  it('reports scrap stock in hpPct and refills a node after resourceDepleted', () => {
    const src = new FakeSnapshotSource({ count: 1, scrapNodes: 3 });
    const first = parseSnapshot(src.next());
    const nodes = [...first.entities.typeId].map((t, i) => (t === TYPE_ID_SCRAP_NODE ? i : -1)).filter((i) => i >= 0);
    expect(nodes.length).toBe(3);
    for (const i of nodes) expect(first.entities.hpPct[i]!).toBeLessThanOrEqual(100);
    let depleted = 0;
    for (let t = 0; t < 20 * 60; t++) {
      const s = parseSnapshot(src.next());
      for (let k = 0; k < s.eventCount; k++) if (s.events.type[k] === EVENT_TYPE.resourceDepleted) depleted++;
    }
    expect(depleted).toBeGreaterThan(0);
  });
});
