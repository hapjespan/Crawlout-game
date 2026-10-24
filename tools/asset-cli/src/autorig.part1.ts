// Split from autorig.ts to stay under the 5,000-token file limit; autorig.ts re-exports the public surface.
// Holds: AutoRigOptions, AutoRigInfo, TriMesh, weldIds, components, vec, +18 more.
import { type Vec3, type Quat, type Mat, identity, multiply } from './math.js';
import type { Material, Document, Node } from '@gltf-transform/core';
import { stripMixamoPrefix } from './inspect.js';
import type { ClothInfo, ClothOptions } from './cloth.js';

export interface AutoRigOptions {
  /** Height of the body (feet to crown, without small loose parts) after scaling, m. Default 1.8. */
  height?: number | undefined;
  /** Turn about +Y before scaling, degrees, so the model faces +Z. Default 0. */
  yawDegrees?: number | undefined;
  /** Heat constant of the bone-heat weights; larger is stiffer (less blending). Default 1. */
  heat?: number | undefined;
  /** Small loose parts within this distance (m, after scaling) of the body take the body's weights. Default 0.05. */
  attachRadius?: number | undefined;
  /** Treat some materials as the skin under the clothes: weight source and cull candidate (src/cloth.ts). */
  cloth?: ClothOptions | undefined;
}

export interface AutoRigInfo {
  /** Uniform scale applied to the source (after the yaw). */
  scale: number;
  heightBefore: number;
  /** Bounds height of the result in the bind pose (with the loose parts), m. */
  heightAfter: number;
  vertices: number;
  triangles: number;
  /** Connected parts of the welded mesh, and how many small ones were linked to the body. */
  components: number;
  attachedComponents: number;
  /** Vertices that see no bone: their weights come from their neighbours. */
  hiddenVertices: number;
  /** Arm angle below the horizontal in the source pose (degrees, 0 = T-pose). */
  armAngle: { left: number; right: number };
  /** Rig length over embedded length per bone (1 = same proportion as the rig); leaf bones keep their size. */
  boneStretch: Record<string, number>;
  /** Largest number of bone influences on one vertex. */
  maxInfluences: number;
  /** Primitives that carry a TANGENT, and how many of those were computed here because the source had none. */
  tangents: { primitives: number; computed: number };
  /** Weight transfer and skin cull of the clothing layers (src/cloth.ts); absent without an `cloth` option. */
  cloth?: ClothInfo;
}

// ---------------------------------------------------------------------------------------------------------------
// Geometry input

/** A triangle mesh in one space: positions (xyz), triangle indices, and per-vertex owner (primitive) where needed. */
export interface TriMesh {
  positions: Float64Array;
  indices: Uint32Array;
}

/** Welded vertex ids (same position within `step`) for a mesh; the graph and visibility work on these. */
export function weldIds(positions: Float64Array, step: number): Int32Array {
  const ids = new Int32Array(positions.length / 3);
  const seen = new Map<string, number>();
  for (let i = 0; i < ids.length; i++) {
    const key = `${Math.round(positions[i * 3]! / step)},${Math.round(positions[i * 3 + 1]! / step)},${Math.round(positions[i * 3 + 2]! / step)}`;
    const found = seen.get(key);
    if (found === undefined) {
      seen.set(key, i);
      ids[i] = i;
    } else ids[i] = found;
  }
  return ids;
}

/** Connected parts of the welded mesh: a component id per vertex (ids are the smallest vertex index in the part). */
export function components(mesh: TriMesh, weld: Int32Array): Int32Array {
  const parent = Int32Array.from({ length: weld.length }, (_, i) => weld[i]!);
  const find = (i: number): number => {
    let r = i;
    while (parent[r] !== r) r = parent[r]!;
    while (parent[i] !== r) {
      const next = parent[i]!;
      parent[i] = r;
      i = next;
    }
    return r;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };
  for (let t = 0; t < mesh.indices.length; t += 3) {
    union(mesh.indices[t]!, mesh.indices[t + 1]!);
    union(mesh.indices[t]!, mesh.indices[t + 2]!);
  }
  const out = new Int32Array(weld.length);
  for (let i = 0; i < weld.length; i++) out[i] = find(i);
  return out;
}

export const vec = (p: Float64Array, i: number): Vec3 => [p[i * 3]!, p[i * 3 + 1]!, p[i * 3 + 2]!];

// ---------------------------------------------------------------------------------------------------------------
// Landmarks

export interface SideLandmarks {
  /** Arm root: the centre of the arm cross-section at the armpit plane. */
  root: Vec3;
  /** Fingertip: the point of the arm island farthest from the root. */
  tip: Vec3;
  /** Centre of the leg (x, z) between 15 and 55 percent of the crotch height. */
  legX: number;
  legZ: number;
  /** Front of the foot (largest z below 15 percent of the crotch height). */
  toeZ: number;
}

export interface Landmarks {
  top: number;
  crotch: number;
  left: SideLandmarks;
  right: SideLandmarks;
  /** Points of the x = 0 cross-section (y, z pairs), for the front-to-back centre of the torso and head. */
  midline: Float64Array;
}

/** Points where the triangle edges cross the plane `axis` = `value` (only triangles with `use` true). */
function sliceEdges(
  mesh: TriMesh,
  use: (tri: number) => boolean,
  axis: 0 | 1 | 2,
  value: number,
): Vec3[] {
  const out: Vec3[] = [];
  const p = mesh.positions;
  for (let t = 0; t < mesh.indices.length; t += 3) {
    if (!use(t / 3)) continue;
    for (let e = 0; e < 3; e++) {
      const a = mesh.indices[t + e]!;
      const b = mesh.indices[t + ((e + 1) % 3)]!;
      const da = p[a * 3 + axis]! - value;
      const db = p[b * 3 + axis]! - value;
      if ((da < 0 && db < 0) || (da > 0 && db > 0) || da === db) continue;
      const f = da / (da - db);
      out.push([
        p[a * 3]! + (p[b * 3]! - p[a * 3]!) * f,
        p[a * 3 + 1]! + (p[b * 3 + 1]! - p[a * 3 + 1]!) * f,
        p[a * 3 + 2]! + (p[b * 3 + 2]! - p[a * 3 + 2]!) * f,
      ]);
    }
  }
  return out;
}

/**
 * Landmarks of a humanoid in T- or A-pose (meters, +Y up, facing +Z, feet on y = 0, centred on x = 0). Only the
 * structural parts count (`structural` per vertex: not a small loose part). Left is +X (the character's left).
 */
export function detectLandmarks(
  mesh: TriMesh,
  weld: Int32Array,
  structural: Uint8Array,
): Landmarks {
  const p = mesh.positions;
  const n = p.length / 3;
  let top = -Infinity;
  for (let i = 0; i < n; i++) if (structural[i]) top = Math.max(top, p[i * 3 + 1]!);
  const tri = (t: number): boolean =>
    structural[mesh.indices[t * 3]!] === 1 &&
    structural[mesh.indices[t * 3 + 1]!] === 1 &&
    structural[mesh.indices[t * 3 + 2]!] === 1;
  const mid = sliceEdges(mesh, tri, 0, 0);
  // Crotch: the lowest point of the x = 0 cross-section in the middle band of the body (the legs are apart below it).
  let crotch = Infinity;
  for (const q of mid) if (q[1] > 0.3 * top && q[1] < 0.75 * top) crotch = Math.min(crotch, q[1]);
  if (!Number.isFinite(crotch)) crotch = 0.47 * top;
  const midline = new Float64Array(mid.length * 2);
  mid.forEach((q, i) => midline.set([q[1], q[2]], i * 2));

  // Welded adjacency for the arm island.
  const adjacency = new Map<number, number[]>();
  for (let t = 0; t < mesh.indices.length; t += 3)
    for (let e = 0; e < 3; e++) {
      const a = weld[mesh.indices[t + e]!]!;
      const b = weld[mesh.indices[t + ((e + 1) % 3)]!]!;
      if (a === b) continue;
      (adjacency.get(a) ?? adjacency.set(a, []).get(a)!).push(b);
      (adjacency.get(b) ?? adjacency.set(b, []).get(b)!).push(a);
    }

  const side = (s: 1 | -1): SideLandmarks => {
    const step = 0.01 * top;
    const floor = crotch + 0.1 * (top - crotch);
    const lift = crotch + 0.3 * (top - crotch);
    let maxX = 0;
    for (let i = 0; i < n; i++) if (structural[i]) maxX = Math.max(maxX, s * p[i * 3]!);
    // Armpit: scanning outward, the first plane x = c whose cross-section (above the hips) starts high: the torso
    // reaches down to the hips, an arm only to its own underside.
    let armpitX = 0.11 * top;
    let root: Vec3 = [s * armpitX, 0.8 * top, 0];
    for (let c = 0.05 * top; c < maxX; c += step) {
      const cut = sliceEdges(mesh, tri, 0, s * c).filter((q) => q[1] > floor);
      if (cut.length === 0) continue;
      const ys = cut.map((q) => q[1]);
      if (Math.min(...ys) > lift) {
        armpitX = c;
        const zs = cut.map((q) => q[2]);
        root = [
          s * c,
          (Math.min(...ys) + Math.max(...ys)) / 2,
          (Math.min(...zs) + Math.max(...zs)) / 2,
        ];
        break;
      }
    }
    // Arm island: from the outermost vertex across the welded graph, staying beyond the armpit plane.
    let start = -1;
    for (let i = 0; i < n; i++)
      if (structural[i] && (start < 0 || s * p[i * 3]! > s * p[start * 3]!)) start = i;
    let tip: Vec3 = start >= 0 ? vec(p, start) : [s * maxX, root[1], root[2]];
    if (start >= 0) {
      const visited = new Set<number>([weld[start]!]);
      const queue = [weld[start]!];
      let best = -1;
      while (queue.length > 0) {
        const v = queue.shift()!;
        const d = Math.hypot(p[v * 3]! - root[0], p[v * 3 + 1]! - root[1], p[v * 3 + 2]! - root[2]);
        if (d > best) {
          best = d;
          tip = vec(p, v);
        }
        for (const w of adjacency.get(v) ?? [])
          if (!visited.has(w) && s * p[w * 3]! > armpitX) {
            visited.add(w);
            queue.push(w);
          }
      }
    }
    // Leg centre and toe.
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    let toeZ = -Infinity;
    for (let i = 0; i < n; i++) {
      if (!structural[i] || s * p[i * 3]! <= 0) continue;
      const y = p[i * 3 + 1]!;
      if (y > 0.15 * crotch && y < 0.55 * crotch) {
        x0 = Math.min(x0, p[i * 3]!);
        x1 = Math.max(x1, p[i * 3]!);
        z0 = Math.min(z0, p[i * 3 + 2]!);
        z1 = Math.max(z1, p[i * 3 + 2]!);
      }
      if (y < 0.15 * crotch) toeZ = Math.max(toeZ, p[i * 3 + 2]!);
    }
    const legX = Number.isFinite(x0) ? (x0 + x1) / 2 : s * 0.05 * top;
    const legZ = Number.isFinite(z0) ? (z0 + z1) / 2 : 0;
    return { root, tip, legX, legZ, toeZ: Number.isFinite(toeZ) ? toeZ : legZ + 0.1 * top };
  };
  return { top, crotch, left: side(1), right: side(-1), midline };
}

/** Front-to-back centre of the x = 0 cross-section around height y (band of 3 percent of the height). */
export function midZ(lm: Landmarks, y: number): number {
  const band = 0.03 * lm.top;
  for (const widen of [1, 2, 4, 8]) {
    let z0 = Infinity;
    let z1 = -Infinity;
    for (let i = 0; i < lm.midline.length; i += 2) {
      if (Math.abs(lm.midline[i]! - y) > band * widen) continue;
      z0 = Math.min(z0, lm.midline[i + 1]!);
      z1 = Math.max(z1, lm.midline[i + 1]!);
    }
    if (Number.isFinite(z0)) return (z0 + z1) / 2;
  }
  return 0;
}

/** Piecewise linear height map from the reference to the source: floor, crotch, arm root, crown. */
export function heightMap(ref: Landmarks, src: Landmarks): (y: number) => number {
  const knots = (l: Landmarks): number[] => [
    0,
    l.crotch,
    Math.max(l.crotch + 1e-3, (l.left.root[1] + l.right.root[1]) / 2),
    l.top,
  ];
  const a = knots(ref);
  const b = knots(src);
  return (y) => {
    let k = 0;
    while (k < a.length - 2 && y > a[k + 1]!) k++;
    const f = (y - a[k]!) / (a[k + 1]! - a[k]!);
    return b[k]! + f * (b[k + 1]! - b[k]!);
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Skeleton

export interface RigBone {
  name: string;
  /** Index of the parent bone, or -1. */
  parent: number;
  /** Head (joint position) in the bind pose, model space. */
  head: Vec3;
}

type Role = 'torso' | 'shoulder' | 'arm' | 'leg' | 'other';

type Side = 1 | -1 | 0;

export function roleOf(name: string): { role: Role; side: Side } {
  const side: Side = /^Left/.test(name) ? 1 : /^Right/.test(name) ? -1 : 0;
  const base = name.replace(/^(Left|Right)/, '');
  if (base === 'Shoulder') return { role: 'shoulder', side };
  if (['Arm', 'ForeArm', 'Hand'].includes(base)) return { role: 'arm', side };
  if (['UpLeg', 'Leg', 'Foot', 'ToeBase'].includes(base)) return { role: 'leg', side };
  if (side === 0) return { role: 'torso', side };
  return { role: 'other', side };
}

export const sideOf = (lm: Landmarks, s: Side): SideLandmarks => (s < 0 ? lm.right : lm.left);

// ---------------------------------------------------------------------------------------------------------------
// Weights

export interface SkinWeights {
  /** 4 joint indices and 4 weights per vertex (unused slots: index 0, weight 0). */
  joints: Uint16Array;
  weights: Float32Array;
  hidden: number;
  attached: number;
  components: number;
  maxInfluences: number;
  /** Garment vertices that took the weights of the skin under them (src/cloth.ts). */
  transferred: number;
}

export interface WeightOptions {
  heat?: number | undefined;
  attachRadius?: number | undefined;
  /** Parts whose bounds diagonal is below this (m) count as small loose parts. */
  smallPart?: number | undefined;
  /** Per vertex 1 when it belongs to the skin layer; garment vertices then take the skin's weights (src/cloth.ts). */
  body?: Uint8Array | undefined;
  cloth?: ClothOptions | undefined;
}

/** Solves (L + diag(h)) x = b by conjugate gradients with a Jacobi preconditioner (L from the CSR graph). */
export function solveHeat(
  rowStart: Int32Array,
  cols: Int32Array,
  vals: Float64Array,
  diag: Float64Array,
  b: Float64Array,
  x: Float64Array,
): void {
  const n = b.length;
  const apply = (v: Float64Array, out: Float64Array): void => {
    for (let i = 0; i < n; i++) {
      let s = diag[i]! * v[i]!;
      for (let k = rowStart[i]!; k < rowStart[i + 1]!; k++) s -= vals[k]! * v[cols[k]!]!;
      out[i] = s;
    }
  };
  const r = new Float64Array(n);
  const z = new Float64Array(n);
  const d = new Float64Array(n);
  const q = new Float64Array(n);
  apply(x, q);
  let bNorm = 0;
  for (let i = 0; i < n; i++) {
    r[i] = b[i]! - q[i]!;
    z[i] = diag[i]! > 0 ? r[i]! / diag[i]! : 0;
    d[i] = z[i]!;
    bNorm += b[i]! * b[i]!;
  }
  let rz = 0;
  for (let i = 0; i < n; i++) rz += r[i]! * z[i]!;
  const tol = 1e-20 * Math.max(bNorm, 1e-30);
  for (let it = 0; it < 4 * n + 100; it++) {
    let rr = 0;
    for (let i = 0; i < n; i++) rr += r[i]! * r[i]!;
    if (rr <= tol) break;
    apply(d, q);
    let dq = 0;
    for (let i = 0; i < n; i++) dq += d[i]! * q[i]!;
    if (dq <= 0) break;
    const alpha = rz / dq;
    for (let i = 0; i < n; i++) {
      x[i]! += alpha * d[i]!;
      r[i]! -= alpha * q[i]!;
      z[i] = diag[i]! > 0 ? r[i]! / diag[i]! : 0;
    }
    let rzNext = 0;
    for (let i = 0; i < n; i++) rzNext += r[i]! * z[i]!;
    const beta = rzNext / rz;
    rz = rzNext;
    for (let i = 0; i < n; i++) d[i] = z[i]! + beta * d[i]!;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Re-pose

export interface BoneMove {
  /** Rotation of the bone direction, then translation of the head: v' = to + R * S * (v - from). */
  from: Vec3;
  to: Vec3;
  q: Quat;
  /** Stretch along the (source) bone direction `axis`. */
  axis: Vec3;
  stretch: number;
}

// ---------------------------------------------------------------------------------------------------------------
// Documents

export interface SourcePrimitive {
  material: Material | null;
  positions: Float64Array;
  normals: Float64Array;
  /** VEC4 tangent (xyz plus the handedness w), in the same space as the positions; null without UV's to derive one. */
  tangents: Float64Array | null;
  /** Whether those tangents were computed here because the source primitive had no TANGENT. */
  tangentsComputed?: boolean;
  uvs: Float32Array | null;
  indices: Uint32Array;
}

export function concat(
  parts: readonly SourcePrimitive[],
): TriMesh & { normals: Float64Array; tangents: Float64Array; offsets: number[] } {
  const total = parts.reduce((s, p) => s + p.positions.length / 3, 0);
  const positions = new Float64Array(total * 3);
  const normals = new Float64Array(total * 3);
  const tangents = new Float64Array(total * 4);
  const indexList: number[] = [];
  const offsets: number[] = [];
  let offset = 0;
  for (const part of parts) {
    offsets.push(offset);
    positions.set(part.positions, offset * 3);
    normals.set(part.normals, offset * 3);
    if (part.tangents) tangents.set(part.tangents, offset * 4);
    for (const i of part.indices) indexList.push(i + offset);
    offset += part.positions.length / 3;
  }
  return { positions, normals, tangents, indices: Uint32Array.from(indexList), offsets };
}

/** Skin, joints in their bind pose (heads in model space) and the bind transform of the skinned mesh. */
export function readRig(skeleton: Document): { bones: RigBone[]; bind: Mat; meshNode: Node } {
  const root = skeleton.getRoot();
  const skins = root.listSkins();
  if (skins.length !== 1)
    throw new Error(`auto-rig: the skeleton needs exactly 1 skin, found ${skins.length}`);
  const skin = skins[0]!;
  const joints = skin.listJoints();
  const meshNode = root.listNodes().find((node) => node.getMesh() && node.getSkin() === skin);
  if (!meshNode) throw new Error('auto-rig: the skeleton has no skinned mesh to measure');
  const ibm = skin.getInverseBindMatrices();
  const first = identity();
  if (ibm) ibm.getElement(0, first as unknown as number[]);
  // Rest = bind: joint world * inverse bind is the same for every joint (the skin's bind transform).
  const bind = multiply(joints[0]!.getWorldMatrix(), first);
  const bones = joints.map((joint) => {
    const parentNode = joint.getParentNode();
    const t = joint.getWorldMatrix();
    return {
      name: stripMixamoPrefix(joint.getName()),
      parent: parentNode ? joints.indexOf(parentNode) : -1,
      head: [t[12]!, t[13]!, t[14]!] as Vec3,
    };
  });
  return { bones, bind, meshNode };
}
