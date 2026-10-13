import { describe, expect, it } from 'vitest';
import { TICK_MS, UNITS_PER_METER } from '@crawlout/protocol';
import { encodeSnapshot, type EntityRecord } from '../dev/snapshotWriter.js';
import { createInterpolatedFrame, lerpAngle, lerpAnimT, SnapshotInterpolator } from './interpolate.js';

const M = UNITS_PER_METER;

function snap(tick: number, entities: EntityRecord[]): ArrayBuffer {
  return encodeSnapshot(tick, 0, entities);
}

describe('lerpAngle', () => {
  it('takes the short way across 0', () => {
    expect(lerpAngle(65000, 500, 0.5)).toBeCloseTo((65000 + (500 + 65536 - 65000) / 2) % 65536, 6);
    expect(lerpAngle(500, 65000, 0.5)).toBeCloseTo(65518, 6);
    expect(lerpAngle(100, 300, 0.25)).toBe(150);
  });
  it('stays in [0, 65536)', () => {
    for (const [a, b] of [
      [0, 65535],
      [65535, 0],
      [10, 65530],
    ] as const) {
      for (const t of [0, 0.3, 0.7, 1]) {
        const r = lerpAngle(a, b, t);
        expect(r).toBeGreaterThanOrEqual(0);
        expect(r).toBeLessThan(65536);
      }
    }
  });
});

describe('lerpAnimT', () => {
  it('interpolates forwards and wraps a looping clip', () => {
    expect(lerpAnimT(0, 32768, 0.5)).toBeCloseTo(0.25, 6);
    // 60000 -> 4000 means the loop wrapped: 4000 counts as 69536, halfway is 64768
    expect(lerpAnimT(60000, 4000, 0.5)).toBeCloseTo(((60000 + 4768) % 65536) / 65536, 6);
  });
});

describe('SnapshotInterpolator', () => {
  it('runs one tick behind: shows prev when curr arrives, curr one TICK_MS later', () => {
    const si = new SnapshotInterpolator();
    const out = createInterpolatedFrame(16);
    si.push(snap(1, [{ id: 5, x: 0, y: 0 }]), 1000);
    si.push(snap(2, [{ id: 5, x: 10 * M, y: -4 * M }]), 1050);

    si.sample(1050, out);
    expect(out.count).toBe(1);
    expect(out.x[0]).toBeCloseTo(0);
    si.sample(1050 + TICK_MS / 2, out);
    expect(out.x[0]).toBeCloseTo(5);
    expect(out.z[0]).toBeCloseTo(-2);
    si.sample(1050 + TICK_MS, out);
    expect(out.x[0]).toBeCloseTo(10);
    si.sample(1050 + TICK_MS * 3, out);
    expect(out.x[0]).toBeCloseTo(10); // clamps, never extrapolates
  });

  it('matches entities by id, not by index', () => {
    const si = new SnapshotInterpolator();
    const out = createInterpolatedFrame(16);
    si.push(snap(1, [{ id: 1, x: 0, y: 0 }, { id: 2, x: 100 * M, y: 0 }]), 0);
    si.push(snap(2, [{ id: 2, x: 102 * M, y: 0 }, { id: 3, x: 50 * M, y: 0 }, { id: 1, x: 2 * M, y: 0 }]), 0);
    si.sample(TICK_MS / 2, out);
    expect([...out.id.subarray(0, out.count)]).toEqual([2, 3, 1]);
    expect(out.x[0]).toBeCloseTo(101); // id 2
    expect(out.x[1]).toBeCloseTo(50); // id 3 just spawned: curr state
    expect(out.x[2]).toBeCloseTo(1); // id 1
  });

  it('stretches the interval over skipped ticks and snaps teleports', () => {
    const si = new SnapshotInterpolator();
    const out = createInterpolatedFrame(4);
    si.push(snap(10, [{ id: 1, x: 0, y: 0 }, { id: 2, x: 0, y: 0 }]), 0);
    si.push(snap(12, [{ id: 1, x: 4 * M, y: 0 }, { id: 2, x: 500 * M, y: 0 }]), 0);
    si.sample(TICK_MS, out); // half of a two-tick gap
    expect(out.x[0]).toBeCloseTo(2);
    expect(out.x[1]).toBeCloseTo(500);
  });

  it('interpolates yaw and animT, and drops animT blending when the clip changes', () => {
    const si = new SnapshotInterpolator();
    const out = createInterpolatedFrame(4);
    si.push(snap(1, [{ id: 1, x: 0, y: 0, yaw: 65436, anim: 1, animT: 65036 }, { id: 2, x: 0, y: 0, anim: 1, animT: 1000 }]), 0);
    si.push(snap(2, [{ id: 1, x: 0, y: 0, yaw: 100, anim: 1, animT: 500 }, { id: 2, x: 0, y: 0, anim: 3, animT: 2000 }]), 0);
    si.sample(TICK_MS / 2, out);
    expect(out.yaw[0]).toBeCloseTo(Math.PI / 2, 5); // halfway between -100 and +100 on the circle = sim +x = render PI/2
    expect(out.animT[0]).toBeCloseTo(0, 5); // 65036 -> 500 wraps through 0
    expect(out.animT[1]).toBeCloseTo(2000 / 65536, 6);
    expect(out.anim[1]).toBe(3);
  });

  it('drops snapshots that are not newer and reports emptiness before the first one', () => {
    const si = new SnapshotInterpolator();
    const out = createInterpolatedFrame(4);
    expect(si.sample(0, out)).toBe(false);
    expect(out.count).toBe(0);
    expect(si.push(snap(5, [{ id: 1, x: M, y: 0 }]), 0)).toBe(true);
    expect(si.push(snap(5, [{ id: 1, x: 9 * M, y: 0 }]), 10)).toBe(false);
    expect(si.push(snap(4, [{ id: 1, x: 9 * M, y: 0 }]), 10)).toBe(false);
    expect(si.sample(10, out)).toBe(true);
    expect(out.x[0]).toBeCloseTo(1);
  });

  it('converts sim units to meters and yaw to radians', () => {
    const si = new SnapshotInterpolator();
    const out = createInterpolatedFrame(4);
    si.push(snap(1, [{ id: 1, x: 3 * M, y: 7 * M, yaw: 16384, owner: 2, flags: 1, hpPct: 80, typeId: 9 }]), 0);
    si.sample(0, out);
    expect(out.x[0]).toBe(3);
    expect(out.z[0]).toBe(7);
    expect(out.yaw[0]).toBeCloseTo(0, 5); // sim yaw 16384 = sim +y = world +z = model forward, render yaw 0
    expect([out.owner[0], out.flags[0], out.hpPct[0], out.typeId[0]]).toEqual([2, 1, 80, 9]);
  });
});
