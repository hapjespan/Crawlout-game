// Split from propLayer.ts to stay under the 5,000-token file limit; propLayer.ts re-exports the public surface.
// Holds: RenderProp, PropVisual, PropMaterialSpec, PropLayerOptions, PROP_CHUNK_SIZE, BLOB_PX_PER_METER, +12 more.
import type { BufferGeometry, Texture, MeshBasicNodeMaterial } from 'three/webgpu';
import type { PropCategory } from './propCategory.js';
import { ScreenLod, type ScreenLodThresholds } from '../lod/screenLod.js';
import type { Vec3Like } from './shadowSweep.js';
import { type DecalStyle, DECAL_SHAPE, DECAL_COLOR } from '../decals/decalLayer.js';
import type { ThinTier } from './propThinning.js';
import { InstanceBatch } from '../structures/instanceBatch.js';

/**
 * One prop as the map delivers it (PropInstance of @crawlout/map fits as is): x and y in meters on the map (y is
 * world z), yaw 0..65535 as in the sim (0 = sim +x), scale 1 = 100 %.
 */
export interface RenderProp {
  asset: string;
  x: number;
  y: number;
  yaw: number;
  scale: number;
}

/** What an asset is drawn with. The layer clones the geometries (it owns its clones); the map stays the caller's. */
export interface PropVisual {
  lods: readonly [BufferGeometry, BufferGeometry, BufferGeometry];
  map: Texture | null;
  /** Texture array of an asset with more than one texture (the geometry then has `uvl`, not `uv`). */
  layers?: Texture | null;
  /** The geometries carry the `aCut` alpha-test cutoff: draw with the mask material (alpha test, two-sided). */
  mask?: boolean;
  /** What the prop is (the manifest's category, else read from the asset id). */
  category?: PropCategory;
  /** Uniform scale on top of the instance scale (propFit.ts). */
  fit: number;
  /** Mesh height and horizontal radius (m) before fit and instance scale. */
  height: number;
  radius: number;
  /** Brightness factor on the albedo (renderer option albedoGain), through the instance tint. Default 1. */
  gain?: number;
}

/** What a prop material is built for: its textures, whether it is alpha-tested, and the asset's category and size. */
export interface PropMaterialSpec {
  /** Diffuse map (null: vertex colors only). */
  map: Texture | null;
  /** Texture array of a multi-texture asset. */
  layers: Texture | null;
  /** Alpha-tested (leaf cards, blades): the mask variant, two-sided. Opaque otherwise. */
  mask: boolean;
  category: PropCategory;
  /** Mesh height in meters before the fit (the wind's height scale). */
  height: number;
}

export interface PropLayerOptions {
  heightAt: (x: number, z: number) => number;
  /** Creates the material for a visual. Called once per visual (one material, so one draw, per asset per LOD). */
  material: (spec: PropMaterialSpec) => MeshBasicNodeMaterial;
  /** Screen-size LOD (lod/screenLod.ts), shared with the other layers; the renderer feeds it the viewport. */
  screen?: ScreenLod;
  /** Projected heights (device px) below which an asset draws LOD 1 and LOD 2. Default PROP_LOD_PX. */
  lodPixels?: ScreenLodThresholds;
  /** The same for trees (tree-leafy, tree-bare), which carry most of a forest view's triangles. Default TREE_LOD_PX. */
  treeLodPixels?: ScreenLodThresholds;
  /** Chunk edge in meters. */
  chunkSize?: number;
  /** Most props drawn at once. Default 3000. */
  maxVisible?: number;
  /** Trees closer than this (meters) draw all their props; ground cover thins from half of it. Default 160. */
  thinDistance?: number;
  /** Lowest share of its trees a far chunk draws before the maxVisible cap (less for ground cover). Default 0.15. */
  minDensity?: number;
  /** Most blob shadows pushed per frame. Default 768. */
  maxBlobs?: number;
  /**
   * The sun shadow is on: props cast it by category (`smallProps`: rocks, crates, chests and barrels as well as trees
   * and structures), the blobs turn into contact darkening and culling keeps a margin. Default off.
   */
  shadow?: { smallProps: boolean; sunDir?: Vec3Like } | null;
}

export const PROP_CHUNK_SIZE = 16;

/** Blob shadows under props where one meter projects to at least this many device px (100 m at 1800 px, fov 45). */
export const BLOB_PX_PER_METER = 21.7;

/** Props sink this far into the terrain, so slopes show no gap under them. */
export const SINK = 0.06;

/** Blob radius per mesh radius. */
export const BLOB_SCALE = 0.7;

export const BLOB: DecalStyle = {
  shape: DECAL_SHAPE.circle,
  shadow: 0.7,
  ring: 0,
  ringWidth: 0,
  fill: 0,
  grid: 0,
  color: DECAL_COLOR.selection,
};

/** The blob next to a real shadow: contact darkening under the trunk or the rock. */
export const CONTACT: DecalStyle = { ...BLOB, shadow: 0.32 };

/** Props lower than this (m, mesh height times fit) stay out of the shadow pass: a pallet or a small rock throws a few pixels of it. */
export const SHADOW_MIN_SIZE = 0.8;

/** Culling margin (m) with shadows: about the shadow length of a 14 m tree under the 40 degree sun. */
export const SHADOW_CULL_MARGIN = 16;

export const STRIDE = 8; // x, y, z, yaw (render radians), scale, brightness hash, tint hash, wind phase (radians)

/** Density steps per chunk: the instance buffers are only rewritten when a chunk crosses a step. */
export const DENSITY_STEPS = 32;

/** Size boost of thinned props: (1 / density)^SPARSE_GROW, at most SPARSE_MAX. */
export const SPARSE_GROW = 0.5;

export const SPARSE_MAX = 1.6;

export interface Group {
  id: string;
  count: number;
  /** STRIDE floats per instance, sorted by chunk. */
  data: Float32Array;
  chunk: Int32Array;
  /** [chunk, start, end) triples over `data`. */
  ranges: number[];
  /** Range start and end per chunk (equal when the chunk has none of this asset). */
  start: Int32Array;
  end: Int32Array;
  visual: PropVisual | null;
  category: PropCategory;
  /** Thinning tier of the category (propThinning.ts). */
  tier: ThinTier;
  material: MeshBasicNodeMaterial | null;
  batches: InstanceBatch[];
  /** Batch index per LOD. */
  lodBatch: [number, number, number];
}

export function hash01(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
