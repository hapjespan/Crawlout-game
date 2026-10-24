// Foot-ground constraint for retargeted clips: how deep does the *skinned surface* sit below the ground plane?
//
// Why the surface and not the skeleton. Retargeting copies bone rotations, so it reproduces the donor's pose exactly.
// Ground contact, however, is a property of the mesh around those bones, not of the bones themselves. The donor is a
// slim body whose shin rests on the floor in `Fixing_Kneeling`; the same bone pose drives an armoured shin, which is
// far thicker, straight through the floor. No correction in bone space can see that, which is why pushing knee and
// ankle down made the power armour worse instead of better: it moved a bone that was already in the right place.
//
// So the constraint measures the real thing: linear blend skinning over every vertex, the same matrices as the bake
// (animated joint world matrix * inverse bind matrix), and the lowest y that comes out. `retargetClips` then lifts the
// root by the penetration, which is a rigid translation of the whole body and therefore moves that lowest point by
// exactly the lift.
//
// Doing that naively costs vertices * frames * 4 (the warlord is 524k vertices over 480 frames, about a billion
// multiply-adds), so the scan is pruned with a per-bone bound. For every bone the axis-aligned box around the vertices
// it influences is known in bind space; pushing its eight corners through the bone's skin matrix gives `lo[b]`, a
// lower bound on the y of anything rigidly bound to that bone. A blended vertex is a convex combination of its bones'
// transformed positions, so its y is at least the smallest `lo` among its influences. A vertex whose bound already
// sits above the best y found so far cannot win and is skipped without ever being transformed. The answer is exact;
// only the work is smaller.
import type { Document, Node, Skin } from '@gltf-transform/core';
import type { Mat } from './math.js';

/** Vertices the constraint watches, flattened into typed arrays once. */
interface SkinData {
  /** Bind-space positions, 3 per vertex. */
  positions: Float64Array;
  /** Joint indices into the skin's joint list, 4 per vertex. */
  joints: Int32Array;
  /** Skin weights, 4 per vertex; a weight of 0 marks an unused slot. */
  weights: Float32Array;
  count: number;
}

export interface GroundSampler {
  /** Lowest y of the skinned surface for these joint world matrices (indexed like the skin's joint list). */
  lowestY(jointWorld: readonly Mat[]): number;
  /** How many vertices the constraint watches. */
  vertexCount: number;
  /** Vertices skipped because a joint outside the root's subtree influences them; the root cannot lift those. */
  skipped: number;
}

/** Every node in `node`'s subtree, `node` included. */
function subtreeOf(node: Node): Set<Node> {
  const all = new Set<Node>();
  node.traverse((n) => all.add(n));
  all.add(node);
  return all;
}

/**
 * Builds a sampler over the first skin of `document`, limited to the vertices that a translation of `root` really
 * moves: every joint with weight on them has to sit in `root`'s subtree. Returns null when there is nothing to
 * measure (no skinned primitive, or no vertex that qualifies), so a skeleton-only document simply has no constraint.
 *
 * `ignore` drops every vertex that any of those joints has weight on. That is how the root lift tells a body that is
 * really in the ground from a boot corner that is not: with the ankles ignored the sampler sees the shin of a
 * kneeling `build` but not the pointed toe of a `walk`, and the two can then be answered differently.
 */
export function createGroundSampler(
  document: Document,
  skin: Skin,
  root: Node,
  ignore?: ReadonlySet<Node>,
): GroundSampler | null {
  const joints = skin.listJoints();
  const boneCount = joints.length;
  const liftable = subtreeOf(root);
  const canLift = joints.map((joint) => liftable.has(joint));
  const ignored = joints.map((joint) => ignore?.has(joint) ?? false);

  const ibm = skin.getInverseBindMatrices();
  const inverseBind: Float64Array[] = joints.map((_, b) => {
    const m = new Float64Array(16);
    if (ibm) ibm.getElement(b, m as unknown as number[]);
    else for (let i = 0; i < 4; i++) m[i * 5] = 1;
    return m;
  });

  const px: number[] = [];
  const ji: number[] = [];
  const jw: number[] = [];
  let skipped = 0;
  for (const node of document.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh || node.getSkin() !== skin) continue;
    for (const prim of mesh.listPrimitives()) {
      const position = prim.getAttribute('POSITION');
      const jointAttr = prim.getAttribute('JOINTS_0');
      const weightAttr = prim.getAttribute('WEIGHTS_0');
      if (!position || !jointAttr || !weightAttr) continue;
      const p = [0, 0, 0];
      const j = [0, 0, 0, 0];
      const w = [0, 0, 0, 0];
      for (let i = 0; i < position.getCount(); i++) {
        jointAttr.getElement(i, j);
        weightAttr.getElement(i, w);
        let usable = false;
        let movable = true;
        let dropped = false;
        for (let k = 0; k < 4; k++) {
          if (!(w[k]! > 0)) continue;
          usable = true;
          if (!canLift[j[k]!]) movable = false;
          if (ignored[j[k]!]) dropped = true;
        }
        if (!usable || dropped) continue;
        if (!movable) {
          skipped++;
          continue;
        }
        position.getElement(i, p);
        px.push(p[0]!, p[1]!, p[2]!);
        for (let k = 0; k < 4; k++) {
          ji.push(w[k]! > 0 ? j[k]! : 0);
          jw.push(w[k]! > 0 ? w[k]! : 0);
        }
      }
    }
  }
  if (px.length === 0) return null;

  const data: SkinData = {
    positions: Float64Array.from(px),
    joints: Int32Array.from(ji),
    weights: Float32Array.from(jw),
    count: px.length / 3,
  };

  // Bind-space box per bone over everything it influences; the bound for the pruned scan comes from its corners.
  const boxMin = new Float64Array(boneCount * 3).fill(Infinity);
  const boxMax = new Float64Array(boneCount * 3).fill(-Infinity);
  const used = new Uint8Array(boneCount);
  for (let v = 0; v < data.count; v++)
    for (let k = 0; k < 4; k++) {
      if (!(data.weights[v * 4 + k]! > 0)) continue;
      const b = data.joints[v * 4 + k]!;
      used[b] = 1;
      for (let c = 0; c < 3; c++) {
        const value = data.positions[v * 3 + c]!;
        if (value < boxMin[b * 3 + c]!) boxMin[b * 3 + c] = value;
        if (value > boxMax[b * 3 + c]!) boxMax[b * 3 + c] = value;
      }
    }

  const skinMat = Array.from({ length: boneCount }, () => new Float64Array(16));
  const lo = new Float64Array(boneCount);
  let warmStart = 0;

  const lowestY = (jointWorld: readonly Mat[]): number => {
    for (let b = 0; b < boneCount; b++) {
      if (!used[b]) {
        lo[b] = Infinity;
        continue;
      }
      // skin = jointWorld * inverseBind, column-major; only the row that produces y is ever read.
      const a = jointWorld[b]!;
      const i = inverseBind[b]!;
      const m = skinMat[b]!;
      for (let col = 0; col < 4; col++) {
        const b0 = i[col * 4]!;
        const b1 = i[col * 4 + 1]!;
        const b2 = i[col * 4 + 2]!;
        const b3 = i[col * 4 + 3]!;
        m[col * 4 + 1] = a[1]! * b0 + a[5]! * b1 + a[9]! * b2 + a[13]! * b3;
      }
      // Lowest of the eight corners of the bind-space box under that row.
      const m1 = m[1]!;
      const m5 = m[5]!;
      const m9 = m[9]!;
      const m13 = m[13]!;
      lo[b] =
        m13 +
        Math.min(m1 * boxMin[b * 3]!, m1 * boxMax[b * 3]!) +
        Math.min(m5 * boxMin[b * 3 + 1]!, m5 * boxMax[b * 3 + 1]!) +
        Math.min(m9 * boxMin[b * 3 + 2]!, m9 * boxMax[b * 3 + 2]!);
    }

    const { positions, joints: vj, weights: vw, count } = data;
    let best = Infinity;
    // The winner rarely jumps far between frames; evaluating last frame's winner first makes the bound bite at once.
    for (const seed of [warmStart]) {
      let y = 0;
      for (let k = 0; k < 4; k++) {
        const w = vw[seed * 4 + k]!;
        if (w <= 0) continue;
        const m = skinMat[vj[seed * 4 + k]!]!;
        y +=
          w *
          (m[1]! * positions[seed * 3]! +
            m[5]! * positions[seed * 3 + 1]! +
            m[9]! * positions[seed * 3 + 2]! +
            m[13]!);
      }
      best = y;
    }
    for (let v = 0; v < count; v++) {
      let bound = Infinity;
      for (let k = 0; k < 4; k++) {
        if (!(vw[v * 4 + k]! > 0)) continue;
        const candidate = lo[vj[v * 4 + k]!]!;
        if (candidate < bound) bound = candidate;
      }
      if (bound >= best) continue;
      let y = 0;
      for (let k = 0; k < 4; k++) {
        const w = vw[v * 4 + k]!;
        if (w <= 0) continue;
        const m = skinMat[vj[v * 4 + k]!]!;
        y +=
          w *
          (m[1]! * positions[v * 3]! +
            m[5]! * positions[v * 3 + 1]! +
            m[9]! * positions[v * 3 + 2]! +
            m[13]!);
      }
      if (y < best) {
        best = y;
        warmStart = v;
      }
    }
    return best;
  };

  return { lowestY, vertexCount: data.count, skipped };
}
