// Bakes clips into a bone-matrix texture: the same layout the asset-cli will produce from real GLB rigs.
//
// Layout (RGBA float32):
//   width  = boneCount * 4 texels; texel (bone*4 + c, row) is column c of that bone's skin matrix (column-major).
//   height = sum of frame counts; each clip occupies `frameCount` consecutive rows starting at `startRow`.
//   Skin matrix = animated joint world matrix * inverse bind matrix, in model space.
// Clip table (separate RGBA float texture, width = clipCount, height 1): (startRow, frameCount, loop 0|1, duration s).
import { Euler, Matrix4, Quaternion, Vector3 } from 'three/webgpu';
import { BONES, CLIPS, createPose, type BoneDef, type ClipDef } from './rig.js';

export interface BakedClip {
  name: string;
  startRow: number;
  frameCount: number;
  loop: boolean;
  duration: number;
}

export interface BakedAnimations {
  boneCount: number;
  /** Bone texture: width = boneCount * 4, height = total frames, RGBA float32. */
  width: number;
  height: number;
  data: Float32Array;
  clips: BakedClip[];
  /** Clip table texels, RGBA per clip. */
  clipTable: Float32Array;
}

export interface BakeOptions {
  /** Samples per second of clip; the artist brief animates at 30 fps. */
  fps?: number;
  bones?: readonly BoneDef[];
  clips?: readonly ClipDef[];
}

export function bakeAnimations(opts: BakeOptions = {}): BakedAnimations {
  const fps = opts.fps ?? 30;
  const bones = opts.bones ?? BONES;
  const clips = opts.clips ?? CLIPS;
  const boneCount = bones.length;

  // Bind pose: pure translations, so the inverse bind matrix is a translation by minus the joint position.
  const bindWorld: Vector3[] = [];
  for (const b of bones) {
    const v = new Vector3(...b.offset);
    if (b.parent >= 0) v.add(bindWorld[b.parent]!);
    bindWorld.push(v);
  }
  const invBind = bindWorld.map((p) => new Matrix4().makeTranslation(-p.x, -p.y, -p.z));

  const baked: BakedClip[] = [];
  let rows = 0;
  for (const clip of clips) {
    const frameCount = Math.max(2, Math.round(clip.duration * fps));
    baked.push({
      name: clip.name,
      startRow: rows,
      frameCount,
      loop: clip.loop,
      duration: clip.duration,
    });
    rows += frameCount;
  }

  const width = boneCount * 4;
  const data = new Float32Array(width * rows * 4);
  const pose = createPose();
  const world: Matrix4[] = bones.map(() => new Matrix4());
  const local = new Matrix4();
  const skin = new Matrix4();
  const euler = new Euler();
  const quat = new Quaternion();
  const pos = new Vector3();
  const one = new Vector3(1, 1, 1);
  const rootOffset = new Vector3();

  clips.forEach((clip, ci) => {
    const info = baked[ci]!;
    for (let f = 0; f < info.frameCount; f++) {
      // Looping clips sample [0, 1); one-shot clips include the last pose at p = 1.
      const p = info.loop ? f / info.frameCount : f / (info.frameCount - 1);
      pose.root[0] = pose.root[1] = pose.root[2] = 0;
      pose.rot.fill(0);
      clip.sample(p, pose);
      rootOffset.fromArray(pose.root);
      const row = info.startRow + f;
      for (let b = 0; b < boneCount; b++) {
        const def = bones[b]!;
        pos.set(...def.offset);
        if (def.parent < 0) pos.add(rootOffset);
        euler.set(pose.rot[b * 3]!, pose.rot[b * 3 + 1]!, pose.rot[b * 3 + 2]!, 'XYZ');
        quat.setFromEuler(euler);
        local.compose(pos, quat, one);
        if (def.parent >= 0) world[b]!.multiplyMatrices(world[def.parent]!, local);
        else world[b]!.copy(local);
        skin.multiplyMatrices(world[b]!, invBind[b]!);
        data.set(skin.elements, (row * width + b * 4) * 4);
      }
    }
  });

  const clipTable = new Float32Array(baked.length * 4);
  baked.forEach((c, i) =>
    clipTable.set([c.startRow, c.frameCount, c.loop ? 1 : 0, c.duration], i * 4),
  );
  return { boneCount, width, height: rows, data, clips: baked, clipTable };
}
