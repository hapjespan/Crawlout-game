// Auto-rigging: a static humanoid mesh (T- or A-pose, no skeleton) gets the skeleton, bind pose and clips of a
// reference character (the conformed humanoid rig, Mixamo names), so it plays the reference's baked animations.
//
// 1. Align: the mesh is turned (yaw), scaled to `height` (the body without small loose parts), feet on y = 0, centred.
// 2. Landmarks on both meshes (the reference skin in its bind pose and the source), detected the same way so their
//    biases cancel: crown, crotch (the x = 0 cross-section), per side the arm root at the armpit and the fingertip
//    (the arm is the mesh island beyond the armpit plane), the leg centre and the toe.
// 3. Embed the reference skeleton in the source: every joint is placed relative to those landmarks (heights piecewise
//    linear between floor, crotch, shoulder and crown; the arm joints at the same fraction along the arm axis, which
//    may hang down in an A-pose; the legs follow the leg centres).
// 4. Skin weights in the source pose, by bone heat (Pinocchio, Baran and Popovic 2007): per bone j solve
//    (L + H) w_j = H p_j on the welded mesh graph, with L the graph Laplacian (edge weight 1 / length^2), p_j(i) = 1
//    when j is the nearest bone that vertex i sees (the segment to the bone crosses no triangle) and H_ii = heat / d^2.
//    The weights are smooth, sum to 1 and do not jump between body parts that only touch in space (the legs, an arm
//    and the torso). Small loose parts (studs, a buckle, hair cards) take the weights of the body under them: they are
//    linked to the nearest body vertex and get no bone term of their own. Then at most 4 influences, renormalised.
// 5. Re-pose to the reference bind pose with linear blend skinning: per bone the rotation from its embedded direction
//    to the reference direction and a stretch along the bone to the reference length (leaf bones: head, hands, feet
//    keep their size). The arms of an A-pose come up to the T-pose of the rig; proportions follow the rig.
// 6. The result replaces the reference mesh in the reference document: same joints, inverse bind matrices and clips,
//    so the baked animation texture is the reference's, byte for byte.
import type { Document, Material, Node, Primitive, Texture } from '@gltf-transform/core';
import { prune } from '@gltf-transform/functions';
import { stripMixamoPrefix } from './inspect.js';
import {
  identity,
  invertAffine,
  multiply,
  quatFromTo,
  quatRotate,
  transformDirection,
  transformPoint,
  type Mat,
  type Quat,
  type Vec3,
} from './math.js';
import { computeSmoothNormals } from './normals.js';

export interface AutoRigOptions {
  /** Height of the body (feet to crown, without small loose parts) after scaling, m. Default 1.8. */
  height?: number | undefined;
  /** Turn about +Y before scaling, degrees, so the model faces +Z. Default 0. */
  yawDegrees?: number | undefined;
  /** Heat constant of the bone-heat weights; larger is stiffer (less blending). Default 1. */
  heat?: number | undefined;
  /** Small loose parts within this distance (m, after scaling) of the body take the body's weights. Default 0.05. */
  attachRadius?: number | undefined;
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

const vec = (p: Float64Array, i: number): Vec3 => [p[i * 3]!, p[i * 3 + 1]!, p[i * 3 + 2]!];

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
function midZ(lm: Landmarks, y: number): number {
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
function heightMap(ref: Landmarks, src: Landmarks): (y: number) => number {
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

function roleOf(name: string): { role: Role; side: Side } {
  const side: Side = /^Left/.test(name) ? 1 : /^Right/.test(name) ? -1 : 0;
  const base = name.replace(/^(Left|Right)/, '');
  if (base === 'Shoulder') return { role: 'shoulder', side };
  if (['Arm', 'ForeArm', 'Hand'].includes(base)) return { role: 'arm', side };
  if (['UpLeg', 'Leg', 'Foot', 'ToeBase'].includes(base)) return { role: 'leg', side };
  if (side === 0) return { role: 'torso', side };
  return { role: 'other', side };
}

const sideOf = (lm: Landmarks, s: Side): SideLandmarks => (s < 0 ? lm.right : lm.left);

/** Embeds the reference skeleton in the source: joint positions relative to the landmarks. */
export function embedSkeleton(bones: readonly RigBone[], ref: Landmarks, src: Landmarks): Vec3[] {
  const mapY = heightMap(ref, src);
  return bones.map((bone) => {
    const [x, y, z] = bone.head;
    const { role, side } = roleOf(bone.name);
    if (role === 'arm' && side !== 0) {
      const r = sideOf(ref, side);
      const t = sideOf(src, side);
      const dirR = normalize(sub(r.tip, r.root));
      const lenR = length(sub(r.tip, r.root));
      const dirT = normalize(sub(t.tip, t.root));
      const lenT = length(sub(t.tip, t.root));
      const rel = sub(bone.head, r.root);
      const u = dot(rel, dirR) / lenR;
      const offset = sub(rel, scale(dirR, u * lenR));
      const turned = quatRotate(quatFromTo(dirR, dirT), offset);
      return add(add(t.root, scale(dirT, u * lenT)), turned);
    }
    if (role === 'leg' && side !== 0) {
      const r = sideOf(ref, side);
      const t = sideOf(src, side);
      return [x + t.legX - r.legX, mapY(y), z + t.legZ - r.legZ];
    }
    const yt = mapY(y);
    const zt = z + midZ(src, yt) - midZ(ref, y);
    if (role === 'shoulder' && side !== 0) {
      const ratio = sideOf(src, side).root[0] / sideOf(ref, side).root[0];
      return [x * ratio, yt, zt];
    }
    return [x, yt, zt];
  });
}

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
}

export interface WeightOptions {
  heat?: number | undefined;
  attachRadius?: number | undefined;
  /** Parts whose bounds diagonal is below this (m) count as small loose parts. */
  smallPart?: number | undefined;
}

function closestOnSegment(p: Vec3, a: Vec3, b: Vec3): Vec3 {
  const ab = sub(b, a);
  const len2 = dot(ab, ab);
  const t = len2 > 0 ? Math.min(1, Math.max(0, dot(sub(p, a), ab) / len2)) : 0;
  return add(a, scale(ab, t));
}

/** Triangle soup with bounds for segment tests. */
class Occluders {
  private readonly box: Float64Array;
  constructor(
    private readonly mesh: TriMesh,
    private readonly weld: Int32Array,
  ) {
    const count = mesh.indices.length / 3;
    this.box = new Float64Array(count * 6);
    const p = mesh.positions;
    for (let t = 0; t < count; t++) {
      for (let k = 0; k < 3; k++) {
        let lo = Infinity;
        let hi = -Infinity;
        for (let c = 0; c < 3; c++) {
          const v = p[mesh.indices[t * 3 + c]! * 3 + k]!;
          lo = Math.min(lo, v);
          hi = Math.max(hi, v);
        }
        this.box[t * 6 + k] = lo;
        this.box[t * 6 + 3 + k] = hi;
      }
    }
  }

  /** True when the open segment from vertex `v` (welded id) to `q` crosses a triangle not touching `v`. */
  blocked(v: number, from: Vec3, q: Vec3): boolean {
    const { indices, positions: p } = this.mesh;
    const lo = [Math.min(from[0], q[0]), Math.min(from[1], q[1]), Math.min(from[2], q[2])];
    const hi = [Math.max(from[0], q[0]), Math.max(from[1], q[1]), Math.max(from[2], q[2])];
    const d = sub(q, from);
    const count = indices.length / 3;
    for (let t = 0; t < count; t++) {
      const b = t * 6;
      if (
        this.box[b]! > hi[0]! ||
        this.box[b + 3]! < lo[0]! ||
        this.box[b + 1]! > hi[1]! ||
        this.box[b + 4]! < lo[1]! ||
        this.box[b + 2]! > hi[2]! ||
        this.box[b + 5]! < lo[2]!
      )
        continue;
      const i0 = indices[t * 3]!;
      const i1 = indices[t * 3 + 1]!;
      const i2 = indices[t * 3 + 2]!;
      if (this.weld[i0] === v || this.weld[i1] === v || this.weld[i2] === v) continue;
      // Moller-Trumbore.
      const a = vec(p, i0);
      const e1 = sub(vec(p, i1), a);
      const e2 = sub(vec(p, i2), a);
      const h = cross(d, e2);
      const det = dot(e1, h);
      if (Math.abs(det) < 1e-14) continue;
      const inv = 1 / det;
      const s = sub(from, a);
      const u = dot(s, h) * inv;
      if (u < 0 || u > 1) continue;
      const qv = cross(s, e1);
      const w = dot(d, qv) * inv;
      if (w < 0 || u + w > 1) continue;
      const t1 = dot(e2, qv) * inv;
      if (t1 > 1e-4 && t1 < 1 - 1e-4) return true;
    }
    return false;
  }
}

/** Solves (L + diag(h)) x = b by conjugate gradients with a Jacobi preconditioner (L from the CSR graph). */
function solveHeat(
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

/**
 * Bone-heat skin weights for `mesh` and bone segments `heads` to `tails` (see the header, step 4). Deterministic: the
 * same input gives the same weights.
 */
export function computeSkinWeights(
  mesh: TriMesh,
  heads: readonly Vec3[],
  tails: readonly Vec3[],
  options: WeightOptions = {},
): SkinWeights {
  const heat = options.heat ?? 1;
  const attachRadius = options.attachRadius ?? 0.05;
  const p = mesh.positions;
  const n = p.length / 3;
  let size = 0;
  for (let k = 0; k < 3; k++) {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < n; i++) {
      lo = Math.min(lo, p[i * 3 + k]!);
      hi = Math.max(hi, p[i * 3 + k]!);
    }
    size = Math.max(size, hi - lo);
  }
  const smallPart = options.smallPart ?? 0.1 * size;
  const weld = weldIds(p, Math.max(size, 1e-9) * 1e-5);
  const comp = components(mesh, weld);

  // Graph on the welded vertices (index = the welded representative).
  const edges = new Map<number, Map<number, number>>();
  const link = (a: number, b: number, w: number): void => {
    if (a === b) return;
    const ea = edges.get(a) ?? edges.set(a, new Map()).get(a)!;
    const eb = edges.get(b) ?? edges.set(b, new Map()).get(b)!;
    ea.set(b, Math.max(ea.get(b) ?? 0, w));
    eb.set(a, Math.max(eb.get(a) ?? 0, w));
  };
  const minEdge = 0.005;
  const edgeWeight = (a: number, b: number): number => {
    const l = Math.max(minEdge, length(sub(vec(p, a), vec(p, b))));
    return 1 / (l * l);
  };
  for (let t = 0; t < mesh.indices.length; t += 3)
    for (let e = 0; e < 3; e++) {
      const a = weld[mesh.indices[t + e]!]!;
      const b = weld[mesh.indices[t + ((e + 1) % 3)]!]!;
      link(a, b, edgeWeight(a, b));
    }

  // Small loose parts: linked to the nearest vertex of a larger part, without a bone term of their own.
  const partSize = partDiagonals(p, comp);
  const small = new Set<number>();
  for (const [c, diagonal] of partSize) if (diagonal < smallPart) small.add(c);
  const reps = [...new Set(weld)].sort((a, b) => a - b);
  const bodyReps = reps.filter((r) => !small.has(comp[r]!));
  const attachedParts = new Set<number>();
  for (const r of reps) {
    if (!small.has(comp[r]!)) continue;
    let best = -1;
    let bestD = attachRadius;
    for (const b of bodyReps) {
      const d = length(sub(vec(p, r), vec(p, b)));
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    if (best >= 0) {
      link(r, best, edgeWeight(r, best));
      attachedParts.add(comp[r]!);
    }
  }

  // Nearest visible bone per welded vertex.
  const occluders = new Occluders(mesh, weld);
  const nearest = new Int32Array(n).fill(-1);
  const h = new Float64Array(n);
  let hidden = 0;
  const bones = heads.length;
  for (const r of reps) {
    const v = vec(p, r);
    const order = heads
      .map((head, j) => {
        const q = closestOnSegment(v, head, tails[j]!);
        return { j, q, d: length(sub(v, q)) };
      })
      .sort((a, b) => a.d - b.d || a.j - b.j);
    if (attachedParts.has(comp[r]!)) {
      nearest[r] = order[0]!.j;
      continue;
    }
    const visible = order.find((o) => !occluders.blocked(r, v, o.q));
    if (visible) {
      nearest[r] = visible.j;
      const d = Math.max(visible.d, 0.01);
      h[r] = heat / (d * d);
    } else {
      nearest[r] = order[0]!.j;
      hidden++;
    }
  }
  // A connected part (with its links) without any bone term falls back to the nearest bone.
  const graphPart = new Map<number, number>();
  for (const r of reps) {
    if (graphPart.has(r)) continue;
    const stack = [r];
    const members: number[] = [];
    graphPart.set(r, r);
    while (stack.length > 0) {
      const v = stack.pop()!;
      members.push(v);
      for (const w of [...(edges.get(v)?.keys() ?? [])].sort((a, b) => a - b))
        if (!graphPart.has(w)) {
          graphPart.set(w, r);
          stack.push(w);
        }
    }
    if (members.every((m) => h[m] === 0))
      for (const m of members) {
        const d = Math.max(
          length(
            sub(vec(p, m), closestOnSegment(vec(p, m), heads[nearest[m]!]!, tails[nearest[m]!]!)),
          ),
          0.01,
        );
        h[m] = heat / (d * d);
      }
  }

  // CSR over the welded representatives.
  const index = new Map<number, number>(reps.map((r, i) => [r, i]));
  const m = reps.length;
  const rowStart = new Int32Array(m + 1);
  const colList: number[] = [];
  const valList: number[] = [];
  const diag = new Float64Array(m);
  reps.forEach((r, i) => {
    const nb = [...(edges.get(r) ?? new Map<number, number>())].sort((a, b) => a[0] - b[0]);
    for (const [w, a] of nb) {
      colList.push(index.get(w)!);
      valList.push(a);
      diag[i]! += a;
    }
    diag[i]! += h[r]!;
    rowStart[i + 1] = colList.length;
  });
  const cols = Int32Array.from(colList);
  const vals = Float64Array.from(valList);
  const solved: Float64Array[] = [];
  for (let j = 0; j < bones; j++) {
    const rhs = new Float64Array(m);
    const x = new Float64Array(m);
    reps.forEach((r, i) => {
      if (nearest[r] === j) {
        rhs[i] = h[r]!;
        x[i] = 1;
      }
    });
    solveHeat(rowStart, cols, vals, diag, rhs, x);
    solved.push(x);
  }

  // Top 4 per vertex, small ones dropped, renormalised.
  const joints = new Uint16Array(n * 4);
  const weights = new Float32Array(n * 4);
  let maxInfluences = 0;
  for (let i = 0; i < n; i++) {
    const row = index.get(weld[i]!)!;
    const ranked = solved
      .map((x, j) => ({ j, w: Math.max(0, x[row]!) }))
      .sort((a, b) => b.w - a.w || a.j - b.j)
      .slice(0, 4)
      .filter((e, k) => k === 0 || e.w >= 0.02);
    const sum = ranked.reduce((s, e) => s + e.w, 0);
    if (sum <= 0) {
      joints[i * 4] = nearest[weld[i]!]!;
      weights[i * 4] = 1;
      maxInfluences = Math.max(maxInfluences, 1);
      continue;
    }
    ranked.forEach((e, k) => {
      joints[i * 4 + k] = e.j;
      weights[i * 4 + k] = e.w / sum;
    });
    maxInfluences = Math.max(maxInfluences, ranked.length);
  }
  return {
    joints,
    weights,
    hidden,
    attached: attachedParts.size,
    components: partSize.size,
    maxInfluences,
  };
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

function movePoint(m: BoneMove, v: Vec3): Vec3 {
  const rel = sub(v, m.from);
  const along = dot(rel, m.axis);
  const stretched = add(rel, scale(m.axis, along * (m.stretch - 1)));
  return add(m.to, quatRotate(m.q, stretched));
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

// ---------------------------------------------------------------------------------------------------------------
// Documents

interface SourcePrimitive {
  material: Material | null;
  positions: Float64Array;
  normals: Float64Array;
  uvs: Float32Array | null;
  indices: Uint32Array;
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

function concat(
  parts: readonly SourcePrimitive[],
): TriMesh & { normals: Float64Array; offsets: number[] } {
  const total = parts.reduce((s, p) => s + p.positions.length / 3, 0);
  const positions = new Float64Array(total * 3);
  const normals = new Float64Array(total * 3);
  const indexList: number[] = [];
  const offsets: number[] = [];
  let offset = 0;
  for (const part of parts) {
    offsets.push(offset);
    positions.set(part.positions, offset * 3);
    normals.set(part.normals, offset * 3);
    for (const i of part.indices) indexList.push(i + offset);
    offset += part.positions.length / 3;
  }
  return { positions, normals, indices: Uint32Array.from(indexList), offsets };
}

/** Bounds diagonal per connected part (keyed by the part id from `components`). */
function partDiagonals(positions: Float64Array, comp: Int32Array): Map<number, number> {
  const lo = new Map<number, Vec3>();
  const hi = new Map<number, Vec3>();
  for (let i = 0; i < comp.length; i++) {
    const c = comp[i]!;
    const a = lo.get(c) ?? [Infinity, Infinity, Infinity];
    const b = hi.get(c) ?? [-Infinity, -Infinity, -Infinity];
    for (let k = 0; k < 3; k++) {
      a[k] = Math.min(a[k]!, positions[i * 3 + k]!);
      b[k] = Math.max(b[k]!, positions[i * 3 + k]!);
    }
    lo.set(c, a);
    hi.set(c, b);
  }
  const diagonals = new Map<number, number>();
  for (const [c, a] of lo) diagonals.set(c, length(sub(hi.get(c)!, a)));
  return diagonals;
}

/** The structural vertices: not in a part whose bounds diagonal is below `small`. */
function structuralMask(mesh: TriMesh, weld: Int32Array, small: number): Uint8Array {
  const comp = components(mesh, weld);
  const diagonals = partDiagonals(mesh.positions, comp);
  return Uint8Array.from(comp, (c) => (diagonals.get(c)! >= small ? 1 : 0));
}

/** Skin, joints in their bind pose (heads in model space) and the bind transform of the skinned mesh. */
function readRig(skeleton: Document): { bones: RigBone[]; bind: Mat; meshNode: Node } {
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

/** The reference skin's vertices in the bind pose (model space). */
function referenceMesh(meshNode: Node, bind: Mat): TriMesh {
  const parts: SourcePrimitive[] = [];
  for (const prim of meshNode.getMesh()!.listPrimitives()) {
    const position = prim.getAttribute('POSITION');
    if (!position || prim.getMode() !== 4) continue;
    const count = position.getCount();
    const positions = new Float64Array(count * 3);
    const e = [0, 0, 0];
    for (let i = 0; i < count; i++)
      positions.set(transformPoint(bind, position.getElement(i, e)), i * 3);
    const idx = prim.getIndices();
    parts.push({
      material: null,
      positions,
      normals: new Float64Array(count * 3),
      uvs: null,
      indices: idx
        ? Uint32Array.from({ length: idx.getCount() }, (_, k) => idx.getScalar(k))
        : Uint32Array.from({ length: count }, (_, k) => k),
    });
  }
  return concat(parts);
}

function copyTexture(
  texture: Texture | null,
  target: Document,
  cache: Map<Texture, Texture>,
): Texture | null {
  if (!texture) return null;
  let copy = cache.get(texture);
  if (!copy) {
    copy = target.createTexture(texture.getName()).setMimeType(texture.getMimeType());
    const image = texture.getImage();
    if (image) copy.setImage(image);
    cache.set(texture, copy);
  }
  return copy;
}

/** A copy of the material in `target`: base color and emissive (factor and texture), alpha, sides. */
function copyMaterial(
  source: Material | null,
  target: Document,
  cache: Map<Texture, Texture>,
): Material {
  const material = target.createMaterial(source?.getName() || 'body');
  if (!source) return material;
  material
    .setBaseColorFactor(source.getBaseColorFactor())
    .setEmissiveFactor(source.getEmissiveFactor())
    .setMetallicFactor(source.getMetallicFactor())
    .setRoughnessFactor(source.getRoughnessFactor())
    .setAlphaMode(source.getAlphaMode())
    .setAlphaCutoff(source.getAlphaCutoff())
    .setDoubleSided(source.getDoubleSided());
  const base = copyTexture(source.getBaseColorTexture(), target, cache);
  if (base) {
    material.setBaseColorTexture(base);
    const from = source.getBaseColorTextureInfo();
    const to = material.getBaseColorTextureInfo();
    if (from && to)
      to.setWrapS(from.getWrapS())
        .setWrapT(from.getWrapT())
        .setMagFilter(from.getMagFilter())
        .setMinFilter(from.getMinFilter());
  }
  const emissive = copyTexture(source.getEmissiveTexture(), target, cache);
  if (emissive) material.setEmissiveTexture(emissive);
  return material;
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

// ---------------------------------------------------------------------------------------------------------------
// Small vector helpers (plain arrays; math.ts works on matrices and quaternions).

function extent(p: Float64Array): number {
  let size = 0;
  for (let k = 0; k < 3; k++) {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = k; i < p.length; i += 3) {
      lo = Math.min(lo, p[i]!);
      hi = Math.max(hi, p[i]!);
    }
    size = Math.max(size, hi - lo);
  }
  return size;
}
function round(v: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}
function add(a: readonly number[], b: readonly number[]): Vec3 {
  return [a[0]! + b[0]!, a[1]! + b[1]!, a[2]! + b[2]!];
}
function sub(a: readonly number[], b: readonly number[]): Vec3 {
  return [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
}
function scale(a: readonly number[], f: number): Vec3 {
  return [a[0]! * f, a[1]! * f, a[2]! * f];
}
function dot(a: readonly number[], b: readonly number[]): number {
  return a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
}
function cross(a: readonly number[], b: readonly number[]): Vec3 {
  return [
    a[1]! * b[2]! - a[2]! * b[1]!,
    a[2]! * b[0]! - a[0]! * b[2]!,
    a[0]! * b[1]! - a[1]! * b[0]!,
  ];
}
function length(a: readonly number[]): number {
  return Math.hypot(a[0]!, a[1]!, a[2]!);
}
function normalize(a: readonly number[]): Vec3 {
  const l = length(a) || 1;
  return [a[0]! / l, a[1]! / l, a[2]! / l];
}
