// Chunked terrain with distance LOD (a small quadtree over the terrain field, terrainField.ts). Every node is a grid of
// the same number of quads (chunkSize / field step, 64 by default), so a node twice the size has half the resolution:
//   level 0: 32 m chunks at the field step (0.5 m)      level 1: 64 m at 1 m      level 2: 128 m at 2 m (the roots)
//   far:     the roots again at 4 m, beyond farDistance (220 m)
// splitting into the finer level under 100 and 40 m (camera to the node's box).
// Per frame the tree is walked from the roots: a node outside the view frustum is skipped, a node closer to the camera
// than the split distance of its level is replaced by its four children, everything else is drawn as one mesh. Leaves
// (the 0.5 m chunks) are built on demand, a few per frame, and kept in a small cache; a parent whose visible children
// are not all built yet is drawn instead, so the ground never has holes and never stalls a frame. Coarser levels are
// built up front. Seams between neighbors of different resolution are hidden by skirts: every node has a strip hanging
// down from its border, deep enough to cover the gap to the coarsest neighbor along that edge.
import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  Color,
  Frustum,
  Group,
  Matrix4,
  Mesh,
  type Camera,
  type Material,
  type Scene,
  type Vector3,
} from 'three/webgpu';
import type { FieldRegion, TerrainField } from './terrainField.js';

export interface TerrainChunkOptions {
  /** Edge of a leaf chunk in meters (rounded to whole field steps). Default 32. */
  chunkSize?: number;
  /** Levels above the leaves; the roots are chunkSize * 2^levels. Default 2 (32, 64 and 128 m). */
  levels?: number;
  /**
   * Distance from the camera to a node (meters, to its bounding box) below which a node of level k + 1 splits into its
   * children of level k, for k = 0 .. levels - 1. Default [40, 100]: at gameplay zoom (42 m) the ground near the
   * camera is at 0.5 m and the view stays around 100k triangles.
   */
  splitDistances?: readonly number[];
  /** Beyond this distance a root draws at half its resolution. Default 220. Infinity disables the far level. */
  farDistance?: number;
  /** Leaf chunks built per frame at most (about 0.7 ms each on an M3 Pro). Default 2. */
  buildsPerFrame?: number;
  /** Leaf chunks kept built (least recently drawn are dropped). Default 64. */
  maxLeaves?: number;
  /** Coarse nodes rebuilt per frame at most after a local height change (invalidate). Default 6. */
  rebuildsPerFrame?: number;
}

/** Default sRGB color of a field without colors (the greybox's sand). */
const DEFAULT_SRGB = [150, 128, 94] as const;
/** Extra skirt depth below the computed gap, meters. */
const SKIRT_MARGIN = 0.3;

export interface TerrainChunk {
  readonly level: number;
  /** True for a root drawn at half resolution. */
  readonly far: boolean;
  /** Sample bounds in the field, inclusive. */
  readonly i0: number;
  readonly j0: number;
  readonly i1: number;
  readonly j1: number;
  /** Field samples between two vertices. */
  readonly stride: number;
  readonly box: Box3;
  readonly children: TerrainChunk[];
  readonly parent: TerrainChunk | null;
  mesh: Mesh | null;
  /** Frame in which it was last drawn. */
  used: number;
}

const SRGB_TO_LINEAR = (() => {
  const lut = new Float32Array(256);
  const c = new Color();
  for (let i = 0; i < 256; i++) {
    c.setRGB(i / 255, 0, 0, 'srgb');
    lut[i] = c.r;
  }
  return lut;
})();

/** Sample indices from `a` to `b` every `stride`, always ending on `b`. */
function sampleLine(a: number, b: number, stride: number): number[] {
  const out: number[] = [];
  for (let i = a; i < b; i += stride) out.push(i);
  out.push(b);
  return out;
}

/** Largest height difference between the field and its linear interpolation every `stride` samples along a line. */
function edgeError(
  field: TerrainField,
  i0: number,
  j0: number,
  di: number,
  dj: number,
  length: number,
  stride: number,
): number {
  const { heights, nx } = field;
  const h = (k: number): number => heights[(j0 + dj * k) * nx + i0 + di * k]!;
  let err = 0;
  for (let k0 = 0; k0 < length; k0 += stride) {
    const k1 = Math.min(length, k0 + stride);
    const a = h(k0);
    const b = h(k1);
    for (let k = k0 + 1; k < k1; k++) {
      const t = (k - k0) / (k1 - k0);
      err = Math.max(err, Math.abs(h(k) - (a + (b - a) * t)));
    }
  }
  return err;
}

/** The mesh data of one node: the grid over its samples every `stride`, plus a skirt `skirt` meters deep. */
export function buildChunkGeometry(
  field: TerrainField,
  i0: number,
  j0: number,
  i1: number,
  j1: number,
  stride: number,
  skirt: number,
): BufferGeometry {
  const { heights, nx, nz, step, minX, minZ } = field;
  const cols = sampleLine(i0, i1, stride);
  const rows = sampleLine(j0, j1, stride);
  const ca = cols.length;
  const ra = rows.length;
  const gridCount = ca * ra;
  const rim = 2 * (ca - 1) + 2 * (ra - 1);
  const count = gridCount + rim;
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const occlusion = new Float32Array(count);
  const h = (i: number, j: number): number =>
    heights[Math.min(nz - 1, Math.max(0, j)) * nx + Math.min(nx - 1, Math.max(0, i))]!;
  const src = field.colors;
  for (let b = 0; b < ra; b++) {
    const j = rows[b]!;
    for (let a = 0; a < ca; a++) {
      const i = cols[a]!;
      const v = b * ca + a;
      const s = j * nx + i;
      const o = v * 3;
      positions[o] = minX + i * step;
      positions[o + 1] = heights[s]!;
      positions[o + 2] = minZ + j * step;
      // Central differences over the node's own spacing: coarser nodes get smoother normals.
      const il = Math.max(0, i - stride);
      const ir = Math.min(nx - 1, i + stride);
      const jl = Math.max(0, j - stride);
      const jr = Math.min(nz - 1, j + stride);
      const dx = (h(ir, j) - h(il, j)) / ((ir - il || 1) * step);
      const dz = (h(i, jr) - h(i, jl)) / ((jr - jl || 1) * step);
      // len >= 1 for finite slopes; a NaN height (a hole in the source) falls back to straight up (safeNormal.ts).
      const len = Math.hypot(dx, 1, dz);
      const ok = Number.isFinite(len);
      normals[o] = ok ? -dx / len : 0;
      normals[o + 1] = ok ? 1 / len : 1;
      normals[o + 2] = ok ? -dz / len : 0;
      for (let k = 0; k < 3; k++)
        colors[o + k] = SRGB_TO_LINEAR[src ? src[s * 3 + k]! : DEFAULT_SRGB[k]!]!;
      occlusion[v] = field.occlusion[s]!;
    }
  }
  // Skirt: the border loop (bottom +x, right +z, top -x, left -z), each vertex copied `skirt` meters down.
  const loop: number[] = [];
  for (let a = 0; a < ca - 1; a++) loop.push(a);
  for (let b = 0; b < ra - 1; b++) loop.push(b * ca + ca - 1);
  for (let a = ca - 1; a > 0; a--) loop.push((ra - 1) * ca + a);
  for (let b = ra - 1; b > 0; b--) loop.push(b * ca);
  loop.forEach((v, k) => {
    const w = gridCount + k;
    for (let c = 0; c < 3; c++) {
      positions[w * 3 + c] = positions[v * 3 + c]!;
      normals[w * 3 + c] = normals[v * 3 + c]!;
      colors[w * 3 + c] = colors[v * 3 + c]!;
    }
    positions[w * 3 + 1]! -= skirt;
    occlusion[w] = occlusion[v]!;
  });

  const quads = (ca - 1) * (ra - 1) + rim;
  const indices = count < 65536 ? new Uint16Array(quads * 6) : new Uint32Array(quads * 6);
  let k = 0;
  const hv = (v: number): number => positions[v * 3 + 1]!;
  for (let b = 0; b < ra - 1; b++) {
    for (let a = 0; a < ca - 1; a++) {
      const p = b * ca + a;
      const q = p + 1;
      const c = p + ca;
      const d = c + 1;
      // Counter-clockwise seen from above; the shorter diagonal in height, as the field and GridHeightField split.
      if (Math.abs(hv(p) - hv(d)) <= Math.abs(hv(q) - hv(c))) indices.set([p, c, d, p, d, q], k);
      else indices.set([p, c, q, q, c, d], k);
      k += 6;
    }
  }
  for (let e = 0; e < rim; e++) {
    const p = loop[e]!;
    const q = loop[(e + 1) % rim]!;
    const ps = gridCount + e;
    const qs = gridCount + ((e + 1) % rim);
    // Facing outwards.
    indices.set([p, q, ps, q, qs, ps], k);
    k += 6;
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(positions, 3));
  geo.setAttribute('normal', new BufferAttribute(normals, 3));
  geo.setAttribute('color', new BufferAttribute(colors, 3));
  geo.setAttribute('occlusion', new BufferAttribute(occlusion, 1));
  geo.setIndex(new BufferAttribute(indices, 1));
  return geo;
}

export class TerrainChunks {
  readonly group = new Group();
  readonly roots: TerrainChunk[] = [];
  /** Every node, roots and their far twins included. */
  readonly nodes: TerrainChunk[] = [];
  private readonly far = new Map<TerrainChunk, TerrainChunk>();
  private readonly split2: number[];
  private readonly far2: number;
  private readonly buildsPerFrame: number;
  private readonly maxLeaves: number;
  private readonly frustum = new Frustum();
  private readonly projView = new Matrix4();
  private readonly skirt = new Map<TerrainChunk, number>();
  /** The box of a node before its skirt depth is taken off the bottom (what its children and heights say). */
  private readonly raw = new Map<TerrainChunk, Box3>();
  /** Coarse nodes (and far twins) whose heights changed and whose mesh is still the old one. */
  private readonly stale = new Set<TerrainChunk>();
  private readonly rebuildsPerFrame: number;
  private readonly coarsest: number;
  private frameNo = 0;
  private budget = 0;
  private builtLeaves = 0;
  /** Nodes drawn in the last update. */
  readonly drawn: TerrainChunk[] = [];
  /** Triangles drawn in the last update. */
  triangles = 0;
  /** Leaf chunks built so far (tests, stats). */
  leafBuilds = 0;

  constructor(
    scene: Scene,
    private readonly field: TerrainField,
    private readonly material: Material,
    opts: TerrainChunkOptions = {},
  ) {
    const levels = Math.max(0, Math.floor(opts.levels ?? 2));
    const n = Math.max(2, Math.round((opts.chunkSize ?? 32) / field.step));
    const splits = opts.splitDistances ?? [40, 100];
    this.split2 = Array.from({ length: levels }, (_, k) => {
      const d = splits[k] ?? (splits[splits.length - 1] ?? 60) * 2 ** (k - splits.length + 1);
      return d * d;
    });
    const farD = opts.farDistance ?? 220;
    this.far2 = farD * farD;
    this.buildsPerFrame = opts.buildsPerFrame ?? 2;
    this.maxLeaves = opts.maxLeaves ?? 64;
    this.rebuildsPerFrame = Math.max(1, Math.floor(opts.rebuildsPerFrame ?? 6));
    this.group.name = 'terrain';
    scene.add(this.group);

    // Leaf min/max heights once, aggregated up the tree.
    const rootSpan = n << levels;
    const lastI = field.nx - 1;
    const lastJ = field.nz - 1;
    const make = (
      level: number,
      i0: number,
      j0: number,
      parent: TerrainChunk | null,
    ): TerrainChunk | null => {
      if (i0 >= lastI || j0 >= lastJ) return null;
      const span = n << level;
      const node: TerrainChunk = {
        level,
        far: false,
        i0,
        j0,
        i1: Math.min(lastI, i0 + span),
        j1: Math.min(lastJ, j0 + span),
        stride: 1 << level,
        box: new Box3(),
        children: [],
        parent,
        mesh: null,
        used: -1,
      };
      if (level > 0) {
        const half = span >> 1;
        for (const [di, dj] of [
          [0, 0],
          [half, 0],
          [0, half],
          [half, half],
        ] as const) {
          const c = make(level - 1, i0 + di, j0 + dj, node);
          if (c) node.children.push(c);
        }
        for (const c of node.children) node.box.union(c.box);
      } else {
        let lo = Infinity;
        let hi = -Infinity;
        for (let j = node.j0; j <= node.j1; j++)
          for (let i = node.i0; i <= node.i1; i++) {
            const y = field.heights[j * field.nx + i]!;
            if (y < lo) lo = y;
            if (y > hi) hi = y;
          }
        node.box.min.set(field.minX + node.i0 * field.step, lo, field.minZ + node.j0 * field.step);
        node.box.max.set(field.minX + node.i1 * field.step, hi, field.minZ + node.j1 * field.step);
      }
      this.nodes.push(node);
      return node;
    };
    for (let j0 = 0; j0 < Math.max(1, lastJ); j0 += rootSpan)
      for (let i0 = 0; i0 < Math.max(1, lastI); i0 += rootSpan) {
        const root = make(levels, i0, j0, null);
        if (root) this.roots.push(root);
      }
    if (Number.isFinite(farD))
      for (const root of this.roots) {
        const twin: TerrainChunk = {
          ...root,
          far: true,
          stride: root.stride * 2,
          box: root.box.clone(),
          children: [],
          mesh: null,
          used: -1,
        };
        this.far.set(root, twin);
        this.nodes.push(twin);
      }
    // The coarsest spacing a neighbor can have decides how deep the skirts hang.
    this.coarsest = (1 << levels) * (Number.isFinite(farD) ? 2 : 1);
    for (const node of this.nodes) {
      this.raw.set(node, node.box.clone());
      this.fitSkirt(node);
    }
    for (const node of this.nodes) if (node.level > 0 || node.far) this.build(node);
  }

  /** Skirt depth of a node, and its box with the skirt (frustum culling) from the raw box. */
  private fitSkirt(node: TerrainChunk): void {
    const field = this.field;
    const w = node.i1 - node.i0;
    const hgt = node.j1 - node.j0;
    const c = this.coarsest;
    const err = Math.max(
      edgeError(field, node.i0, node.j0, 1, 0, w, c),
      edgeError(field, node.i0, node.j1, 1, 0, w, c),
      edgeError(field, node.i0, node.j0, 0, 1, hgt, c),
      edgeError(field, node.i1, node.j0, 0, 1, hgt, c),
    );
    const depth = 2 * err + SKIRT_MARGIN;
    this.skirt.set(node, depth);
    node.box.copy(this.raw.get(node)!);
    node.box.min.y -= depth;
  }

  /**
   * The field's heights changed in `region` (samples, inclusive): refits the boxes and skirts of the nodes that read
   * them, drops their finest chunks (rebuilt on demand) and queues the coarser nodes for a rebuild, a few per frame.
   */
  invalidate(region: FieldRegion): void {
    const field = this.field;
    const touched: TerrainChunk[] = [];
    // this.nodes lists children before their parent and the far twins last, so boxes can be rebuilt in order.
    for (const node of this.nodes) {
      const pad = node.stride;
      if (
        node.i0 - pad > region.i1 ||
        node.i1 + pad < region.i0 ||
        node.j0 - pad > region.j1 ||
        node.j1 + pad < region.j0
      )
        continue;
      touched.push(node);
      const raw = this.raw.get(node)!;
      if (node.far) {
        const root = this.roots.find((r) => this.far.get(r) === node);
        if (root) raw.copy(this.raw.get(root)!);
      } else if (node.level === 0) {
        let lo = Infinity;
        let hi = -Infinity;
        for (let j = node.j0; j <= node.j1; j++)
          for (let i = node.i0; i <= node.i1; i++) {
            const y = field.heights[j * field.nx + i]!;
            if (y < lo) lo = y;
            if (y > hi) hi = y;
          }
        raw.min.y = lo;
        raw.max.y = hi;
      } else {
        raw.min.y = Infinity;
        raw.max.y = -Infinity;
        for (const c of node.children) {
          const cb = this.raw.get(c)!;
          raw.min.y = Math.min(raw.min.y, cb.min.y);
          raw.max.y = Math.max(raw.max.y, cb.max.y);
        }
      }
    }
    for (const node of touched) {
      this.fitSkirt(node);
      if (node.level === 0 && !node.far) this.drop(node);
      else this.stale.add(node);
    }
  }

  /** Rebuilds the stale coarse nodes nearest the camera, `rebuildsPerFrame` at most. */
  private rebuildStale(cam: Vector3): void {
    if (this.stale.size === 0) return;
    const queue = [...this.stale].sort(
      (a, b) => a.box.distanceToPoint(cam) - b.box.distanceToPoint(cam),
    );
    for (const node of queue.slice(0, this.rebuildsPerFrame)) {
      this.stale.delete(node);
      if (node.mesh) {
        node.mesh.removeFromParent();
        node.mesh.geometry.dispose();
        node.mesh = null;
      }
      this.build(node);
    }
  }

  /** Quads per node edge, the same on every level. */
  get quadsPerEdge(): number {
    const root = this.roots[0];
    return root ? (root.i1 - root.i0) / root.stride : 0;
  }

  private build(node: TerrainChunk): void {
    const f = this.field;
    const geo = buildChunkGeometry(
      f,
      node.i0,
      node.j0,
      node.i1,
      node.j1,
      node.stride,
      this.skirt.get(node) ?? SKIRT_MARGIN,
    );
    geo.boundingBox = node.box.clone();
    const mesh = new Mesh(geo, this.material);
    mesh.name = `terrain-${node.far ? 'far' : node.level}-${node.i0}-${node.j0}`;
    mesh.frustumCulled = false; // culled per node here
    mesh.matrixAutoUpdate = false;
    mesh.raycast = () => {}; // picking marches the height field instead
    mesh.visible = false;
    this.group.add(mesh);
    node.mesh = mesh;
    if (node.level === 0 && !node.far) {
      this.builtLeaves++;
      this.leafBuilds++;
    }
  }

  private drop(node: TerrainChunk): void {
    if (!node.mesh) return;
    node.mesh.removeFromParent();
    node.mesh.geometry.dispose();
    node.mesh = null;
    if (node.level === 0 && !node.far) this.builtLeaves--;
  }

  /** Built now or within this frame's budget. */
  private ready(node: TerrainChunk): boolean {
    if (node.mesh) return true;
    if (this.budget <= 0) return false;
    this.budget--;
    this.build(node);
    return true;
  }

  /** Picks the nodes to draw for this camera and shows only their meshes. */
  update(camera: Camera): void {
    this.frameNo++;
    this.budget = this.buildsPerFrame;
    this.projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projView);
    for (const node of this.drawn) if (node.mesh) node.mesh.visible = false;
    this.drawn.length = 0;
    this.triangles = 0;
    const cam = camera.position;
    this.rebuildStale(cam);
    const draw = (node: TerrainChunk): void => {
      node.used = this.frameNo;
      node.mesh!.visible = true;
      this.drawn.push(node);
      this.triangles += (node.mesh!.geometry.index?.count ?? 0) / 3;
    };
    const visit = (node: TerrainChunk): void => {
      if (!this.frustum.intersectsBox(node.box)) return;
      const d2 = node.box.distanceToPoint(cam) ** 2;
      if (!node.parent && d2 >= this.far2) {
        const twin = this.far.get(node);
        if (twin?.mesh) return draw(twin);
      }
      if (node.level > 0 && d2 < this.split2[node.level - 1]!) {
        const shown = node.children.filter((c) => this.frustum.intersectsBox(c.box));
        // Nearest first, so the build budget goes where the camera looks.
        shown.sort((a, b) => a.box.distanceToPoint(cam) - b.box.distanceToPoint(cam));
        let all = true;
        for (const c of shown) if (!this.ready(c)) all = false;
        if (all) {
          for (const c of shown) visit(c);
          return;
        }
      }
      if (node.mesh || this.ready(node)) draw(node);
    };
    for (const root of this.roots) visit(root);
    this.evict();
  }

  private evict(): void {
    if (this.builtLeaves <= this.maxLeaves) return;
    const leaves = this.nodes
      .filter((n) => n.level === 0 && !n.far && n.mesh && n.used !== this.frameNo)
      .sort((a, b) => a.used - b.used);
    for (const n of leaves) {
      if (this.builtLeaves <= this.maxLeaves) break;
      this.drop(n);
    }
  }

  dispose(): void {
    this.stale.clear();
    for (const node of this.nodes)
      if (node.mesh) {
        node.mesh.removeFromParent();
        node.mesh.geometry.dispose();
        node.mesh = null;
      }
    this.group.removeFromParent();
    this.drawn.length = 0;
  }
}
