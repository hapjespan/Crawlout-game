// Loads one rigid unit asset (a robot): its three LOD GLBs as static geometry in the building vertex layout
// (structures/buildingGeometry.ts: position, normal, color with the team mask in alpha, uvl into a texture array),
// the model as authored (a floating unit has its hover height baked in: bounds.min.y), and identical LODs merged into
// one geometry so they cost one draw. Network and parsing come from UnitAssetIO, so tests run without a GPU.
import type { BufferGeometry, DataArrayTexture, Object3D } from 'three/webgpu';
import {
  buildingGeometryFromGltf,
  TextureLayerTable,
  type BuildingMesh,
} from '../structures/buildingGeometry.js';
import {
  createLayerTexture,
  DEFAULT_LAYER_SIZE,
  type Rasterize,
} from '../structures/textureArray.js';
import { applySurfaceTiles, type SurfaceTileSet } from '../look/surfaceTiles.js';
import type { RigidAssetEntry } from './rigidUnitManifest.js';

export interface RigidUnitLoadOptions {
  rasterize?: Rasterize;
  /** Cap on the texture-array layer edge (the GPU's max texture size, or less). Default DEFAULT_LAYER_SIZE. */
  maxLayerSize?: number;
  /**
   * The manifest's shared surface tiles (look/surfaceTiles.ts). A rigid unit entry is split off the manifest before
   * the schema sees it (rigidUnitManifest.ts), so this loader cannot look them up itself: the caller passes them.
   * Null or absent means the GLBs carry their own maps, which is what an older build does.
   */
  surfaces?: SurfaceTileSet | null;
}

export interface LoadedRigidAsset {
  entry: RigidAssetEntry;
  /** Geometry per LOD; identical LODs are the same object. */
  lods: readonly [BufferGeometry, BufferGeometry, BufferGeometry];
  triangles: [number, number, number];
  /** Height of the model in meters (bounds), the mean of its two horizontal sizes, and its farthest horizontal reach from the origin. */
  height: number;
  width: number;
  reach: number;
  layers: DataArrayTexture | null;
  layerLuma: number[];
  /** Vertices with the team mask in LOD 0: 0 means the model shows no team color. */
  teamVertices: number;
  /** Set when something is off but the asset is usable (a texture that did not decode). */
  warning?: string;
}

export async function loadRigidUnitAsset(
  io: {
    fetchBytes(url: string): Promise<ArrayBuffer>;
    parseGltf(bytes: ArrayBuffer, url: string): Promise<Object3D>;
  },
  resolveUrl: (path: string) => string,
  entry: RigidAssetEntry,
  opts: RigidUnitLoadOptions = {},
): Promise<LoadedRigidAsset> {
  const scenes = await Promise.all(
    entry.lods.map(async (lod) => {
      const url = resolveUrl(lod.path);
      return io.parseGltf(await io.fetchBytes(url), url);
    }),
  );
  const table = new TextureLayerTable();
  const built: BuildingMesh[] = scenes.map((scene) => {
    // Before the layer table: it reads the image size to pick a layer and to rescale the uv for texel density.
    applySurfaceTiles(scene, opts.surfaces ?? null);
    return buildingGeometryFromGltf(scene, { teamMaterials: entry.teamMaterials, layers: table });
  });
  // Identical LODs share one geometry: the same path, or the same triangle count as the LOD before.
  const geos: BufferGeometry[] = [];
  built.forEach((b, i) => {
    const prev = i > 0 ? entry.lods[i - 1]! : null;
    const same =
      prev && (prev.path === entry.lods[i]!.path || built[i - 1]!.triangles === b.triangles);
    if (same) {
      b.geometry.dispose();
      geos.push(geos[i - 1]!);
    } else geos.push(b.geometry);
  });

  let layers: DataArrayTexture | null = null;
  let layerLuma: number[] = [];
  let warning: string | undefined;
  if (table.size > 0) {
    const made = createLayerTexture(
      table.layers,
      opts.rasterize,
      opts.maxLayerSize ?? DEFAULT_LAYER_SIZE,
    );
    layers = made.texture;
    layerLuma = made.luma;
    if (made.missing.length > 0)
      warning = `texture ${made.missing.join(', ')} not decoded (flat color)`;
  }
  const color = geos[0]!.getAttribute('color');
  let teamVertices = 0;
  for (let i = 0; i < color.count; i++) if (color.getW(i) > 0.5) teamVertices++;
  const [x0, y0, z0] = entry.bounds.min;
  const [x1, y1, z1] = entry.bounds.max;
  return {
    entry,
    lods: geos as unknown as LoadedRigidAsset['lods'],
    triangles: built.map((b) => b.triangles) as [number, number, number],
    height: y1 - y0,
    width: Math.sqrt((x1 - x0) * (z1 - z0)),
    reach: Math.hypot(Math.max(Math.abs(x0), Math.abs(x1)), Math.max(Math.abs(z0), Math.abs(z1))),
    layers,
    layerLuma,
    teamVertices,
    ...(warning ? { warning } : {}),
  };
}
