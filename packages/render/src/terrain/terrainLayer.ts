// Terrain from flat typed arrays (the map agent's greybox export). The greybox is resampled into a smooth field
// (terrainField.ts, render only) and drawn in chunks with distance LOD (terrainChunks.ts) with the terrain material
// (terrainMaterial.ts: rock on slopes, dust on the flat, a world-space detail texture, toon ramp). Receives
// the sun shadow when one is given, and keeps a height texture for terrain-hugging decals. Height lookups and
// picking use the field, which is what the finest chunks draw. A bed (setBed, the river) is cut into the field.
// Buildings and building sites level the ground under them (setPlatforms, terrainPlatforms.ts): the platforms are
// baked into the field on top of the ground (the bed included), so everything that reads heights follows.
// With `detail.subdivide: 0` the greybox is drawn as delivered, as one mesh (debugging; no chunks, no bed, no platforms).
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Mesh,
  type Camera,
  type Material,
  type Scene,
  type Texture,
  type Vector3,
} from 'three/webgpu';
import type { DataTexturePrecision } from '../gpu/dataTextures.js';
import type { SunShadowTerm } from '../shadows/sunShadow.js';
import {
  mirroredAlbedoLayout,
  validateAlbedoLayout,
  type TerrainAlbedoLayout,
} from './albedoLayout.js';
import { TerrainHeightField, type TerrainGeometry } from './heightField.js';
import { createHeightTexture, refreshHeightTexture, type HeightTexture } from './heightTexture.js';
import { TerrainChunks, type TerrainChunkOptions } from './terrainChunks.js';
import {
  buildTerrainField,
  computeOcclusion,
  GridHeightField,
  OCCLUSION_REACH,
  raycastHeight,
  type HeightSource,
  type TerrainField,
} from './terrainField.js';
import {
  applyPlatform,
  platformRegion,
  regionsOverlap,
  unionRegion,
  shapePlatform,
  type PlatformShape,
  type PlatformSpec,
  type SampleRegion,
} from './terrainPlatforms.js';
import {
  createTerrainMaterial,
  DEFAULT_ALBEDO_TILE,
  type TerrainMaterialBundle,
} from './terrainMaterial.js';
import { sanitizeNormals } from './safeNormal.js';
import { refineTerrain, type TerrainDetailOptions } from './terrainRefine.js';

export interface TerrainLayerOptions {
  /** The sun's shadow (shadows/sunShadow.ts), received by the terrain. */
  shadow?: SunShadowTerm | null | undefined;
  precision?: DataTexturePrecision;
  /** Render-only refinement of the given mesh. */
  detail?: TerrainDetailOptions;
  /** Chunk size, levels and LOD distances of the chunked terrain. */
  chunks?: TerrainChunkOptions;
  /** Close-up detail layer of the material. Default: on, unless the refinement is below its default (`detail.subdivide` 0 or 1, the cheaper path). */
  detailLayer?: boolean;
}

/** Whether the terrain material gets its close-up detail layer: explicit, else on from the default refinement (subdivide 2). */
export function wantsDetailLayer(
  opts: Pick<TerrainLayerOptions, 'detail' | 'detailLayer'>,
): boolean {
  return opts.detailLayer ?? (opts.detail?.subdivide ?? 2) >= 2;
}

/** Cuts a bed into the terrain: the drawn height at (x, z) given the field's own height there. */
export type TerrainBed = (x: number, z: number, height: number) => number;

function linearColors(
  src: Float32Array | Uint8Array | undefined,
  vertexCount: number,
): Float32Array {
  const out = new Float32Array(vertexCount * 3);
  const c = new Color();
  const scale = src instanceof Uint8Array ? 1 / 255 : 1;
  for (let i = 0; i < vertexCount; i++) {
    if (src)
      c.setRGB(src[i * 3]! * scale, src[i * 3 + 1]! * scale, src[i * 3 + 2]! * scale, 'srgb');
    else c.setRGB(150 / 255, 128 / 255, 94 / 255, 'srgb');
    out[i * 3] = c.r;
    out[i * 3 + 1] = c.g;
    out[i * 3 + 2] = c.b;
  }
  return out;
}

/** A platform as the layer keeps it: the spec, its shape on the current ground, and the frame stamp of the last sighting. */
interface StoredPlatform {
  spec: PlatformSpec;
  shape: PlatformShape | null;
  stamp: number;
}

const samePlatform = (a: PlatformSpec, b: PlatformSpec): boolean =>
  Math.abs(a.x - b.x) < 1e-3 &&
  Math.abs(a.z - b.z) < 1e-3 &&
  Math.abs(a.hx - b.hx) < 1e-3 &&
  Math.abs(a.hz - b.hz) < 1e-3;

export class TerrainLayer {
  private mesh: Mesh | null = null;
  private chunks: TerrainChunks | null = null;
  private field: TerrainField | null = null;
  /** The field's heights before a bed was cut. */
  private baseHeights: Float32Array | null = null;
  private baseOcclusion: Float32Array | null = null;
  private baseGrid: GridHeightField | null = null;
  private bed: TerrainBed | null = null;
  /** The field's heights with the bed cut and no platforms; null while there is no bed (then the base heights are it). */
  private bedHeights: Float32Array | null = null;
  private readonly platforms = new Map<number, StoredPlatform>();
  private platformStamp = 0;
  /** Regions whose ground still has to be levelled (setPlatforms with a budget). */
  private pending: SampleRegion[] = [];
  private readonly look: TerrainMaterialBundle;
  heightField: HeightSource | null = null;
  heightTexture: HeightTexture | null = null;
  private readonly precision: DataTexturePrecision;
  private readonly detail: TerrainDetailOptions;
  private readonly chunkOptions: TerrainChunkOptions;
  private albedoLayout: TerrainAlbedoLayout | null = null;
  private albedoTile = DEFAULT_ALBEDO_TILE;

  constructor(
    private readonly scene: Scene,
    lightDir: Vector3,
    opts: TerrainLayerOptions = {},
  ) {
    this.precision = opts.precision ?? 'float';
    this.detail = opts.detail ?? {};
    this.chunkOptions = opts.chunks ?? {};
    this.look = createTerrainMaterial({
      lightDir,
      shadow: opts.shadow,
      detailLayer: wantsDetailLayer(opts),
    });
  }

  /**
   * Replaces the terrain. `albedoLayout` says where each point samples the albedo (the map's tiles and mirroring,
   * albedoLayout.ts); without it the albedo is tiled mirrored over the terrain's bounds.
   */
  set(geometry: TerrainGeometry, albedoLayout: TerrainAlbedoLayout | null = null): void {
    if (albedoLayout) validateAlbedoLayout(albedoLayout);
    this.albedoLayout = albedoLayout;
    const { positions, indices } = geometry;
    if (positions.length % 3 !== 0) throw new Error('terrain positions must hold xyz triples');
    if (indices.length % 3 !== 0) throw new Error('terrain indices must hold triangles');
    const source = new TerrainHeightField(positions, indices);
    this.clear();
    this.bed = null; // a bed belongs to a terrain
    this.platforms.clear(); // and so do the foundations: the caller sets them again
    this.pending = [];
    if ((this.detail.subdivide ?? 2) <= 0) {
      this.setWholeMesh(refineTerrain(geometry, source, { subdivide: 0 }));
      this.heightField = source;
    } else {
      const field = buildTerrainField(geometry, source, {
        subdivide: this.detail.subdivide ?? 2,
        baseStep: this.detail.baseStep ?? 1,
      });
      this.field = field;
      this.baseHeights = field.heights.slice();
      this.baseOcclusion = field.occlusion.slice();
      this.baseGrid = new GridHeightField({ ...field, heights: this.baseHeights });
      this.heightField = new GridHeightField(field);
      this.chunks = new TerrainChunks(this.scene, field, this.look.material, this.chunkOptions);
    }
    this.afterHeights();
  }

  /**
   * Cuts a bed into the drawn terrain (or removes it with null): every field sample gets bed(x, z, height). Height
   * lookups, decals and picking follow; read heightTexture again. set() drops the bed (it belongs to a terrain).
   */
  setBed(bed: TerrainBed | null): void {
    if (bed === null && this.bed === null) return;
    this.bed = bed;
    const field = this.field;
    if (!field || !this.baseHeights || !this.baseOcclusion) return;
    field.heights.set(this.baseHeights);
    field.occlusion.set(this.baseOcclusion);
    if (bed) this.cutBed();
    this.bedHeights = bed ? field.heights.slice() : null;
    this.levelAll();
    this.chunks?.dispose();
    this.chunks = new TerrainChunks(this.scene, field, this.look.material, this.chunkOptions);
    this.heightTexture?.texture.dispose();
    this.afterHeights();
  }

  /**
   * Levels the ground under building footprints (terrainPlatforms.ts). Give the whole current list every call (cheap
   * when nothing changed): platforms that are new, moved or gone are applied or taken away, and the field, its
   * occlusion, the chunk meshes and the height texture follow in the affected region. Returns true when the ground
   * changed (the caller re-reads what stands on it: props, say). Without chunks (subdivide 0) there are no platforms.
   * With `budgetMs` the work of one call stops after about that long (at least one region is done) and carries on in the
   * next call, so a map full of buildings does not cost one long frame; the stored platforms are always the latest.
   */
  setPlatforms(list: readonly PlatformSpec[], budgetMs = Infinity): boolean {
    const field = this.field;
    if (!field) return false;
    const stamp = ++this.platformStamp;
    const changed: (SampleRegion | null)[] = [];
    for (const spec of list) {
      const old = this.platforms.get(spec.id);
      if (old && samePlatform(old.spec, spec)) {
        old.stamp = stamp;
        continue;
      }
      if (old) changed.push(platformRegion(field, old.spec));
      changed.push(platformRegion(field, spec));
      this.platforms.set(spec.id, { spec: { ...spec }, shape: null, stamp });
    }
    if (this.platforms.size > list.length)
      for (const [id, p] of this.platforms)
        if (p.stamp !== stamp) {
          changed.push(platformRegion(field, p.spec));
          this.platforms.delete(id);
        }
    // Regions that touch are one job; far apart ones stay apart (a union box over a whole map would be a whole-map job).
    // One job per changed footprint, not their union: every sample is restored and re-applied from the ground and the
    // current platforms, so overlapping jobs agree, and a union box over a cluster of buildings would be a map-sized job.
    for (const r of changed) if (r) this.pending.push(r);
    if (this.pending.length === 0) return false;
    const start = performance.now();
    while (this.pending.length > 0) {
      this.levelRegion(this.pending.shift()!);
      if (performance.now() - start > budgetMs) break;
    }
    return true;
  }

  /** The ground before the platforms: the bed-cut heights, else what the map delivered. */
  private groundHeights(): Float32Array {
    return this.bedHeights ?? this.baseHeights!;
  }

  /** The platforms, in id order (what an overlap resolves by). */
  private platformsOver(region: SampleRegion): StoredPlatform[] {
    const field = this.field!;
    const out: StoredPlatform[] = [];
    for (const p of this.platforms.values()) {
      const own = platformRegion(field, p.spec);
      if (own && regionsOverlap(own, region)) out.push(p);
    }
    return out.sort((a, b) => a.spec.id - b.spec.id);
  }

  private applyPlatformsTo(region: SampleRegion): void {
    const field = this.field!;
    const ground = this.groundHeights();
    for (const p of this.platformsOver(region)) {
      p.shape ??= shapePlatform(field, ground, p.spec);
      applyPlatform(field, field.heights, p.spec, p.shape, region);
    }
  }

  /** Restores the ground in the region, applies the platforms over it, and refreshes everything built on the heights. */
  private levelRegion(region: SampleRegion): void {
    const field = this.field!;
    const ground = this.groundHeights();
    for (let j = region.j0; j <= region.j1; j++) {
      const row = j * field.nx;
      field.heights.set(ground.subarray(row + region.i0, row + region.i1 + 1), row + region.i0);
    }
    this.applyPlatformsTo(region);
    const pad = Math.ceil(OCCLUSION_REACH / field.step);
    computeOcclusion(field, {
      i0: region.i0 - pad,
      j0: region.j0 - pad,
      i1: region.i1 + pad,
      j1: region.j1 + pad,
    });
    this.chunks?.invalidate(region);
    const hf = this.heightField;
    const ht = this.heightTexture;
    if (hf && ht)
      refreshHeightTexture(ht, hf, {
        minX: field.minX + (region.i0 - 1) * field.step,
        maxX: field.minX + (region.i1 + 1) * field.step,
        minZ: field.minZ + (region.j0 - 1) * field.step,
        maxZ: field.minZ + (region.j1 + 1) * field.step,
      });
  }

  /** After a new bed: the platforms are re-shaped on the new ground and applied everywhere (the field is the ground again). */
  private levelAll(): void {
    const field = this.field;
    if (!field || this.platforms.size === 0) return;
    let region: SampleRegion | null = null;
    for (const p of this.platforms.values()) {
      p.shape = null;
      region = unionRegion(region, platformRegion(field, p.spec));
    }
    if (!region) return;
    this.applyPlatformsTo(region);
    const pad = Math.ceil(OCCLUSION_REACH / field.step);
    computeOcclusion(field, {
      i0: region.i0 - pad,
      j0: region.j0 - pad,
      i1: region.i1 + pad,
      j1: region.j1 + pad,
    });
  }

  /** The field's heights before the bed: what the map delivered, refined. */
  baseHeightAt(x: number, z: number): number {
    return this.baseGrid ? this.baseGrid.heightAt(x, z, 0) : this.heightAt(x, z);
  }

  private cutBed(): void {
    const f = this.field!;
    const bed = this.bed!;
    let changed = false;
    for (let j = 0; j < f.nz; j++)
      for (let i = 0; i < f.nx; i++) {
        const k = j * f.nx + i;
        const h = f.heights[k]!;
        const y = bed(f.minX + i * f.step, f.minZ + j * f.step, h);
        if (y !== h) {
          f.heights[k] = y;
          changed = true;
        }
      }
    if (changed) computeOcclusion(f);
  }

  private setWholeMesh(drawn: TerrainGeometry & { occlusion?: Float32Array }): void {
    const vertexCount = drawn.positions.length / 3;
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(drawn.positions, 3));
    geo.setAttribute('color', new BufferAttribute(linearColors(drawn.colors, vertexCount), 3));
    geo.setIndex(new BufferAttribute(drawn.indices, 1));
    const occlusion = drawn.occlusion ?? new Float32Array(vertexCount).fill(1);
    geo.setAttribute('occlusion', new BufferAttribute(occlusion, 1));
    if (drawn.normals) geo.setAttribute('normal', new BufferAttribute(drawn.normals, 3));
    else geo.computeVertexNormals();
    sanitizeNormals(geo);
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    this.mesh = new Mesh(geo, this.look.material);
    this.mesh.name = 'terrain';
    this.mesh.raycast = () => {};
    this.scene.add(this.mesh);
  }

  /** Edge (m) of the area the albedo covers, from terrain.json: the tile of the default layout. */
  setAlbedoTileSize(meters: number): void {
    if (!(meters > 0) || meters === this.albedoTile) return;
    this.albedoTile = meters;
    this.applyLayout();
  }

  private applyLayout(): void {
    const hf = this.heightField;
    if (this.albedoLayout) this.look.setLayout(this.albedoLayout);
    else if (hf) this.look.setLayout(mirroredAlbedoLayout(hf, this.albedoTile));
  }

  private afterHeights(): void {
    const hf = this.heightField;
    if (!hf) return;
    this.applyLayout();
    this.heightTexture = createHeightTexture(hf, this.precision);
    const [lo, hi] = hf.heightRange();
    this.look.setHeightRange(lo, hi);
  }

  /** Chooses the chunks and their LOD for this camera. Call once per frame before rendering. */
  update(camera: Camera): void {
    this.chunks?.update(camera);
  }

  /** Detail texture (the albedo of terrain.json); null for the tints alone. The caller keeps ownership. */
  setAlbedo(map: Texture | null): void {
    this.look.setAlbedo(map);
  }

  /** Grass density mask (grassMask.ts) over the given world rectangle; null removes it. The caller keeps ownership. */
  setGrassMask(
    map: Texture | null,
    rect?: { minX: number; minZ: number; sizeX: number; sizeZ: number },
  ): void {
    this.look.setGrassMask(map, rect);
  }

  /** Ground map (groundMap.ts) over the given world rectangle; null removes it. The caller keeps ownership. */
  setGroundMap(
    map: Texture | null,
    rect?: { minX: number; minZ: number; sizeX: number; sizeZ: number },
  ): void {
    this.look.setGroundMap(map, rect);
  }

  /** Rock and ground tints, sRGB hex (#rrggbb). */
  setTints(rockTint: string, groundTint: string): void {
    this.look.setTints(rockTint, groundTint);
  }

  /** The terrain's material: the map-edge skirt is drawn with it so the ground continues. */
  get material(): Material {
    return this.look.material;
  }

  /** The chunk tree (null for the whole-mesh mode): tests and stats. */
  get chunkTree(): TerrainChunks | null {
    return this.chunks;
  }

  /** Triangles drawn in the last update. */
  get triangles(): number {
    if (this.chunks) return this.chunks.triangles;
    return (this.mesh?.geometry.getIndex()?.count ?? 0) / 3;
  }

  /** Leaf chunks built so far (the frame profiler reports the difference per frame). */
  get leafBuilds(): number {
    return this.chunks?.leafBuilds ?? 0;
  }

  /** Terrain meshes drawn in the last update. */
  get drawCount(): number {
    return this.chunks ? this.chunks.drawn.length : this.mesh ? 1 : 0;
  }

  heightAt(x: number, z: number): number {
    return this.heightField ? this.heightField.heightAt(x, z, 0) : 0;
  }

  /** First terrain point along a ray, into `out`; false when it misses. */
  raycast(
    origin: { x: number; y: number; z: number },
    dir: { x: number; y: number; z: number },
    out: { x: number; y: number; z: number },
  ): boolean {
    const hf = this.heightField;
    return hf
      ? raycastHeight(hf, origin, dir, out, { step: this.field ? this.field.step : 0.5 })
      : false;
  }

  clear(): void {
    this.chunks?.dispose();
    this.chunks = null;
    this.field = null;
    this.baseHeights = null;
    this.baseOcclusion = null;
    this.baseGrid = null;
    this.bedHeights = null;
    if (this.mesh) {
      this.mesh.removeFromParent();
      this.mesh.geometry.dispose();
      this.mesh = null;
    }
    this.heightField = null;
    this.heightTexture?.texture.dispose();
    this.heightTexture = null;
  }

  dispose(): void {
    this.clear();
    this.look.dispose();
  }
}
