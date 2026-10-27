import { ANIM } from '@crawlout/protocol';
import { describe, expect, it } from 'vitest';
import {
  CLIP_DELAY_MAX_MS,
  InstanceVariation,
  MAX_CYCLE_RATE,
  MAX_PHASE_STEP_S,
  MIN_CYCLE_RATE,
  TURN_MAX_RATE,
  WALK_STRIDE_M,
  WORK_LOOP_S,
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

/**
 * Regression: "the animations freeze after a few seconds, every time". The sim's animT of a gather is the progress of the
 * whole job (13 s) and of a build a step counter, so a looping 2 s clip stood almost still; and a run of slow frames
 * (each over the stale limit) never advanced the phase. These drive the variation for minutes of real time.
 */
describe('InstanceVariation over long runs', () => {
  const ID = 9 << 20;
  const FRAME_MS = 1000 / 60;
  const CLIP_SECONDS = [2.4, 1.3, 0.9, 0.6, 1, 2, 5.2, 2.4]; // by ANIM id (idle, walk, run, attack1, attack2, gather, build, death)

  /** Longest stretch (s) in which the progress did not change, over a run of `frames` frames. */
  function longestStandStill(
    run: (frame: number) => number,
    frames: number,
    stepMs: number,
  ): number {
    let prev = run(0);
    let still = 0;
    let worst = 0;
    for (let f = 1; f < frames; f++) {
      const t = run(f);
      still = t === prev ? still + stepMs / 1000 : 0;
      worst = Math.max(worst, still);
      prev = t;
    }
    return worst;
  }

  /** Cycles completed by the progress t over a run of frames. */
  function cycles(run: (frame: number) => number, frames: number): number {
    let sum = 0;
    let prev = run(0);
    for (let f = 1; f < frames; f++) {
      const t = run(f);
      sum += (t - prev + 1) % 1;
      prev = t;
    }
    return sum;
  }

  it('plays a gather at the pace of its clip, not stretched over the whole job', () => {
    const v = new InstanceVariation();
    const jobS = 13;
    const frames = 60 * 65; // five jobs back to back
    const run = (f: number): number => {
      const sec = (f * FRAME_MS) / 1000;
      const simT = (sec % jobS) / jobS; // what the sim writes: progress of the job
      return v.apply(ID, 0, 0, ANIM.gather, simT, 0, 2.4, f * FRAME_MS, CLIP_SECONDS).t;
    };
    expect(cycles(run, frames)).toBeGreaterThan((65 / CLIP_SECONDS[ANIM.gather]!) * 0.85);
    expect(cycles(run, frames)).toBeLessThan((65 / CLIP_SECONDS[ANIM.gather]!) * 1.15);
    expect(longestStandStill(run, frames, FRAME_MS)).toBeLessThan(0.1);
  });

  it('plays a build at the pace of its clip, and a clip it does not know at WORK_LOOP_S', () => {
    const build = new InstanceVariation();
    const frames = 60 * 30;
    const byClip = (f: number): number =>
      build.apply(ID, 0, 0, ANIM.build, (f * 2048 * 0.05) % 1, 0, 2.4, f * FRAME_MS, CLIP_SECONDS)
        .t;
    expect(cycles(byClip, frames)).toBeCloseTo(30 / CLIP_SECONDS[ANIM.build]!, 0);
    const fallback = new InstanceVariation();
    const byDefault = (f: number): number =>
      fallback.apply(ID, 0, 0, ANIM.build, 0.5, 0, 2.4, f * FRAME_MS).t;
    expect(cycles(byDefault, frames)).toBeCloseTo(30 / WORK_LOOP_S, 0);
  });

  it('still hands attacks and death to the sim', () => {
    const v = new InstanceVariation();
    expect(v.apply(ID, 0, 0, ANIM.attack1, 0.4, 0, 2.4, 0, CLIP_SECONDS).t).toBe(0.4);
    expect(v.apply(ID, 0, 0, ANIM.death, 0.9, 0, 2.4, 16, CLIP_SECONDS).t).toBe(0.9);
  });

  it('keeps idle moving for two hours of clock time', () => {
    const v = new InstanceVariation();
    const base = 2 * 3600 * 1000;
    const run = (f: number): number =>
      v.apply(ID, 3, 4, ANIM.idle, 0, 0, 2.5, base + f * FRAME_MS).t;
    expect(longestStandStill(run, 60 * 30, FRAME_MS)).toBeLessThan(0.1);
    expect(cycles(run, 60 * 30)).toBeGreaterThan((30 / 2.5) * 0.85);
  });

  it('walks on at the ground speed when positions only change every snapshot (20 Hz, held between)', () => {
    const v = new InstanceVariation();
    const frames = 60 * 40;
    const run = (f: number): number => {
      const ms = f * FRAME_MS;
      const snapshotX = Math.floor(ms / 50) * 50 * 0.0034; // 3.4 m/s, a step every 50 ms
      return v.apply(ID, snapshotX, 0, ANIM.walk, 0, 0, 2.4, ms, CLIP_SECONDS).t;
    };
    run(0);
    const expected = (40 * 3.4) / WALK_STRIDE_M;
    expect(cycles(run, frames)).toBeGreaterThan(expected * 0.8);
    expect(cycles(run, frames)).toBeLessThan(expected * 1.25);
    expect(longestStandStill(run, frames, FRAME_MS)).toBeLessThan(0.1);
  });

  it('keeps cycling when every frame is slower than the stale limit', () => {
    const v = new InstanceVariation();
    const slowMs = 400; // 2.5 fps: a hitching machine
    const frames = 40;
    const idle = (f: number): number => v.apply(ID, 0, 0, ANIM.idle, 0, 0, 2.5, f * slowMs).t;
    expect(longestStandStill(idle, frames, slowMs)).toBeLessThan(slowMs / 1000 + 1e-9);
    const gather = new InstanceVariation();
    const work = (f: number): number =>
      gather.apply(ID, 0, 0, ANIM.gather, 0.3, 0, 2.5, f * slowMs, CLIP_SECONDS).t;
    expect(cycles(work, frames)).toBeGreaterThan(2);
    // A long absence (culled for a minute) advances the cycle by one capped step, not by the whole gap.
    const gone = new InstanceVariation();
    const before = gone.apply(ID, 0, 0, ANIM.idle, 0, 0, 2.5, 0).t;
    gone.apply(ID, 0, 0, ANIM.idle, 0, 0, 2.5, 16);
    const after = gone.apply(ID, 0, 0, ANIM.idle, 0, 0, 2.5, 16 + 60000).t;
    expect((after - before + 1) % 1).toBeLessThan((MAX_PHASE_STEP_S / 2.5) * 1.2 + 0.01);
  });
});
