// Poses a skinned document at one moment of one clip and bakes the result into the vertices, so a still picture can
// show whether a character really walks instead of sliding. The silhouette sheet (src/silhouette.ts) uses it; a review
// of "do the legs move" then needs no browser, no GPU and no render demo.
//
// Linear blend skinning with the same matrices as the bake (src/bake.ts): animated joint world matrix * inverse bind
// matrix. After posing the document has no skin left, so it reads as an ordinary static mesh.
import type { Animation, Document, Node } from '@gltf-transform/core';
import { readTracks, sampleTrack } from './bake.js';
import { compose, multiply, transformPoint, type Mat, type Pose } from './math.js';

const restPose = (node: Node): Pose =>
  ({ t: [...node.getTranslation()], r: [...node.getRotation()], s: [...node.getScale()] }) as Pose;

/** Duration of the clip in seconds: the last keyframe time over all its samplers. */
function durationOf(animation: Animation): number {
  let duration = 0;
  for (const sampler of animation.listSamplers()) {
    const input = sampler.getInput();
    if (input && input.getCount() > 0)
      duration = Math.max(duration, input.getScalar(input.getCount() - 1));
  }
  return duration;
}

/**
 * Poses the first skin of `document` at `phase` (0 to 1) of the clip named `clip` and bakes it into the positions;
 * `clip` null bakes the rest pose (joint world * inverse bind, what a glTF viewer shows without animation).
 * Throws when the clip or the skin is missing. The document is changed in place.
 */
export function poseSkinnedDocument(document: Document, clip: string | null, phase: number): void {
  const root = document.getRoot();
  const skin = root.listSkins()[0];
  if (!skin) throw new Error(`pose: ${document.getRoot().getName() || 'document'} heeft geen skin`);
  const animation = clip === null ? null : root.listAnimations().find((a) => a.getName() === clip);
  if (animation === undefined) throw new Error(`pose: clip "${clip}" staat niet in het document`);

  const time = animation ? phase * durationOf(animation) : 0;
  const overrides = new Map<Node, Pose>();
  for (const track of animation ? readTracks(animation) : []) {
    let pose = overrides.get(track.node);
    if (!pose) {
      const rest = restPose(track.node);
      pose = { t: [...rest.t], r: [...rest.r], s: [...rest.s] } as Pose;
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
      const local = compose(overrides.get(node) ?? restPose(node));
      const parent = node.getParentNode();
      m = parent ? multiply(world(parent), local) : local;
      worlds.set(node, m);
    }
    return m;
  };
  const ibm = skin.getInverseBindMatrices();
  const matrices = skin.listJoints().map((joint, b) => {
    const m = new Float64Array(16);
    if (ibm) ibm.getElement(b, m as unknown as number[]);
    else for (let i = 0; i < 4; i++) m[i * 5] = 1;
    return multiply(world(joint), m);
  });

  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (!mesh || node.getSkin() !== skin) continue;
    for (const prim of mesh.listPrimitives()) {
      const position = prim.getAttribute('POSITION');
      const joints = prim.getAttribute('JOINTS_0');
      const weights = prim.getAttribute('WEIGHTS_0');
      if (!position || !joints || !weights) continue;
      const out = new Float32Array(position.getCount() * 3);
      const p = [0, 0, 0];
      const j = [0, 0, 0, 0];
      const w = [0, 0, 0, 0];
      for (let i = 0; i < position.getCount(); i++) {
        position.getElement(i, p);
        joints.getElement(i, j);
        weights.getElement(i, w);
        const acc = [0, 0, 0];
        for (let k = 0; k < 4; k++) {
          if (w[k]! <= 0) continue;
          const moved = transformPoint(matrices[j[k]!]!, p);
          for (let c = 0; c < 3; c++) acc[c]! += w[k]! * moved[c]!;
        }
        out.set(acc, i * 3);
      }
      position.setArray(out);
      prim.setAttribute('JOINTS_0', null).setAttribute('WEIGHTS_0', null);
    }
    // The posed vertices are already in model space; the node keeps its own transform out of it.
    node.setSkin(null).setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
    (root.getDefaultScene() ?? root.listScenes()[0])?.addChild(node);
  }
}
