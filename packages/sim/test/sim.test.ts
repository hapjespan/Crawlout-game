import { describe, expect, it } from 'vitest';
import { ENTITY_FIELDS, EVENT_TYPE, readSnapshotHeader, snapshotLayout } from '@crawlout/protocol';
import {
  FNV_OFFSET,
  NO_ENTITY,
  createSim,
  deserialize,
  fnv1a,
  genOf,
  indexOf,
} from '../src/index.js';
import type { Sim } from '../src/index.js';
import { cellCenter, createTestMap } from '../src/testing.js';
import {
  CONFIG,
  SCAV,
  bundle,
  cmd,
  emptySim,
  runFrames,
  scriptedBundles,
  spawnBlock,
  testInit,
} from './helpers.js';

const TEST_UNIT_TYPE = SCAV;
const TEST_SIM_CONFIG = CONFIG;

function setup(seed = 7): { sim: Sim; a: number[]; b: number[] } {
  const sim = emptySim(seed);
  const a = spawnBlock(sim, 0, 4, 4, 20);
  const b = spawnBlock(sim, 1, 40, 50, 20);
  return { sim, a, b };
}

describe('ECS en entity-ids', () => {
  it('ids dragen generatie-bits en hergebruiken indices via de vrije lijst', () => {
    const sim = emptySim();
    const p = cellCenter(5, 5);
    const id1 = sim.spawnUnit({ typeId: TEST_UNIT_TYPE, owner: 0, ...p });
    const id2 = sim.spawnUnit({ typeId: TEST_UNIT_TYPE, owner: 0, ...p });
    expect(id1).not.toBe(NO_ENTITY);
    expect(indexOf(id1)).toBe(0);
    expect(indexOf(id2)).toBe(1);
    expect(genOf(id1)).toBe(1);
    expect(id2).toBeGreaterThan(id1);
    expect(sim.destroyEntity(id1)).toBe(true);
    expect(sim.destroyEntity(id1)).toBe(false);
    expect(sim.getUnit(id1)).toBeNull();
    const id3 = sim.spawnUnit({ typeId: TEST_UNIT_TYPE, owner: 0, ...p });
    expect(indexOf(id3)).toBe(0);
    expect(genOf(id3)).toBe(2);
    expect(sim.getUnit(id1)).toBeNull(); // oude id blijft ongeldig
    expect(sim.getUnit(id3)).not.toBeNull();
    expect(sim.entityCount).toBe(2);
  });

  it('weigert spawns op muur, buiten de map, met onbekend type of ongeldige eigenaar', () => {
    const sim = emptySim();
    expect(sim.spawnUnit({ typeId: TEST_UNIT_TYPE, owner: 0, ...cellCenter(0, 0) })).toBe(
      NO_ENTITY,
    );
    expect(sim.spawnUnit({ typeId: TEST_UNIT_TYPE, owner: 0, x: -1, y: 300 })).toBe(NO_ENTITY);
    expect(sim.spawnUnit({ typeId: 99, owner: 0, ...cellCenter(5, 5) })).toBe(NO_ENTITY);
    expect(sim.spawnUnit({ typeId: TEST_UNIT_TYPE, owner: 2, ...cellCenter(5, 5) })).toBe(
      NO_ENTITY,
    );
  });

  it('valideert de invoer', () => {
    const bad = {
      ...testInit(),
      map: { ...createTestMap(), w: 4, h: 4, passable: new Uint8Array(3) },
    };
    expect(() => createSim(bad)).toThrow();
    expect(() => createSim({ ...testInit(), seed: -1 })).toThrow();
    const fast = {
      ...TEST_SIM_CONFIG,
      unitTypes: [{ ...TEST_SIM_CONFIG.unitTypes[0]!, speed: 1000 }],
    };
    expect(() => createSim({ ...testInit(), config: fast })).toThrow();
  });
});

describe('determinisme', () => {
  it('twee runs met dezelfde invoer geven dezelfde hash op elke tick', () => {
    const r1 = setup();
    const r2 = setup();
    const h1 = runFrames(r1.sim, 300, scriptedBundles(r1.a, r1.b));
    const h2 = runFrames(r2.sim, 300, scriptedBundles(r2.a, r2.b));
    expect(h1).toEqual(h2);
    expect(new Set(h1).size).toBeGreaterThan(100); // de state verandert echt
  });

  it('een andere seed of andere commando’s geven een andere hash', () => {
    const r1 = setup(7);
    const r2 = setup(8);
    expect(runFrames(r1.sim, 5, new Map())).not.toEqual(runFrames(r2.sim, 5, new Map()));
    const r3 = setup();
    const r4 = setup();
    const s4 = scriptedBundles(r4.a, r4.b);
    s4.delete(120);
    const h3 = runFrames(r3.sim, 200, scriptedBundles(r3.a, r3.b));
    const h4 = runFrames(r4.sim, 200, s4);
    expect(h3.slice(0, 120)).toEqual(h4.slice(0, 120));
    expect(h3[120]).not.toBe(h4[120]);
  });

  it('serialize gevolgd door deserialize geeft dezelfde hash, ook vlak na een bevel (padcaches half gevuld)', () => {
    const { sim, a, b } = setup();
    const script = scriptedBundles(a, b);
    runFrames(sim, 3, script); // de padvinding heeft net zijn eerste regiovelden (afgeleid, niet in de state)
    for (const stop of [3, 45, 81, 150]) {
      if (sim.frame < stop) runFrames(sim, stop - sim.frame, script);
      const buf = sim.serialize();
      expect(fnv1a(FNV_OFFSET, new Uint8Array(buf))).toBe(sim.hash());
      const copy = deserialize(buf, testInit());
      expect(copy.hash()).toBe(sim.hash());
      expect(copy.frame).toBe(sim.frame);
      // beide verder: zelfde hashes per tick
      const fork = structuredClone(script);
      expect(runFrames(copy, 60, fork)).toEqual(runFrames(createSimFrom(buf), 60, fork));
    }
  });

  it('een geladen state loopt identiek verder met het origineel', () => {
    const { sim, a, b } = setup();
    const script = scriptedBundles(a, b);
    runFrames(sim, 70, script);
    const copy = deserialize(sim.serialize(), testInit());
    expect(runFrames(copy, 150, script)).toEqual(runFrames(sim, 150, script));
  });

  it('weigert een state met een andere map of config', () => {
    const { sim } = setup();
    const buf = sim.serialize();
    expect(() => deserialize(buf, { ...testInit(), map: createTestMap(48, 48) })).toThrow(
      /envHash/,
    );
    expect(() =>
      deserialize(buf, { ...testInit(), config: { ...TEST_SIM_CONFIG, dataVersion: 'x' } }),
    ).toThrow(/envHash/);
    expect(() => deserialize(new ArrayBuffer(8), testInit())).toThrow();
  });
});

function createSimFrom(buf: ArrayBuffer): Sim {
  return deserialize(buf, testInit());
}

describe('commando’s', () => {
  it('Move brengt een groep door de opening in de muur naar het doel', () => {
    const { sim, a } = setup();
    const t = cellCenter(50, 40);
    sim.applyBundle(bundle(0, [cmd(0, 0, 'Move', { ids: a, x: t.x, y: t.y })]));
    for (let f = 0; f < 600; f++) sim.tick();
    for (const id of a) {
      const u = sim.getUnit(id)!;
      expect(u.moving).toBe(false);
      const d = Math.hypot(u.x - t.x, u.y - t.y);
      expect(d).toBeLessThan(4 * 256); // binnen 4 m van het doel
      expect(u.x >> 8).toBeGreaterThan(32); // aan de andere kant van de muur
    }
  });

  it('Stop houdt units tegen en laat het flow field los', () => {
    const { sim, a } = setup();
    const t = cellCenter(20, 20);
    sim.applyBundle(bundle(0, [cmd(0, 0, 'Move', { ids: a, x: t.x, y: t.y })]));
    sim.tick();
    sim.tick();
    expect(sim.getUnit(a[0]!)!.moving).toBe(true);
    sim.applyBundle(bundle(2, [cmd(2, 0, 'Stop', { ids: a })]));
    sim.tick();
    for (const id of a) {
      const u = sim.getUnit(id)!;
      expect(u.moving).toBe(false);
      expect(u.flowField).toBe(255);
    }
  });

  it('negeert ongeldige commando’s stil: verkeerde eigenaar, onbekende speler, buiten de map, kapotte payload', () => {
    const { sim, a, b } = setup();
    const before = sim.serialize();
    const t = cellCenter(20, 20);
    sim.applyBundle(
      bundle(0, [
        cmd(0, 1, 'Move', { ids: a, x: t.x, y: t.y }), // niet van speler 1
        cmd(0, 5, 'Move', { ids: a, x: t.x, y: t.y }), // speler bestaat niet
        cmd(0, 0, 'Move', { ids: a, x: -5, y: t.y }), // buiten de map
        cmd(0, 0, 'Move', { ids: a, target: 3 }), // payload past niet
        cmd(0, 0, 'Move', { ids: [123456789], x: t.x, y: t.y }), // onbekende id
        cmd(0, 0, 'Stop', { ids: b }), // niet van speler 0
        cmd(0, 0, 'Research', { techId: 0 }), // nog no-op
      ]),
    );
    const ref = deserialize(before, testInit());
    ref.applyBundle(bundle(0, []));
    expect(sim.tick()).toBe(ref.tick());
  });

  it('past commando’s toe in volgorde van playerId en seq, ongeacht de volgorde in de bundel', () => {
    const r1 = setup();
    const r2 = setup();
    const t1 = cellCenter(20, 20);
    const t2 = cellCenter(10, 40);
    const c1 = {
      frame: 0,
      playerId: 0,
      seq: 1,
      type: 'Move' as const,
      payload: { ids: r1.a, x: t1.x, y: t1.y },
    };
    const c2 = {
      frame: 0,
      playerId: 0,
      seq: 2,
      type: 'Move' as const,
      payload: { ids: r1.a, x: t2.x, y: t2.y },
    };
    r1.sim.applyBundle(bundle(0, [c1, c2]));
    r2.sim.applyBundle(bundle(0, [c2, c1]));
    expect(r1.sim.tick()).toBe(r2.sim.tick());
  });

  it('weigert bundels voor een al uitgevoerd frame en dubbele bundels', () => {
    const { sim } = setup();
    sim.applyBundle(bundle(0));
    expect(() => sim.applyBundle(bundle(0))).toThrow();
    sim.tick();
    expect(() => sim.applyBundle(bundle(0))).toThrow();
    expect(sim.hasBundle()).toBe(false);
    sim.applyBundle(bundle(1));
    expect(sim.hasBundle()).toBe(true);
  });
});

describe('beweging', () => {
  it('units overlappen niet blijvend (separatie)', () => {
    const sim = emptySim();
    const c = cellCenter(10, 10);
    const ids: number[] = [];
    for (let k = 0; k < 10; k++)
      ids.push(sim.spawnUnit({ typeId: TEST_UNIT_TYPE, owner: 0, ...c }));
    for (let f = 0; f < 100; f++) sim.tick();
    const us = ids.map((id) => sim.getUnit(id)!);
    let minD = Infinity;
    for (let i = 0; i < us.length; i++)
      for (let j = i + 1; j < us.length; j++)
        minD = Math.min(minD, Math.hypot(us[i]!.x - us[j]!.x, us[i]!.y - us[j]!.y));
    expect(minD).toBeGreaterThan(2 * 96 * 0.8);
  });

  it('units lopen nooit een geblokkeerde cel in', () => {
    const { sim, a, b } = setup();
    const map = testInit().map;
    const script = scriptedBundles(a, b);
    for (let f = 0; f < 300; f++) {
      sim.applyBundle(bundle(f, script.get(f) ?? []));
      sim.tick();
      for (const id of sim.entityIds()) {
        const u = sim.getUnit(id)!;
        expect(map.passable[(u.y >> 8) * map.w + (u.x >> 8)]).toBe(1);
      }
    }
  });
});

describe('snapshot', () => {
  it('volgt contract 1: header, SoA-arrays op de layout uit protocol, spawn-events', () => {
    const sim = emptySim();
    const ids = spawnBlock(sim, 1, 4, 4, 3);
    const t = cellCenter(20, 20);
    sim.applyBundle(bundle(0, [cmd(0, 1, 'Move', { ids, x: t.x, y: t.y })]));
    sim.tick();
    sim.applyBundle(bundle(1));
    sim.tick();
    const id4 = sim.spawnUnit({ typeId: TEST_UNIT_TYPE, owner: 0, ...cellCenter(8, 8) });
    const buf = sim.writeSnapshot();
    const h = readSnapshotHeader(buf);
    expect(h).toEqual({ tick: 1, hash: sim.hash(), entityCount: 4, eventCount: 1 });
    const L = snapshotLayout(4, 1);
    expect(buf.byteLength).toBe(L.totalBytes);
    const idArr = new ENTITY_FIELDS.id.ctor(buf, L.entity.id, 4);
    expect(Array.from(idArr)).toEqual([...ids, id4]);
    const owner = new ENTITY_FIELDS.owner.ctor(buf, L.entity.owner, 4);
    expect(Array.from(owner)).toEqual([1, 1, 1, 0]);
    const hp = new ENTITY_FIELDS.hpPct.ctor(buf, L.entity.hpPct, 4);
    expect(Array.from(hp)).toEqual([100, 100, 100, 100]);
    const anim = new ENTITY_FIELDS.anim.ctor(buf, L.entity.anim, 4);
    expect(anim[0]).toBe(1); // lopend
    const x = new ENTITY_FIELDS.x.ctor(buf, L.entity.x, 4);
    expect(x[0]).toBe(sim.getUnit(ids[0]!)!.x);
    const evType = new Uint8Array(buf, L.event.type, 1);
    const evA = new Uint32Array(buf, L.event.a, 1);
    expect(evType[0]).toBe(EVENT_TYPE.spawn);
    expect(evA[0]).toBe(id4);
  });
});
