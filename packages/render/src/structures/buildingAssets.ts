// Building assets from the asset-cli manifest (kind 'building'): which asset a building type uses is data
// (data/buildings/*.json visuals.mesh), the files come from the manifest, so another GLB costs no code. All building assets
// of one load share one texture array (textureArray.ts) and so one material; every LOD becomes one geometry
// (buildingGeometry.ts). Identical LODs (same file, or the same triangle count as the LOD before, as the asset-cli
// emits for small buildings) share one geometry and so one draw. A building type without an asset keeps the
// placeholder; a failed asset is a status with a reason, never an exception.
import type { AssetEntry, AssetManifest } from '@crawlout/asset-cli/manifest';
import type { BufferGeometry, DataArrayTexture, Object3D } from 'three/webgpu';
import {
  buildingGeometryFromGltf,
  TextureLayerTable,
  type BuildingMesh,
} from './buildingGeometry.js';
import type { SurfaceKind } from '../look/surfaces.js';
import { createLayerTexture, DEFAULT_LAYER_SIZE, type Rasterize } from './textureArray.js';

/** Network and parsing, injectable for tests. */
export interface BuildingAssetIO {
  manifest(url: string): Promise<AssetManifest>;
  fetchBytes(url: string): Promise<ArrayBuffer>;
  parseGltf(bytes: ArrayBuffer, url: string): Promise<Object3D>;
}

/** What one building asset is drawn with. */
export interface BuildingVisual {
  assetId: string;
  /** Geometry per LOD; identical LODs are the same object. */
  lods: readonly [BufferGeometry, BufferGeometry, BufferGeometry];
  /** Footprint the model was made for (manifest), cells of 1 m; the instance scale maps it to the data footprint. */
  footprint: { w: number; h: number };
  /** Top of the model above its ground, meters (manifest bounds). */
  height: number;
  triangles: [number, number, number];
  /** Brightness factor on the albedo (renderer option albedoGain), through the instance tint. Default 1. */
  gain?: number;
}

export interface BuildingAssetStatus {
  assetId: string;
  /** Building ids (index in data/buildings/*.json) drawn with this asset. */
  buildingIds: number[];
  state: 'loading' | 'ready' | 'failed';
  reason?: string;
  triangles?: [number, number, number];
}

export interface BuildingAssetSet {
  /** Visual per asset id, only the ones that loaded. */
  visuals: Map<string, BuildingVisual>;
  /** The shared diffuse layers, or null when no asset has a texture. */
  layers: DataArrayTexture | null;
  /** Layer edge in texels. */
  layerSize: number;
  /** Surface kind per layer (look/surfaces.ts), by the layer's material name. */
  layerKinds: SurfaceKind[];
  /** Mean linear luminance per layer (the team pivot of a textured team material, propMaterial.ts). */
  layerLuma: number[];
  statuses: BuildingAssetStatus[];
}

export interface BuildingAssetOptions {
  rasterize?: Rasterize;
  /** Cap on the layer edge (the GPU's max texture size, or less). Default DEFAULT_LAYER_SIZE (1024). */
  maxLayerSize?: number;
}

/** Building id to asset id, for the building types whose `visuals.mesh` names something. */
export function buildingMeshes(
  buildings: readonly { id: number; visuals?: { mesh?: string | undefined } | undefined }[],
): Map<number, string> {
  const out = new Map<number, string>();
  for (const b of buildings) if (b.visuals?.mesh) out.set(b.id, b.visuals.mesh);
  return out;
}

/**
 * Loads every building asset in `meshes` that the manifest has. Resolves with the visuals, the shared texture array
 * and a status per requested asset id; never rejects (a failed manifest fails every asset with its reason).
 */
export async function loadBuildingAssets(
  io: BuildingAssetIO,
  manifestUrl: string,
  resolveUrl: (manifestUrl: string, path: string) => string,
  meshes: ReadonlyMap<number, string>,
  opts: BuildingAssetOptions = {},
): Promise<BuildingAssetSet> {
  const wanted = new Map<string, number[]>();
  for (const [buildingId, assetId] of meshes) {
    const l = wanted.get(assetId) ?? [];
    l.push(buildingId);
    wanted.set(assetId, l);
  }
  const statuses = [...wanted].map(([assetId, buildingIds]): BuildingAssetStatus => ({
    assetId,
    buildingIds: buildingIds.sort((a, b) => a - b),
    state: 'loading',
  }));
  const result: BuildingAssetSet = {
    visuals: new Map(),
    layers: null,
    layerSize: 0,
    layerKinds: [],
    layerLuma: [],
    statuses,
  };
  let manifest: AssetManifest;
  try {
    manifest = await io.manifest(manifestUrl);
  } catch (err) {
    for (const s of statuses) fail(s, `manifest: ${message(err)}`);
    return result;
  }

  const layers = new TextureLayerTable();
  const loaded: {
    entry: AssetEntry;
    status: BuildingAssetStatus;
    scenes: Object3D[];
    lods: BuildingMesh[];
  }[] = [];
  await Promise.all(
    statuses.map(async (status) => {
      const entry = manifest.assets.find((a) => a.id === status.assetId);
      if (!entry) return fail(status, 'not in the manifest');
      if (entry.kind !== 'building')
        return fail(status, `a ${entry.kind} in the manifest, not a building`);
      try {
        const scenes = await Promise.all(
          entry.lods.map(async (lod) => {
            const url = resolveUrl(manifestUrl, lod.path);
            return io.parseGltf(await io.fetchBytes(url), url);
          }),
        );
        // Converted below, sorted on id, so the layer order does not depend on network timing.
        loaded.push({ entry, status, scenes, lods: [] });
      } catch (err) {
        fail(status, message(err));
      }
    }),
  );

  loaded.sort((a, b) => a.entry.id.localeCompare(b.entry.id));
  for (const item of loaded) {
    const teamMaterials = item.entry.teamMaterials ?? [];
    try {
      item.lods = item.scenes.map((scene) =>
        buildingGeometryFromGltf(scene, { teamMaterials, layers }),
      );
    } catch (err) {
      fail(item.status, message(err));
      item.lods = [];
    }
    item.scenes = [];
  }

  for (const { entry, status, lods } of loaded) {
    if (lods.length !== 3) continue;
    // Identical LODs share one geometry: same path, or the same triangle count as the LOD before.
    const geos: BufferGeometry[] = [];
    for (let i = 0; i < 3; i++) {
      const prev = i > 0 ? entry.lods[i - 1]! : null;
      const lod = entry.lods[i]!;
      if (prev && (prev.path === lod.path || lods[i - 1]!.triangles === lods[i]!.triangles)) {
        lods[i]!.geometry.dispose();
        geos.push(geos[i - 1]!);
      } else geos.push(lods[i]!.geometry);
    }
    const footprint = entry.footprint ?? {
      w: Math.max(1, Math.round(entry.bounds.max[0] - entry.bounds.min[0])),
      h: Math.max(1, Math.round(entry.bounds.max[2] - entry.bounds.min[2])),
    };
    const triangles: [number, number, number] = [
      lods[0]!.triangles,
      lods[1]!.triangles,
      lods[2]!.triangles,
    ];
    result.visuals.set(entry.id, {
      assetId: entry.id,
      lods: geos as unknown as BuildingVisual['lods'],
      footprint: { w: footprint.w, h: footprint.h },
      height: Math.max(entry.bounds.max[1], lods[0]!.height),
      triangles,
      ...(entry.albedoGain !== undefined ? { gain: entry.albedoGain } : {}),
    });
    status.state = 'ready';
    status.triangles = triangles;
  }

  if (layers.size > 0) {
    const { texture, size, missing, luma } = createLayerTexture(
      layers.layers,
      opts.rasterize,
      opts.maxLayerSize ?? DEFAULT_LAYER_SIZE,
    );
    result.layers = texture;
    result.layerSize = size;
    result.layerKinds = layers.layers.map((l) => l.kind);
    result.layerLuma = luma;
    if (missing.length > 0)
      for (const s of statuses)
        if (s.state === 'ready')
          s.reason = `texture${missing.length > 1 ? 's' : ''} ${missing.join(', ')} not decoded (flat color)`;
  }
  return result;
}

function fail(status: BuildingAssetStatus, reason: string): void {
  status.state = 'failed';
  status.reason = reason;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
