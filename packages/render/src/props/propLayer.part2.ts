// Split from propLayer.ts to stay under the 5,000-token file limit; propLayer.ts re-exports the public surface.
// Holds: PropLayer.
import {
  type Scene,
  Box3,
  Vector3,
  Frustum,
  Matrix4,
  type MeshBasicNodeMaterial,
  type BufferGeometry,
  type Camera,
} from 'three/webgpu';
import { ScreenLod, type ScreenLodThresholds, PROP_LOD_PX, TREE_LOD_PX } from '../lod/screenLod.js';
import type { DecalStyle, DecalLayer } from '../decals/decalLayer.js';
import { simYawToRender } from '../snapshot/interpolate.js';
import {
  propCategoryOf,
  type PropCategory,
  castsShadow,
  hasBlobShadow,
  isTree,
} from './propCategory.js';
import { thinTier, THIN_TIERS, tierDensity, type ThinTier, shedPlan } from './propThinning.js';
import { ensureCutoffAttribute } from './propGeometry.js';
import { InstanceBatch } from '../structures/instanceBatch.js';
import { propContact } from '../decals/contact.js';
import { instanceTint } from './propVariation.js';
import { NEUTRAL_TEAM } from '../palette.js';
import { sweepAlongShadow } from './shadowSweep.js';
import {
  BLOB,
  BLOB_PX_PER_METER,
  BLOB_SCALE,
  CONTACT,
  DENSITY_STEPS,
  PROP_CHUNK_SIZE,
  SHADOW_CULL_MARGIN,
  SHADOW_MIN_SIZE,
  SINK,
  SPARSE_GROW,
  SPARSE_MAX,
  STRIDE,
  hash01,
} from './propLayer.part1.js';
import type { Group, PropLayerOptions, PropVisual, RenderProp } from './propLayer.part1.js';

export class PropLayer {
  private readonly scene: Scene;
  private readonly opts: PropLayerOptions;
  private readonly screen: ScreenLod;
  private readonly lodPixels: ScreenLodThresholds;
  private readonly treeLodPixels: ScreenLodThresholds;
  /** Camera distances at which some asset changes LOD (from the assets' heights), for change detection. */
  private breaks: number[] = [];
  private readonly chunkSize: number;
  private groups: Group[] = [];
  private readonly byId = new Map<string, Group>();
  private chunkBoxes: Box3[] = [];
  private chunkCenters: Vector3[] = [];
  private state = new Int8Array(0);
  private shown = new Int8Array(0);
  /** Density step per tier and chunk (tier * chunks + chunk; 0..DENSITY_STEPS), now and as last written. */
  private density = new Uint8Array(0);
  private shownDensity = new Uint8Array(0);
  private distance = new Float32Array(0);
  /** Props per tier and chunk. */
  private chunkTotal = new Int32Array(0);
  private blobChunks: number[] = [];
  private readonly maxVisible: number;
  private readonly thinDistance: number;
  private readonly minDensity: number;
  private readonly maxBlobs: number;
  private readonly blob: DecalStyle;
  private readonly cullBox = new Box3();
  /** Props drawn in the last update. */
  visibleCount = 0;

  /** Props in the current set. */
  get totalCount(): number {
    let n = 0;
    for (const g of this.groups) n += g.count;
    return n;
  }
  private dirty = true;
  private readonly frustum = new Frustum();
  private readonly projView = new Matrix4();
  private readonly tint: [number, number, number] = [1, 1, 1];
  /** Instances drawn per LOD in the last update. */
  readonly lodCounts: [number, number, number] = [0, 0, 0];

  constructor(scene: Scene, opts: PropLayerOptions) {
    this.scene = scene;
    this.opts = opts;
    this.screen = opts.screen ?? new ScreenLod();
    this.lodPixels = opts.lodPixels ?? PROP_LOD_PX;
    this.treeLodPixels = opts.treeLodPixels ?? TREE_LOD_PX;
    this.chunkSize = opts.chunkSize ?? PROP_CHUNK_SIZE;
    this.maxVisible = opts.maxVisible ?? 3000;
    this.thinDistance = opts.thinDistance ?? 160;
    this.minDensity = opts.minDensity ?? 0.15;
    this.maxBlobs = opts.maxBlobs ?? 768;
    this.blob = opts.shadow ? CONTACT : BLOB;
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
      // Within a chunk on a fixed per-prop priority: a thinned chunk keeps a prefix, the same props every time.
      const prio = new Map(list.map((e) => [e, hash01(e.index ^ 0x5bd1e995)]));
      list.sort((a, b) => chunkOf(a.p) - chunkOf(b.p) || prio.get(a)! - prio.get(b)!);
      const data = new Float32Array(list.length * STRIDE);
      const chunk = new Int32Array(list.length);
      list.forEach(({ p, index }, k) => {
        const o = k * STRIDE;
        data[o] = p.x;
        data[o + 2] = p.y;
        data[o + 3] = simYawToRender(p.yaw);
        data[o + 4] = p.scale;
        data[o + 5] = hash01(index); // brightness variation per instance
        data[o + 6] = hash01(index ^ 0x68e31da4); // tint variation
        data[o + 7] = hash01(index ^ 0x1b873593) * Math.PI * 2; // wind phase
        chunk[k] = chunkOf(p);
      });
      const ranges: number[] = [];
      const start = new Int32Array(cols * rows);
      const end = new Int32Array(cols * rows);
      for (let k = 0; k < list.length;) {
        let e = k + 1;
        while (e < list.length && chunk[e] === chunk[k]) e++;
        ranges.push(chunk[k]!, k, e);
        start[chunk[k]!] = k;
        end[chunk[k]!] = e;
        k = e;
      }
      const prev = old.get(id);
      const g: Group = {
        id,
        count: list.length,
        data,
        chunk,
        ranges,
        start,
        end,
        visual: null,
        category: propCategoryOf(id),
        tier: thinTier(propCategoryOf(id)),
        material: null,
        batches: [],
        lodBatch: [0, 0, 0],
      };
      this.groups.push(g);
      this.byId.set(id, g);
      if (prev?.visual) {
        g.category = prev.visual.category ?? g.category;
        g.tier = thinTier(g.category);
        this.applyVisual(g, prev.visual, prev.material);
      }
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
    this.density = new Uint8Array(THIN_TIERS * cols * rows);
    this.shownDensity = new Uint8Array(THIN_TIERS * cols * rows);
    this.distance = new Float32Array(cols * rows);
    this.countTiers();
    this.relayout();
  }

  /** Props per tier and chunk, from the groups' current categories. */
  private countTiers(): void {
    const chunks = this.state.length;
    this.chunkTotal = new Int32Array(THIN_TIERS * chunks);
    for (const g of this.groups)
      for (let k = 0; k < g.count; k++) this.chunkTotal[g.tier * chunks + g.chunk[k]!]!++;
  }

  /** Asset ids in the current props, in first-seen order. */
  assetIds(): string[] {
    return this.groups.map((g) => g.id);
  }

  /** The category an asset is drawn as (the manifest's once its visual is set, else from the id); null for an unknown id. */
  categoryOf(assetId: string): PropCategory | null {
    return this.byId.get(assetId)?.category ?? null;
  }

  instanceCount(assetId: string): number {
    return this.byId.get(assetId)?.count ?? 0;
  }

  /** Draws `assetId` with this visual (null hides it). */
  setVisual(assetId: string, visual: PropVisual | null): void {
    const g = this.byId.get(assetId);
    if (!g) return;
    this.disposeBatches(g, true);
    g.category = visual?.category ?? propCategoryOf(assetId);
    g.tier = thinTier(g.category);
    if (visual) this.applyVisual(g, visual, null);
    this.countTiers();
    this.updateBounds();
    this.dirty = true;
  }

  private applyVisual(g: Group, visual: PropVisual, material: MeshBasicNodeMaterial | null): void {
    g.visual = visual;
    const mask = visual.mask === true;
    g.material =
      material ??
      this.opts.material({
        map: visual.map,
        layers: visual.layers ?? null,
        mask,
        category: g.category,
        height: visual.height,
      });
    const unique: BufferGeometry[] = [];
    g.lodBatch = visual.lods.map((geo) => {
      let i = unique.indexOf(geo);
      if (i < 0) i = unique.push(geo) - 1;
      return i;
    }) as [number, number, number];
    g.batches = unique.map((geo, i) => {
      const own = geo.clone();
      if (mask) ensureCutoffAttribute(own); // an LOD without leaf cards shares the mask material
      const b = new InstanceBatch(this.scene, own, g.material!, g.count, `props-${g.id}-${i}`);
      b.mesh.raycast = () => {}; // props are never picked and never block a pick
      const shadow = this.opts.shadow;
      // Small props (rocks, crates) at their coarsest LOD leave the shadow pass: a few pixels of shadow for a draw call.
      const coarseOnly =
        g.lodBatch[2] === i && g.lodBatch[1] !== i && !castsShadow(g.category, false);
      const tiny = visual.height * visual.fit < SHADOW_MIN_SIZE; // a shadow of a few pixels is not worth its draw
      b.mesh.castShadow =
        !!shadow && castsShadow(g.category, shadow.smallProps) && !coarseOnly && !tiny;
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

  /** Culls, LODs and thins per chunk, rewrites the instance buffers when that changed, and pushes the blob decals. */
  update(camera: Camera, decals: DecalLayer): void {
    this.projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projView);
    const cam = camera.position;
    const state = this.state;
    const dist = this.distance;
    // Screen-size LOD per asset: a chunk's state counts the asset LOD switches nearer than it, so the buffers are only
    // rewritten when some asset in some chunk changes LOD.
    const breaks = this.breaks;
    breaks.length = 0;
    for (const g of this.groups) {
      const size = this.sizeOf(g);
      if (size <= 0) continue;
      const px = this.lodOf(g);
      breaks.push(
        (size * this.screen.pxPerMeter) / px.lod1,
        (size * this.screen.pxPerMeter) / px.lod2,
      );
    }
    const chunks = state.length;
    const near = [0, 0, 0];
    const far = [0, 0, 0];
    for (let c = 0; c < chunks; c++) {
      const box = this.chunkBoxes[c]!;
      let s = -1;
      if (!box.isEmpty() && this.frustum.intersectsBox(this.castBox(box))) {
        const d = box.distanceToPoint(cam);
        dist[c] = d;
        s = 0;
        for (const b of breaks) if (d >= b) s++;
        for (let t = 0; t < THIN_TIERS; t++) {
          const total = this.chunkTotal[t * chunks + c]!;
          if (total === 0) continue;
          const f = tierDensity(t as ThinTier, d, this.thinDistance, this.minDensity);
          if (f === 1) near[t]! += total;
          else far[t]! += total * f;
        }
      }
      state[c] = s;
    }
    // Over budget: ground cover gives way first, trees last, and within a tier the far chunks before the near ones.
    const plan = shedPlan(near, far, this.maxVisible);
    let changed = this.dirty;
    for (let t = 0; t < THIN_TIERS; t++) {
      for (let c = 0; c < chunks; c++) {
        const i = t * chunks + c;
        let q = 0;
        if (state[c]! >= 0 && this.chunkTotal[i]! > 0) {
          const f = tierDensity(t as ThinTier, dist[c]!, this.thinDistance, this.minDensity);
          const scaled = f * (f === 1 ? plan.near[t]! : plan.far[t]!);
          q = Math.max(1, Math.min(DENSITY_STEPS, Math.ceil(scaled * DENSITY_STEPS)));
        }
        this.density[i] = q;
        if (q !== this.shownDensity[i]) changed = true;
      }
    }
    for (let c = 0; c < chunks; c++) if (state[c] !== this.shown[c]) changed = true;
    if (changed) this.rebuild();

    let blobs = 0;
    for (const c of this.blobChunks) {
      for (const g of this.groups) {
        if (!g.visual || g.batches.length === 0 || !hasBlobShadow(g.category)) continue;
        const s0 = g.start[c]!;
        const n = g.end[c]! - s0;
        if (n === 0) continue;
        const keep = Math.round((this.density[g.tier * chunks + c]! * n) / DENSITY_STEPS);
        const d = g.data;
        const r = g.visual.radius * g.visual.fit * BLOB_SCALE;
        for (let k = s0; k < s0 + keep; k++) {
          if (blobs >= this.maxBlobs) return;
          const o = k * STRIDE;
          const scale = d[o + 4]!;
          const half = r * scale;
          // Large rocks, crates and the like sit in the ground with a contact decal instead of the round blob.
          const contact = propContact(g.category, g.visual.radius * g.visual.fit * scale);
          if (contact)
            decals.pushContact(d[o]!, d[o + 2]!, half, half, contact.margin, contact.style);
          else decals.push(d[o]!, d[o + 2]!, half, half, this.blob);
          blobs++;
        }
      }
    }
  }

  private rebuild(): void {
    this.shown.set(this.state);
    this.shownDensity.set(this.density);
    this.dirty = false;
    const counts = this.lodCounts;
    counts[0] = counts[1] = counts[2] = 0;
    const t = this.tint;
    const chunks = this.state.length;
    for (const g of this.groups) {
      for (const b of g.batches) b.count = 0;
      if (g.batches.length === 0 || !g.visual) continue;
      const fit = g.visual.fit;
      const gain = g.visual.gain ?? 1;
      const d = g.data;
      const size = this.sizeOf(g);
      for (let q = 0; q < g.ranges.length; q += 3) {
        const c = g.ranges[q]!;
        if (this.state[c]! < 0) continue;
        const s = this.screen.lod(size, this.distance[c]!, this.lodOf(g));
        const batch = g.batches[g.lodBatch[s]!]!;
        const k0 = g.ranges[q + 1]!;
        const n = g.ranges[q + 2]! - k0;
        const keep = Math.round((this.density[g.tier * chunks + c]! * n) / DENSITY_STEPS);
        // Ground cover never grows: it keeps its real size (a 0.6 m grass patch stays 0.6 m).
        const grow =
          keep < n && g.tier > 0 ? Math.min(SPARSE_MAX, Math.pow(n / keep, SPARSE_GROW)) : 1;
        for (let k = k0; k < k0 + keep; k++) {
          const o = k * STRIDE;
          const sc = d[o + 4]! * fit * grow;
          instanceTint(g.category, d[o + 5]!, d[o + 6]!, gain, t);
          batch.push(
            d[o]!,
            d[o + 1]!,
            d[o + 2]!,
            d[o + 3]!,
            sc,
            sc,
            sc,
            NEUTRAL_TEAM,
            t,
            d[o + 7]!,
          );
          counts[s] = counts[s]! + 1;
        }
      }
      for (const b of g.batches) b.commit();
    }
    this.visibleCount = counts[0] + counts[1] + counts[2];
    // Blob shadows: visible chunks where a meter still projects to BLOB_PX_PER_METER, nearest first.
    this.blobChunks = [];
    for (let c = 0; c < this.state.length; c++)
      if (this.state[c]! >= 0 && this.screen.pixels(1, this.distance[c]!) >= BLOB_PX_PER_METER)
        this.blobChunks.push(c);
    this.blobChunks.sort((a, b) => this.distance[a]! - this.distance[b]!);
  }

  /**
   * The box a chunk is culled with: as is, or with the sun's shadow on, swept along the shadow so a prop just outside the
   * view that shades it is still drawn (shadowSweep.ts). Without a sun direction the box grows by SHADOW_CULL_MARGIN.
   */
  private castBox(box: Box3): Box3 {
    const shadow = this.opts.shadow;
    if (!shadow) return box;
    if (shadow.sunDir) return sweepAlongShadow(box, shadow.sunDir, this.cullBox);
    return this.cullBox.copy(box).expandByScalar(SHADOW_CULL_MARGIN);
  }

  /** The screen-size thresholds of an asset's LODs: trees have their own. */
  private lodOf(g: Group): ScreenLodThresholds {
    return isTree(g.category) ? this.treeLodPixels : this.lodPixels;
  }

  /** Nominal drawn height of an asset (m): mesh height times its fit; 0 without a visual. */
  private sizeOf(g: Group): number {
    return g.visual ? g.visual.height * g.visual.fit : 0;
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
