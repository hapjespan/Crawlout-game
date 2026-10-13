import { describe, expect, it } from 'vitest';
import { EVENT_TYPE, UNITS_PER_METER } from '@crawlout/protocol';
import { buildingTypeId } from '../entities/typeIds.js';
import { EffectSpawner, type EffectContext, type EntityRef } from './effects.js';
import type { ParticleSink, ParticleSpec } from './particles.js';

class Collect implements ParticleSink {
  readonly items: ParticleSpec[] = [];
  emit(p: ParticleSpec): void {
    this.items.push({ ...p });
  }
}

const M = UNITS_PER_METER;

function context(entities: Record<number, EntityRef>): EffectContext {
  return {
    entity(id, out) {
      const e = entities[id];
      if (!e) return false;
      Object.assign(out, e);
      return true;
    },
    heightAt: () => 2,
    footprint: (typeId) => (typeId === buildingTypeId(0) ? { w: 5, h: 5 } : { w: 2, h: 2 }),
  };
}

function seeded(): () => number {
  let s = 12345;
  return () => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    return s / 4294967296;
  };
}

describe('EffectSpawner', () => {
  const ctx = context({
    1: { x: 10, z: 10, yaw: 0, typeId: 1 },
    2: { x: 10, z: 20, yaw: 0, typeId: 1 },
    3: { x: 30, z: 30, yaw: 0, typeId: buildingTypeId(0) },
  });

  it('fires a muzzle flash at the shooter and a tracer towards the target', () => {
    const add = new Collect();
    const alpha = new Collect();
    new EffectSpawner(add, alpha, seeded()).handle(EVENT_TYPE.shotFired, 1, 2, 0, 0, 5, ctx);
    expect(add.items.length).toBeGreaterThanOrEqual(3);
    expect(alpha.items.length).toBeGreaterThanOrEqual(1);
    const flash = add.items[0]!;
    expect(flash.t0).toBe(5);
    expect(flash.y).toBeGreaterThan(2); // above the terrain height of 2
    expect(flash.x).toBeCloseTo(10, 5);
    expect(flash.z).toBeGreaterThan(10); // in front, towards the target at z = 20
    const tracer = add.items.find((p) => p.vz > 50)!;
    expect(tracer).toBeDefined();
    expect(tracer.z + tracer.vz * tracer.life).toBeCloseTo(20, 0);
  });

  it('puts impacts at the event position, or at the target (a) when the event has none', () => {
    const add = new Collect();
    const fx = new EffectSpawner(add, new Collect(), seeded());
    fx.handle(EVENT_TYPE.hit, 2, 1, 40 * M, 50 * M, 0, ctx);
    expect(add.items[0]!.x).toBeCloseTo(40);
    expect(add.items[0]!.z).toBeCloseTo(50);
    add.items.length = 0;
    fx.handle(EVENT_TYPE.hit, 3, 1, 0, 0, 0, ctx); // a = target (building 3), b = shooter (unit 1)
    expect(add.items[0]!.x).toBeCloseTo(30);
    expect(add.items[0]!.y).toBeGreaterThan(3); // building hit sits higher
  });

  it('falls back to the shooter (b) when the target of a hit without position is gone', () => {
    const add = new Collect();
    new EffectSpawner(add, new Collect(), seeded()).handle(EVENT_TYPE.hit, 99, 2, 0, 0, 0, ctx);
    expect(add.items[0]!.x).toBeCloseTo(10);
    expect(add.items[0]!.z).toBeCloseTo(20);
    expect(add.items[0]!.y).toBeCloseTo(3); // terrain 2 + unit hit height 1
  });

  it('makes a bigger death cloud for buildings than for units', () => {
    const unit = new Collect();
    const building = new Collect();
    new EffectSpawner(new Collect(), unit, seeded()).handle(EVENT_TYPE.death, 1, 1, 10 * M, 10 * M, 0, ctx);
    new EffectSpawner(new Collect(), building, seeded()).handle(EVENT_TYPE.death, 3, buildingTypeId(0), 30 * M, 30 * M, 0, ctx);
    expect(unit.items.length).toBeGreaterThan(0);
    expect(building.items.length).toBeGreaterThan(unit.items.length);
  });

  it('sizes the death of a demolished building from event.b, although it left the snapshot', () => {
    const gone = context({}); // the building is no longer in the snapshot carrying its death event
    const fromB = new Collect();
    new EffectSpawner(new Collect(), fromB, seeded()).handle(EVENT_TYPE.death, 77, buildingTypeId(0), 30 * M, 30 * M, 0, gone);
    const asUnit = new Collect();
    new EffectSpawner(new Collect(), asUnit, seeded()).handle(EVENT_TYPE.death, 77, 1, 30 * M, 30 * M, 0, gone);
    expect(fromB.items.length).toBeGreaterThan(asUnit.items.length);
    const spread = (items: ParticleSpec[]) => Math.max(...items.map((p) => p.size1));
    expect(spread(fromB.items)).toBeGreaterThan(spread(asUnit.items)); // a 5x5 footprint makes a wider cloud
  });

  it('still reads the typeId from the snapshot when b is 0', () => {
    const building = new Collect();
    const unit = new Collect();
    new EffectSpawner(new Collect(), building, seeded()).handle(EVENT_TYPE.death, 3, 0, 30 * M, 30 * M, 0, ctx);
    new EffectSpawner(new Collect(), unit, seeded()).handle(EVENT_TYPE.death, 1, 0, 10 * M, 10 * M, 0, ctx);
    expect(building.items.length).toBeGreaterThan(unit.items.length);
  });

  it('rings a building footprint with dust on placement and adds sparks when done', () => {
    const placedAlpha = new Collect();
    const placedAdd = new Collect();
    new EffectSpawner(placedAdd, placedAlpha, seeded()).handle(EVENT_TYPE.buildingPlaced, 3, buildingTypeId(0), 30 * M, 30 * M, 1, ctx);
    expect(placedAlpha.items.length).toBeGreaterThan(20);
    expect(placedAdd.items.length).toBe(0);
    for (const p of placedAlpha.items) {
      const edge = Math.max(Math.abs(p.x - 30), Math.abs(p.z - 30));
      expect(edge).toBeCloseTo(2.5, 5); // on the 5x5 footprint edge
    }
    const doneAdd = new Collect();
    new EffectSpawner(doneAdd, new Collect(), seeded()).handle(EVENT_TYPE.buildingDone, 3, buildingTypeId(0), 0, 0, 1, ctx);
    expect(doneAdd.items.length).toBeGreaterThan(0);
  });

  it('ignores events it has no effect for, and events without any position', () => {
    const add = new Collect();
    const alpha = new Collect();
    const fx = new EffectSpawner(add, alpha, seeded());
    fx.handle(EVENT_TYPE.spawn, 1, 1, 10 * M, 10 * M, 0, ctx);
    fx.handle(EVENT_TYPE.claimTaken, 1, 0, 10 * M, 10 * M, 0, ctx);
    fx.handle(EVENT_TYPE.death, 99, 0, 0, 0, 0, ctx);
    expect(add.items.length + alpha.items.length).toBe(0);
  });
});
