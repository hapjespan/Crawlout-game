// Bakt animatieclips naar een bone-matrix-texture, formaat volgens fase-0 sectie 12 (zelfde layout als
// packages/render/src/units/bake.ts): RGBA float32 little-endian, breedte boneCount * 4, rijen per clip aaneengesloten.
// Skin-matrix = geanimeerde joint-wereldmatrix * inverse bind-matrix, column-major (three.js Matrix4.elements).
import type { Animation, Document, Node } from '@gltf-transform/core';
import { ANIM_NAMES, type AnimName } from '@crawlout/protocol';
import type { BakedAnimation, BakedClip } from './manifest.js';
import { compose, multiply, slerp, type Mat, type Pose } from './math.js';

export const BAKE_FPS = 30;
/** Clips die niet loopen: de laatste pose op p = 1 wordt meegenomen. */
const ONE_SHOT: ReadonlySet<AnimName> = new Set(['death']);

export interface BakeInput {
  assetId: string;
  document: Document;
  /** Canonieke clipnaam naar index in `document.getRoot().listAnimations()`; moet alle ANIM_NAMES bevatten. */
  clips: ReadonlyMap<AnimName, number>;
  fps?: number;
}

export interface BakeResult {
  baked: BakedAnimation;
  /** De inhoud van `<id>.anim.f32`. */
  data: Uint8Array;
}

export interface Track {
  node: Node;
  path: 'translation' | 'rotation' | 'scale';
  times: Float32Array | number[];
  values: number[][];
  interpolation: 'LINEAR' | 'STEP' | 'CUBICSPLINE';
}

export function readTracks(animation: Animation): Track[] {
  const tracks: Track[] = [];
  for (const channel of animation.listChannels()) {
    const node = channel.getTargetNode();
    const path = channel.getTargetPath();
    const sampler = channel.getSampler();
    const input = sampler?.getInput();
    const output = sampler?.getOutput();
    if (
      !node ||
      !sampler ||
      !input ||
      !output ||
      (path !== 'translation' && path !== 'rotation' && path !== 'scale')
    )
      continue;
    const size = output.getElementSize();
    const values: number[][] = [];
    for (let i = 0; i < output.getCount(); i++)
      values.push(output.getElement(i, new Array<number>(size).fill(0)));
    const times: number[] = [];
    for (let i = 0; i < input.getCount(); i++) times.push(input.getScalar(i));
    tracks.push({ node, path, times, values, interpolation: sampler.getInterpolation() });
  }
  return tracks;
}

export function sampleTrack(track: Track, time: number): number[] {
  const { times, values, interpolation, path } = track;
  const stride = interpolation === 'CUBICSPLINE' ? 3 : 1;
  const value = (i: number): number[] => values[i * stride + (stride === 3 ? 1 : 0)]!;
  const last = times.length - 1;
  if (time <= times[0]!) return value(0);
  if (time >= times[last]!) return value(last);
  let i = 0;
  while (times[i + 1]! <= time) i++;
  if (interpolation === 'STEP') return value(i);
  const f = (time - times[i]!) / (times[i + 1]! - times[i]!);
  const a = value(i);
  const b = value(i + 1);
  // CUBICSPLINE wordt als LINEAR benaderd (alleen de waarde-keyframes); gedocumenteerd in de README.
  if (path === 'rotation') return slerp(a, b, f);
  return a.map((v, k) => v + (b[k]! - v) * f);
}

/** Bakt de acht clips uit ANIM_NAMES van de eerste skin in `document` naar een bone-matrix-texture. */
export function bakeAnimations(input: BakeInput): BakeResult {
  const fps = input.fps ?? BAKE_FPS;
  const skin = input.document.getRoot().listSkins()[0];
  if (!skin) throw new Error(`${input.assetId}: geen skin om te bakken.`);
  const joints = skin.listJoints();
  const boneCount = joints.length;
  const ibmAccessor = skin.getInverseBindMatrices();
  const animations = input.document.getRoot().listAnimations();

  const ibm = joints.map((_, b) => {
    const m = new Float64Array(16);
    if (ibmAccessor) ibmAccessor.getElement(b, m as unknown as number[]);
    else for (let i = 0; i < 4; i++) m[i * 5] = 1;
    return m;
  });

  const clipInfo: BakedClip[] = [];
  let rows = 0;
  for (const name of ANIM_NAMES) {
    const index = input.clips.get(name);
    const animation = index === undefined ? undefined : animations[index];
    if (!animation) throw new Error(`${input.assetId}: animatieclip "${name}" ontbreekt.`);
    let duration = 0;
    for (const sampler of animation.listSamplers()) {
      const times = sampler.getInput();
      if (times && times.getCount() > 0)
        duration = Math.max(duration, times.getScalar(times.getCount() - 1));
    }
    if (duration <= 0) throw new Error(`${input.assetId}: animatieclip "${name}" heeft duur 0.`);
    const frames = Math.max(2, Math.round(duration * fps));
    clipInfo.push({
      name,
      startRow: rows,
      frames,
      loop: !ONE_SHOT.has(name),
      durationSeconds: Math.round(duration * 1e6) / 1e6,
    });
    rows += frames;
  }

  const width = boneCount * 4;
  const data = new Float32Array(width * rows * 4);
  const bindLocal = new Map<Node, Pose>();
  const localPose = (node: Node): Pose => {
    let pose = bindLocal.get(node);
    if (!pose) {
      pose = {
        t: [...node.getTranslation()],
        r: [...node.getRotation()],
        s: [...node.getScale()],
      } as Pose;
      bindLocal.set(node, pose);
    }
    return pose;
  };

  ANIM_NAMES.forEach((name, ci) => {
    const info = clipInfo[ci]!;
    const tracks = readTracks(animations[input.clips.get(name)!]!);
    for (let f = 0; f < info.frames; f++) {
      const p = info.loop ? f / info.frames : f / (info.frames - 1);
      const time = p * info.durationSeconds;
      const overrides = new Map<Node, Pose>();
      for (const track of tracks) {
        let pose = overrides.get(track.node);
        if (!pose) {
          const base = localPose(track.node);
          pose = { t: [...base.t], r: [...base.r], s: [...base.s] };
          overrides.set(track.node, pose);
        }
        const v = sampleTrack(track, time);
        if (track.path === 'translation') pose.t = [v[0]!, v[1]!, v[2]!];
        else if (track.path === 'rotation') pose.r = [v[0]!, v[1]!, v[2]!, v[3]!];
        else pose.s = [v[0]!, v[1]!, v[2]!];
      }
      const worlds = new Map<Node, Mat>();
      const world = (node: Node): Mat => {
        let m = worlds.get(node);
        if (!m) {
          const local = compose(overrides.get(node) ?? localPose(node));
          const parent = node.getParentNode();
          m = parent ? multiply(world(parent), local) : local;
          worlds.set(node, m);
        }
        return m;
      };
      const row = info.startRow + f;
      for (let b = 0; b < boneCount; b++)
        data.set(multiply(world(joints[b]!), ibm[b]!), (row * width + b * 4) * 4);
    }
  });

  const path = `${input.assetId}/${input.assetId}.anim.f32`;
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return { baked: { path, width, height: rows, fps, clips: clipInfo }, data: bytes };
}
