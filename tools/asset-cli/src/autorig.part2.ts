// Split from autorig.ts to stay under the 5,000-token file limit; autorig.ts re-exports the public surface.
// Holds: embedSkeleton, closestOnSegment, Occluders, computeSkinWeights, movePoint, partDiagonals, +13 more.
import type { Node, Texture, Document, Material } from '@gltf-transform/core';
import { type Mat, transformPoint, type Vec3, quatRotate, quatFromTo } from './math.js';
import {
  components,
  concat,
  heightMap,
  midZ,
  roleOf,
  sideOf,
  solveHeat,
  vec,
  weldIds,
} from './autorig.part1.js';
import type {
  BoneMove,
  Landmarks,
  RigBone,
  SkinWeights,
  SourcePrimitive,
  TriMesh,
  WeightOptions,
} from './autorig.part1.js';
import { transferClothWeights } from './cloth.js';

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

  // Clothing: a garment vertex looks inward and sees the body, never a bone, so bone heat leaves it nearly unanchored
  // and the whole garment moves as one stiff shell. It takes the weights of the skin right under it instead.
  let transferred = 0;
  if (options.body && options.cloth)
    transferred = transferClothWeights(
      p,
      mesh.indices,
      options.body,
      weld,
      reps,
      index,
      edges,
      solved,
      {
        transfer: options.cloth.transfer ?? 0.09,
        smooth: options.cloth.smooth ?? 4,
      },
    );

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
    transferred,
  };
}

export function movePoint(m: BoneMove, v: Vec3): Vec3 {
  const rel = sub(v, m.from);
  const along = dot(rel, m.axis);
  const stretched = add(rel, scale(m.axis, along * (m.stretch - 1)));
  return add(m.to, quatRotate(m.q, stretched));
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
export function structuralMask(mesh: TriMesh, weld: Int32Array, small: number): Uint8Array {
  const comp = components(mesh, weld);
  const diagonals = partDiagonals(mesh.positions, comp);
  return Uint8Array.from(comp, (c) => (diagonals.get(c)! >= small ? 1 : 0));
}

/** The reference skin's vertices in the bind pose (model space). */
export function referenceMesh(meshNode: Node, bind: Mat): TriMesh {
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
      tangents: null,
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

type Info = ReturnType<Material['getBaseColorTextureInfo']>;

function copyInfo(from: Info, to: Info): void {
  if (!from || !to) return;
  to.setWrapS(from.getWrapS())
    .setWrapT(from.getWrapT())
    .setMagFilter(from.getMagFilter())
    .setMinFilter(from.getMinFilter())
    .setTexCoord(from.getTexCoord());
}

/**
 * Whether an extra map lines up with the base colour map: same UV set, same transform and same size. Render stacks the
 * maps of all primitives into one array texture per map type and keys every type on the same layer index, so a map that
 * needs its own UV's or its own size cannot ride along. Such a map is dropped instead of shipped misaligned.
 *
 * Shared with the delivered-model pipeline (delivered.part1.ts `extract`), so both routes apply one rule.
 */
export function alignsWithBase(material: Material, info: Info, texture: Texture | null): boolean {
  const base = material.getBaseColorTexture();
  const baseInfo = material.getBaseColorTextureInfo();
  if (!base || !baseInfo || !info || !texture) return false;
  if (info.getTexCoord() !== baseInfo.getTexCoord()) return false;
  const xf = (i: NonNullable<Info>): string => {
    const t = i.getExtension('KHR_texture_transform') as {
      getOffset?: () => number[];
      getScale?: () => number[];
      getRotation?: () => number;
      getTexCoord?: () => number | null;
    } | null;
    return t
      ? JSON.stringify([t.getOffset?.(), t.getScale?.(), t.getRotation?.(), t.getTexCoord?.()])
      : '';
  };
  if (xf(info) !== xf(baseInfo)) return false;
  const [bw, bh] = base.getSize() ?? [0, 0];
  const [tw, th] = texture.getSize() ?? [0, 0];
  return bw === tw && bh === th;
}

/** A copy of the material in `target`: base colour, normal, metallic-roughness, occlusion and emissive, alpha, sides. */
export function copyMaterial(
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
    .setNormalScale(source.getNormalScale())
    .setOcclusionStrength(source.getOcclusionStrength())
    .setAlphaMode(source.getAlphaMode())
    .setAlphaCutoff(source.getAlphaCutoff())
    .setDoubleSided(source.getDoubleSided());
  const base = copyTexture(source.getBaseColorTexture(), target, cache);
  if (base) {
    material.setBaseColorTexture(base);
    copyInfo(source.getBaseColorTextureInfo(), material.getBaseColorTextureInfo());
  }
  // The PBR set rides along on the base colour's UV's: leather, metal and cloth get their own response and relief.
  const extras = [
    {
      texture: source.getNormalTexture(),
      info: source.getNormalTextureInfo(),
      set: (t: Texture) => material.setNormalTexture(t),
      got: () => material.getNormalTextureInfo(),
    },
    {
      texture: source.getMetallicRoughnessTexture(),
      info: source.getMetallicRoughnessTextureInfo(),
      set: (t: Texture) => material.setMetallicRoughnessTexture(t),
      got: () => material.getMetallicRoughnessTextureInfo(),
    },
    {
      texture: source.getOcclusionTexture(),
      info: source.getOcclusionTextureInfo(),
      set: (t: Texture) => material.setOcclusionTexture(t),
      got: () => material.getOcclusionTextureInfo(),
    },
  ] as const;
  for (const extra of extras) {
    if (!base || !alignsWithBase(source, extra.info, extra.texture)) continue;
    const copy = copyTexture(extra.texture, target, cache);
    if (!copy) continue;
    extra.set(copy);
    copyInfo(extra.info, extra.got());
  }
  const emissive = copyTexture(source.getEmissiveTexture(), target, cache);
  if (emissive) {
    material.setEmissiveTexture(emissive);
    copyInfo(source.getEmissiveTextureInfo(), material.getEmissiveTextureInfo());
  }
  return material;
}

// ---------------------------------------------------------------------------------------------------------------
// Small vector helpers (plain arrays; math.ts works on matrices and quaternions).

export function extent(p: Float64Array): number {
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

export function round(v: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

export function add(a: readonly number[], b: readonly number[]): Vec3 {
  return [a[0]! + b[0]!, a[1]! + b[1]!, a[2]! + b[2]!];
}

export function sub(a: readonly number[], b: readonly number[]): Vec3 {
  return [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
}

export function scale(a: readonly number[], f: number): Vec3 {
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

export function length(a: readonly number[]): number {
  return Math.hypot(a[0]!, a[1]!, a[2]!);
}

export function normalize(a: readonly number[]): Vec3 {
  const l = length(a) || 1;
  return [a[0]! / l, a[1]! / l, a[2]! / l];
}
