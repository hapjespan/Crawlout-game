// Buildings, scrap heaps and claim points: one instanced draw call per kind per LOD, plus one for the scaffolds around
// building sites. A building type with an asset from the manifest (setBuildingAssets) is drawn with it: one instanced
// draw per asset per LOD (three LODs, identical LODs share a draw; every material of the asset sits in that one draw
// through the shared texture array); the others keep the placeholder block (two LODs). Buildings, scrap heaps and claim
// flags cast the real sun shadow (when the renderer enables it); scrap
// heaps get a blob shadow decal and claim points a ring decal in the owner's color. Everything is read from the
// interpolated frame, by typeId (entities/typeIds.ts). A site (anim build) grows with its progress in animT inside a
// scaffold (a placeholder scales up, an asset rises out of the ground: the material cuts it at the built height); a
// scrap heap shrinks with its remaining stock in hpPct (structureVisuals.ts).
import { ANIM, ENTITY_FLAG } from '@crawlout/protocol';
import {
  Frustum,
  Matrix4,
  Sphere,
  type BufferGeometry,
  type Camera,
  type MeshBasicNodeMaterial,
  type Scene,
} from 'three/webgpu';
import type { BuildingVisual } from './buildingAssets.js';
import { InstanceBatch } from './instanceBatch.js';
import {
  CONTACT_MASK_SIZE,
  DECAL_COLOR,
  DECAL_SHAPE,
  type DecalLayer,
  type DecalStyle,
} from '../decals/decalLayer.js';
import { buildingContact } from '../decals/contact.js';
import { bakeContactField } from '../decals/contactMask.js';
import {
  buildingRoofHeight,
  buildingWallHeight,
  type Footprint,
  type FootprintTable,
} from '../entities/footprint.js';
import { buildingIdOf, classifyTypeId, ENTITY_KIND } from '../entities/typeIds.js';
import { BUILDING_LOD_PX, ScreenLod, type ScreenLodThresholds } from '../lod/screenLod.js';
import { NEUTRAL_TEAM, teamIndex } from '../palette.js';
import type { PickShape } from '../picking/selection.js';
import type { InterpolatedFrame } from '../snapshot/interpolate.js';
import type { PlatformSpec } from '../terrain/terrainPlatforms.js';
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
  /** Screen-size LOD (lod/screenLod.ts), shared with the other layers; the renderer feeds it the viewport. */
  screen?: ScreenLod;
  /**
   * Projected size (device px, bounding diameter) below which buildings draw LOD 1 and LOD 2 (the placeholder has
   * two LODs: LOD 1 from lod1 on). Default BUILDING_LOD_PX.
   */
  lodPixels?: ScreenLodThresholds;
  castShadows?: boolean;
}

/** Instances per building-asset batch: more of one type than this in view is not a game. */
const ASSET_BATCH_CAPACITY = 1024;
/** Scaffold height around an asset site, times the model height (capped by the placeholder's scaffold). */
const ASSET_SCAFFOLD_HEIGHT = 1.05;

interface AssetDraw {
  visual: BuildingVisual;
  /** One batch per distinct LOD geometry. */
  batches: InstanceBatch[];
  /** Batch index per LOD. */
  lodBatch: [number, number, number];
}

const WHITE: readonly [number, number, number] = [1, 1, 1];

export class StructureLayer {
  private readonly buildings: [InstanceBatch, InstanceBatch];
  private readonly scaffolds: InstanceBatch;
  private readonly scrap: InstanceBatch;
  private readonly claims: InstanceBatch;
  private readonly footprints: FootprintTable;
  private readonly heightAt: (x: number, z: number) => number;
  private readonly screen: ScreenLod;
  private readonly lodPixels: ScreenLodThresholds;
  private readonly frustum = new Frustum();
  private readonly projView = new Matrix4();
  private readonly sphere = new Sphere();
  private readonly materials: StructureMaterials;
  private readonly siteTint: [number, number, number] = [1, 1, 1];
  private readonly gainTint: [number, number, number] = [1, 1, 1];
  private readonly heap: [number, number] = [1, 1];
  private readonly scene: Scene;
  private readonly capacity: number;
  private readonly castShadows: boolean;
  private assetDraws: AssetDraw[] = [];
  /** Building id (index in buildings.json) to its asset draw. */
  private readonly assetByBuilding = new Map<number, AssetDraw>();
  private assetMaterial: MeshBasicNodeMaterial | null = null;
  /** Contact mask layer per building id (decals/contactMask.ts), baked on first sight; reset with the assets. */
  private readonly contactLayers = new Map<number, number>();
  private contactDecals: DecalLayer | null = null;
  private camPos: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 };
  private readonly scrapDecal: DecalStyle;

  constructor(scene: Scene, opts: StructureLayerOptions) {
    const cap = opts.capacity;
    this.scene = scene;
    this.capacity = cap;
    this.castShadows = opts.castShadows ?? false;
    this.screen = opts.screen ?? new ScreenLod();
    this.lodPixels = opts.lodPixels ?? BUILDING_LOD_PX;
    const m = (this.materials = opts.materials);
    this.footprints = opts.footprints;
    this.heightAt = opts.heightAt;
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
    this.scrap.mesh.castShadow = this.castShadows;
    this.claims.mesh.castShadow = this.castShadows;
    // With the real shadow the scrap heap's blob is only a contact darkening.
    this.scrapDecal = this.castShadows ? { ...SCRAP_DECAL, shadow: 0.5 } : SCRAP_DECAL;
  }

  /**
   * Draws the building ids in `byBuilding` with their asset, all with `material` (the layer takes ownership of it and
   * of nothing else: the geometries are cloned per batch, the textures stay the caller's). Replaces earlier assets;
   * an empty map brings every building back to the placeholder.
   */
  setBuildingAssets(
    byBuilding: ReadonlyMap<number, BuildingVisual>,
    material: MeshBasicNodeMaterial | null,
  ): void {
    this.clearAssets();
    if (byBuilding.size === 0 || !material) {
      material?.dispose();
      return;
    }
    this.assetMaterial = material;
    const byVisual = new Map<BuildingVisual, AssetDraw>();
    for (const [buildingId, visual] of byBuilding) {
      let draw = byVisual.get(visual);
      if (!draw) {
        const unique: BufferGeometry[] = [];
        const lodBatch = visual.lods.map((geo) => {
          let i = unique.indexOf(geo);
          if (i < 0) i = unique.push(geo) - 1;
          return i;
        }) as [number, number, number];
        const batches = unique.map((geo, i) => {
          const b = new InstanceBatch(
            this.scene,
            geo.clone(),
            material,
            Math.min(this.capacity, ASSET_BATCH_CAPACITY),
            `building-${visual.assetId}-${i}`,
          );
          b.mesh.castShadow = this.castShadows;
          return b;
        });
        draw = { visual, batches, lodBatch };
        byVisual.set(visual, draw);
        this.assetDraws.push(draw);
      }
      this.assetByBuilding.set(buildingId, draw);
    }
  }

  private clearAssets(): void {
    for (const d of this.assetDraws) for (const b of d.batches) b.dispose();
    this.assetDraws = [];
    this.assetByBuilding.clear();
    this.contactLayers.clear();
    this.contactDecals?.clearContactMasks();
    this.assetMaterial?.dispose();
    this.assetMaterial = null;
  }

  /** The asset a building typeId is drawn with, or undefined for the placeholder. */
  assetOf(typeId: number): BuildingVisual | undefined {
    return this.assetByBuilding.get(buildingIdOf(typeId))?.visual;
  }

  /** Height (m above its ground) of the top of a drawn building: the asset's bounds or the placeholder's ridge. */
  buildingTop(typeId: number): number {
    const v = this.assetOf(typeId);
    return v ? v.height : buildingRoofHeight(this.footprints.get(typeId));
  }

  /** Instanced draws the buildings take this frame (placeholders, assets and scaffolds), before the shadow pass. */
  buildingDrawCount(): number {
    let n = 0;
    for (const b of [...this.buildings, this.scaffolds]) if (b.mesh.visible) n++;
    for (const d of this.assetDraws) for (const b of d.batches) if (b.mesh.visible) n++;
    return n;
  }

  /** The building meshes in the scene (tests, debugging). */
  buildingMeshes(): readonly InstanceBatch['mesh'][] {
    return [
      ...this.buildings.map((b) => b.mesh),
      ...this.assetDraws.flatMap((d) => d.batches.map((b) => b.mesh)),
    ];
  }

  /**
   * The footprints of the buildings and building sites in the frame, as platforms for the terrain to level
   * (terrain/terrainPlatforms.ts), in `out` (cleared first; the specs are reused between calls). The entity id is the
   * platform id.
   */
  platforms(frame: InterpolatedFrame, out: PlatformSpec[]): PlatformSpec[] {
    let n = 0;
    for (let i = 0; i < frame.count; i++) {
      const typeId = frame.typeId[i]!;
      if (classifyTypeId(typeId) !== ENTITY_KIND.building) continue;
      if ((frame.flags[i]! & ENTITY_FLAG.dead) !== 0) continue;
      const f = this.footprints.get(typeId);
      const spec = (out[n] ??= { id: 0, x: 0, z: 0, hx: 0, hz: 0 });
      spec.id = frame.id[i]!;
      spec.x = frame.x[i]!;
      spec.z = frame.z[i]!;
      spec.hx = f.w * 0.5;
      spec.hz = f.h * 0.5;
      n++;
    }
    out.length = n;
    return out;
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

  /**
   * Contact decal around a footprint (decals/contact.ts), when it is in view: the building sits in the ground. A
   * finished building with an asset gets its own ground-contact distance field (decals/contactMask.ts, baked from the
   * lowest LOD on first sight), so a house with a water tower in a 21 m footprint darkens at the walls and legs, not
   * the whole yard; sites and placeholders use the footprint box.
   */
  private pushContact(
    decals: DecalLayer,
    x: number,
    y: number,
    z: number,
    typeId: number,
    f: Footprint,
    underConstruction: boolean,
  ): void {
    const c = buildingContact(f.w, f.h, underConstruction);
    this.sphere.center.set(x, y, z);
    this.sphere.radius = Math.hypot(f.w, f.h) * 0.5 + c.margin;
    if (!this.frustum.intersectsSphere(this.sphere)) return;
    let layer = -1;
    const draw = underConstruction ? undefined : this.assetByBuilding.get(buildingIdOf(typeId));
    if (draw) {
      if (this.contactDecals !== decals) {
        this.contactDecals?.clearContactMasks();
        this.contactLayers.clear();
        this.contactDecals = decals;
      }
      const id = buildingIdOf(typeId);
      let known = this.contactLayers.get(id);
      if (known === undefined) {
        known = decals.addContactMask(this.bakeContact(draw.visual, f, c.margin));
        this.contactLayers.set(id, known);
      }
      layer = known;
    }
    decals.pushContact(x, z, f.w * 0.5, f.h * 0.5, c.margin, c.style, layer);
  }

  private bakeContact(v: BuildingVisual, f: Footprint, margin: number): Uint8Array {
    const geo = v.lods[2];
    const index = geo.getIndex();
    return bakeContactField({
      positions: geo.getAttribute('position').array,
      indices: index ? index.array : null,
      scaleX: f.w / v.footprint.w,
      scaleZ: f.h / v.footprint.h,
      halfX: f.w * 0.5 + margin,
      halfZ: f.h * 0.5 + margin,
      size: CONTACT_MASK_SIZE,
      maxDistance: margin,
    });
  }

  /** Pick sphere for a structure typeId, or null for units. */
  pickShape(typeId: number, out: PickShape): PickShape | null {
    switch (classifyTypeId(typeId)) {
      case ENTITY_KIND.building: {
        const f = this.footprints.get(typeId);
        const asset = this.assetOf(typeId);
        out.radius = 0.5 * Math.max(f.w, f.h);
        out.height =
          0.5 * (asset ? Math.min(asset.height, buildingWallHeight(f)) : buildingWallHeight(f));
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
    this.camPos = cam;
    const [lod0, lod1] = this.buildings;
    lod0.count = lod1.count = this.scaffolds.count = this.scrap.count = this.claims.count = 0;
    for (const d of this.assetDraws) for (const b of d.batches) b.count = 0;
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
        this.pushContact(decals, x, y, z, typeId, f, frame.anim[i] === ANIM.build);
        const asset = this.assetByBuilding.get(buildingIdOf(typeId));
        if (asset) {
          this.pushAsset(asset, frame, i, x, y, z, f.w, f.h, wall, team);
          if ((flags & ENTITY_FLAG.selected) !== 0)
            decals.push(x, z, hx + 0.35, hz + 0.35, BUILDING_SELECTED);
          continue;
        }
        center.set(x, y + wall * 0.5, z);
        this.sphere.radius = Math.hypot(hx, hz, wall);
        if (!this.frustum.intersectsSphere(this.sphere)) continue;
        const dx = x - cam.x;
        const dy = y - cam.y;
        const dz = z - cam.z;
        const near = this.screen.lod(
          2 * this.sphere.radius,
          Math.sqrt(dx * dx + dy * dy + dz * dz),
          this.lodPixels,
        );
        const batch = near === 0 ? lod0 : lod1;
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
        decals.push(x, z, 1.7 * w, 1.7 * w, this.scrapDecal);
      } else {
        this.claims.push(x, y, z, yaw, 1, 1, 1, team, WHITE);
        decals.push(x, z, CLAIM_RADIUS, CLAIM_RADIUS, CLAIM_DECALS[team]!);
      }
    }
    lod0.commit();
    lod1.commit();
    for (const d of this.assetDraws) for (const b of d.batches) b.commit();
    this.scaffolds.commit();
    this.scrap.commit();
    this.claims.commit();
  }

  /** One building drawn with its asset: culled on its bounds, LOD by camera distance, cut while under construction. */
  private pushAsset(
    asset: AssetDraw,
    frame: InterpolatedFrame,
    i: number,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    wall: number,
    team: number,
  ): void {
    const v = asset.visual;
    const top = v.height;
    const sx = w / v.footprint.w;
    const sz = h / v.footprint.h;
    this.sphere.center.set(x, y + top * 0.5, z);
    this.sphere.radius = Math.hypot(w * 0.5, h * 0.5, top * 0.5);
    if (!this.frustum.intersectsSphere(this.sphere)) return;
    const cam = this.camPos;
    const d2 = (x - cam.x) ** 2 + (y - cam.y) ** 2 + (z - cam.z) ** 2;
    const lod = this.screen.lod(2 * this.sphere.radius, Math.sqrt(d2), this.lodPixels);
    const batch = asset.batches[asset.lodBatch[lod]]!;
    const g = v.gain ?? 1;
    const lit = this.gainTint;
    lit[0] = lit[1] = lit[2] = g;
    if (frame.anim[i] === ANIM.build) {
      const progress = frame.animT[i]!;
      const tint = constructionTint(progress, lit, this.siteTint);
      batch.push(x, y, z, 0, sx, 1, sz, team, tint, top * constructionHeight(progress));
      const m = 2 * SCAFFOLD_MARGIN;
      const scaffold = Math.min(wall * SCAFFOLD_HEIGHT, top * ASSET_SCAFFOLD_HEIGHT);
      this.scaffolds.push(x, y, z, 0, w + m, scaffold, h + m, team, WHITE);
    } else {
      batch.push(x, y, z, 0, sx, 1, sz, team, lit);
    }
  }

  dispose(): void {
    this.clearAssets();
    for (const b of [...this.buildings, this.scaffolds, this.scrap, this.claims]) b.dispose();
    this.materials.building.dispose();
    this.materials.scrap.dispose();
    this.materials.claim.dispose();
  }
}
