// Units on screen: one instanced draw call per rig per LOD. Blob shadows and selection rings go to the shared DecalLayer.
// Only typeIds classified as units (or unknown) are drawn here; buildings, scrap nodes and claims have their own layer.
// Rig 0 is the procedural placeholder (bake.ts, humanoidGeometry.ts); loaded assets add rigs (addRig) and take over
// unit typeIds (assignRig) or every unit without its own rig (setDefaultRig).
import { ANIM, ENTITY_FLAG } from '@crawlout/protocol';
import { DynamicDrawUsage, Frustum, InstancedBufferAttribute, Matrix4, Mesh, Sphere, Vector3, type BufferGeometry, type Camera, type MeshBasicNodeMaterial, type Scene, type Texture } from 'three/webgpu';
import { DECAL_COLOR, DECAL_SHAPE, type DecalLayer, type DecalStyle } from '../decals/decalLayer.js';
import { drawsAsUnit, TYPE_ID_BUILDING_FIRST } from '../entities/typeIds.js';
import type { DataTexturePrecision } from '../gpu/dataTextures.js';
import { teamIndex } from '../palette.js';
import type { InterpolatedFrame } from '../snapshot/interpolate.js';
import { bakeAnimations, type BakedAnimations } from './bake.js';
import { createHumanoidGeometry, UNIT_LODS } from './humanoidGeometry.js';
import { createUnitMaterial, type UnitAlbedo } from './unitMaterial.js';

export interface UnitLayerOptions {
  capacity: number;
  /** Camera distance (m) where LOD1 and LOD2 start. */
  lodDistances?: readonly [number, number];
  lightDir: Vector3;
  /** Bone and clip texture precision (gpu/dataTextures.ts). Default float. */
  precision?: DataTexturePrecision;
  /** Pre-baked clips for the placeholder rig; baked from the procedural rig when absent. */
  anims?: BakedAnimations;
}

/** A rig the layer can draw: baked clips plus one geometry per LOD in the unit vertex layout. */
export interface UnitRigSource {
  name: string;
  anims: BakedAnimations;
  lods: readonly [BufferGeometry, BufferGeometry, BufferGeometry];
  albedo?: UnitAlbedo;
}

interface LodBatch {
  mesh: Mesh;
  pose: InstancedBufferAttribute;
  anim: InstancedBufferAttribute;
}

interface Rig {
  name: string;
  anims: BakedAnimations;
  material: MeshBasicNodeMaterial;
  textures: Texture[];
  geometries: BufferGeometry[];
  lods: LodBatch[];
}

const UNIT_RADIUS = 1.0; // culling sphere around a unit's chest, meters
const SELECTED = ENTITY_FLAG.selected;
const DEAD = ENTITY_FLAG.dead;
const DECAL_HALF = 0.8; // meters
/** No rig of its own: the typeId uses the default rig. */
const DEFAULT_RIG = 255;
export const PLACEHOLDER_RIG = 0;

const BLOB: DecalStyle = { shape: DECAL_SHAPE.circle, shadow: 1, ring: 0, ringWidth: 0.14, fill: 0, grid: 0, color: DECAL_COLOR.selection };
const BLOB_SELECTED: DecalStyle = { ...BLOB, ring: 1 };

function dynamic(capacity: number, size: number): InstancedBufferAttribute {
  const a = new InstancedBufferAttribute(new Float32Array(capacity * size), size);
  a.setUsage(DynamicDrawUsage);
  return a;
}

function markUsed(a: InstancedBufferAttribute, count: number): void {
  a.clearUpdateRanges();
  a.addUpdateRange(0, Math.max(1, count) * a.itemSize);
  a.needsUpdate = true;
}

export class UnitLayer {
  private readonly rigs: Rig[] = [];
  private readonly scene: Scene;
  private readonly capacity: number;
  private readonly lightDir: Vector3;
  private readonly precision: DataTexturePrecision;
  private readonly lodDist2: [number, number];
  private readonly frustum = new Frustum();
  private readonly projView = new Matrix4();
  private readonly sphere = new Sphere();
  /** Rig per unit typeId (1..1023), DEFAULT_RIG when the typeId has none of its own. */
  private readonly rigByType = new Uint8Array(TYPE_ID_BUILDING_FIRST).fill(DEFAULT_RIG);
  private defaultRig = PLACEHOLDER_RIG;
  /** Instances drawn per LOD (all rigs together) in the last update. */
  readonly lodCounts: [number, number, number] = [0, 0, 0];

  constructor(scene: Scene, opts: UnitLayerOptions) {
    this.scene = scene;
    this.capacity = opts.capacity;
    this.lightDir = opts.lightDir;
    this.precision = opts.precision ?? 'float';
    const [d1, d2] = opts.lodDistances ?? [30, 70];
    this.lodDist2 = [d1 * d1, d2 * d2];
    const anims = opts.anims ?? bakeAnimations();
    this.addRig({ name: 'placeholder', anims, lods: [createHumanoidGeometry(0), createHumanoidGeometry(1), createHumanoidGeometry(2)] });
  }

  /** Baked clips of the placeholder rig. */
  get anims(): BakedAnimations {
    return this.rigs[PLACEHOLDER_RIG]!.anims;
  }

  /** Clip count in the placeholder's baked set; anim ids at or above a rig's clip count fall back to ANIM.idle. */
  get clipCount(): number {
    return this.anims.clips.length;
  }

  get rigCount(): number {
    return this.rigs.length;
  }

  rigName(rig: number): string | undefined {
    return this.rigs[rig]?.name;
  }

  /** Adds a rig and returns its index. The geometries are owned (and disposed) by the layer from here on. */
  addRig(src: UnitRigSource): number {
    if (this.rigs.length >= DEFAULT_RIG) throw new Error('too many unit rigs');
    const index = this.rigs.length;
    const bundle = createUnitMaterial(src.anims, { lightDir: this.lightDir }, this.precision, src.albedo ?? {});
    const geometries = [...src.lods];
    const lods = UNIT_LODS.map((lod) => {
      const geo = geometries[lod]!;
      const pose = dynamic(this.capacity, 4);
      const anim = dynamic(this.capacity, 4);
      geo.setAttribute('iPose', pose);
      geo.setAttribute('iAnim', anim);
      const mesh = new Mesh(geo, bundle.material);
      mesh.name = `units-${src.name}-lod${lod}`;
      mesh.frustumCulled = false; // culled per instance on the CPU
      mesh.count = 0;
      mesh.visible = false;
      this.scene.add(mesh);
      return { mesh, pose, anim };
    });
    const textures = src.albedo?.map ? [...bundle.textures, src.albedo.map] : bundle.textures;
    this.rigs.push({ name: src.name, anims: src.anims, material: bundle.material, textures, geometries, lods });
    return index;
  }

  /** Draws these unit typeIds with `rig`; null hands them back to the default rig. */
  assignRig(typeIds: Iterable<number>, rig: number | null): void {
    if (rig !== null && !this.rigs[rig]) throw new Error(`no unit rig ${rig}`);
    for (const t of typeIds) if (t > 0 && t < this.rigByType.length) this.rigByType[t] = rig ?? DEFAULT_RIG;
  }

  /** The rig for unit typeIds without one of their own (the placeholder until an asset says otherwise). */
  setDefaultRig(rig: number): void {
    if (!this.rigs[rig]) throw new Error(`no unit rig ${rig}`);
    this.defaultRig = rig;
  }

  /** Rig a typeId is drawn with. */
  rigFor(typeId: number): number {
    const own = typeId > 0 && typeId < this.rigByType.length ? this.rigByType[typeId]! : DEFAULT_RIG;
    return own === DEFAULT_RIG ? this.defaultRig : own;
  }

  /** LOD index for a squared camera distance. */
  private lodFor(distanceSq: number): number {
    if (distanceSq < this.lodDist2[0]) return 0;
    if (distanceSq < this.lodDist2[1]) return 1;
    return 2;
  }

  /** Distributes the units in the frame over the rig and LOD batches. `frame.y` must already hold terrain heights. */
  update(frame: InterpolatedFrame, camera: Camera, decals: DecalLayer): void {
    this.projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projView);
    const cam = camera.position;
    const counts = this.lodCounts;
    counts[0] = counts[1] = counts[2] = 0;
    for (const rig of this.rigs) for (const b of rig.lods) b.mesh.count = 0;
    const center = this.sphere.center;
    this.sphere.radius = UNIT_RADIUS;

    for (let i = 0; i < frame.count; i++) {
      const typeId = frame.typeId[i]!;
      if (!drawsAsUnit(typeId)) continue;
      const x = frame.x[i]!;
      const y = frame.y[i]!;
      const z = frame.z[i]!;
      center.set(x, y + 0.9, z);
      if (!this.frustum.intersectsSphere(this.sphere)) continue;
      const dx = x - cam.x;
      const dy = y - cam.y;
      const dz = z - cam.z;
      const lod = this.lodFor(dx * dx + dy * dy + dz * dz);
      const rig = this.rigs[this.rigFor(typeId)]!;
      const batch = rig.lods[lod]!;
      const k = batch.mesh.count;
      if (k >= this.capacity) continue;
      batch.mesh.count = k + 1;
      counts[lod] = counts[lod]! + 1;
      const pose = batch.pose.array as Float32Array;
      const anim = batch.anim.array as Float32Array;
      const flags = frame.flags[i]!;
      const clip = frame.anim[i]!;
      pose[k * 4] = x;
      pose[k * 4 + 1] = y;
      pose[k * 4 + 2] = z;
      pose[k * 4 + 3] = frame.yaw[i]!;
      anim[k * 4] = clip < rig.anims.clips.length ? clip : ANIM.idle;
      anim[k * 4 + 1] = frame.animT[i]!;
      anim[k * 4 + 2] = teamIndex(frame.owner[i]!);
      anim[k * 4 + 3] = flags;

      const selected = (flags & SELECTED) !== 0 && (flags & DEAD) === 0;
      decals.push(x, z, DECAL_HALF, DECAL_HALF, selected ? BLOB_SELECTED : BLOB);
    }

    for (const rig of this.rigs) {
      for (const b of rig.lods) {
        const n = b.mesh.count;
        b.mesh.visible = n > 0;
        if (n > 0) {
          markUsed(b.pose, n);
          markUsed(b.anim, n);
        }
      }
    }
  }

  dispose(): void {
    for (const rig of this.rigs) {
      for (const b of rig.lods) b.mesh.removeFromParent();
      for (const g of rig.geometries) g.dispose();
      for (const t of rig.textures) t.dispose();
      rig.material.dispose();
    }
    this.rigs.length = 0;
  }
}

/** Shared light direction for units and terrain: low sun from the south-west, like the bake in the textures will be. */
export const DEFAULT_LIGHT_DIR = new Vector3(-0.45, 0.8, 0.35).normalize();
