// Rigid units on screen: robots that are not skinned (the Dwellers' security robot, repair drone and sentinel). One
// InstanceBatch, so one draw call, per asset per LOD (LODs that share a geometry share the batch). Position and yaw
// come from the interpolated frame like the humanoids; the procedural pose from the anim fields (rigidMotion.ts).
// Blob shadows and selection rings go to the shared DecalLayer, LOD follows the projected height (lod/screenLod.ts).
//
// Which unit typeIds are rigid is decided by whoever adds an asset (rigidUnitAssets.ts: the loadout's body slot names
// a rigid manifest asset): assign() hands typeIds to an asset, and UnitLayer skips every typeId that owns() claims.
// A unit type without an asset is not claimed and falls back to the humanoid rig.
import { ANIM, ENTITY_FLAG } from '@crawlout/protocol';
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
import { INSPECTED_FLAG } from '../entities/inspected.js';
import { teamIndex } from '../palette.js';
import type { SunShadowTerm } from '../shadows/sunShadow.js';
import type { InterpolatedFrame } from '../snapshot/interpolate.js';
import { InstanceBatch, NO_CUT } from '../structures/instanceBatch.js';
import type { PickShape } from '../picking/selection.js';
import { InstanceVariation } from './animVariation.js';
import { createRigidPose, idlePeriod, rigidPose, type RigidMotionParams } from './rigidMotion.js';
import { createRigidUnitMaterial } from './rigidUnitMaterial.js';
import { BLOB_WITH_SHADOW } from './unitLayer.js';

/** Instance attribute of the pose, read by rigidUnitMaterial.ts. */
const POSE_ATTRIBUTE = 'iMotion';
/** The seed of InstanceVariation has 12 bits; /SEED_RANGE gives a constant in [0, 1) per unit. */
const SEED_RANGE = 4096;

/** A rigid asset the layer can draw: a geometry per LOD in the building vertex layout (buildingGeometry.ts). */
export interface RigidUnitSource {
  name: string;
  /** LOD 0, 1, 2; the same object twice means the LODs are identical and share one draw. Owned by the layer. */
  lods: readonly [BufferGeometry, BufferGeometry, BufferGeometry];
  /** Model height in meters (bounds). */
  height: number;
  /** Mean horizontal size in meters, the footprint on the ground (blob shadow, selection ring, pick radius). Default: height / 2. */
  width?: number;
  /** Farthest horizontal distance of the model from its origin, meters (culling; the origin need not be the middle). Default: width. */
  reach?: number;
  /**
   * Height in meters of the model's lowest point above the ground; > 0 makes it a floating unit (the repair drone). It is
   * already baked into the geometry (manifest `hover` equals bounds.min.y): the layer does not lift the model by it, it
   * only needs it for the pivot of the tilt, the pick sphere and the fall of a dead drone. Default 0.
   */
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
  /** Duration of one idle loop in seconds (rigidMotion.ts idlePeriod). */
  idleS: number;
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
  /**
   * The sun's shadow: robots cast it (a drone's falls on the ground under its hover, from the posed model in the
   * shadow pass) and receive it; the blob drops to a contact darkening, and culling keeps a margin for shadows that
   * reach into the view. Without it, the full blob.
   */
  shadow?: SunShadowTerm | null;
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
/** With the real shadow: a faint contact darkening (unitLayer.ts BLOB_WITH_SHADOW). */
const CONTACT: DecalStyle = { ...BLOB, shadow: BLOB_WITH_SHADOW };
const CONTACT_SELECTED: DecalStyle = { ...CONTACT, ring: 1 };
const BLOB_INSPECTED: DecalStyle = { ...BLOB_SELECTED, color: DECAL_COLOR.invalid };
const CONTACT_INSPECTED: DecalStyle = { ...CONTACT_SELECTED, color: DECAL_COLOR.invalid };
/** Extra culling radius with shadows (m): a robot just outside the view still casts into it. */
const SHADOW_CULL_MARGIN = 2.5;

export class RigidUnitLayer {
  private readonly assets: RigidAsset[] = [];
  private readonly scene: Scene;
  private readonly capacity: number;
  private readonly lightDir: Vector3;
  private readonly screen: ScreenLod;
  private readonly lodPixels: ScreenLodThresholds;
  private readonly shadow: SunShadowTerm | null;
  private readonly frustum = new Frustum();
  private readonly projView = new Matrix4();
  private readonly sphere = new Sphere();
  private readonly pose = createRigidPose();
  /** Per-entity phase, pace and heading smoothing (animVariation.ts), shared with the skinned units' look. */
  private readonly variation = new InstanceVariation();
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
    this.shadow = opts.shadow ?? null;
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
      pivotY: hover > 0 ? hover + height / 2 : 0,
      ...(src.grade ? { grade: src.grade } : {}),
      shadow: this.shadow,
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
      // A batch that only draws the coarsest LOD leaves the shadow pass (its shadow is a few pixels, the draw call is not).
      b.mesh.castShadow = this.shadow !== null && lod < src.lods.length - 1;
      batches.push(b);
      return b;
    }) as [InstanceBatch, InstanceBatch, InstanceBatch];
    this.assets.push({
      name: src.name,
      motion: { height, hover },
      idleS: idlePeriod({ height, hover }),
      width,
      tint: [src.gain ?? 1, src.gain ?? 1, src.gain ?? 1],
      lodSize: height,
      pick: { radius: Math.max(0.55, 0.4 * height, 0.45 * width), height: hover + height / 2 },
      blobHalf: Math.min(3, Math.max(0.45, 0.45 * width + 0.1)),
      cullHeight: hover + height / 2,
      cullRadius: Math.hypot(src.reach ?? width, height / 2) + 0.6,
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
    const nowMs = time * 1000;
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
        this.sphere.radius = asset.cullRadius + (this.shadow ? SHADOW_CULL_MARGIN : 0);
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
        const simClip = frame.anim[i]!;
        const v = this.variation.apply(
          frame.id[i]!,
          x,
          z,
          simClip <= ANIM.death ? simClip : ANIM.idle,
          frame.animT[i]!,
          frame.yaw[i]!,
          asset.idleS,
          nowMs,
        );
        const yaw = v.yaw;
        rigidPose(asset.motion, v.clip, v.t, time, v.seed / SEED_RANGE, pose);
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
        const inspected = (flags & INSPECTED_FLAG) !== 0;
        const blob = this.shadow
          ? selected
            ? inspected
              ? CONTACT_INSPECTED
              : CONTACT_SELECTED
            : CONTACT
          : selected
            ? inspected
              ? BLOB_INSPECTED
              : BLOB_SELECTED
            : BLOB;
        decals.push(x, z, asset.blobHalf, asset.blobHalf, blob);
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
