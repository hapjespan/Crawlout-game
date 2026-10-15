import { ANIM } from '@crawlout/protocol';
import { describe, expect, it } from 'vitest';
import {
  CLIP_DELAY_MAX_MS,
  InstanceVariation,
  MAX_CYCLE_RATE,
  MIN_CYCLE_RATE,
  TURN_MAX_RATE,
  WALK_STRIDE_M,
  angleDiff,
  hash01,
  phaseOffset,
  rateVariation,
  speedToCycleRate,
  turnToward,
} from './animVariation.js';

describe('hash helpers', () => {
  it('are stable and in range', () => {
    expect(phaseOffset(12345)).toBe(phaseOffset(12345));
    for (let id = 0; id < 2000; id++) {
      const p = phaseOffset(id << 20);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThan(1);
      const r = rateVariation(id, 0.08);
      expect(r).toBeGreaterThanOrEqual(0.92);
      expect(r).toBeLessThanOrEqual(1.08);
    }
  });

  it('spread consecutive entity ids over the whole phase range', () => {
    const bins = new Array<number>(10).fill(0);
    for (let i = 0; i < 1000; i++) bins[Math.floor(phaseOffset(i << 20) * 10)]!++;
    for (const b of bins) expect(b).toBeGreaterThan(60);
    expect(hash01(1, 1)).not.toBe(hash01(1, 2));
  });
});

describe('speedToCycleRate', () => {
  it('is cycles per meter and clamped', () => {
    expect(speedToCycleRate(WALK_STRIDE_M, WALK_STRIDE_M)).toBeCloseTo(1);
    expect(speedToCycleRate(2 * WALK_STRIDE_M, WALK_STRIDE_M)).toBeCloseTo(2);
    expect(speedToCycleRate(0, WALK_STRIDE_M)).toBe(MIN_CYCLE_RATE);
    expect(speedToCycleRate(100, WALK_STRIDE_M)).toBe(MAX_CYCLE_RATE);
  });
});

describe('turnToward', () => {
  it('never snaps 180 degrees and does not overshoot', () => {
    const dt = 1 / 60;
    let yaw = 0;
    const first = turnToward(yaw, Math.PI, dt);
    expect(Math.abs(first)).toBeLessThanOrEqual(TURN_MAX_RATE * dt + 1e-9);
    for (let i = 0; i < 120; i++) yaw = turnToward(yaw, Math.PI - 0.01, dt);
    expect(Math.abs(angleDiff(yaw, Math.PI - 0.01))).toBeLessThan(0.01);
  });

  it('takes the short way round', () => {
    expect(turnToward(3.0, -3.0, 0.016)).toBeGreaterThan(3.0);
  });
});

describe('InstanceVariation', () => {
  const ID_A = 5 << 20;
  const ID_B = 6 << 20;
  const FRAME_MS = 1000 / 60;

  it('puts two idle units out of phase', () => {
    const v = new InstanceVariation();
    const a = v.apply(ID_A, 0, 0, ANIM.idle, 0, 0, 2.4, 0).t;
    const b = v.apply(ID_B, 1, 0, ANIM.idle, 0, 0, 2.4, 0).t;
    expect(a).not.toBeCloseTo(b, 2);
  });

  it('slows the walk cycle when the unit moves slower', () => {
    const v = new InstanceVariation();
    let x = 0;
    let t = 0;
    let prev = v.apply(ID_A, 0, 0, ANIM.walk, 0, 0, 2.4, 0).t;
    const cyclesAt = (speed: number, secs: number): number => {
      let sum = 0;
      for (let i = 0; i < secs * 60; i++) {
        t += FRAME_MS;
        x += speed / 60;
        const now = v.apply(ID_A, x, 0, ANIM.walk, 0, 0, 2.4, t).t;
        sum += (now - prev + 1) % 1;
        prev = now;
      }
      return sum;
    };
    cyclesAt(3, 1); // let the speed smoothing settle
    const fast = cyclesAt(3, 2);
    cyclesAt(0.5, 1);
    const slow = cyclesAt(0.5, 2);
    expect(fast).toBeGreaterThan(2.2);
    expect(slow).toBeLessThan(fast * 0.4);
  });

  it('holds a locomotion change for at most the start delay, but not an attack', () => {
    const v = new InstanceVariation();
    let t = 0;
    v.apply(ID_A, 0, 0, ANIM.idle, 0, 0, 2.4, t);
    t += FRAME_MS;
    v.apply(ID_A, 0, 0, ANIM.walk, 0, 0, 2.4, t);
    t += CLIP_DELAY_MAX_MS + 20;
    expect(v.apply(ID_A, 0.1, 0, ANIM.walk, 0, 0, 2.4, t).clip).toBe(ANIM.walk);
    t += FRAME_MS;
    expect(v.apply(ID_A, 0.1, 0, ANIM.attack1, 0.2, 0, 2.4, t).clip).toBe(ANIM.attack1);
  });

  it('spreads the switch time of a group that gets the same order', () => {
    const v = new InstanceVariation();
    const ids = Array.from({ length: 20 }, (_, i) => (i + 1) << 20);
    for (const id of ids) v.apply(id, 0, 0, ANIM.idle, 0, 0, 2.4, 0);
    const counts = new Set<number>();
    for (let step = 1; step <= 12; step++) {
      let n = 0;
      for (const id of ids) {
        if (v.apply(id, 0, 0, ANIM.walk, 0, 0, 2.4, step * 16).clip === ANIM.walk) n++;
      }
      counts.add(n);
    }
    expect(counts.size).toBeGreaterThan(3);
  });

  it('passes non-locomotion progress through and starts a new entity at the sim heading', () => {
    const v = new InstanceVariation();
    const o = v.apply(ID_A, 0, 0, ANIM.attack1, 0.37, 2, 2.4, 0);
    expect(o.t).toBe(0.37);
    expect(Math.abs(o.yaw - 2)).toBeLessThan(0.1);
  });
});
