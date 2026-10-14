// Decorative props (trees, rocks, bushes, grass) from the map's props file: static, not in the sim, not pickable.
// One instanced draw per prop asset per distinct LOD geometry (identical LODs share one draw), with frustum culling
// per chunk of CHUNK_SIZE meters: the layer only rewrites the instance buffers when the set of visible chunks or
// their LOD changes, so a still camera costs no uploads. Height comes from the terrain at each prop (relayout() after
// setTerrain). Props get a soft blob shadow decal near the camera (LOD 0 and 1 chunks), no real shadow: that keeps
// the shadow pass at buildings only.
import {
  Box3,
  Frustum,
  Matrix4,
  Vector3,
  type BufferGeometry,
  type Camera,
  type MeshBasicNodeMaterial,
  type Scene,
  type Texture,
} from 'three/webgpu';
import {
  DECAL_COLOR,
  DECAL_SHAPE,
  type DecalLayer,
  type DecalStyle,
} from '../decals/decalLayer.js';
import { NEUTRAL_TEAM } from '../palette.js';
import { simYawToRender } from '../snapshot/interpolate.js';
import { InstanceBatch } from '../structures/instanceBatch.js';

/**
 * One prop as the map delivers it (PropInstance of @crawlout/map fits as is): x and y in meters on the map (y is
 * world z), yaw 0..65535 as in the sim (0 = sim +x), scale 1 = 100 %.
 */
export interface RenderProp {
  asset: string;
  x: number;
  y: number;
  yaw: number;
  scale: number;
}

/** What an asset is drawn with. The layer clones the geometries (it owns its clones); the map stays the caller's. */
export interface PropVisual {
  lods: readonly [BufferGeometry, BufferGeometry, BufferGeometry];
  map: Texture | null;
  /** Uniform scale on top of the instance scale (propFit.ts). */
  fit: number;
  /** Mesh height and horizontal radius (m) before fit and instance scale. */
  height: number;
  radius: number;
}

export interface PropLayerOptions {
  heightAt: (x: number, z: number) => number;
  /** Creates the material for a visual's map (null: vertex colors only). Called once per visual. */
  material: (map: Texture | null) => MeshBasicNodeMaterial;
  /** Camera distance (m) where LOD 1 and LOD 2 start. */
  lodDistances?: readonly [number, number];
  /** Chunk edge in meters. */
  chunkSize?: number;
}

export const PROP_CHUNK_SIZE = 16;
/** Props sink this far into the terrain, so slopes show no gap under them. */
const SINK = 0.06;
/** Blob radius per mesh radius. */
const BLOB_SCALE = 0.7;
const BLOB: DecalStyle = {
  shape: DECAL_SHAPE.circle,
  shadow: 0.7,
  ring: 0,
  ringWidth: 0,
  fill: 0,
  grid: 0,
  color: DECAL_COLOR.selection,
};
const STRIDE = 6; // x, y, z, yaw (render radians), scale, brightness

interface Group {
  id: string;
  count: number;
  /** STRIDE floats per instance, sorted by chunk. */
  data: Float32Array;
  chunk: Int32Array;
  /** [chunk, start, end) triples over `data`. */
  ranges: number[];
  visual: PropVisual | null;
  material: MeshBasicNodeMaterial | null;
  batches: InstanceBatch[];
  /** Batch index per LOD. */
  lodBatch: [number, number, number];
}

function hash01(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export class PropLayer {
  private readonly scene: Scene;
  private readonly opts: PropLayerOptions;
  private readonly lodDist2: [number, number];
  private readonly chunkSize: number;
  private groups: Group[] = [];
  private readonly byId = new Map<string, Group>();
  private chunkBoxes: Box3[] = [];
  private chunkCenters: Vector3[] = [];
  private state = new Int8Array(0);
  private shown = new Int8Array(0);
  private dirty = true;
  private readonly frustum = new Frustum();
  private readonly projView = new Matrix4();
  private readonly tint: [number, number, number] = [1, 1, 1];
  /** Instances drawn per LOD in the last update. */
  readonly lodCounts: [number, number, number] = [0, 0, 0];

  constructor(scene: Scene, opts: PropLayerOptions) {
    this.scene = scene;
    this.opts = opts;
    const [d1, d2] = opts.lodDistances ?? [45, 100];
    this.lodDist2 = [d1 * d1, d2 * d2];
    this.chunkSize = opts.chunkSize ?? PROP_CHUNK_SIZE;
  }

  /** Replaces all props. Visuals of asset ids that stay are kept. */
  setProps(props: readonly RenderProp[]): void {
    const old = new Map(this.byId);
    this.byId.clear();
    // Chunk grid over the props' extent.
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (const p of props) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.y);
      maxZ = Math.max(maxZ, p.y);
    }
    const cs = this.chunkSize;
    const cols = props.length ? Math.floor((maxX - minX) / cs) + 1 : 0;
    const rows = props.length ? Math.floor((maxZ - minZ) / cs) + 1 : 0;
    const chunkOf = (p: RenderProp): number =>
      Math.floor((p.y - minZ) / cs) * cols + Math.floor((p.x - minX) / cs);

    const lists = new Map<string, { p: RenderProp; index: number }[]>();
    props.forEach((p, index) => {
      const l = lists.get(p.asset) ?? [];
      l.push({ p, index });
      lists.set(p.asset, l);
    });
    this.groups = [];
    for (const [id, list] of lists) {
      list.sort((a, b) => chunkOf(a.p) - chunkOf(b.p) || a.index - b.index);
      const data = new Float32Array(list.length * STRIDE);
      const chunk = new Int32Array(list.length);
      list.forEach(({ p, index }, k) => {
        const o = k * STRIDE;
        data[o] = p.x;
        data[o + 2] = p.y;
        data[o + 3] = simYawToRender(p.yaw);
        data[o + 4] = p.scale;
        data[o + 5] = 0.92 + 0.14 * hash01(index); // a little brightness variation per instance
        chunk[k] = chunkOf(p);
      });
      const ranges: number[] = [];
      for (let k = 0; k < list.length;) {
        let e = k + 1;
        while (e < list.length && chunk[e] === chunk[k]) e++;
        ranges.push(chunk[k]!, k, e);
        k = e;
      }
      const prev = old.get(id);
      const g: Group = {
        id,
        count: list.length,
        data,
        chunk,
        ranges,
        visual: null,
        material: null,
        batches: [],
        lodBatch: [0, 0, 0],
      };
      this.groups.push(g);
      this.byId.set(id, g);
      if (prev?.visual) this.applyVisual(g, prev.visual, prev.material);
      if (prev) {
        old.delete(id);
        this.disposeBatches(prev, false);
      }
    }
    for (const g of old.values()) this.disposeBatches(g, true);
    this.chunkBoxes = Array.from({ length: cols * rows }, () => new Box3());
    this.chunkCenters = Array.from({ length: cols * rows }, () => new Vector3());
    this.state = new Int8Array(cols * rows).fill(-1);
    this.shown = new Int8Array(cols * rows).fill(-2);
    this.relayout();
  }

  /** Asset ids in the current props, in first-seen order. */
  assetIds(): string[] {
    return this.groups.map((g) => g.id);
  }

  instanceCount(assetId: string): number {
    return this.byId.get(assetId)?.count ?? 0;
  }

  /** Draws `assetId` with this visual (null hides it). */
  setVisual(assetId: string, visual: PropVisual | null): void {
    const g = this.byId.get(assetId);
    if (!g) return;
    this.disposeBatches(g, true);
    if (visual) this.applyVisual(g, visual, null);
    this.updateBounds();
    this.dirty = true;
  }

  private applyVisual(g: Group, visual: PropVisual, material: MeshBasicNodeMaterial | null): void {
    g.visual = visual;
    g.material = material ?? this.opts.material(visual.map);
    const unique: BufferGeometry[] = [];
    g.lodBatch = visual.lods.map((geo) => {
      let i = unique.indexOf(geo);
      if (i < 0) i = unique.push(geo) - 1;
      return i;
    }) as [number, number, number];
    g.batches = unique.map((geo, i) => {
      const b = new InstanceBatch(
        this.scene,
        geo.clone(),
        g.material!,
        g.count,
        `props-${g.id}-${i}`,
      );
      b.mesh.raycast = () => {}; // props are never picked and never block a pick
      return b;
    });
  }

  private disposeBatches(g: Group, material: boolean): void {
    for (const b of g.batches) b.dispose();
    g.batches = [];
    if (material) {
      g.material?.dispose();
      g.material = null;
      g.visual = null;
    }
  }

  /** Re-reads the terrain height under every prop (after setTerrain). */
  relayout(): void {
    const h = this.opts.heightAt;
    for (const g of this.groups) {
      const d = g.data;
      for (let k = 0; k < g.count; k++) {
        const o = k * STRIDE;
        d[o + 1] = h(d[o]!, d[o + 2]!) - SINK;
      }
    }
    this.updateBounds();
    this.dirty = true;
  }

  private updateBounds(): void {
    for (const b of this.chunkBoxes) b.makeEmpty();
    const v = new Vector3();
    for (const g of this.groups) {
      const fit = g.visual?.fit ?? 1;
      const top = (g.visual?.height ?? 2) * fit;
      const r = (g.visual?.radius ?? 1) * fit;
      const d = g.data;
      for (let k = 0; k < g.count; k++) {
        const o = k * STRIDE;
        const s = d[o + 4]!;
        const box = this.chunkBoxes[g.chunk[k]!]!;
        box.expandByPoint(v.set(d[o]! - r * s, d[o + 1]!, d[o + 2]! - r * s));
        box.expandByPoint(v.set(d[o]! + r * s, d[o + 1]! + top * s, d[o + 2]! + r * s));
      }
    }
    this.chunkBoxes.forEach((b, i) =>
      b.isEmpty() ? this.chunkCenters[i]!.set(0, 0, 0) : b.getCenter(this.chunkCenters[i]!),
    );
  }

  /** Culls and LODs per chunk, rewrites the instance buffers when that changed, and pushes the blob decals. */
  update(camera: Camera, decals: DecalLayer): void {
    this.projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projView);
    const cam = camera.position;
    const state = this.state;
    let changed = this.dirty;
    for (let c = 0; c < state.length; c++) {
      const box = this.chunkBoxes[c]!;
      let s = -1;
      if (!box.isEmpty() && this.frustum.intersectsBox(box)) {
        const d2 = box.distanceToPoint(cam) ** 2;
        s = d2 < this.lodDist2[0] ? 0 : d2 < this.lodDist2[1] ? 1 : 2;
      }
      state[c] = s;
      if (s !== this.shown[c]) changed = true;
    }
    if (changed) this.rebuild();

    for (const g of this.groups) {
      if (!g.visual || g.batches.length === 0) continue;
      const d = g.data;
      const r = g.visual.radius * g.visual.fit * BLOB_SCALE;
      for (let q = 0; q < g.ranges.length; q += 3) {
        const s = state[g.ranges[q]!]!;
        if (s < 0 || s > 1) continue;
        for (let k = g.ranges[q + 1]!; k < g.ranges[q + 2]!; k++) {
          const o = k * STRIDE;
          const half = r * d[o + 4]!;
          decals.push(d[o]!, d[o + 2]!, half, half, BLOB);
        }
      }
    }
  }

  private rebuild(): void {
    this.shown.set(this.state);
    this.dirty = false;
    const counts = this.lodCounts;
    counts[0] = counts[1] = counts[2] = 0;
    const t = this.tint;
    for (const g of this.groups) {
      for (const b of g.batches) b.count = 0;
      if (g.batches.length === 0 || !g.visual) continue;
      const fit = g.visual.fit;
      const d = g.data;
      for (let q = 0; q < g.ranges.length; q += 3) {
        const s = this.state[g.ranges[q]!]!;
        if (s < 0) continue;
        const batch = g.batches[g.lodBatch[s]!]!;
        for (let k = g.ranges[q + 1]!; k < g.ranges[q + 2]!; k++) {
          const o = k * STRIDE;
          const sc = d[o + 4]! * fit;
          t[0] = t[1] = t[2] = d[o + 5]!;
          batch.push(d[o]!, d[o + 1]!, d[o + 2]!, d[o + 3]!, sc, sc, sc, NEUTRAL_TEAM, t);
          counts[s] = counts[s]! + 1;
        }
      }
      for (const b of g.batches) b.commit();
    }
  }

  /** Instanced draws the props take this frame. */
  drawCount(): number {
    let n = 0;
    for (const g of this.groups) for (const b of g.batches) if (b.mesh.visible) n++;
    return n;
  }

  /** The prop meshes in the scene (tests, debugging). */
  meshes(): readonly InstanceBatch['mesh'][] {
    return this.groups.flatMap((g) => g.batches.map((b) => b.mesh));
  }

  dispose(): void {
    for (const g of this.groups) this.disposeBatches(g, true);
    this.groups = [];
    this.byId.clear();
  }
}
