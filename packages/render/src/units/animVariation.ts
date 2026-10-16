// Render-only movement variation: units of one type must not move in lockstep. Pure helpers plus a small per-entity
// state table (InstanceVariation); no three.js, so unit layers (skinned) and rigid robot units can share it.
//
// What it does, per entity id (the sim is untouched, every number here is presentation):
//   - a stable hash of the id gives a phase offset and a small playback-rate variation for idle and walk/run;
//   - walk/run advance with the interpolated ground speed (cycles per meter), so a slowed or blocked unit slows its
//     cycle and a fast one does not slide its feet. The sim's own animT for these clips is ignored;
//   - gather and build (a unit at work) loop on the render-owned phase too, at the rig clip's own pace. The sim's
//     animT for them is a progress over the whole job (a 13 s gather, a 1.6 s step counter): fed to a 1-5 s loop clip
//     it plays the clip once in 13 s (looks frozen) or three times too fast. Attacks and death follow the sim's animT;
//   - a clip change between idle/walk/run is held back 0..CLIP_DELAY_MAX_MS (per entity, per change): a group that gets
//     an order in the same tick does not snap from idle to walk in one frame. (The skinning shader samples a single
//     clip per instance and the vertex buffers are full, so there is no real cross-fade.);
//   - the visual heading turns at a limited rate (no 180 degree snap) and gets a tiny fixed jitter at rest;
//   - `seed` (12 bits) drives a static per-instance lean and height variation in the shader (unitMaterial.ts), the
//     idle variety for rigs that only have one idle clip.
import { ANIM, ENTITY_GEN_BITS, MAX_ENTITIES } from '@crawlout/protocol';

export const CLIP_DELAY_MAX_MS = 150;
/** Playback-rate spread (fraction, +-) of the idle cycle and of the walk/run stride rate. */
export const IDLE_RATE_SPREAD = 0.1;
export const MOVE_RATE_SPREAD = 0.06;
/** Meters covered per walk or run cycle at rate 1 (about 3 m/s gives 1.25 cycles/s). */
export const WALK_STRIDE_M = 2.4;
export const RUN_STRIDE_M = 3.6;
/** Bounds of the locomotion cycle rate (cycles/s): a blocked unit crawls, a fast one stays readable. */
export const MIN_CYCLE_RATE = 0.1;
export const MAX_CYCLE_RATE = 2.5;
/** Time constant (s) of the ground-speed smoothing. */
export const SPEED_TAU_S = 0.12;
/** Visual turn: exponential ease (1/s) capped at TURN_MAX_RATE (rad/s, about 400 degrees/s). */
export const TURN_EASE = 14;
export const TURN_MAX_RATE = 7;
/** Heading jitter at rest (rad, +-), fades out between REST_SPEED_FROM and REST_SPEED_TO (m/s). */
export const REST_JITTER_RAD = 0.07;
const REST_SPEED_FROM = 0.2;
const REST_SPEED_TO = 0.9;
/** A slot not seen for this long (s) is treated like a new entity (it was culled or off screen). */
const STALE_S = 0.25;
/** Longest frame gap (s) the phase still advances over: a hitch must not freeze the cycles, a long absence must not spin them. */
export const MAX_PHASE_STEP_S = 0.25;
/** Loop length (s) of a work clip when the rig does not say (rigid robots strike three times per loop). */
export const WORK_LOOP_S = 3;
const MAX_SPEED = 12;
const SEED_BITS = 12;

const SALT = {
  phase: 1,
  idleRate: 2,
  moveRate: 3,
  jitter: 4,
  seed: 5,
  delay: 6,
  idlePhase: 7,
} as const;

/** 32-bit integer mix (murmur3 finalizer) of an id and a salt; stable across runs and platforms. */
export function hash32(id: number, salt = 0): number {
  let h = (id ^ Math.imul(salt + 1, 0x9e3779b1)) | 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Stable value in [0, 1) for an id and salt. */
export function hash01(id: number, salt = 0): number {
  return (hash32(id, salt) >>> 8) / 0x1000000;
}

/** Stable start phase of an entity's cycle, 0..1. */
export function phaseOffset(id: number, salt: number = SALT.phase): number {
  return hash01(id, salt);
}

/** Stable playback-rate multiplier in [1 - spread, 1 + spread]. */
export function rateVariation(id: number, spread: number, salt: number = SALT.idleRate): number {
  return 1 + (hash01(id, salt) * 2 - 1) * spread;
}

/** Locomotion cycles per second for a ground speed (m/s) and stride length (m per cycle), clamped. */
export function speedToCycleRate(speedMps: number, strideM: number): number {
  const r = speedMps / strideM;
  return r < MIN_CYCLE_RATE ? MIN_CYCLE_RATE : r > MAX_CYCLE_RATE ? MAX_CYCLE_RATE : r;
}

/** Shortest signed difference b - a of two radian angles, in [-PI, PI]. */
export function angleDiff(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  else if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Turns `current` towards `target` (radians): exponential ease, capped at `maxRate` rad/s. No overshoot. */
export function turnToward(
  current: number,
  target: number,
  dt: number,
  ease = TURN_EASE,
  maxRate = TURN_MAX_RATE,
): number {
  const d = angleDiff(current, target);
  const want = d * (1 - Math.exp(-ease * dt));
  const cap = maxRate * dt;
  return current + (want > cap ? cap : want < -cap ? -cap : want);
}

/** Idle, walk and run: the clips whose changes wait a per-entity moment and whose rate follows the ground speed. */
export function isLocomotion(clip: number): boolean {
  return clip === ANIM.idle || clip === ANIM.walk || clip === ANIM.run;
}

/** Gather and build: a unit at work, looping at the clip's own pace. */
export function isWork(clip: number): boolean {
  return clip === ANIM.gather || clip === ANIM.build;
}

/** Clips that loop on the render-owned phase; every other clip follows the sim's animT. */
export function isRenderTimed(clip: number): boolean {
  return isLocomotion(clip) || isWork(clip);
}

/** Result of InstanceVariation.apply; one object, overwritten by every call. */
export interface VariationOut {
  /** Clip to draw (may lag the sim's by the start delay). */
  clip: number;
  /** Clip progress 0..1. */
  t: number;
  /** Visual heading, radians. */
  yaw: number;
  /** 12-bit static per-instance seed: three 4-bit fields (lean x, lean z, height). */
  seed: number;
  /** Smoothed ground speed, m/s. */
  speed: number;
}

export class InstanceVariation {
  readonly out: VariationOut = { clip: 0, t: 0, yaw: 0, seed: 0, speed: 0 };
  private readonly cap: number;
  private readonly owner: Uint32Array; // id + 1 of the entity in the slot, 0 = empty
  private readonly lastMs: Float64Array;
  private readonly pendingAt: Float64Array; // ms at which the held clip switches, 0 = none
  private readonly px: Float32Array;
  private readonly pz: Float32Array;
  private readonly speed: Float32Array;
  private readonly yaw: Float32Array;
  private readonly phase: Float32Array;
  private readonly shown: Uint8Array;
  private readonly lastSim: Uint8Array;
  private readonly changes: Uint16Array;

  constructor(capacity: number = MAX_ENTITIES) {
    this.cap = capacity;
    this.owner = new Uint32Array(capacity);
    this.lastMs = new Float64Array(capacity);
    this.pendingAt = new Float64Array(capacity);
    this.px = new Float32Array(capacity);
    this.pz = new Float32Array(capacity);
    this.speed = new Float32Array(capacity);
    this.yaw = new Float32Array(capacity);
    this.phase = new Float32Array(capacity);
    this.shown = new Uint8Array(capacity);
    this.lastSim = new Uint8Array(capacity);
    this.changes = new Uint16Array(capacity);
  }

  /**
   * Computes the presented clip, progress, heading and seed of one entity into `out`.
   * `id` is the snapshot entity id; `x`, `z` meters; `simYaw` radians (render convention); `idleDurationS` the
   * duration of the rig's idle clip; `nowMs` a monotonic clock (performance.now()); `clipSeconds` the duration of each
   * of the rig's clips by clip id (the pace of gather and build; WORK_LOOP_S for a clip it does not list).
   */
  apply(
    id: number,
    x: number,
    z: number,
    simClip: number,
    simAnimT: number,
    simYaw: number,
    idleDurationS: number,
    nowMs: number,
    clipSeconds?: ArrayLike<number>,
  ): VariationOut {
    const out = this.out;
    const slot = id >>> ENTITY_GEN_BITS;
    out.seed = hash32(id, SALT.seed) & ((1 << SEED_BITS) - 1);
    if (slot >= this.cap) {
      out.clip = simClip;
      out.t = simAnimT;
      out.yaw = simYaw;
      out.speed = 0;
      return out;
    }
    let dt = (nowMs - this.lastMs[slot]!) / 1000;
    const newEntity = this.owner[slot] !== id + 1;
    const fresh = newEntity || dt > STALE_S || dt < 0;
    // The phase keeps running over a hitch (a frame over STALE_S resets speed and heading, not the cycle): with every
    // frame slower than STALE_S the cycles used to stand still for as long as the slow frames lasted.
    const phaseDt = newEntity || dt < 0 ? 0 : Math.min(dt, MAX_PHASE_STEP_S);
    this.lastMs[slot] = nowMs;
    if (fresh) {
      if (newEntity) this.phase[slot] = phaseOffset(id);
      this.owner[slot] = id + 1;
      this.px[slot] = x;
      this.pz[slot] = z;
      this.speed[slot] = simClip === ANIM.idle ? 0 : 3;
      this.yaw[slot] = simYaw;
      this.shown[slot] = simClip;
      this.lastSim[slot] = simClip;
      this.pendingAt[slot] = 0;
      this.changes[slot] = 0;
      dt = 0;
    }

    // Ground speed from the interpolated position, smoothed.
    if (dt > 1e-4) {
      const inst = Math.min(MAX_SPEED, Math.hypot(x - this.px[slot]!, z - this.pz[slot]!) / dt);
      const a = 1 - Math.exp(-dt / SPEED_TAU_S);
      this.speed[slot] = this.speed[slot]! + (inst - this.speed[slot]!) * a;
      this.px[slot] = x;
      this.pz[slot] = z;
    }
    const speed = this.speed[slot]!;

    // Clip changes: locomotion to locomotion waits a per-entity moment, everything else (attack, death) is immediate.
    let shown = this.shown[slot]!;
    if (simClip !== this.lastSim[slot]) {
      this.lastSim[slot] = simClip;
      if (isLocomotion(shown) && isLocomotion(simClip)) {
        if (this.pendingAt[slot] === 0) {
          const n = this.changes[slot]!;
          this.changes[slot] = n + 1;
          const delay = hash01(id + Math.imul(n, 0x9e3779b1), SALT.delay) * CLIP_DELAY_MAX_MS;
          this.pendingAt[slot] = nowMs + delay + 1;
        }
      } else {
        shown = simClip;
        this.pendingAt[slot] = 0;
      }
    }
    if (this.pendingAt[slot] !== 0 && nowMs >= this.pendingAt[slot]!) {
      shown = simClip;
      this.pendingAt[slot] = 0;
    }
    if (shown !== this.shown[slot]) {
      this.shown[slot] = shown;
      this.phase[slot] = phaseOffset(id, isLocomotion(shown) ? SALT.phase : SALT.idlePhase);
    }

    // Progress: idle, walk, run, gather and build run on the render-owned phase; the other clips follow the sim.
    let t = simAnimT;
    if (isRenderTimed(shown)) {
      let cps: number;
      if (shown === ANIM.idle) {
        cps = rateVariation(id, IDLE_RATE_SPREAD) / Math.max(0.1, idleDurationS);
      } else if (isWork(shown)) {
        const loopS = clipSeconds?.[shown] ?? WORK_LOOP_S;
        cps = rateVariation(id, MOVE_RATE_SPREAD, SALT.moveRate) / Math.max(0.1, loopS);
      } else {
        const stride = shown === ANIM.run ? RUN_STRIDE_M : WALK_STRIDE_M;
        cps = speedToCycleRate(speed, stride) * rateVariation(id, MOVE_RATE_SPREAD, SALT.moveRate);
      }
      let p = this.phase[slot]! + phaseDt * cps;
      p -= Math.floor(p);
      this.phase[slot] = p;
      t = p;
    }

    // Heading: limited turn rate, plus a small fixed jitter that fades out while moving.
    const yaw = fresh ? simYaw : turnToward(this.yaw[slot]!, simYaw, dt);
    this.yaw[slot] = yaw;
    const s = Math.min(
      1,
      Math.max(0, (speed - REST_SPEED_FROM) / (REST_SPEED_TO - REST_SPEED_FROM)),
    );
    const rest = 1 - s * s * (3 - 2 * s);

    out.clip = shown;
    out.t = t;
    out.yaw = yaw + (hash01(id, SALT.jitter) * 2 - 1) * REST_JITTER_RAD * rest;
    out.speed = speed;
    return out;
  }
}
