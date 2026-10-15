// Rigid units on screen: robots that are not skinned (the Dwellers' security robot, repair drone and sentinel). One
// InstanceBatch, so one draw call, per asset per LOD (LODs that share a geometry share the batch). Position and yaw
// come from the interpolated frame like the humanoids; the procedural pose from the anim fields (rigidMotion.ts).
// Blob shadows and selection rings go to the shared DecalLayer, LOD follows the projected height (lod/screenLod.ts).
//
// Which unit typeIds are rigid is decided by whoever adds an asset (rigidUnitAssets.ts: the loadout's body slot names
// a rigid manifest asset): assign() hands typeIds to an asset, and UnitLayer skips every typeId that owns() claims.
// A unit type without an asset is not claimed and falls back to the humanoid rig.
import { ENTITY_FLAG } from '@crawlout/protocol';
import {
  Frustum,
  Matrix4,
  Sphere,
  type BufferGeometry,
  type Camera,
  type MeshBasicNodeMaterial,
  type Scene,
  type Texture,
  type Vector3,
} from 'three/webgpu';
import {
  DECAL_COLOR,
  DECAL_SHAPE,
  type DecalLayer,
  type DecalStyle,
} from '../decals/decalLayer.js';
import { TYPE_ID_BUILDING_FIRST } from '../entities/typeIds.js';
import { ScreenLod, UNIT_LOD_PX, type ScreenLodThresholds } from '../lod/screenLod.js';
import { teamIndex } from '../palette.js';
import type { InterpolatedFrame } from '../snapshot/interpolate.js';
import { InstanceBatch, NO_CUT } from '../structures/instanceBatch.js';
import type { PickShape } from '../picking/selection.js';
import { createRigidPose, rigidPose, type RigidMotionParams } from './rigidMotion.js';
import { createRigidUnitMaterial } from './rigidUnitMaterial.js';

/** Instance attribute of the pose, read by rigidUnitMaterial.ts. */
const POSE_ATTRIBUTE = 'iAnim';

/** A rigid asset the layer can draw: a geometry per LOD in the building vertex layout (buildingGeometry.ts). */
export interface RigidUnitSource {
  name: string;
  /** LOD 0, 1, 2; the same object twice means the LODs are identical and share one draw. Owned by the layer. */
  lods: readonly [BufferGeometry, BufferGeometry, BufferGeometry];
  /** Model height in meters, with its lowest point on y = 0. */
  height: number;
  /** Largest horizontal extent in meters (blob shadow, pick radius, culling). Default: height / 2. */
  width?: number;
  /** Hover height in meters above the ground; > 0 makes it a floating unit (drone). Default 0. */
  hover?: number;
  /** Diffuse texture array and its mean luma per layer (textureArray.ts), owned by the layer. */
  layers?: Texture | null;
  layerLuma?: readonly number[];
  /** Brightness factor on the albedo (renderer option albedoGain). Default 1. */
  gain?: number;
  /** Pulls the albedo towards the wasteland grey like the props (0..1). Default 0. */
  grade?: number;
}

interface RigidAsset {
  name: string;
  motion: RigidMotionParams;
  /** Largest horizontal extent, meters. */
  width: number;
  /** Albedo multiplier per instance (iTint.rgb). */
  tint: readonly [number, number, number];
  /** Projected-height size of the model for the screen LOD, meters. */
  lodSize: number;
  pick: PickShape;
  /** Half edge of the blob shadow and selection ring, meters. */
  blobHalf: number;
  /** Culling sphere: center height above the ground point and radius, meters. */
  cullHeight: number;
  cullRadius: number;
  material: MeshBasicNodeMaterial;
  layers: Texture | null;
  /** Batch per LOD; entries can be the same object. */
  lods: [InstanceBatch, InstanceBatch, InstanceBatch];
  /** Each batch once. */
  batches: InstanceBatch[];
}

export interface RigidUnitLayerOptions {
  capacity: number;
  lightDir: Vector3;
  screen?: ScreenLod;
  lodPixels?: ScreenLodThresholds;
}

const SELECTED = ENTITY_FLAG.selected;
const DEAD = ENTITY_FLAG.dead;
/** No asset of its own. */
const NO_ASSET = 255;

const BLOB: DecalStyle = {
  shape: DECAL_SHAPE.circle,
  shadow: 1,
  ring: 0,
  ringWidth: 0.14,
  fill: 0,
  grid: 0,
  color: DECAL_COLOR.selection,
};
const BLOB_SELECTED: DecalStyle = { ...BLOB, ring: 1 };

/** A float in [0, 1) per unit id (Knuth's multiplicative hash): the phase of the idle motion. */
export function phaseOf(id: number): number {
  return ((Math.imul(id, 2654435761) >>> 0) % 65536) / 65536;
}

export class RigidUnitLayer {
  private readonly assets: RigidAsset[] = [];
  private readonly scene: Scene;
  private readonly capacity: number;
  private readonly lightDir: Vector3;
  private readonly screen: ScreenLod;
  private readonly lodPixels: ScreenLodThresholds;
  private readonly frustum = new Frustum();
  private readonly projView = new Matrix4();
  private readonly sphere = new Sphere();
  private readonly pose = createRigidPose();
  /** Asset per unit typeId (1..1023), NO_ASSET when the typeId has none. */
  private readonly assetByType = new Uint8Array(TYPE_ID_BUILDING_FIRST).fill(NO_ASSET);
  /** Rigid instances drawn in the last update. */
  visibleCount = 0;
  /** Rigid instances in the frame (before culling). */
  totalCount = 0;
  /** Instances drawn per LOD in the last update. */
  readonly lodCounts: [number, number, number] = [0, 0, 0];

  constructor(scene: Scene, opts: RigidUnitLayerOptions) {
    this.scene = scene;
    this.capacity = opts.capacity;
    this.lightDir = opts.lightDir;
    this.screen = opts.screen ?? new ScreenLod();
    this.lodPixels = opts.lodPixels ?? UNIT_LOD_PX;
  }

  get assetCount(): number {
    return this.assets.length;
  }

  assetName(asset: number): string | undefined {
    return this.assets[asset]?.name;
  }

  /** Draw calls the layer issues when everything is on screen: one per asset per distinct LOD geometry. */
  get drawCapacity(): number {
    return this.assets.reduce((n, a) => n + a.batches.length, 0);
  }

  /** Meshes (batches) drawn in the last update. */
  get drawCount(): number {
    let n = 0;
    for (const a of this.assets) for (const b of a.batches) if (b.mesh.visible) n++;
    return n;
  }

  /** Adds an asset and returns its index. The geometries, material and texture are owned (and disposed) by the layer. */
  addAsset(src: RigidUnitSource): number {
    if (this.assets.length >= NO_ASSET) throw new Error('too many rigid unit assets');
    const hover = Math.max(0, src.hover ?? 0);
    const height = Math.max(0.1, src.height);
    const width = Math.max(0.1, src.width ?? height / 2);
    const material = createRigidUnitMaterial({
      lightDir: this.lightDir,
      name: `crawlout-rigid-${src.name}`,
      layers: src.layers ?? null,
      layerLuma: src.layerLuma ?? [],
      pivotY: hover > 0 ? height / 2 : 0,
      ...(src.grade ? { grade: src.grade } : {}),
    });
    const index = this.assets.length;
    const batches: InstanceBatch[] = [];
    const lods = src.lods.map((geometry, lod) => {
      const prev = lod > 0 ? batches.find((b) => b.mesh.geometry === geometry) : undefined;
      if (prev) return prev;
      const b = new InstanceBatch(
        this.scene,
        geometry,
        material,
        this.capacity,
        `rigid-${src.name}-lod${lod}`,
        [POSE_ATTRIBUTE],
      );
      batches.push(b);
      return b;
    }) as [InstanceBatch, InstanceBatch, InstanceBatch];
    this.assets.push({
      name: src.name,
      motion: { height, hover },
      width,
      tint: [src.gain ?? 1, src.gain ?? 1, src.gain ?? 1],
      lodSize: height,
      pick: { radius: Math.max(0.55, 0.4 * height, 0.45 * width), height: hover + height / 2 },
      blobHalf: Math.min(3, Math.max(0.45, 0.62 * width + 0.2)),
      cullHeight: hover + height / 2,
      cullRadius: 0.6 * Math.hypot(height, width) + 0.6,
      material,
      layers: src.layers ?? null,
      lods,
      batches,
    });
    return index;
  }

  /** Draws these unit typeIds with `asset`; null hands them back (to the humanoid rig). */
  assign(typeIds: Iterable<number>, asset: number | null): void {
    if (asset !== null && !this.assets[asset]) throw new Error(`no rigid unit asset ${asset}`);
    for (const t of typeIds)
      if (t > 0 && t < this.assetByType.length) this.assetByType[t] = asset ?? NO_ASSET;
  }

  /** Asset index a typeId is drawn with, or -1 (not a rigid unit). */
  assetFor(typeId: number): number {
    const a = typeId > 0 && typeId < this.assetByType.length ? this.assetByType[typeId]! : NO_ASSET;
    return a === NO_ASSET ? -1 : a;
  }

  /** True when the typeId is drawn here: the humanoid layer skips it. */
  owns(typeId: number): boolean {
    return this.assetFor(typeId) >= 0;
  }

  /** Pick sphere of a rigid typeId (a floating drone is hit where it floats), or null for any other. */
  pickShape(typeId: number, out: PickShape): PickShape | null {
    const a = this.assetFor(typeId);
    if (a < 0) return null;
    const p = this.assets[a]!.pick;
    out.radius = p.radius;
    out.height = p.height;
    return out;
  }

  /**
   * Distributes the rigid units of the frame over the asset and LOD batches. `frame.y` must already hold terrain
   * heights; `time` is the render clock in seconds (idle motion and pulses).
   */
  update(frame: InterpolatedFrame, camera: Camera, decals: DecalLayer, time: number): void {
    this.projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projView);
    const cam = camera.position;
    const counts = this.lodCounts;
    counts[0] = counts[1] = counts[2] = 0;
    this.visibleCount = 0;
    this.totalCount = 0;
    for (const a of this.assets) for (const b of a.batches) b.count = 0;
    if (this.assets.length > 0) {
      const center = this.sphere.center;
      const pose = this.pose;
      for (let i = 0; i < frame.count; i++) {
        const typeId = frame.typeId[i]!;
        const ai = this.assetFor(typeId);
        if (ai < 0) continue;
        this.totalCount++;
        const asset = this.assets[ai]!;
        const x = frame.x[i]!;
        const y = frame.y[i]!;
        const z = frame.z[i]!;
        center.set(x, y + asset.cullHeight, z);
        this.sphere.radius = asset.cullRadius;
        if (!this.frustum.intersectsSphere(this.sphere)) continue;
        const dx = x - cam.x;
        const dy = y + asset.cullHeight - cam.y;
        const dz = z - cam.z;
        const lod = this.screen.lod(
          asset.lodSize,
          Math.sqrt(dx * dx + dy * dy + dz * dz),
          this.lodPixels,
        );
        const batch = asset.lods[lod]!;
        if (batch.count >= this.capacity) continue;
        const flags = frame.flags[i]!;
        const yaw = frame.yaw[i]!;
        rigidPose(asset.motion, frame.anim[i]!, frame.animT[i]!, time, phaseOf(frame.id[i]!), pose);
        batch.push(
          x - Math.sin(yaw) * pose.back,
          y + pose.lift,
          z - Math.cos(yaw) * pose.back,
          yaw,
          pose.scale,
          pose.scale,
          pose.scale,
          teamIndex(frame.owner[i]!),
          asset.tint,
          NO_CUT,
        );
        batch.setExtra(POSE_ATTRIBUTE, pose.pitch, pose.roll, pose.dim, pose.glow);
        this.visibleCount++;
        counts[lod] = counts[lod]! + 1;

        const selected = (flags & SELECTED) !== 0 && (flags & DEAD) === 0;
        decals.push(x, z, asset.blobHalf, asset.blobHalf, selected ? BLOB_SELECTED : BLOB);
      }
    }
    for (const a of this.assets) for (const b of a.batches) b.commit();
  }

  dispose(): void {
    for (const a of this.assets) {
      for (const b of a.batches) b.dispose();
      a.layers?.dispose();
      a.material.dispose();
    }
    this.assets.length = 0;
    this.assetByType.fill(NO_ASSET);
  }
}
