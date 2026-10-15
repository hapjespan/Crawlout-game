import { describe, expect, it } from 'vitest';
import { ANIM } from '@crawlout/protocol';
import {
  createRigidPose,
  idlePeriod,
  motionWeight,
  recoil,
  rigidPose,
  type RigidMotionParams,
  type RigidPose,
} from './rigidMotion.js';

const GUARD: RigidMotionParams = { height: 2.2, hover: 0 };
const SENTINEL: RigidMotionParams = { height: 3.5, hover: 0 };
const DRONE: RigidMotionParams = { height: 0.8, hover: 1.35 };

function pose(p: RigidMotionParams, anim: number, t: number, time = 0, phase = 0.25): RigidPose {
  return { ...rigidPose(p, anim, t, time, phase, createRigidPose()) };
}

/** Samples a field of the pose over one clip loop. */
function over(p: RigidMotionParams, anim: number, field: keyof RigidPose, steps = 64): number[] {
  return Array.from({ length: steps }, (_, k) => pose(p, anim, k / steps)[field]);
}

const range = (xs: number[]): number => Math.max(...xs) - Math.min(...xs);
const peak = (xs: number[]): number => Math.max(...xs.map(Math.abs));

describe('rigidPose', () => {
  it('only ever produces finite numbers, for every anim, progress, time and an unknown anim id', () => {
    for (const p of [GUARD, SENTINEL, DRONE])
      for (const anim of [0, 1, 2, 3, 4, 5, 6, 7, 99])
        for (const t of [0, 0.01, 0.5, 0.999, 1])
          for (const time of [0, 3.7, 1234.5]) {
            const out = pose(p, anim, t, time, 0.9);
            for (const v of Object.values(out)) expect(Number.isFinite(v)).toBe(true);
            expect(out.dim).toBeGreaterThanOrEqual(0);
            expect(out.dim).toBeLessThanOrEqual(1);
            expect(out.glow).toBeGreaterThanOrEqual(0);
            expect(out.glow).toBeLessThanOrEqual(1);
            expect(out.scale).toBeGreaterThan(0.5);
          }
  });

  it('lets a walker idle with a subtle sway and a drone float with a bob around its hover height', () => {
    for (const p of [GUARD, SENTINEL]) {
      for (let k = 0; k < 40; k++) {
        const o = pose(p, ANIM.idle, k / 40);
        expect(Math.abs(o.pitch)).toBeLessThan(0.02);
        expect(Math.abs(o.roll)).toBeLessThan(0.02);
        expect(o.lift).toBeGreaterThanOrEqual(0);
        expect(o.lift).toBeLessThan(0.01 * p.height);
      }
      expect(range(over(p, ANIM.idle, 'roll'))).toBeGreaterThan(0.01); // it does move
      // The sway closes over the idle loop, so it does not jump when the loop wraps.
      expect(pose(p, ANIM.idle, 0).roll).toBeCloseTo(pose(p, ANIM.idle, 1).roll, 9);
      expect(pose(p, ANIM.idle, 0).pitch).toBeCloseTo(pose(p, ANIM.idle, 1).pitch, 9);
    }
    // The hover height is baked into the model: the float is a bob around zero lift.
    const lifts = Array.from({ length: 200 }, (_, k) => pose(DRONE, ANIM.idle, 0, k * 0.05).lift);
    expect(Math.min(...lifts)).toBeGreaterThan(-0.1);
    expect(Math.max(...lifts)).toBeLessThan(0.1);
    expect(range(lifts)).toBeGreaterThan(0.06); // a visible bob
  });

  it('desynchronizes units through the phase', () => {
    const a = pose(GUARD, ANIM.idle, 0.3, 5, 0.1);
    const b = pose(GUARD, ANIM.idle, 0.3, 5, 0.6);
    expect(a.roll).not.toBeCloseTo(b.roll, 3);
    expect(pose(DRONE, ANIM.idle, 0, 5, 0.1).lift).not.toBeCloseTo(
      pose(DRONE, ANIM.idle, 0, 5, 0.33).lift,
      3,
    );
  });

  it('rocks and stomps a walker: two bobs and one sway per loop, more on a run', () => {
    const walkLift = over(GUARD, ANIM.walk, 'lift');
    const walkRoll = over(GUARD, ANIM.walk, 'roll');
    expect(Math.min(...walkRoll)).toBeLessThan(-0.03);
    expect(Math.max(...walkRoll)).toBeGreaterThan(0.03);
    // Two steps per loop: the lift repeats at half a loop, the roll flips sign.
    for (const t of [0.07, 0.19, 0.41]) {
      expect(pose(GUARD, ANIM.walk, t).lift).toBeCloseTo(pose(GUARD, ANIM.walk, t + 0.5).lift, 6);
      expect(pose(GUARD, ANIM.walk, t).roll).toBeCloseTo(-pose(GUARD, ANIM.walk, t + 0.5).roll, 6);
    }
    expect(range(walkLift)).toBeGreaterThan(0.03);
    expect(range(over(GUARD, ANIM.run, 'lift'))).toBeGreaterThan(range(walkLift));
    expect(peak(over(GUARD, ANIM.run, 'roll'))).toBeGreaterThan(peak(walkRoll));
    expect(pose(GUARD, ANIM.run, 0.3).pitch).toBeGreaterThan(pose(GUARD, ANIM.walk, 0.3).pitch);
  });

  it('gives the taller sentinel more weight than the guard, from the height alone', () => {
    expect(motionWeight(SENTINEL.height)).toBeGreaterThan(motionWeight(GUARD.height));
    expect(motionWeight(GUARD.height)).toBeCloseTo(1, 6);
    expect(peak(over(SENTINEL, ANIM.walk, 'roll'))).toBeGreaterThan(
      peak(over(GUARD, ANIM.walk, 'roll')),
    );
    expect(range(over(SENTINEL, ANIM.walk, 'lift'))).toBeGreaterThan(
      range(over(GUARD, ANIM.walk, 'lift')),
    );
    // Idle sways slower: one loop lasts longer.
    expect(idlePeriod(SENTINEL)).toBeGreaterThan(idlePeriod(GUARD));
    expect(idlePeriod(GUARD)).toBeCloseTo(3.2, 6);
  });

  it('tilts a drone forward into the movement, more on a run', () => {
    const idle = pose(DRONE, ANIM.idle, 0, 0, 0.5);
    const walk = pose(DRONE, ANIM.walk, 0.3, 0, 0.5);
    const run = pose(DRONE, ANIM.run, 0.3, 0, 0.5);
    expect(walk.pitch - idle.pitch).toBeGreaterThan(0.1);
    expect(run.pitch).toBeGreaterThan(walk.pitch + 0.1);
    expect(walk.lift).toBeGreaterThan(-0.15); // still floating
  });

  it('kicks back on an attack: zero at both ends, a peak early, smaller for attack2', () => {
    for (const p of [GUARD, SENTINEL, DRONE]) {
      expect(pose(p, ANIM.attack1, 0).back).toBeCloseTo(0, 9);
      expect(pose(p, ANIM.attack1, 1).back).toBeCloseTo(0, 9);
      const peakAt = over(p, ANIM.attack1, 'back', 100).reduce(
        (best, v, k, all) => (v > all[best]! ? k : best),
        0,
      );
      expect(peakAt / 100).toBeLessThan(0.2);
      expect(Math.max(...over(p, ANIM.attack1, 'back'))).toBeGreaterThan(0.04 * p.height);
      expect(Math.max(...over(p, ANIM.attack2, 'back'))).toBeLessThan(
        Math.max(...over(p, ANIM.attack1, 'back')),
      );
      expect(pose(p, ANIM.attack1, 0.12).pitch).toBeLessThan(pose(p, ANIM.idle, 0).pitch + 0.01);
    }
    expect(recoil(0)).toBe(0);
    expect(recoil(1)).toBe(0);
    expect(recoil(0.1)).toBeCloseTo(1, 6);
  });

  it('pulses a drone at work (size and glow) and leaves a walker at its job without glow', () => {
    for (const anim of [ANIM.gather, ANIM.build]) {
      const scales = Array.from({ length: 100 }, (_, k) => pose(DRONE, anim, 0.5, k * 0.04).scale);
      const glows = Array.from({ length: 100 }, (_, k) => pose(DRONE, anim, 0.5, k * 0.04).glow);
      expect(Math.min(...scales)).toBeLessThan(0.97);
      expect(Math.max(...scales)).toBeGreaterThan(1.03);
      expect(Math.min(...glows)).toBeLessThan(0.1);
      expect(Math.max(...glows)).toBeGreaterThan(0.9);
      const walker = pose(GUARD, anim, 0.3, 2);
      expect(walker.glow).toBe(0);
      expect(walker.scale).toBe(1);
      expect(walker.pitch).toBeGreaterThan(0.03); // leans into the work
    }
  });

  it('topples a walker, sinks it and powers it down in the death clip', () => {
    for (const phase of [0.2, 0.8]) {
      const start = pose(GUARD, ANIM.death, 0, 0, phase);
      const end = pose(GUARD, ANIM.death, 1, 0, phase);
      expect(Math.abs(start.roll)).toBeLessThan(0.01);
      expect(start.dim).toBe(0);
      expect(Math.abs(end.roll)).toBeGreaterThan(1.3); // lying on its side
      expect(end.lift).toBeLessThan(-0.1);
      expect(end.dim).toBeGreaterThan(0.75);
      expect(end.glow).toBe(0);
      expect(Math.sign(end.roll)).toBe(phase < 0.5 ? -1 : 1);
    }
    const dims = over(GUARD, ANIM.death, 'dim');
    for (let k = 1; k < dims.length; k++)
      expect(dims[k]!).toBeGreaterThanOrEqual(dims[k - 1]! - 1e-9);
  });

  it('drops a drone out of the air, tilting, and powers it down', () => {
    const start = pose(DRONE, ANIM.death, 0, 0, 0.3);
    const mid = pose(DRONE, ANIM.death, 0.3, 0, 0.3);
    const end = pose(DRONE, ANIM.death, 1, 0, 0.3);
    expect(start.lift).toBeGreaterThan(-0.15); // floating, hover baked in
    expect(mid.lift).toBeLessThan(start.lift - 0.2);
    expect(end.lift).toBeLessThan(-DRONE.hover); // dropped the whole hover height, and a little deeper
    expect(end.pitch).toBeGreaterThan(0.9);
    expect(end.dim).toBeGreaterThan(0.75);
  });

  it('treats an unknown anim id as idle', () => {
    expect(pose(GUARD, 200, 0.4, 3.3, 0.7)).toEqual(pose(GUARD, ANIM.idle, 0.4, 3.3, 0.7));
    expect(pose(DRONE, 200, 0.4, 3.3, 0.7)).toEqual(pose(DRONE, ANIM.idle, 0.4, 3.3, 0.7));
  });
});
