// Procedural placeholder rig and clips. Stand-in for the Quaternius rig and the clips the asset-cli will bake.
// Faces +Z, Y up, feet on y=0, 1.8 m tall (artist brief, spelfundament section 9). Left is +X.
// Clip order is ANIM_NAMES from @crawlout/protocol (artist brief): the snapshot field `anim` indexes CLIPS.
import { ANIM_NAMES, type AnimName } from '@crawlout/protocol';

export const BONE = {
  hips: 0,
  chest: 1,
  head: 2,
  upperArmL: 3,
  foreArmL: 4,
  upperArmR: 5,
  foreArmR: 6,
  thighL: 7,
  shinL: 8,
  thighR: 9,
  shinR: 10,
} as const;

export interface BoneDef {
  name: string;
  parent: number;
  /** Bind-pose offset from the parent joint, meters. */
  offset: readonly [number, number, number];
}

export const BONES: readonly BoneDef[] = [
  { name: 'Hips', parent: -1, offset: [0, 0.95, 0] },
  { name: 'Spine2', parent: BONE.hips, offset: [0, 0.1, 0] },
  { name: 'Head', parent: BONE.chest, offset: [0, 0.48, 0] },
  { name: 'LeftArm', parent: BONE.chest, offset: [0.27, 0.36, 0] },
  { name: 'LeftForeArm', parent: BONE.upperArmL, offset: [0, -0.3, 0] },
  { name: 'RightArm', parent: BONE.chest, offset: [-0.27, 0.36, 0] },
  { name: 'RightForeArm', parent: BONE.upperArmR, offset: [0, -0.3, 0] },
  { name: 'LeftUpLeg', parent: BONE.hips, offset: [0.1, -0.05, 0] },
  { name: 'LeftLeg', parent: BONE.thighL, offset: [0, -0.45, 0] },
  { name: 'RightUpLeg', parent: BONE.hips, offset: [-0.1, -0.05, 0] },
  { name: 'RightLeg', parent: BONE.thighR, offset: [0, -0.45, 0] },
];

/** A pose: root translation plus an XYZ euler rotation (radians) per bone, relative to bind. */
export interface Pose {
  root: [number, number, number];
  rot: Float32Array; // BONES.length * 3
}

export function createPose(): Pose {
  return { root: [0, 0, 0], rot: new Float32Array(BONES.length * 3) };
}

function setRot(pose: Pose, bone: number, x: number, y = 0, z = 0): void {
  pose.rot[bone * 3] = x;
  pose.rot[bone * 3 + 1] = y;
  pose.rot[bone * 3 + 2] = z;
}

export interface ClipDef {
  name: AnimName;
  /** Seconds for one pass at normal speed. The sim advances animT; this is what the placeholder clip is tuned for. */
  duration: number;
  loop: boolean;
  /** Writes the pose at progress p in [0, 1]. */
  sample(p: number, pose: Pose): void;
}

const TAU = Math.PI * 2;

// Positive X rotation swings a limb that hangs down backwards (-Z) and tilts the chest forwards (+Z).
function gait(
  pose: Pose,
  p: number,
  legAmp: number,
  kneeAmp: number,
  armAmp: number,
  lean: number,
  bob: number,
): void {
  const ph = p * TAU;
  const s = Math.sin(ph);
  const c = Math.cos(ph);
  pose.root[1] = bob * Math.cos(ph * 2);
  setRot(pose, BONE.hips, 0, 0.08 * s * legAmp);
  setRot(pose, BONE.chest, lean, -0.12 * s * legAmp);
  setRot(pose, BONE.head, -lean * 0.5);
  setRot(pose, BONE.thighL, -legAmp * s);
  setRot(pose, BONE.thighR, legAmp * s);
  setRot(pose, BONE.shinL, kneeAmp * Math.max(0, c) + 0.05);
  setRot(pose, BONE.shinR, kneeAmp * Math.max(0, -c) + 0.05);
  setRot(pose, BONE.upperArmL, armAmp * s, 0, 0.08);
  setRot(pose, BONE.upperArmR, -armAmp * s, 0, -0.08);
  setRot(pose, BONE.foreArmL, -0.25 - armAmp * 0.4);
  setRot(pose, BONE.foreArmR, -0.25 - armAmp * 0.4);
}

const smooth = (t: number): number => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

// Keyed by name, ordered by ANIM_NAMES below, so the order can never drift from the protocol.
const CLIP_DEFS: Record<AnimName, ClipDef> = {
  idle: {
    name: 'idle',
    duration: 2.4,
    loop: true,
    sample(p, pose) {
      const s = Math.sin(p * TAU);
      pose.root[1] = 0.008 * s;
      setRot(pose, BONE.chest, 0.03 * s);
      setRot(pose, BONE.head, -0.02 * s, 0.15 * Math.sin(p * TAU * 0.5 + 1));
      setRot(pose, BONE.upperArmL, 0.04 * s, 0, 0.1);
      setRot(pose, BONE.upperArmR, 0.04 * s, 0, -0.1);
      setRot(pose, BONE.foreArmL, -0.15);
      setRot(pose, BONE.foreArmR, -0.15);
      setRot(pose, BONE.shinL, 0.04);
      setRot(pose, BONE.shinR, 0.04);
    },
  },
  walk: {
    name: 'walk',
    duration: 1.0,
    loop: true,
    sample: (p, pose) => gait(pose, p, 0.5, 0.75, 0.45, 0.06, 0.025),
  },
  run: {
    name: 'run',
    duration: 0.6,
    loop: true,
    sample: (p, pose) => gait(pose, p, 0.85, 1.3, 0.9, 0.25, 0.05),
  },
  attack1: {
    name: 'attack1',
    duration: 0.8,
    loop: true,
    sample(p, pose) {
      // Overhead swing with the right arm: wind up, strike, recover.
      const up = smooth(p / 0.45);
      const down = smooth((p - 0.45) / 0.15);
      const rec = smooth((p - 0.7) / 0.3);
      const raise = up * (1 - down);
      const twist = 0.35 * raise - 0.25 * down * (1 - rec);
      setRot(pose, BONE.chest, 0.05 + 0.2 * down * (1 - rec), twist);
      setRot(pose, BONE.upperArmR, -2.6 * raise - 0.6 * down * (1 - rec), 0, -0.2);
      setRot(pose, BONE.foreArmR, -0.9 * raise);
      setRot(pose, BONE.upperArmL, -0.5, 0, 0.25);
      setRot(pose, BONE.foreArmL, -0.8);
      setRot(pose, BONE.thighL, -0.3);
      setRot(pose, BONE.thighR, 0.25);
      setRot(pose, BONE.shinL, 0.3);
      setRot(pose, BONE.shinR, 0.2);
      pose.root[1] = -0.04;
    },
  },
  attack2: {
    name: 'attack2',
    duration: 0.5,
    loop: true,
    sample(p, pose) {
      // Aimed shot: both arms forward, recoil kick at the start.
      const kick = Math.exp(-p * 12);
      setRot(pose, BONE.chest, 0.08 - 0.12 * kick, 0.3);
      setRot(pose, BONE.head, 0, -0.3);
      setRot(pose, BONE.upperArmR, -1.45 - 0.35 * kick, 0.25);
      setRot(pose, BONE.foreArmR, -0.1);
      setRot(pose, BONE.upperArmL, -1.3 - 0.3 * kick, -0.5);
      setRot(pose, BONE.foreArmL, -0.5);
      setRot(pose, BONE.thighL, -0.25);
      setRot(pose, BONE.thighR, 0.2);
      setRot(pose, BONE.shinL, 0.2);
      setRot(pose, BONE.shinR, 0.15);
    },
  },
  gather: {
    name: 'gather',
    duration: 1.4,
    loop: true,
    sample(p, pose) {
      const s = Math.sin(p * TAU);
      pose.root[1] = -0.18 + 0.03 * s;
      setRot(pose, BONE.hips, 0.35);
      setRot(pose, BONE.chest, 0.45 + 0.1 * s);
      setRot(pose, BONE.thighL, -0.9);
      setRot(pose, BONE.thighR, -0.6);
      setRot(pose, BONE.shinL, 1.2);
      setRot(pose, BONE.shinR, 0.9);
      setRot(pose, BONE.upperArmL, -0.9 - 0.4 * s, 0, 0.1);
      setRot(pose, BONE.upperArmR, -0.9 + 0.4 * s, 0, -0.1);
      setRot(pose, BONE.foreArmL, -0.4);
      setRot(pose, BONE.foreArmR, -0.4);
    },
  },
  build: {
    name: 'build',
    duration: 0.7,
    loop: true,
    sample(p, pose) {
      // Hammering: right arm up and down, slight crouch.
      const h = 0.5 + 0.5 * Math.cos(p * TAU);
      pose.root[1] = -0.08;
      setRot(pose, BONE.chest, 0.3 + 0.08 * (1 - h), -0.15);
      setRot(pose, BONE.upperArmR, -0.6 - 1.6 * h, 0, -0.15);
      setRot(pose, BONE.foreArmR, -1.2 * h);
      setRot(pose, BONE.upperArmL, -0.7, 0, 0.2);
      setRot(pose, BONE.foreArmL, -0.6);
      setRot(pose, BONE.thighL, -0.5);
      setRot(pose, BONE.thighR, 0.1);
      setRot(pose, BONE.shinL, 0.6);
      setRot(pose, BONE.shinR, 0.4);
    },
  },
  death: {
    name: 'death',
    duration: 1.2,
    loop: false,
    sample(p, pose) {
      // Knees give, then the body falls backwards and lies on its back.
      const k = smooth(p / 0.35);
      const f = smooth((p - 0.2) / 0.6);
      pose.root[1] = -0.3 * k - 0.52 * f;
      pose.root[2] = -0.45 * f;
      setRot(pose, BONE.hips, -1.45 * f);
      setRot(pose, BONE.chest, 0.3 * k * (1 - f) - 0.1 * f);
      setRot(pose, BONE.head, -0.3 * f, 0.4 * f);
      setRot(pose, BONE.thighL, -1.0 * k * (1 - f) - 0.2 * f, 0, 0.15 * f);
      setRot(pose, BONE.thighR, -0.8 * k * (1 - f), 0, -0.1 * f);
      setRot(pose, BONE.shinL, 1.3 * k * (1 - f) + 0.3 * f);
      setRot(pose, BONE.shinR, 1.1 * k * (1 - f) + 0.1 * f);
      setRot(pose, BONE.upperArmL, -0.8 * k * (1 - f), 0, 0.2 + 1.0 * f);
      setRot(pose, BONE.upperArmR, -0.6 * k * (1 - f), 0, -0.2 - 1.2 * f);
      setRot(pose, BONE.foreArmL, -0.3 * f);
      setRot(pose, BONE.foreArmR, -0.5 * f);
    },
  },
};

/** Placeholder clips in protocol order: CLIPS[ANIM.walk] is the walk clip. */
export const CLIPS: readonly ClipDef[] = ANIM_NAMES.map((name) => CLIP_DEFS[name]);
