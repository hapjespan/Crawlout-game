// Units on screen: one instanced draw call per rig per LOD. Blob shadows and selection rings go to the shared DecalLayer.
// Only typeIds classified as units (or unknown) are drawn here; buildings, scrap nodes and claims have their own layer.
// Rig 0 is the procedural placeholder (bake.ts, humanoidGeometry.ts); loaded assets add rigs (addRig) and take over
// unit typeIds (assignRig) or every unit without its own rig (setDefaultRig). A hero (typeId 1000 + heroId) uses the
// default rig with a hero flag per instance: bigger, and on the placeholder with cap, collar and pauldrons.
// Unit typeIds that the rigid layer owns (robots, rigidUnitLayer.ts) are skipped here: setSkip().
// Attachments (weapon, tool, gear, armor; attachmentSockets.ts) are extra instanced meshes of a rig, skinned to one bone
// of the body and drawn with the same bone texture and per-instance pose and anim as the body: one draw per attachment
// asset (both LODs in one mesh, the instance says which: attachmentGeometry.ts mergeAttachmentLods), whatever the
// number of units that carry it. addAttachment registers one, assignAttachments gives it to unit typeIds. The nearest
// ATTACHMENT_LODS unit LODs show them; the far LOD does not.
import { heroIdOfTypeId } from '@crawlout/data';
import { ANIM, ENTITY_FLAG } from '@crawlout/protocol';
import {
  DynamicDrawUsage,
  Frustum,
  InstancedBufferAttribute,
  Matrix4,
  Mesh,
  Sphere,
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
import { drawsAsUnit, TYPE_ID_BUILDING_FIRST } from '../entities/typeIds.js';
import type { DataTexturePrecision } from '../gpu/dataTextures.js';
import { ScreenLod, UNIT_LOD_PX, type ScreenLodThresholds } from '../lod/screenLod.js';
import { INSPECTED_FLAG } from '../entities/inspected.js';
import { teamIndex } from '../palette.js';
import type { InterpolatedFrame } from '../snapshot/interpolate.js';
import { SUN_DIR } from '../lighting/lightRig.js';
import type { SunShadowTerm } from '../shadows/sunShadow.js';
import { InstanceVariation } from './animVariation.js';
import { bakeAnimations, type BakedAnimations } from './bake.js';
import { createHumanoidGeometry, UNIT_LODS } from './humanoidGeometry.js';
import {
  ATTACHMENT_LOD_STEP,
  createUnitMaterial,
  HERO_INSTANCE_FLAG,
  HERO_SCALE,
  TEAM_SLOTS,
  type UnitAlbedo,
} from './unitMaterial.js';

export interface UnitLayerOptions {
  capacity: number;
  /** Screen-size LOD (lod/screenLod.ts), shared with the other layers; the renderer feeds it the viewport. */
  screen?: ScreenLod;
  /** Projected heights (device px) below which LOD 1 and LOD 2 draw. Default UNIT_LOD_PX. */
  lodPixels?: ScreenLodThresholds;
  lightDir: Vector3;
  /** Bone and clip texture precision (gpu/dataTextures.ts). Default float. */
  precision?: DataTexturePrecision;
  /** Pre-baked clips for the placeholder rig; baked from the procedural rig when absent. */
  anims?: BakedAnimations;
  /**
   * The sun's shadow (shadows/sunShadow.ts): units cast it and receive it, and their blob decal drops to a faint
   * contact darkening (BLOB_WITH_SHADOW) that keeps them grounded at RTS distance. Without it, the full blob.
   */
  shadow?: SunShadowTerm | null;
}

/** A rig the layer can draw: baked clips plus one geometry per LOD in the unit vertex layout. */
export interface UnitRigSource {
  name: string;
  anims: BakedAnimations;
  lods: readonly [BufferGeometry, BufferGeometry, BufferGeometry];
  albedo?: UnitAlbedo;
}

/**
 * A prop carried by a rig's units: its LOD 0 and 1 in one geometry in the unit vertex layout, skinned to one bone
 * (attachmentGeometry.ts mergeAttachmentLods), drawn with the bone and clip textures of `rig`.
 */
export interface AttachmentSource {
  name: string;
  /** The rig whose animation it follows; only units drawn with this rig show it. */
  rig: number;
  geometry: BufferGeometry;
  /** Diffuse atlas when the prop has one; the rest of the material is the rig's attachment material. */
  albedo?: UnitAlbedo;
}

/** Unit LODs that show attachments: 0 and 1. The far LOD drops them (a weapon is a pixel there, the draw call is not). */
export const ATTACHMENT_LODS = 2;

interface LodBatch {
  mesh: Mesh;
  pose: InstancedBufferAttribute;
  anim: InstancedBufferAttribute;
}

interface Attachment {
  name: string;
  rig: number;
  batch: LodBatch;
  geometry: BufferGeometry;
  /** Set for an attachment with its own atlas; otherwise the rig's shared attachment material is used. */
  ownMaterial: MeshBasicNodeMaterial | null;
  textures: Texture[];
}

interface Rig {
  name: string;
  /** Model height (m) of LOD 0 in its rest pose: the size for the screen-size LOD. */
  height: number;
  anims: BakedAnimations;
  /** Duration (s) of each clip by clip id: the pace of the looping work clips (animVariation.ts). */
  clipSeconds: number[];
  material: MeshBasicNodeMaterial;
  textures: Texture[];
  /** The bone and clip textures of `material`, shared by this rig's attachment materials. */
  dataTextures: { boneTex: Texture; clipTex: Texture };
  /** Material of the attachments of this rig that have no atlas of their own (made on first use). */
  attachmentMaterial: MeshBasicNodeMaterial | null;
  geometries: BufferGeometry[];
  lods: LodBatch[];
}

/** Anisotropic filtering of a unit asset's diffuse atlas. */
export const UNIT_ATLAS_ANISOTROPY = 8;
const UNIT_RADIUS = 1.0; // culling sphere around a unit's chest, meters
/**
 * With shadows the culling sphere is this big: a unit just outside the view still casts its shadow into it (a 1.8 m
 * settler under the 40 degree sun throws about 2.2 m).
 */
const UNIT_SHADOW_RADIUS = 3.2;
/** Blob strength under a unit when the real shadow is on: a contact darkening, not a second shadow. */
export const BLOB_WITH_SHADOW = 0.45;
const SELECTED = ENTITY_FLAG.selected;
const DEAD = ENTITY_FLAG.dead;
const DECAL_HALF = 0.8; // meters
/** No rig of its own: the typeId uses the default rig. */
const DEFAULT_RIG = 255;
export const PLACEHOLDER_RIG = 0;

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
const CONTACT: DecalStyle = { ...BLOB, shadow: BLOB_WITH_SHADOW };
const CONTACT_SELECTED: DecalStyle = { ...CONTACT, ring: 1 };
const BLOB_INSPECTED: DecalStyle = { ...BLOB_SELECTED, color: DECAL_COLOR.invalid };
const CONTACT_INSPECTED: DecalStyle = { ...CONTACT_SELECTED, color: DECAL_COLOR.invalid };

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
  private readonly attachments: Attachment[] = [];
  /** Attachments per unit typeId (assignAttachments); undefined when the typeId carries none. */
  private readonly attachmentsByType: (Attachment[] | undefined)[] = new Array<
    Attachment[] | undefined
  >(TYPE_ID_BUILDING_FIRST).fill(undefined);
  private readonly scene: Scene;
  private readonly capacity: number;
  private readonly lightDir: Vector3;
  private readonly precision: DataTexturePrecision;
  private readonly screen: ScreenLod;
  private readonly lodPixels: ScreenLodThresholds;
  private readonly shadow: SunShadowTerm | null;
  private readonly blob: DecalStyle;
  private readonly blobSelected: DecalStyle;
  private readonly blobInspected: DecalStyle;
  private readonly frustum = new Frustum();
  private readonly projView = new Matrix4();
  private readonly sphere = new Sphere();
  /** Rig per unit typeId (1..1023), DEFAULT_RIG when the typeId has none of its own. */
  private readonly rigByType = new Uint8Array(TYPE_ID_BUILDING_FIRST).fill(DEFAULT_RIG);
  private defaultRig = PLACEHOLDER_RIG;
  /** Unit typeIds drawn by another layer (the rigid robots); this layer skips them. */
  private skip: ((typeId: number) => boolean) | null = null;
  /** Per-entity animation phase, rate, start delay and turn smoothing (animVariation.ts). */
  private readonly variation = new InstanceVariation();
  /** Instances drawn per LOD (all rigs together) in the last update. */
  readonly lodCounts: [number, number, number] = [0, 0, 0];
  /** Attachment instances drawn in the last update (all attachments, both LODs together). */
  attachmentInstances = 0;

  constructor(scene: Scene, opts: UnitLayerOptions) {
    this.scene = scene;
    this.capacity = opts.capacity;
    this.lightDir = opts.lightDir;
    this.precision = opts.precision ?? 'float';
    this.screen = opts.screen ?? new ScreenLod();
    this.lodPixels = opts.lodPixels ?? UNIT_LOD_PX;
    this.shadow = opts.shadow ?? null;
    this.blob = this.shadow ? CONTACT : BLOB;
    this.blobSelected = this.shadow ? CONTACT_SELECTED : BLOB_SELECTED;
    this.blobInspected = this.shadow ? CONTACT_INSPECTED : BLOB_INSPECTED;
    const anims = opts.anims ?? bakeAnimations();
    this.addRig({
      name: 'placeholder',
      anims,
      lods: [createHumanoidGeometry(0), createHumanoidGeometry(1), createHumanoidGeometry(2)],
    });
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
    // GLTFLoader leaves anisotropy at 1: the atlas on a unit's sides, seen 50 to 74 degrees from above, blurred to a
    // smear in the mip chain. Same level as the terrain albedo.
    const map = src.albedo?.map;
    if (map) map.anisotropy = Math.max(map.anisotropy, UNIT_ATLAS_ANISOTROPY);
    const bundle = createUnitMaterial(
      src.anims,
      { lightDir: this.lightDir, shadow: this.shadow },
      this.precision,
      src.albedo ?? {},
    );
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
      // The coarsest LOD (under about 30 px tall) leaves the shadow pass: its shadow is a few pixels, the draw call is not.
      mesh.castShadow = this.shadow !== null && lod < UNIT_LODS[UNIT_LODS.length - 1]!;
      mesh.count = 0;
      mesh.visible = false;
      this.scene.add(mesh);
      return { mesh, pose, anim };
    });
    const textures = src.albedo?.map ? [...bundle.textures, src.albedo.map] : bundle.textures;
    const lod0 = geometries[0]!;
    if (!lod0.boundingBox) lod0.computeBoundingBox();
    const box = lod0.boundingBox!;
    const height =
      Number.isFinite(box.max.y - box.min.y) && box.max.y > box.min.y ? box.max.y - box.min.y : 1.8;
    this.rigs.push({
      name: src.name,
      height: Math.min(4, Math.max(1, height)),
      anims: src.anims,
      clipSeconds: src.anims.clips.map((c) => c.duration),
      material: bundle.material,
      textures,
      dataTextures: { boneTex: bundle.boneTex, clipTex: bundle.clipTex },
      attachmentMaterial: null,
      geometries,
      lods,
    });
    return index;
  }

  get attachmentCount(): number {
    return this.attachments.length;
  }

  /** Adds an attachment and returns its handle. The geometries are owned (and disposed) by the layer from here on. */
  addAttachment(src: AttachmentSource): number {
    const rig = this.rigs[src.rig];
    if (!rig) throw new Error(`no unit rig ${src.rig}`);
    const map = src.albedo?.map ?? null;
    let material: MeshBasicNodeMaterial;
    let ownMaterial: MeshBasicNodeMaterial | null = null;
    if (map) {
      map.anisotropy = Math.max(map.anisotropy, UNIT_ATLAS_ANISOTROPY);
      ownMaterial = createUnitMaterial(
        rig.anims,
        { lightDir: this.lightDir, shadow: this.shadow },
        this.precision,
        src.albedo ?? {},
        { shared: rig.dataTextures, attachment: true },
      ).material;
      material = ownMaterial;
    } else {
      rig.attachmentMaterial ??= createUnitMaterial(
        rig.anims,
        { lightDir: this.lightDir, shadow: this.shadow },
        this.precision,
        {},
        { shared: rig.dataTextures, attachment: true },
      ).material;
      material = rig.attachmentMaterial;
    }
    const geo = src.geometry;
    const pose = dynamic(this.capacity, 4);
    const anim = dynamic(this.capacity, 4);
    geo.setAttribute('iPose', pose);
    geo.setAttribute('iAnim', anim);
    const mesh = new Mesh(geo, material);
    mesh.name = `units-${rig.name}-${src.name}`;
    mesh.frustumCulled = false; // culled per instance on the CPU, with the body
    mesh.castShadow = this.shadow !== null; // the far LOD, the only one left out of the shadow pass, has no attachments
    mesh.count = 0;
    mesh.visible = false;
    this.scene.add(mesh);
    this.attachments.push({
      name: src.name,
      rig: src.rig,
      batch: { mesh, pose, anim },
      geometry: geo,
      ownMaterial,
      textures: map ? [map] : [],
    });
    return this.attachments.length - 1;
  }

  /** Gives these unit typeIds the attachments (handles from addAttachment); an empty list takes them all away. */
  assignAttachments(typeIds: Iterable<number>, handles: readonly number[]): void {
    const list = handles.map((h) => {
      const a = this.attachments[h];
      if (!a) throw new Error(`no attachment ${h}`);
      return a;
    });
    for (const t of typeIds)
      if (t > 0 && t < this.attachmentsByType.length)
        this.attachmentsByType[t] = list.length > 0 ? list : undefined;
  }

  /** Attachment names a typeId carries (tests, the status line of the demo). */
  attachmentNamesOf(typeId: number): string[] {
    return (this.attachmentsByType[typeId] ?? []).map((a) => a.name);
  }

  /** Draws these unit typeIds with `rig`; null hands them back to the default rig. */
  assignRig(typeIds: Iterable<number>, rig: number | null): void {
    if (rig !== null && !this.rigs[rig]) throw new Error(`no unit rig ${rig}`);
    for (const t of typeIds)
      if (t > 0 && t < this.rigByType.length) this.rigByType[t] = rig ?? DEFAULT_RIG;
  }

  /** The rig for unit typeIds without one of their own (the placeholder until an asset says otherwise). */
  setDefaultRig(rig: number): void {
    if (!this.rigs[rig]) throw new Error(`no unit rig ${rig}`);
    this.defaultRig = rig;
  }

  /** typeIds for which `skip` returns true are left to another layer; null draws every unit again. */
  setSkip(skip: ((typeId: number) => boolean) | null): void {
    this.skip = skip;
  }

  /** Rig a typeId is drawn with. */
  rigFor(typeId: number): number {
    const own =
      typeId > 0 && typeId < this.rigByType.length ? this.rigByType[typeId]! : DEFAULT_RIG;
    return own === DEFAULT_RIG ? this.defaultRig : own;
  }

  /** Distributes the units in the frame over the rig and LOD batches. `frame.y` must already hold terrain heights. */
  update(
    frame: InterpolatedFrame,
    camera: Camera,
    decals: DecalLayer,
    nowMs: number = performance.now(),
  ): void {
    this.projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projView);
    const cam = camera.position;
    const counts = this.lodCounts;
    counts[0] = counts[1] = counts[2] = 0;
    for (const rig of this.rigs) for (const b of rig.lods) b.mesh.count = 0;
    for (const a of this.attachments) a.batch.mesh.count = 0;
    const center = this.sphere.center;
    this.sphere.radius = this.shadow ? UNIT_SHADOW_RADIUS : UNIT_RADIUS;

    for (let i = 0; i < frame.count; i++) {
      const typeId = frame.typeId[i]!;
      if (!drawsAsUnit(typeId) || this.skip?.(typeId)) continue;
      const x = frame.x[i]!;
      const y = frame.y[i]!;
      const z = frame.z[i]!;
      center.set(x, y + 0.9, z);
      if (!this.frustum.intersectsSphere(this.sphere)) continue;
      const dx = x - cam.x;
      const dy = y - cam.y;
      const dz = z - cam.z;
      const rigIndex = this.rigFor(typeId);
      const rig = this.rigs[rigIndex]!;
      const isHero = heroIdOfTypeId(typeId) >= 0;
      const size = isHero ? rig.height * HERO_SCALE : rig.height;
      const lod = this.screen.lod(size, Math.sqrt(dx * dx + dy * dy + dz * dz), this.lodPixels);
      const batch = rig.lods[lod]!;
      const k = batch.mesh.count;
      if (k >= this.capacity) continue;
      batch.mesh.count = k + 1;
      counts[lod] = counts[lod]! + 1;
      const pose = batch.pose.array as Float32Array;
      const anim = batch.anim.array as Float32Array;
      const flags = frame.flags[i]!;
      const simClip = frame.anim[i]!;
      const v = this.variation.apply(
        frame.id[i]!,
        x,
        z,
        simClip < rig.anims.clips.length ? simClip : ANIM.idle,
        frame.animT[i]!,
        frame.yaw[i]!,
        rig.anims.clips[ANIM.idle]?.duration ?? 1,
        nowMs,
        rig.clipSeconds,
      );
      pose[k * 4] = x;
      pose[k * 4 + 1] = y;
      pose[k * 4 + 2] = z;
      pose[k * 4 + 3] = v.yaw;
      anim[k * 4] = v.clip;
      anim[k * 4 + 1] = v.t;
      // Team slot in the low bits, the static per-instance variation seed above them (see unitMaterial.ts).
      anim[k * 4 + 2] = teamIndex(frame.owner[i]!) + TEAM_SLOTS * v.seed;
      anim[k * 4 + 3] = isHero ? flags + HERO_INSTANCE_FLAG : flags;
      if (lod < ATTACHMENT_LODS) {
        // The attachments take the body's instance as it is: same pose, clip, phase, team slot and variation seed. The
        // unit's LOD rides above the seed (the shader shows that LOD of the prop and collapses the other one).
        const carried = this.attachmentsByType[typeId];
        if (carried)
          for (const a of carried) {
            if (a.rig !== rigIndex) continue;
            const ab = a.batch;
            const j = ab.mesh.count;
            if (j >= this.capacity) continue;
            ab.mesh.count = j + 1;
            const ap = ab.pose.array as Float32Array;
            const aa = ab.anim.array as Float32Array;
            for (let c = 0; c < 4; c++) {
              ap[j * 4 + c] = pose[k * 4 + c]!;
              aa[j * 4 + c] = anim[k * 4 + c]!;
            }
            aa[j * 4 + 2] = anim[k * 4 + 2]! + lod * ATTACHMENT_LOD_STEP;
          }
      }

      const selected = (flags & SELECTED) !== 0 && (flags & DEAD) === 0;
      const half = isHero ? DECAL_HALF * HERO_SCALE : DECAL_HALF;
      const ring = (flags & INSPECTED_FLAG) !== 0 ? this.blobInspected : this.blobSelected;
      decals.push(x, z, half, half, selected ? ring : this.blob);
    }

    const publish = (b: LodBatch): number => {
      const n = b.mesh.count;
      b.mesh.visible = n > 0;
      if (n > 0) {
        markUsed(b.pose, n);
        markUsed(b.anim, n);
      }
      return n;
    };
    for (const rig of this.rigs) for (const b of rig.lods) publish(b);
    let attached = 0;
    for (const a of this.attachments) attached += publish(a.batch);
    this.attachmentInstances = attached;
  }

  dispose(): void {
    for (const a of this.attachments) {
      a.batch.mesh.removeFromParent();
      a.geometry.dispose();
      for (const t of a.textures) t.dispose();
      a.ownMaterial?.dispose();
    }
    this.attachments.length = 0;
    this.attachmentsByType.fill(undefined);
    for (const rig of this.rigs) {
      rig.attachmentMaterial?.dispose();
      for (const b of rig.lods) b.mesh.removeFromParent();
      for (const g of rig.geometries) g.dispose();
      for (const t of rig.textures) t.dispose();
      rig.material.dispose();
    }
    this.rigs.length = 0;
  }
}

/** Shared light direction for every toon material: the rig's sun (lighting/lightRig.ts). */
export const DEFAULT_LIGHT_DIR: Vector3 = SUN_DIR;
