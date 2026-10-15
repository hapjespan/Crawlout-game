// Procedural animation of rigid (not skinned) units: the robots of the Dwellers (security robot, repair drone,
// sentinel). A rigid mesh has no clips, so the snapshot's `anim` and `animT` drive a small pose per instance instead:
// a lift, a push back along the facing, a pitch (nose down positive) and a roll around the model's pivot, a uniform
// scale pulse, a dim (power down) and a glow (team-colored pulse). The CPU computes it per visible instance, the vertex
// shader (rigidUnitMaterial.ts) only applies it. Cheap, no skinning, and a pure function, so the tests can read it.
//
// Two movement kinds, told apart by data alone (the manifest's `hover`, never by asset id):
//   walker: feet on the ground; idle sways a little, walk and run rock and stomp (a heavier, taller body moves slower
//           and with more weight: `weight` follows the model height), attack kicks back, death topples and sinks;
//   hover:  floats `hover` meters above the ground with a bob; walk and run tilt it forward into the movement,
//           gather and build pulse it, death drops it out of the air, tilting.
// All amplitudes scale with the model's height, so a 3.5 m sentinel and a 2.2 m guard share the formulas.
import { ANIM } from '@crawlout/protocol';

/** What the animation needs to know about one asset. */
export interface RigidMotionParams {
  /** Model height in meters (manifest bounds). */
  height: number;
  /** Hover height in meters above the ground; 0 for a unit that stands on the ground. */
  hover: number;
}

/** The pose of one instance. Lengths in meters, angles in radians. */
export interface RigidPose {
  /** Extra height above the unit's ground point (hover height included). */
  lift: number;
  /** Displacement against the facing (recoil). */
  back: number;
  /** Rotation around the model's x axis, positive = nose down. */
  pitch: number;
  /** Rotation around the model's z axis (sway, topple). */
  roll: number;
  /** Uniform scale around the pivot. */
  scale: number;
  /** 0..1: how far the unit is powered down (darker albedo). */
  dim: number;
  /** 0..1: team-colored glow added on top of the shading. */
  glow: number;
}

export function createRigidPose(): RigidPose {
  return { lift: 0, back: 0, pitch: 0, roll: 0, scale: 1, dim: 0, glow: 0 };
}

const TAU = Math.PI * 2;
/** Height of the guard the walker amplitudes are tuned for (m); taller bodies move heavier. */
const REFERENCE_HEIGHT = 2.2;
/** Where in the loop a recoil peaks. */
const RECOIL_RISE = 0.1;

function smooth(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Heaviness of a walker: 1 at the guard's height, more for taller bodies (clamped). */
export function motionWeight(height: number): number {
  return Math.min(2.2, Math.max(0.6, height / REFERENCE_HEIGHT));
}

/** 0 at the start of a one-shot, rises quickly to 1 at RECOIL_RISE and decays smoothly back to 0 at the end. */
export function recoil(t: number): number {
  return smooth(0, RECOIL_RISE, t) * (1 - smooth(RECOIL_RISE, 1, t));
}

/**
 * Pose of an instance. `anim` is the snapshot's ANIM id (an unknown id acts as idle), `t` the clip progress 0..1,
 * `time` seconds of the render clock (idle motion and pulses, which have no clip progress), `phase` 0..1 a per-unit
 * offset so a group does not sway in step. Writes into `out` and returns it.
 */
export function rigidPose(
  p: RigidMotionParams,
  anim: number,
  t: number,
  time: number,
  phase: number,
  out: RigidPose,
): RigidPose {
  out.lift = p.hover;
  out.back = 0;
  out.pitch = 0;
  out.roll = 0;
  out.scale = 1;
  out.dim = 0;
  out.glow = 0;
  const h = p.height;
  const hovering = p.hover > 0;
  const k = motionWeight(h);
  const cycle = TAU * t;
  const side = phase < 0.5 ? -1 : 1;

  if (hovering) {
    // The float: a slow bob plus a faster flutter, and a little lean that never stops.
    const bob =
      Math.sin(TAU * (time * 0.7 + phase)) * 0.06 + Math.sin(TAU * (time * 1.9 + phase * 3)) * 0.02;
    out.lift = p.hover + bob;
    out.pitch = Math.sin(TAU * (time * 0.5 + phase)) * 0.03;
    out.roll = Math.sin(TAU * (time * 0.6 + phase * 2)) * 0.04;
  }

  switch (anim) {
    case ANIM.walk:
    case ANIM.run: {
      const run = anim === ANIM.run;
      if (hovering) {
        out.pitch += run ? 0.32 : 0.16; // into the movement
        out.roll += Math.sin(cycle) * 0.03;
      } else {
        // Two steps per loop: the body rises and falls twice, and rocks over the standing foot once.
        const step = Math.sin(cycle);
        out.lift += (run ? 0.04 : 0.022) * h * step * step;
        out.roll = step * (run ? 0.08 : 0.06) * Math.sqrt(k);
        out.pitch = (run ? 0.14 : 0.03) + Math.sin(2 * cycle) * (run ? 0.03 : 0.015) * k;
      }
      break;
    }
    case ANIM.attack1:
    case ANIM.attack2: {
      const r = recoil(t) * (anim === ANIM.attack2 ? 0.7 : 1);
      out.back = (hovering ? 0.1 : 0.06) * h * r;
      out.pitch -= (hovering ? 0.25 : 0.07) * r;
      break;
    }
    case ANIM.gather:
    case ANIM.build: {
      if (hovering) {
        // The drone pulses while it works: size and glow in step, leaning towards the job.
        const pulse = Math.sin(TAU * (time * 2.5 + phase));
        out.scale = 1 + 0.07 * pulse;
        out.glow = 0.5 + 0.5 * pulse;
        out.pitch += 0.12;
        out.lift += 0.03 * Math.sin(TAU * (time * 1.3 + phase));
      } else {
        const strike = Math.sin(TAU * t * 3);
        out.pitch = 0.09 + 0.05 * strike;
        out.lift += 0.01 * h * strike * strike;
      }
      break;
    }
    case ANIM.death: {
      const fall = smooth(0, hovering ? 0.5 : 0.6, t);
      const e = fall * fall; // accelerates
      out.dim = 0.8 * smooth(0.1, 0.95, t);
      if (hovering) {
        out.lift = p.hover * (1 - e) - 0.05 * smooth(0.5, 1, t);
        out.pitch = 1 * e;
        out.roll = side * 0.7 * e + side * Math.sin(40 * t) * 0.05 * (1 - t);
      } else {
        out.lift = -0.12 * h * smooth(0.55, 1, t);
        out.roll = side * 1.42 * e + side * Math.sin(40 * t) * 0.03 * (1 - t);
        out.pitch = 0.1 * e;
      }
      break;
    }
    default: {
      // Idle (and any unknown clip): breathing and a little weight shift. Taller bodies sway slower.
      if (!hovering) {
        const w = TAU * (time * (0.45 / Math.sqrt(k)) + phase);
        out.lift += 0.004 * h * (0.5 + 0.5 * Math.sin(w));
        out.pitch = 0.012 * Math.sin(w);
        out.roll = 0.016 * Math.sin(0.7 * w + phase * TAU);
      }
    }
  }
  return out;
}
