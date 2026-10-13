// Units on screen: one instanced draw call per LOD, plus one instanced draw call for all ground decals
// (blob shadow under every unit, selection ring under selected ones).
import { ENTITY_FLAG, MAX_PLAYERS } from '@crawlout/protocol';
import {
  Color,
  DynamicDrawUsage,
  Frustum,
  InstancedBufferAttribute,
  Matrix4,
  Mesh,
  MeshBasicNodeMaterial,
  PlaneGeometry,
  Sphere,
  Vector3,
  type BufferGeometry,
  type Camera,
  type Scene,
  type Texture,
} from 'three/webgpu';
import { attribute, float, length, max, mix, positionLocal, smoothstep, uv, vec2, vec3, vec4 } from 'three/tsl';
import type { InterpolatedFrame } from '../snapshot/interpolate.js';
import { bakeAnimations, type BakedAnimations } from './bake.js';
import { createHumanoidGeometry, UNIT_LODS } from './humanoidGeometry.js';
import { createUnitMaterial } from './unitMaterial.js';

/** Team colors per owner (sRGB). Visual only; the sim never sees them. */
export const TEAM_COLORS: readonly number[] = [0x2f7fe0, 0xd8402f, 0x3fae4a, 0xe0b52a, 0x9b4fd0, 0x2fc2c2, 0xe07a2a, 0xd0d0d0];

export interface UnitLayerOptions {
  capacity: number;
  /** Camera distance (m) where LOD1 and LOD2 start. */
  lodDistances?: readonly [number, number];
  lightDir: Vector3;
}

interface LodBatch {
  mesh: Mesh;
  pose: InstancedBufferAttribute;
  anim: InstancedBufferAttribute;
}

const UNIT_RADIUS = 1.0; // culling sphere around a unit's chest, meters
const SELECTED = ENTITY_FLAG.selected;
const DEAD = ENTITY_FLAG.dead;

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

function createDecalMaterial(): MeshBasicNodeMaterial {
  const iDecal = attribute('iDecal', 'vec4'); // x, y, z, selected 0|1
  const d = length(uv().sub(vec2(0.5, 0.5))).mul(2); // 0 at the center, 1 at the quad edge (1 m)
  const shadow = float(1).sub(smoothstep(0.15, 0.5, d)).mul(0.42);
  const ring = smoothstep(0.6, 0.66, d).sub(smoothstep(0.74, 0.8, d)).mul(iDecal.w);
  const alpha = max(shadow, ring);
  const ringColor = vec3(0.45, 1.0, 0.45);
  const m = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  m.positionNode = positionLocal.add(vec3(iDecal.x, iDecal.y.add(0.04), iDecal.z));
  m.colorNode = vec4(mix(vec3(0, 0, 0), ringColor, ring.div(max(alpha, 0.001))), alpha);
  m.polygonOffset = true;
  m.polygonOffsetFactor = -2;
  m.name = 'crawlout-unit-decal';
  return m;
}

export class UnitLayer {
  readonly anims: BakedAnimations;
  private readonly lods: LodBatch[];
  private readonly decal: Mesh;
  private readonly decalAttr: InstancedBufferAttribute;
  private readonly textures: Texture[];
  private readonly geometries: BufferGeometry[] = [];
  private readonly lodDist2: [number, number];
  private readonly frustum = new Frustum();
  private readonly projView = new Matrix4();
  private readonly sphere = new Sphere();
  private readonly unitMaterial: MeshBasicNodeMaterial;
  private readonly decalMaterial: MeshBasicNodeMaterial;
  /** Instances drawn per LOD in the last update. */
  readonly lodCounts: [number, number, number] = [0, 0, 0];

  constructor(scene: Scene, opts: UnitLayerOptions) {
    const cap = opts.capacity;
    const [d1, d2] = opts.lodDistances ?? [30, 70];
    this.lodDist2 = [d1 * d1, d2 * d2];
    this.anims = bakeAnimations();
    const palette = Array.from({ length: MAX_PLAYERS }, (_, i) => new Color().setHex(TEAM_COLORS[i % TEAM_COLORS.length]!));
    const bundle = createUnitMaterial(this.anims, { lightDir: opts.lightDir }, palette);
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

    const decalGeo = new PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
    this.decalAttr = dynamic(cap, 4);
    decalGeo.setAttribute('iDecal', this.decalAttr);
    this.geometries.push(decalGeo);
    this.decalMaterial = createDecalMaterial();
    this.decal = new Mesh(decalGeo, this.decalMaterial);
    this.decal.name = 'unit-decals';
    this.decal.frustumCulled = false;
    this.decal.renderOrder = 1;
    this.decal.count = 0;
    this.decal.visible = false;
    scene.add(this.decal);
  }

  /** Clip count in the baked animation set; anim indices at or above it fall back to clip 0. */
  get clipCount(): number {
    return this.anims.clips.length;
  }

  /** LOD index for a squared camera distance. */
  private lodFor(distanceSq: number): number {
    if (distanceSq < this.lodDist2[0]) return 0;
    if (distanceSq < this.lodDist2[1]) return 1;
    return 2;
  }

  /** Distributes the frame over the LOD batches. `frame.y` must already hold terrain heights. */
  update(frame: InterpolatedFrame, camera: Camera): void {
    this.projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projView);
    const cam = camera.position;
    const counts = this.lodCounts;
    counts[0] = counts[1] = counts[2] = 0;
    let decals = 0;
    const clipMax = this.clipCount - 1;
    const decalArr = this.decalAttr.array as Float32Array;
    const center = this.sphere.center;
    this.sphere.radius = UNIT_RADIUS;

    for (let i = 0; i < frame.count; i++) {
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
      pose[k * 4] = x;
      pose[k * 4 + 1] = y;
      pose[k * 4 + 2] = z;
      pose[k * 4 + 3] = frame.yaw[i]!;
      anim[k * 4] = Math.min(frame.anim[i]!, clipMax);
      anim[k * 4 + 1] = frame.animT[i]!;
      anim[k * 4 + 2] = frame.owner[i]! % MAX_PLAYERS;
      anim[k * 4 + 3] = flags;

      decalArr[decals * 4] = x;
      decalArr[decals * 4 + 1] = y;
      decalArr[decals * 4 + 2] = z;
      decalArr[decals * 4 + 3] = (flags & SELECTED) !== 0 && (flags & DEAD) === 0 ? 1 : 0;
      decals++;
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
    this.decal.count = decals;
    this.decal.visible = decals > 0;
    if (decals > 0) markUsed(this.decalAttr, decals);
  }

  dispose(): void {
    for (const b of this.lods) b.mesh.removeFromParent();
    this.decal.removeFromParent();
    for (const g of this.geometries) g.dispose();
    for (const t of this.textures) t.dispose();
    this.unitMaterial.dispose();
    this.decalMaterial.dispose();
  }
}

/** Shared light direction for units and terrain: low sun from the south-west, like the bake in the textures will be. */
export const DEFAULT_LIGHT_DIR = new Vector3(-0.45, 0.8, 0.35).normalize();
