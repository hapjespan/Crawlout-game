// Clothing on an auto-rigged character (src/autorig.ts). A static source is two shells: the naked body and the garments
// over it, modelled apart and with no weights of their own. Bone heat alone treats them as unrelated surfaces, which
// gives the two faults a reviewer sees at once:
//
// 1. Stiff clothing. Heat needs a vertex that *sees* a bone; a coat vertex looks inward and hits the body first, so it
//    is blocked. Of the Klerk's 54.846 vertices 27.228 see no bone at all. Such a vertex gets no heat term, only the
//    smoothing of its neighbours, so a whole coat hangs on the handful of vertices that happen to peek through a hem.
//    `transferClothWeights` gives every garment vertex the weights of the skin point right under it instead, then
//    smooths over the garment itself, so a sleeve bends with the arm inside it.
// 2. The body through the clothes. Two shells that deform even slightly differently cross each other as soon as a joint
//    bends. The game-art answer is not to chase the deformation but to delete the skin that is permanently covered;
//    `cullHiddenSkin` keeps only the skin a ray can escape from, plus a margin of rings so wrist, neck and ankle still
//    read where skin meets cloth.
import type { Vec3 } from './math.js';

export interface ClothOptions {
  /** Material names of the skin layer: the weight source, and the layer that is culled where it is covered. */
  body: string[];
  /** A garment vertex within this distance (m) of the skin takes the skin's weights. Default 0.09. */
  transfer?: number | undefined;
  /** Laplacian passes over the garment after the transfer (blends the left/right seam of a skirt). Default 4. */
  smooth?: number | undefined;
  /** Outward search distance (m) for a covering shell when culling skin. Default 0.05. */
  reach?: number | undefined;
  /** Rings of triangles kept around every visible skin triangle. Default 2. */
  margin?: number | undefined;
}

export interface ClothInfo {
  /** Garment vertices that took their weights from the skin under them. */
  transferred: number;
  /** Skin triangles before and after the cull. */
  skinTriangles: number;
  skinKept: number;
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const at = (p: Float64Array, i: number): Vec3 => [p[i * 3]!, p[i * 3 + 1]!, p[i * 3 + 2]!];

/** A uniform grid over a triangle list, for "does a ray leave" and "what is the nearest surface point". */
export class TriangleIndex {
  private readonly lo: Vec3 = [Infinity, Infinity, Infinity];
  private readonly cells = new Map<number, number[]>();
  private readonly span = new Int32Array(3);

  constructor(
    private readonly p: Float64Array,
    /** Flat corner indices, three per triangle. */
    private readonly tris: Uint32Array,
    private readonly cell: number,
  ) {
    const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const v of tris)
      for (let k = 0; k < 3; k++) {
        this.lo[k] = Math.min(this.lo[k]!, p[v * 3 + k]!);
        hi[k] = Math.max(hi[k]!, p[v * 3 + k]!);
      }
    for (let k = 0; k < 3; k++)
      this.span[k] = Math.max(1, Math.ceil((hi[k]! - this.lo[k]!) / cell) + 1);
    for (let t = 0; t * 3 < tris.length; t++) {
      const [a, b] = this.box(t);
      for (let x = a[0]!; x <= b[0]!; x++)
        for (let y = a[1]!; y <= b[1]!; y++)
          for (let z = a[2]!; z <= b[2]!; z++) {
            const key = this.key(x, y, z);
            const list = this.cells.get(key);
            if (list) list.push(t);
            else this.cells.set(key, [t]);
          }
    }
  }

  private key(x: number, y: number, z: number): number {
    return (x * this.span[1]! + y) * this.span[2]! + z;
  }

  private box(t: number): [number[], number[]] {
    const a: number[] = [];
    const b: number[] = [];
    for (let k = 0; k < 3; k++) {
      let lo = Infinity;
      let hi = -Infinity;
      for (let c = 0; c < 3; c++) {
        const v = this.p[this.tris[t * 3 + c]! * 3 + k]!;
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
      a.push(this.index(lo, k));
      b.push(this.index(hi, k));
    }
    return [a, b];
  }

  private index(v: number, k: number): number {
    return Math.min(this.span[k]! - 1, Math.max(0, Math.floor((v - this.lo[k]!) / this.cell)));
  }

  /** True when the ray from `o` along unit `d` meets a triangle within `maxT`. */
  hits(o: Vec3, d: Vec3, maxT: number): boolean {
    const steps = Math.ceil(maxT / this.cell);
    const seen = new Set<number>();
    for (let s = 0; s <= steps; s++) {
      const c = [0, 1, 2].map((k) => this.index(o[k]! + d[k]! * s * this.cell, k));
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++)
          for (let dz = -1; dz <= 1; dz++) {
            const list = this.cells.get(this.key(c[0]! + dx, c[1]! + dy, c[2]! + dz));
            if (!list) continue;
            for (const t of list) {
              if (seen.has(t)) continue;
              seen.add(t);
              const hit = this.rayTriangle(o, d, t);
              if (hit > 1e-5 && hit <= maxT) return true;
            }
          }
    }
    return false;
  }

  /** Moller-Trumbore distance along the ray, or -1. */
  private rayTriangle(o: Vec3, d: Vec3, t: number): number {
    const a = at(this.p, this.tris[t * 3]!);
    const e1 = sub(at(this.p, this.tris[t * 3 + 1]!), a);
    const e2 = sub(at(this.p, this.tris[t * 3 + 2]!), a);
    const h = cross(d, e2);
    const det = dot(e1, h);
    if (Math.abs(det) < 1e-14) return -1;
    const inv = 1 / det;
    const s = sub(o, a);
    const u = dot(s, h) * inv;
    if (u < 0 || u > 1) return -1;
    const q = cross(s, e1);
    const v = dot(d, q) * inv;
    if (v < 0 || u + v > 1) return -1;
    return dot(e2, q) * inv;
  }

  /** Nearest surface point within `maxD`: the triangle and its barycentric coordinates. */
  nearest(q: Vec3, maxD: number): { tri: number; w: Vec3 } | null {
    const rings = Math.ceil(maxD / this.cell);
    const home = [0, 1, 2].map((k) => this.index(q[k]!, k));
    let best = maxD * maxD;
    let found: { tri: number; w: Vec3 } | null = null;
    const seen = new Set<number>();
    for (let r = 0; r <= rings; r++) {
      for (let dx = -r; dx <= r; dx++)
        for (let dy = -r; dy <= r; dy++)
          for (let dz = -r; dz <= r; dz++) {
            // Only the shell of the cube; the inside was done in an earlier ring.
            if (r > 0 && Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== r) continue;
            const list = this.cells.get(this.key(home[0]! + dx, home[1]! + dy, home[2]! + dz));
            if (!list) continue;
            for (const t of list) {
              if (seen.has(t)) continue;
              seen.add(t);
              const w = this.barycentric(q, t);
              const point = this.point(t, w);
              const d = sub(point, q);
              const d2 = dot(d, d);
              if (d2 < best) {
                best = d2;
                found = { tri: t, w };
              }
            }
          }
      // A hit inside ring r can still be beaten from ring r+1, but never from beyond sqrt(best) cells.
      if (found && (r + 1) * this.cell > Math.sqrt(best)) break;
    }
    return found;
  }

  private point(t: number, w: Vec3): Vec3 {
    const a = at(this.p, this.tris[t * 3]!);
    const b = at(this.p, this.tris[t * 3 + 1]!);
    const c = at(this.p, this.tris[t * 3 + 2]!);
    return [0, 1, 2].map((k) => w[0] * a[k]! + w[1] * b[k]! + w[2] * c[k]!) as Vec3;
  }

  /** Barycentric coordinates of the closest point of triangle `t` to `q` (Ericson, Real-Time Collision Detection). */
  private barycentric(q: Vec3, t: number): Vec3 {
    const a = at(this.p, this.tris[t * 3]!);
    const b = at(this.p, this.tris[t * 3 + 1]!);
    const c = at(this.p, this.tris[t * 3 + 2]!);
    const ab = sub(b, a);
    const ac = sub(c, a);
    const ap = sub(q, a);
    const d1 = dot(ab, ap);
    const d2 = dot(ac, ap);
    if (d1 <= 0 && d2 <= 0) return [1, 0, 0];
    const bp = sub(q, b);
    const d3 = dot(ab, bp);
    const d4 = dot(ac, bp);
    if (d3 >= 0 && d4 <= d3) return [0, 1, 0];
    const vc = d1 * d4 - d3 * d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0) {
      const v = d1 / (d1 - d3);
      return [1 - v, v, 0];
    }
    const cp = sub(q, c);
    const d5 = dot(ab, cp);
    const d6 = dot(ac, cp);
    if (d6 >= 0 && d5 <= d6) return [0, 0, 1];
    const vb = d5 * d2 - d1 * d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0) {
      const w = d2 / (d2 - d6);
      return [1 - w, 0, w];
    }
    const va = d3 * d6 - d5 * d4;
    if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
      const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
      return [0, 1 - w, w];
    }
    const denominator = 1 / (va + vb + vc);
    const v = vb * denominator;
    const w = vc * denominator;
    return [1 - v - w, v, w];
  }
}

/**
 * Gives every garment vertex within `transfer` m of the skin the weights of the skin point under it, then runs `smooth`
 * Laplacian passes over the garment. Works on the dense bone-heat rows (`solved`, one array per bone over the welded
 * representatives) before they are cut back to four influences, so a sleeve keeps the whole elbow blend of the arm.
 * Returns how many rows were transferred.
 */
export function transferClothWeights(
  positions: Float64Array,
  indices: Uint32Array,
  isBody: Uint8Array,
  weld: Int32Array,
  reps: readonly number[],
  index: ReadonlyMap<number, number>,
  edges: ReadonlyMap<number, ReadonlyMap<number, number>>,
  solved: readonly Float64Array[],
  options: { transfer: number; smooth: number },
): number {
  const bones = solved.length;
  const rows = reps.length;
  // The skin surface: triangles whose three corners are all skin.
  const skin: number[] = [];
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t]!;
    const b = indices[t + 1]!;
    const c = indices[t + 2]!;
    if (isBody[a] && isBody[b] && isBody[c]) skin.push(a, b, c);
  }
  if (skin.length === 0) return 0;
  const grid = new TriangleIndex(
    positions,
    Uint32Array.from(skin),
    Math.max(0.01, 0.25 * options.transfer),
  );

  const dense = new Float64Array(rows * bones);
  for (let j = 0; j < bones; j++)
    for (let i = 0; i < rows; i++) dense[i * bones + j] = Math.max(0, solved[j]![i]!);
  const cloth = new Uint8Array(rows);
  for (const r of reps) if (!isBody[r]) cloth[index.get(r)!] = 1;

  const next = Float64Array.from(dense);
  let transferred = 0;
  for (const r of reps) {
    const row = index.get(r)!;
    if (!cloth[row]) continue;
    const hit = grid.nearest(at(positions, r), options.transfer);
    if (!hit) continue;
    for (let j = 0; j < bones; j++) next[row * bones + j] = 0;
    for (let c = 0; c < 3; c++) {
      const source = index.get(weld[skin[hit.tri * 3 + c]!]!)!;
      const w = hit.w[c]!;
      if (w <= 0) continue;
      for (let j = 0; j < bones; j++) next[row * bones + j]! += w * dense[source * bones + j]!;
    }
    transferred++;
  }

  // Laplacian over the garment only: blends the hard left/right split a skirt gets from the nearest-leg lookup.
  const scratch = new Float64Array(next.length);
  for (let pass = 0; pass < options.smooth; pass++) {
    scratch.set(next);
    for (const r of reps) {
      const row = index.get(r)!;
      if (!cloth[row]) continue;
      const neighbours = [...(edges.get(r)?.keys() ?? [])].sort((a, b) => a - b);
      let count = 0;
      const sum = new Float64Array(bones);
      for (const n of neighbours) {
        const other = index.get(n);
        if (other === undefined || !cloth[other]) continue;
        for (let j = 0; j < bones; j++) sum[j]! += scratch[other * bones + j]!;
        count++;
      }
      if (count === 0) continue;
      for (let j = 0; j < bones; j++)
        next[row * bones + j] = 0.5 * scratch[row * bones + j]! + (0.5 * sum[j]!) / count;
    }
  }

  for (let i = 0; i < rows; i++) {
    if (!cloth[i]) continue;
    let sum = 0;
    for (let j = 0; j < bones; j++) sum += next[i * bones + j]!;
    if (!(sum > 0)) continue;
    for (let j = 0; j < bones; j++) solved[j]![i] = next[i * bones + j]! / sum;
  }
  return transferred;
}

/**
 * Keeps only the skin triangles a ray can escape from. A vertex is covered when a ray along its normal meets a covering
 * triangle within `reach`; a triangle is dropped when all three of its corners are covered. The kept set is then grown
 * by `margin` rings over the welded graph, so the few millimetres of wrist, neck and ankle around a cuff stay.
 *
 * `skin` and `cover` hold flat corner indices into `positions`. Returns a keep flag per skin triangle.
 */
export function cullHiddenSkin(
  positions: Float64Array,
  normals: Float64Array,
  weld: Int32Array,
  skin: Uint32Array,
  cover: Uint32Array,
  options: { reach: number; margin: number },
): Uint8Array {
  const count = skin.length / 3;
  const keep = new Uint8Array(count).fill(1);
  if (cover.length === 0) return keep;
  const grid = new TriangleIndex(positions, cover, Math.max(0.005, 0.5 * options.reach));
  const covered = new Map<number, boolean>();
  const isCovered = (v: number): boolean => {
    const id = weld[v]!;
    let value = covered.get(id);
    if (value === undefined) {
      const p = at(positions, id);
      const n = at(normals, id);
      const l = Math.hypot(n[0], n[1], n[2]);
      if (l < 1e-9) value = false;
      else {
        const d: Vec3 = [n[0] / l, n[1] / l, n[2] / l];
        const o: Vec3 = [p[0] + d[0] * 1e-4, p[1] + d[1] * 1e-4, p[2] + d[2] * 1e-4];
        value = grid.hits(o, d, options.reach);
      }
      covered.set(id, value);
    }
    return value;
  };
  for (let t = 0; t < count; t++)
    keep[t] =
      isCovered(skin[t * 3]!) && isCovered(skin[t * 3 + 1]!) && isCovered(skin[t * 3 + 2]!) ? 0 : 1;

  // Grow the visible set: a triangle touching a kept one (welded) is kept too.
  const owners = new Map<number, number[]>();
  for (let t = 0; t < count; t++)
    for (let c = 0; c < 3; c++) {
      const id = weld[skin[t * 3 + c]!]!;
      const list = owners.get(id);
      if (list) list.push(t);
      else owners.set(id, [t]);
    }
  for (let ring = 0; ring < options.margin; ring++) {
    const grown = Uint8Array.from(keep);
    for (let t = 0; t < count; t++) {
      if (!keep[t]) continue;
      for (let c = 0; c < 3; c++)
        for (const other of owners.get(weld[skin[t * 3 + c]!]!) ?? []) grown[other] = 1;
    }
    keep.set(grown);
  }
  return keep;
}
