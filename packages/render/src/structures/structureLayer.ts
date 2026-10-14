// Buildings, scrap heaps and claim points: one instanced draw call per kind per LOD (buildings have two LODs), plus
// one for the scaffolds around building sites. Buildings cast real shadows (when the renderer enables them); scrap
// heaps get a blob shadow decal and claim points a ring decal in the owner's color. Everything is read from the
// interpolated frame, by typeId (entities/typeIds.ts). A site (anim build) grows with its progress in animT inside a
// scaffold; a scrap heap shrinks with its remaining stock in hpPct (structureVisuals.ts).
import { ANIM, ENTITY_FLAG } from '@crawlout/protocol';
import {
  Frustum,
  Matrix4,
  Sphere,
  type Camera,
  type MeshBasicNodeMaterial,
  type Scene,
} from 'three/webgpu';
import { InstanceBatch } from './instanceBatch.js';
import {
  DECAL_COLOR,
  DECAL_SHAPE,
  type DecalLayer,
  type DecalStyle,
} from '../decals/decalLayer.js';
import { buildingWallHeight, type FootprintTable } from '../entities/footprint.js';
import { buildingIdOf, classifyTypeId, ENTITY_KIND } from '../entities/typeIds.js';
import { NEUTRAL_TEAM, teamIndex } from '../palette.js';
import type { PickShape } from '../picking/selection.js';
import type { InterpolatedFrame } from '../snapshot/interpolate.js';
import {
  createBuildingGeometry,
  createClaimGeometry,
  createScaffoldGeometry,
  createScrapHeapGeometry,
  POLE_HEIGHT,
} from './structureGeometry.js';
import {
  constructionHeight,
  constructionTint,
  SCAFFOLD_HEIGHT,
  SCAFFOLD_MARGIN,
  scrapHeapScale,
} from './structureVisuals.js';

/** Wall color multipliers per building id, so the eight Dweller buildings read apart before real meshes exist. */
const BUILDING_TINTS: readonly (readonly [number, number, number])[] = [
  [1, 1, 1],
  [1.06, 0.96, 0.86],
  [0.88, 0.94, 1.02],
  [0.95, 1.03, 0.9],
  [1.1, 0.9, 0.82],
  [0.82, 0.82, 0.86],
  [1.02, 1.0, 0.8],
  [0.9, 0.86, 0.96],
];

const SCRAP_DECAL: DecalStyle = {
  shape: DECAL_SHAPE.circle,
  shadow: 1,
  ring: 0,
  ringWidth: 0,
  fill: 0,
  grid: 0,
  color: 0,
};
const BUILDING_SELECTED: DecalStyle = {
  shape: DECAL_SHAPE.rect,
  shadow: 0,
  ring: 1,
  ringWidth: 0.18,
  fill: 0.06,
  grid: 0,
  color: DECAL_COLOR.selection,
};
const CLAIM_RADIUS = 3.5; // meters, visual only
/** Claim ring per palette slot (owner color, neutral grey when unclaimed). */
const CLAIM_DECALS: readonly DecalStyle[] = Array.from({ length: NEUTRAL_TEAM + 1 }, (_, team) => ({
  shape: DECAL_SHAPE.circle,
  shadow: 0,
  ring: 0.9,
  ringWidth: 0.28,
  fill: 0.12,
  grid: 0,
  color: team,
}));

function hash01(id: number): number {
  let h = Math.imul(id ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export interface StructureMaterials {
  building: MeshBasicNodeMaterial;
  scrap: MeshBasicNodeMaterial;
  claim: MeshBasicNodeMaterial;
}

export interface StructureLayerOptions {
  capacity: number;
  footprints: FootprintTable;
  heightAt: (x: number, z: number) => number;
  materials: StructureMaterials;
  /** Camera distance (m) where buildings switch to LOD1. */
  lodDistance?: number;
  castShadows?: boolean;
}

const WHITE: readonly [number, number, number] = [1, 1, 1];

export class StructureLayer {
  private readonly buildings: [InstanceBatch, InstanceBatch];
  private readonly scaffolds: InstanceBatch;
  private readonly scrap: InstanceBatch;
  private readonly claims: InstanceBatch;
  private readonly footprints: FootprintTable;
  private readonly heightAt: (x: number, z: number) => number;
  private readonly lodDist2: number;
  private readonly frustum = new Frustum();
  private readonly projView = new Matrix4();
  private readonly sphere = new Sphere();
  private readonly materials: StructureMaterials;
  private readonly siteTint: [number, number, number] = [1, 1, 1];
  private readonly heap: [number, number] = [1, 1];

  constructor(scene: Scene, opts: StructureLayerOptions) {
    const cap = opts.capacity;
    const m = (this.materials = opts.materials);
    this.footprints = opts.footprints;
    this.heightAt = opts.heightAt;
    const d = opts.lodDistance ?? 60;
    this.lodDist2 = d * d;
    this.buildings = [
      new InstanceBatch(scene, createBuildingGeometry(0), m.building, cap, 'buildings-lod0'),
      new InstanceBatch(scene, createBuildingGeometry(1), m.building, cap, 'buildings-lod1'),
    ];
    this.scaffolds = new InstanceBatch(
      scene,
      createScaffoldGeometry(),
      m.building,
      cap,
      'building-scaffolds',
    );
    for (const b of [...this.buildings, this.scaffolds])
      b.mesh.castShadow = opts.castShadows ?? false;
    this.scrap = new InstanceBatch(scene, createScrapHeapGeometry(), m.scrap, cap, 'scrap-nodes');
    this.claims = new InstanceBatch(scene, createClaimGeometry(), m.claim, cap, 'claim-points');
  }

  /** Lowest terrain point under a footprint, so the building's foundation never floats. */
  private groundUnder(x: number, z: number, hx: number, hz: number): number {
    const h = this.heightAt;
    return Math.min(
      h(x, z),
      h(x - hx, z - hz),
      h(x + hx, z - hz),
      h(x - hx, z + hz),
      h(x + hx, z + hz),
    );
  }

  /** Pick sphere for a structure typeId, or null for units. */
  pickShape(typeId: number, out: PickShape): PickShape | null {
    switch (classifyTypeId(typeId)) {
      case ENTITY_KIND.building: {
        const f = this.footprints.get(typeId);
        out.radius = 0.5 * Math.max(f.w, f.h);
        out.height = 0.5 * buildingWallHeight(f);
        return out;
      }
      case ENTITY_KIND.scrapNode:
        out.radius = 1.3;
        out.height = 0.5;
        return out;
      case ENTITY_KIND.claim:
        out.radius = 0.9;
        out.height = POLE_HEIGHT * 0.5;
        return out;
      default:
        return null;
    }
  }

  update(frame: InterpolatedFrame, camera: Camera, decals: DecalLayer): void {
    this.projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projView);
    const cam = camera.position;
    const [lod0, lod1] = this.buildings;
    lod0.count = lod1.count = this.scaffolds.count = this.scrap.count = this.claims.count = 0;
    const center = this.sphere.center;

    for (let i = 0; i < frame.count; i++) {
      const typeId = frame.typeId[i]!;
      const kind = classifyTypeId(typeId);
      if (kind === ENTITY_KIND.unit || kind === ENTITY_KIND.unknown) continue;
      const flags = frame.flags[i]!;
      if ((flags & ENTITY_FLAG.dead) !== 0) continue;
      const x = frame.x[i]!;
      const z = frame.z[i]!;
      const team = teamIndex(frame.owner[i]!);

      if (kind === ENTITY_KIND.building) {
        const f = this.footprints.get(typeId);
        const hx = f.w * 0.5;
        const hz = f.h * 0.5;
        const wall = buildingWallHeight(f);
        const y = this.groundUnder(x, z, hx, hz);
        center.set(x, y + wall * 0.5, z);
        this.sphere.radius = Math.hypot(hx, hz, wall);
        if (!this.frustum.intersectsSphere(this.sphere)) continue;
        const dx = x - cam.x;
        const dy = y - cam.y;
        const dz = z - cam.z;
        const batch = dx * dx + dy * dy + dz * dz < this.lodDist2 ? lod0 : lod1;
        const tint = BUILDING_TINTS[buildingIdOf(typeId) % BUILDING_TINTS.length] ?? WHITE;
        if (frame.anim[i] === ANIM.build) {
          const progress = frame.animT[i]!;
          batch.push(
            x,
            y,
            z,
            0,
            f.w,
            wall * constructionHeight(progress),
            f.h,
            team,
            constructionTint(progress, tint, this.siteTint),
          );
          const m = 2 * SCAFFOLD_MARGIN;
          this.scaffolds.push(x, y, z, 0, f.w + m, wall * SCAFFOLD_HEIGHT, f.h + m, team, WHITE);
        } else {
          batch.push(x, y, z, 0, f.w, wall, f.h, team, tint);
        }
        if ((flags & ENTITY_FLAG.selected) !== 0)
          decals.push(x, z, hx + 0.35, hz + 0.35, BUILDING_SELECTED);
        continue;
      }

      const y = frame.y[i]!;
      center.set(x, y + 1, z);
      this.sphere.radius = kind === ENTITY_KIND.claim ? CLAIM_RADIUS : 2;
      if (!this.frustum.intersectsSphere(this.sphere)) continue;
      const yaw = hash01(frame.id[i]!) * Math.PI * 2;
      if (kind === ENTITY_KIND.scrapNode) {
        const [w, h] = scrapHeapScale(frame.hpPct[i]!, this.heap);
        this.scrap.push(x, y - 0.05, z, yaw, w, h, w, team, WHITE);
        decals.push(x, z, 1.7 * w, 1.7 * w, SCRAP_DECAL);
      } else {
        this.claims.push(x, y, z, yaw, 1, 1, 1, team, WHITE);
        decals.push(x, z, CLAIM_RADIUS, CLAIM_RADIUS, CLAIM_DECALS[team]!);
      }
    }
    lod0.commit();
    lod1.commit();
    this.scaffolds.commit();
    this.scrap.commit();
    this.claims.commit();
  }

  dispose(): void {
    for (const b of [...this.buildings, this.scaffolds, this.scrap, this.claims]) b.dispose();
    this.materials.building.dispose();
    this.materials.scrap.dispose();
    this.materials.claim.dispose();
  }
}
