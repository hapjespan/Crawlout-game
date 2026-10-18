// Split from autorig.ts to stay under the 5,000-token file limit; autorig.ts re-exports the public surface.
// Holds: boneTails, boneMoves, repose, flattenSource, autoRig.
import {
  type Vec3,
  quatFromTo,
  quatRotate,
  transformPoint,
  transformDirection,
  invertAffine,
} from './math.js';
import type { Document, Node, Texture, Material, Primitive } from '@gltf-transform/core';
import { computeSmoothNormals } from './normals.js';
import { prune } from '@gltf-transform/functions';
import { concat, detectLandmarks, readRig, roleOf, sideOf, vec, weldIds } from './autorig.part1.js';
import type {
  AutoRigInfo,
  AutoRigOptions,
  BoneMove,
  Landmarks,
  RigBone,
  SideLandmarks,
  SkinWeights,
  SourcePrimitive,
  TriMesh,
} from './autorig.part1.js';
import {
  add,
  computeSkinWeights,
  copyMaterial,
  embedSkeleton,
  extent,
  length,
  movePoint,
  normalize,
  referenceMesh,
  round,
  scale,
  structuralMask,
  sub,
} from './autorig.part2.js';

/**
 * Bone segments (head to tail) for a set of joint positions: the tail is the head of the chain child (one child, or
 * of several the one nearest the centre line: Hips to Spine, Spine2 to Neck); leaves end at a landmark (Head at the
 * crown, a hand at the fingertip, a foot at the toe), anything else continues its parent's direction.
 */
export function boneTails(
  bones: readonly RigBone[],
  heads: readonly Vec3[],
  lm: Landmarks,
): Vec3[] {
  return bones.map((bone, j) => {
    const children = bones.map((b, i) => (b.parent === j ? i : -1)).filter((i) => i >= 0);
    if (children.length > 0) {
      const chain = children.reduce((best, i) =>
        Math.abs(heads[i]![0]) < Math.abs(heads[best]![0]) - 1e-6 ? i : best,
      );
      return heads[chain]!;
    }
    const head = heads[j]!;
    const { role, side } = roleOf(bone.name);
    const base = bone.name.replace(/^(Left|Right)/, '');
    if (base === 'Head') return [head[0], Math.max(lm.top, head[1] + 0.05), head[2]];
    if (role === 'arm' && side !== 0) return sideOf(lm, side).tip;
    if (role === 'leg' && side !== 0) return [head[0], head[1] * 0.25, sideOf(lm, side).toeZ];
    const parent = bone.parent >= 0 ? heads[bone.parent]! : sub(head, [0, 0.1, 0]);
    const dir = normalize(sub(head, parent));
    return add(head, scale(dir, 0.1));
  });
}

/** Per bone the move from the embedded segment to the reference segment; leaf bones keep their length. */
export function boneMoves(
  bones: readonly RigBone[],
  fromHeads: readonly Vec3[],
  fromTails: readonly Vec3[],
  toHeads: readonly Vec3[],
  toTails: readonly Vec3[],
): BoneMove[] {
  return bones.map((_, j) => {
    const leaf = !bones.some((b) => b.parent === j);
    const a = sub(fromTails[j]!, fromHeads[j]!);
    const b = sub(toTails[j]!, toHeads[j]!);
    const la = length(a);
    const lb = length(b);
    const stretch = leaf || la < 1e-6 ? 1 : Math.min(2, Math.max(0.5, lb / la));
    return {
      from: fromHeads[j]!,
      to: toHeads[j]!,
      q: la < 1e-6 || lb < 1e-6 ? [0, 0, 0, 1] : quatFromTo(a, b),
      axis: la < 1e-6 ? [0, 1, 0] : normalize(a),
      stretch,
    };
  });
}

/** Linear blend skinning of positions and normals by the bone moves. */
export function repose(
  positions: Float64Array,
  normals: Float64Array,
  skin: Pick<SkinWeights, 'joints' | 'weights'>,
  moves: readonly BoneMove[],
): { positions: Float64Array; normals: Float64Array } {
  const n = positions.length / 3;
  const outP = new Float64Array(n * 3);
  const outN = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    const v = vec(positions, i);
    const nv = vec(normals, i);
    const acc: Vec3 = [0, 0, 0];
    const accN: Vec3 = [0, 0, 0];
    for (let k = 0; k < 4; k++) {
      const w = skin.weights[i * 4 + k]!;
      if (w <= 0) continue;
      const m = moves[skin.joints[i * 4 + k]!]!;
      const moved = movePoint(m, v);
      const turned = quatRotate(m.q, nv);
      for (let c = 0; c < 3; c++) {
        acc[c]! += w * moved[c]!;
        accN[c]! += w * turned[c]!;
      }
    }
    outP.set(acc, i * 3);
    outN.set(normalize(accN), i * 3);
  }
  return { positions: outP, normals: outN };
}

/** All TRIANGLES primitives of the scene in world space (node transforms applied), normals computed when missing. */
function flattenSource(document: Document): SourcePrimitive[] {
  const out: SourcePrimitive[] = [];
  const root = document.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  const nodes: Node[] = [];
  scene?.traverse((node) => {
    if (node.getMesh()) nodes.push(node);
  });
  for (const node of nodes) {
    const world = node.getWorldMatrix();
    for (const prim of node.getMesh()!.listPrimitives()) {
      if (prim.getMode() !== 4) continue;
      const position = prim.getAttribute('POSITION');
      if (!position) continue;
      const count = position.getCount();
      const normal = prim.getAttribute('NORMAL');
      const smooth = normal ? null : computeSmoothNormals(prim);
      const positions = new Float64Array(count * 3);
      const normals = new Float64Array(count * 3);
      const e = [0, 0, 0];
      for (let i = 0; i < count; i++) {
        positions.set(transformPoint(world, position.getElement(i, e)), i * 3);
        const local = normal
          ? normal.getElement(i, e)
          : [smooth![i * 3]!, smooth![i * 3 + 1]!, smooth![i * 3 + 2]!];
        normals.set(normalize(transformDirection(world, local)), i * 3);
      }
      const uv = prim.getAttribute('TEXCOORD_0');
      const idx = prim.getIndices();
      const indices = idx
        ? Uint32Array.from({ length: idx.getCount() }, (_, k) => idx.getScalar(k))
        : Uint32Array.from({ length: count }, (_, k) => k);
      // A mirrored node (negative determinant) flips the winding.
      const m = world;
      const det =
        m[0]! * (m[5]! * m[10]! - m[6]! * m[9]!) -
        m[4]! * (m[1]! * m[10]! - m[2]! * m[9]!) +
        m[8]! * (m[1]! * m[6]! - m[2]! * m[5]!);
      if (det < 0)
        for (let t = 0; t < indices.length; t += 3) {
          const swap = indices[t + 1]!;
          indices[t + 1] = indices[t + 2]!;
          indices[t + 2] = swap;
        }
      out.push({
        material: prim.getMaterial(),
        positions,
        normals,
        uvs: uv ? Float32Array.from(uv.getArray() as ArrayLike<number>) : null,
        indices,
      });
    }
  }
  if (out.length === 0) throw new Error('auto-rig: no triangles in the source');
  return out;
}

/**
 * Auto-rigs the static `source` onto the skin of `skeleton` (a conformed humanoid: one skin, Mixamo names, rest pose
 * = bind pose, its clips). `skeleton` is changed in place and becomes the result: its skinned mesh is replaced by the
 * source mesh with its own materials and textures, its joints, inverse bind matrices and clips stay as they are.
 */
export async function autoRig(
  source: Document,
  skeleton: Document,
  options: AutoRigOptions = {},
): Promise<AutoRigInfo> {
  const height = options.height ?? 1.8;
  const { bones, bind, meshNode } = readRig(skeleton);

  // 1. Align the source.
  const parts = flattenSource(source);
  const yaw = ((options.yawDegrees ?? 0) * Math.PI) / 180;
  const [c, s] = [Math.cos(yaw), Math.sin(yaw)];
  for (const part of parts)
    for (const arr of [part.positions, part.normals])
      for (let i = 0; i < arr.length; i += 3) {
        const x = arr[i]!;
        const z = arr[i + 2]!;
        arr[i] = c * x + s * z;
        arr[i + 2] = -s * x + c * z;
      }
  const raw = concat(parts);
  const rawSize = extent(raw.positions);
  const rawWeld = weldIds(raw.positions, Math.max(rawSize, 1e-9) * 1e-5);
  const rawMask = structuralMask(raw, rawWeld, 0.1 * rawSize);
  const lo: Vec3 = [Infinity, Infinity, Infinity];
  const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < rawMask.length; i++) {
    if (!rawMask[i]) continue;
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k]!, raw.positions[i * 3 + k]!);
      hi[k] = Math.max(hi[k]!, raw.positions[i * 3 + k]!);
    }
  }
  const heightBefore = hi[1] - lo[1];
  if (!(heightBefore > 0)) throw new Error('auto-rig: the source has no height');
  const k = height / heightBefore;
  const centre: Vec3 = [(lo[0] + hi[0]) / 2, lo[1], (lo[2] + hi[2]) / 2];
  for (let i = 0; i < raw.positions.length; i += 3)
    for (let a = 0; a < 3; a++) raw.positions[i + a] = (raw.positions[i + a]! - centre[a]!) * k;
  const mesh: TriMesh = { positions: raw.positions, indices: raw.indices };
  const size = extent(mesh.positions);
  const weld = weldIds(mesh.positions, Math.max(size, 1e-9) * 1e-5);
  const structural = structuralMask(mesh, weld, 0.1 * height);

  // 2. Landmarks.
  const ref = referenceMesh(meshNode, bind);
  const refWeld = weldIds(ref.positions, Math.max(extent(ref.positions), 1e-9) * 1e-5);
  const refLm = detectLandmarks(
    ref,
    refWeld,
    structuralMask(ref, refWeld, 0.1 * extent(ref.positions)),
  );
  const srcLm = detectLandmarks(mesh, weld, structural);

  // 3. Embedded skeleton, 4. weights, 5. re-pose.
  const refHeads = bones.map((b) => b.head);
  const srcHeads = embedSkeleton(bones, refLm, srcLm);
  const refTails = boneTails(bones, refHeads, refLm);
  const srcTails = boneTails(bones, srcHeads, srcLm);
  const skin = computeSkinWeights(mesh, srcHeads, srcTails, {
    heat: options.heat,
    attachRadius: options.attachRadius,
    smallPart: 0.1 * height,
  });
  const moves = boneMoves(bones, srcHeads, srcTails, refHeads, refTails);
  const posed = repose(mesh.positions, raw.normals, skin, moves);

  // 6. Replace the reference mesh: vertices in the skin's bind space (inverse of the bind transform).
  const toLocal = invertAffine(bind);
  const old = meshNode.getMesh()!;
  const body = skeleton.createMesh(old.getName() || 'body');
  const buffer = skeleton.getRoot().listBuffers()[0] ?? skeleton.createBuffer();
  const textures = new Map<Texture, Texture>();
  const materials = new Map<Material | null, Material>();
  parts.forEach((part, p) => {
    const from = raw.offsets[p]!;
    const count = part.positions.length / 3;
    const pos = new Float32Array(count * 3);
    const nrm = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos.set(transformPoint(toLocal, vec(posed.positions, from + i)), i * 3);
      nrm.set(normalize(transformDirection(toLocal, vec(posed.normals, from + i))), i * 3);
    }
    const accessor = (
      array: Float32Array | Uint16Array | Uint32Array,
      type: 'VEC2' | 'VEC3' | 'VEC4' | 'SCALAR',
    ) => skeleton.createAccessor().setArray(array).setType(type).setBuffer(buffer);
    let material = materials.get(part.material);
    if (!material) {
      material = copyMaterial(part.material, skeleton, textures);
      materials.set(part.material, material);
    }
    const prim: Primitive = skeleton
      .createPrimitive()
      .setAttribute('POSITION', accessor(pos, 'VEC3'))
      .setAttribute('NORMAL', accessor(nrm, 'VEC3'))
      .setAttribute('JOINTS_0', accessor(skin.joints.slice(from * 4, (from + count) * 4), 'VEC4'))
      .setAttribute('WEIGHTS_0', accessor(skin.weights.slice(from * 4, (from + count) * 4), 'VEC4'))
      .setIndices(
        accessor(count > 65535 ? part.indices.slice() : Uint16Array.from(part.indices), 'SCALAR'),
      )
      .setMaterial(material);
    if (part.uvs) prim.setAttribute('TEXCOORD_0', accessor(part.uvs.slice(), 'VEC2'));
    body.addPrimitive(prim);
  });
  meshNode.setMesh(body);
  for (const node of skeleton.getRoot().listNodes())
    if (node !== meshNode && node.getMesh()) node.setMesh(null);
  old.dispose();
  await skeleton.transform(
    prune({ keepLeaves: true, keepAttributes: true, keepSolidTextures: true }),
  );

  let top = -Infinity;
  let bottom = Infinity;
  for (let i = 1; i < posed.positions.length; i += 3) {
    top = Math.max(top, posed.positions[i]!);
    bottom = Math.min(bottom, posed.positions[i]!);
  }
  const angle = (side: SideLandmarks): number => {
    const d = sub(side.tip, side.root);
    return round((Math.atan2(-d[1], Math.hypot(d[0], d[2])) * 180) / Math.PI, 1);
  };
  const boneStretch: Record<string, number> = {};
  bones.forEach((bone, j) => (boneStretch[bone.name] = round(moves[j]!.stretch, 3)));
  return {
    scale: round(k, 6),
    heightBefore: round(heightBefore, 6),
    heightAfter: round(top - bottom, 4),
    vertices: mesh.positions.length / 3,
    triangles: mesh.indices.length / 3,
    components: skin.components,
    attachedComponents: skin.attached,
    hiddenVertices: skin.hidden,
    armAngle: { left: angle(srcLm.left), right: angle(srcLm.right) },
    boneStretch,
    maxInfluences: skin.maxInfluences,
  };
}
