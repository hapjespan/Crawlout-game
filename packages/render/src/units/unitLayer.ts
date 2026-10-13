// Units on screen: one instanced draw call per LOD. Blob shadows and selection rings go to the shared DecalLayer.
// Only typeIds classified as units (or unknown) are drawn here; buildings, scrap nodes and claims have their own layer.
import { ANIM, ENTITY_FLAG } from '@crawlout/protocol';
import { DynamicDrawUsage, Frustum, InstancedBufferAttribute, Matrix4, Mesh, Sphere, Vector3, type BufferGeometry, type Camera, type MeshBasicNodeMaterial, type Scene, type Texture } from 'three/webgpu';
import { DECAL_COLOR, DECAL_SHAPE, type DecalLayer, type DecalStyle } from '../decals/decalLayer.js';
import { drawsAsUnit } from '../entities/typeIds.js';
import type { DataTexturePrecision } from '../gpu/dataTextures.js';
import { teamIndex } from '../palette.js';
import type { InterpolatedFrame } from '../snapshot/interpolate.js';
import { bakeAnimations, type BakedAnimations } from './bake.js';
import { createHumanoidGeometry, UNIT_LODS } from './humanoidGeometry.js';
import { createUnitMaterial } from './unitMaterial.js';

export interface UnitLayerOptions {
  capacity: number;
  /** Camera distance (m) where LOD1 and LOD2 start. */
  lodDistances?: readonly [number, number];
  lightDir: Vector3;
  /** Bone and clip texture precision (gpu/dataTextures.ts). Default float. */
  precision?: DataTexturePrecision;
  /** Pre-baked clips; baked from the placeholder rig when absent. */
  anims?: BakedAnimations;
}

interface LodBatch {
  mesh: Mesh;
  pose: InstancedBufferAttribute;
  anim: InstancedBufferAttribute;
}

const UNIT_RADIUS = 1.0; // culling sphere around a unit's chest, meters
const SELECTED = ENTITY_FLAG.selected;
const DEAD = ENTITY_FLAG.dead;
const DECAL_HALF = 0.8; // meters

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
  readonly anims: BakedAnimations;
  private readonly lods: LodBatch[];
  private readonly textures: Texture[];
  private readonly geometries: BufferGeometry[] = [];
  private readonly lodDist2: [number, number];
  private readonly frustum = new Frustum();
  private readonly projView = new Matrix4();
  private readonly sphere = new Sphere();
  private readonly unitMaterial: MeshBasicNodeMaterial;
  /** Instances drawn per LOD in the last update. */
  readonly lodCounts: [number, number, number] = [0, 0, 0];

  constructor(scene: Scene, opts: UnitLayerOptions) {
    const cap = opts.capacity;
    const [d1, d2] = opts.lodDistances ?? [30, 70];
    this.lodDist2 = [d1 * d1, d2 * d2];
    this.anims = opts.anims ?? bakeAnimations();
    const bundle = createUnitMaterial(this.anims, { lightDir: opts.lightDir }, opts.precision ?? 'float');
    this.unitMaterial = bundle.material;
    this.textures = bundle.textures;

    this.lods = UNIT_LODS.map((lod) => {
      const geo = createHumanoidGeometry(lod);
      const pose = dynamic(cap, 4);
      const anim = dynamic(cap, 4);
      geo.setAttribute('iPose', pose);
      geo.setAttribute('iAnim', anim);
      this.geometries.push(geo);
      const mesh = new Mesh(geo, this.unitMaterial);
      mesh.name = `units-lod${lod}`;
      mesh.frustumCulled = false; // culled per instance on the CPU
      mesh.count = 0;
      mesh.visible = false;
      scene.add(mesh);
      return { mesh, pose, anim };
    });
  }

  /** Clip count in the baked animation set; anim ids at or above it fall back to ANIM.idle. */
  get clipCount(): number {
    return this.anims.clips.length;
  }

  /** LOD index for a squared camera distance. */
  private lodFor(distanceSq: number): number {
    if (distanceSq < this.lodDist2[0]) return 0;
    if (distanceSq < this.lodDist2[1]) return 1;
    return 2;
  }

  /** Distributes the units in the frame over the LOD batches. `frame.y` must already hold terrain heights. */
  update(frame: InterpolatedFrame, camera: Camera, decals: DecalLayer): void {
    this.projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projView);
    const cam = camera.position;
    const counts = this.lodCounts;
    counts[0] = counts[1] = counts[2] = 0;
    const clipCount = this.clipCount;
    const center = this.sphere.center;
    this.sphere.radius = UNIT_RADIUS;

    for (let i = 0; i < frame.count; i++) {
      if (!drawsAsUnit(frame.typeId[i]!)) continue;
      const x = frame.x[i]!;
      const y = frame.y[i]!;
      const z = frame.z[i]!;
      center.set(x, y + 0.9, z);
      if (!this.frustum.intersectsSphere(this.sphere)) continue;
      const dx = x - cam.x;
      const dy = y - cam.y;
      const dz = z - cam.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      const lod = this.lodFor(d2);
      const batch = this.lods[lod]!;
      const k = counts[lod]!;
      counts[lod] = k + 1;
      const pose = batch.pose.array as Float32Array;
      const anim = batch.anim.array as Float32Array;
      const flags = frame.flags[i]!;
      const clip = frame.anim[i]!;
      pose[k * 4] = x;
      pose[k * 4 + 1] = y;
      pose[k * 4 + 2] = z;
      pose[k * 4 + 3] = frame.yaw[i]!;
      anim[k * 4] = clip < clipCount ? clip : ANIM.idle;
      anim[k * 4 + 1] = frame.animT[i]!;
      anim[k * 4 + 2] = teamIndex(frame.owner[i]!);
      anim[k * 4 + 3] = flags;

      const selected = (flags & SELECTED) !== 0 && (flags & DEAD) === 0;
      decals.push(x, z, DECAL_HALF, DECAL_HALF, selected ? BLOB_SELECTED : BLOB);
    }

    this.lods.forEach((b, lod) => {
      const n = counts[lod]!;
      b.mesh.count = n;
      b.mesh.visible = n > 0;
      if (n > 0) {
        markUsed(b.pose, n);
        markUsed(b.anim, n);
      }
    });
  }

  dispose(): void {
    for (const b of this.lods) b.mesh.removeFromParent();
    for (const g of this.geometries) g.dispose();
    for (const t of this.textures) t.dispose();
    this.unitMaterial.dispose();
  }
}

/** Shared light direction for units and terrain: low sun from the south-west, like the bake in the textures will be. */
export const DEFAULT_LIGHT_DIR = new Vector3(-0.45, 0.8, 0.35).normalize();
