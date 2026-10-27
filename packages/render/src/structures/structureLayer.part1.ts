// Split from structureLayer.ts to stay under the 5,000-token file limit; structureLayer.ts re-exports the public surface.
// Holds: BUILDING_TINTS, SCRAP_DECAL, BUILDING_SELECTED, BUILDING_INSPECTED, CLAIM_RADIUS, CLAIM_DECALS, +8 more.
import { type DecalStyle, DECAL_SHAPE, DECAL_COLOR } from '../decals/decalLayer.js';
import { NEUTRAL_TEAM } from '../palette.js';
import type { MeshBasicNodeMaterial } from 'three/webgpu';
import type { FootprintTable } from '../entities/footprint.js';
import { ScreenLod, type ScreenLodThresholds } from '../lod/screenLod.js';
import type { BuildingVisual } from './buildingAssets.js';
import { InstanceBatch } from './instanceBatch.js';

/** Wall color multipliers per building id, so the eight Dweller buildings read apart before real meshes exist. */
export const BUILDING_TINTS: readonly (readonly [number, number, number])[] = [
  [1, 1, 1],
  [1.06, 0.96, 0.86],
  [0.88, 0.94, 1.02],
  [0.95, 1.03, 0.9],
  [1.1, 0.9, 0.82],
  [0.82, 0.82, 0.86],
  [1.02, 1.0, 0.8],
  [0.9, 0.86, 0.96],
];

export const SCRAP_DECAL: DecalStyle = {
  shape: DECAL_SHAPE.circle,
  shadow: 1,
  ring: 0,
  ringWidth: 0,
  fill: 0,
  grid: 0,
  color: 0,
};

export const BUILDING_SELECTED: DecalStyle = {
  shape: DECAL_SHAPE.rect,
  shadow: 0,
  ring: 1,
  ringWidth: 0.18,
  fill: 0.06,
  grid: 0,
  color: DECAL_COLOR.selection,
};

export const BUILDING_INSPECTED: DecalStyle = { ...BUILDING_SELECTED, color: DECAL_COLOR.invalid };

export const CLAIM_RADIUS = 3.5; // meters, visual only

/** Claim ring per palette slot (owner color, neutral grey when unclaimed). */
export const CLAIM_DECALS: readonly DecalStyle[] = Array.from(
  { length: NEUTRAL_TEAM + 1 },
  (_, team) => ({
    shape: DECAL_SHAPE.circle,
    shadow: 0,
    ring: 0.9,
    ringWidth: 0.28,
    fill: 0.12,
    grid: 0,
    color: team,
  }),
);

export function hash01(id: number): number {
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
export const ASSET_BATCH_CAPACITY = 1024;

/** Slack around a building's footprint for its pick box, meters. */
export const PICK_BOX_MARGIN = 0.5;

/** Scaffold height around an asset site, times the model height (capped by the placeholder's scaffold). */
export const ASSET_SCAFFOLD_HEIGHT = 1.05;

export interface AssetDraw {
  visual: BuildingVisual;
  /** One batch per distinct LOD geometry. */
  batches: InstanceBatch[];
  /** Batch index per LOD. */
  lodBatch: [number, number, number];
}

export const WHITE: readonly [number, number, number] = [1, 1, 1];
