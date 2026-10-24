// Loads a character asset of the asset-cli: manifest.json (tools/asset-cli/src/manifest.ts), the baked bone-matrix
// texture `<id>.anim.f32` and the three LOD GLBs (meshopt, via three's GLTFLoader with the meshopt decoder from
// three/examples). Paths in the manifest are relative to manifest.json; which asset a unit uses is data
// (loadout.visuals.meshSlots.body) or one config value, never a path in code.
import { manifestSchema, type AssetEntry, type AssetManifest } from '@crawlout/asset-cli/manifest';
import type { DataArrayTexture, Object3D } from 'three/webgpu';
import { TextureLayerTable } from '../structures/buildingGeometry.js';
import {
  budgetedLayerSize,
  createLayerTexture,
  DEFAULT_LAYER_SIZE,
  imageRasterize,
  layerArrayBytes,
  type Rasterize,
} from '../structures/textureArray.js';
import type { BakedAnimations } from './bake.js';
import { applyCharacterFit, bakedAnimationsFromManifest, characterFit } from './bakedManifest.js';
import {
  loadRigidUnitAsset,
  type LoadedRigidAsset,
  type RigidUnitLoadOptions,
} from './rigidUnitAssetLoader.js';
import { splitRigidEntries, type RigidAssetEntry } from './rigidUnitManifest.js';
import {
  unitGeometryFromGltf,
  type TeamMaskSource,
  type UnitGeometryResult,
} from './gltfUnitGeometry.js';

export class UnitAssetError extends Error {
  override name = 'UnitAssetError';
}

/** Network and GLB parsing, injectable for tests. */
export interface UnitAssetIO {
  fetchBytes(url: string): Promise<ArrayBuffer>;
  /** Parses a GLB into a scene graph; `url` is where it came from (base for external resources). */
  parseGltf(bytes: ArrayBuffer, url: string): Promise<Object3D>;
}

export interface LoadedUnitAsset {
  id: string;
  entry: AssetEntry;
  anims: BakedAnimations;
  /** LOD 0, 1, 2 in the unit vertex layout. */
  lods: [UnitGeometryResult, UnitGeometryResult, UnitGeometryResult];
  /**
   * The asset's diffuse textures as one array (one layer per source material, shared by the three LODs), sampled
   * with the geometry's uvl attribute. Null when the asset has no texture at all.
   */
  layers: DataArrayTexture | null;
  /**
   * The tangent-space normal maps on the very same layer indices, linear, or null when no material has one. A
   * material without a normal map gets a flat (0.5, 0.5, 1) layer, so one array always covers the whole asset.
   */
  normalLayers: DataArrayTexture | null;
  /**
   * The glTF metallicRoughness maps (G = roughness, B = metalness) on the same layer indices, linear. Always built
   * when the asset has layers: a material without the map gets its own roughnessFactor/metallicFactor as a flat
   * layer, so leather, cloth and metal still answer differently.
   */
  mrLayers: DataArrayTexture | null;
  /** Edge of the array layers in pixels (0 without layers). */
  layerSize: number;
  /**
   * What the arrays of this asset cost on the GPU, before the mip chain: layers * edge^2 * 4 over the arrays that
   * were actually built (base, and normal and metallicRoughness when they exist). The number to watch when a
   * character's textures get heavy; see layerArrayBytes.
   */
  layerBytes: number;
  /** Layers whose image could not be rasterized (they are white). */
  missingLayers: string[];
  /** How many layers carry a real normal map and a real metallicRoughness map (the rest are the flat fallback). */
  mapCounts: { normal: number; mr: number };
}

export interface UnitAssetLoadOptions {
  /** Default: the manifest's teamMask. 'auto' tests the atlas alpha (for manifests without the field). */
  teamMask?: TeamMaskSource;
  /**
   * Reads a texture's pixels for the array layers, the mask test and the team pivot; default WebGL2 with the 2D
   * canvas as the fallback (null outside a browser). It must keep the rgb under a transparent texel: the team mask
   * lives in the diffuse alpha, so most of a character's map is alpha 0 and a premultiplying path returns it black.
   */
  rasterize?: Rasterize;
  /**
   * Edge of the array layers in pixels. Default: budgetedLayerSize of the asset's layer count (textureArray.ts), so
   * an atlased asset keeps 2048 and a 23-material one drops to 512 instead of spending 96 MB per map kind. The edge
   * never exceeds the largest source image, so the asset-cli stays in charge of what is actually exported.
   */
  layerSize?: number;
}

/** Fallback edge of a character's array layers when the budget is not applied; see UnitAssetLoadOptions.layerSize. */
export const UNIT_LAYER_SIZE = DEFAULT_LAYER_SIZE;

/** Resolves a manifest path against the manifest's own URL (absolute or relative to the page). */
export function resolveManifestPath(manifestUrl: string, path: string): string {
  const base = typeof location !== 'undefined' ? location.href : 'file:///';
  return new URL(path, new URL(manifestUrl, base)).href;
}

async function fetchBytes(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new UnitAssetError(`${url}: HTTP ${res.status}`);
  return res.arrayBuffer();
}

/** GLTFLoader with the meshopt decoder, loaded on first use so the renderer bundle stays lean without assets. */
export function createGltfIO(
  fetcher: (url: string) => Promise<ArrayBuffer> = fetchBytes,
): UnitAssetIO {
  let loader: Promise<{
    parseAsync(data: ArrayBuffer, path: string): Promise<{ scene: Object3D }>;
  }> | null = null;
  const getLoader = () =>
    (loader ??= (async () => {
      const [{ GLTFLoader }, { MeshoptDecoder }] = await Promise.all([
        import('three/examples/jsm/loaders/GLTFLoader.js'),
        import('three/examples/jsm/libs/meshopt_decoder.module.js'),
      ]);
      await MeshoptDecoder.ready;
      return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    })());
  return {
    fetchBytes: fetcher,
    async parseGltf(bytes, url) {
      const gltf = await (
        await getLoader()
      ).parseAsync(bytes, url.slice(0, url.lastIndexOf('/') + 1));
      return gltf.scene;
    },
  };
}

interface ParsedManifest {
  manifest: AssetManifest;
  rigid: ReadonlyMap<string, RigidAssetEntry | string>;
}

export class UnitAssetLoader {
  private readonly manifests = new Map<string, Promise<ParsedManifest>>();

  constructor(
    private readonly io: UnitAssetIO = createGltfIO(),
    /** Maps a manifest path to a URL; default resolves it next to manifest.json. */
    private readonly resolveUrl: (
      manifestUrl: string,
      path: string,
    ) => string = resolveManifestPath,
  ) {}

  private parsed(manifestUrl: string): Promise<ParsedManifest> {
    let m = this.manifests.get(manifestUrl);
    if (!m) {
      m = (async () => {
        const bytes = await this.io.fetchBytes(manifestUrl);
        // Rigid units (robots) are split off before the schema sees the manifest: it knows characters, props and
        // buildings, and a rigid entry has its own (render-side) shape, see rigidUnitManifest.ts.
        const { rest, rigid } = splitRigidEntries(JSON.parse(new TextDecoder().decode(bytes)));
        const parsed = manifestSchema.safeParse(rest);
        if (!parsed.success)
          throw new UnitAssetError(
            `invalid manifest ${manifestUrl}: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
          );
        return { manifest: parsed.data, rigid };
      })();
      m.catch(() => this.manifests.delete(manifestUrl));
      this.manifests.set(manifestUrl, m);
    }
    return m;
  }

  /** The parsed manifest (without its rigid units), fetched once per URL. */
  async manifest(manifestUrl: string): Promise<AssetManifest> {
    return (await this.parsed(manifestUrl)).manifest;
  }

  /**
   * The rigid units of the manifest by asset id: the entry, or the reason a rigid entry is unusable (so a loadout that
   * names it can say why it falls back to the humanoid).
   */
  async rigidEntries(manifestUrl: string): Promise<ReadonlyMap<string, RigidAssetEntry | string>> {
    return (await this.parsed(manifestUrl)).rigid;
  }

  /** Loads one rigid unit (robot) asset. Rejects with the reason when the entry or a GLB is unusable. */
  async loadRigid(
    manifestUrl: string,
    assetId: string,
    opts: RigidUnitLoadOptions = {},
  ): Promise<LoadedRigidAsset> {
    const entry = (await this.rigidEntries(manifestUrl)).get(assetId);
    if (entry === undefined)
      throw new UnitAssetError(`asset "${assetId}" is not a rigid unit in ${manifestUrl}`);
    if (typeof entry === 'string') throw new UnitAssetError(`rigid unit "${assetId}": ${entry}`);
    return loadRigidUnitAsset(this.io, (path) => this.resolveUrl(manifestUrl, path), entry, opts);
  }

  /** True when the manifest lists `assetId` as a character with baked clips. */
  async has(manifestUrl: string, assetId: string): Promise<boolean> {
    const m = await this.manifest(manifestUrl);
    return m.assets.some(
      (a) => a.id === assetId && a.kind === 'character' && a.baked !== undefined,
    );
  }

  /** Loads one character asset completely. Rejects (UnitAssetError and friends) when anything does not fit. */
  async load(
    manifestUrl: string,
    assetId: string,
    opts: UnitAssetLoadOptions = {},
  ): Promise<LoadedUnitAsset> {
    const manifest = await this.manifest(manifestUrl);
    const entry = manifest.assets.find((a) => a.id === assetId);
    if (!entry) throw new UnitAssetError(`asset "${assetId}" is not in ${manifestUrl}`);
    if (entry.kind !== 'character')
      throw new UnitAssetError(`asset "${assetId}" is a ${entry.kind}, not a character`);
    const baked = entry.baked;
    if (!baked) throw new UnitAssetError(`asset "${assetId}" has no baked animations`);
    const url = (path: string): string => this.resolveUrl(manifestUrl, path);
    // An explicit option wins ('auto' reads the atlas); otherwise the asset says where its team mask lives (manifest
    // `teamMask`, absent means 'materialName' by the manifest contract).
    const teamMask = opts.teamMask ?? entry.teamMask ?? 'materialName';

    const [animBytes, ...glbs] = await Promise.all([
      this.io.fetchBytes(url(baked.path)),
      ...entry.lods.map((lod) => this.io.fetchBytes(url(lod.path))),
    ]);
    const anims = bakedAnimationsFromManifest(baked, entry.boneCount, animBytes!);
    applyCharacterFit(anims, characterFit(entry.bounds)); // 1.8 m, feet on y = 0 (bakedManifest.ts)
    const scenes = await Promise.all(
      entry.lods.map((lod, i) => this.io.parseGltf(glbs[i]!, url(lod.path))),
    );
    // LOD 0 resolves the team mask ('auto' reads its textures) and measures the team pivot; the lighter LODs follow
    // it. The three LODs share one layer table keyed on material name, so a part that keeps its material across the
    // LODs keeps its layer and nothing is uploaded twice.
    const rasterize = opts.rasterize ?? imageRasterize;
    const layerTable = new TextureLayerTable();
    const lod0 = unitGeometryFromGltf(scenes[0]!, {
      boneCount: entry.boneCount,
      teamMask,
      rasterize,
      palette: entry.palette,
      layers: layerTable,
    });
    const rest = scenes.slice(1).map((scene) =>
      unitGeometryFromGltf(scene, {
        boneCount: entry.boneCount,
        teamMask: lod0.teamMask,
        rasterize,
        palette: entry.palette,
        layers: layerTable,
      }),
    );
    // Not a flat 1024: the edge follows the layer count under a byte budget, so one merged atlas layer gets the full
    // 2048 and a model with 23 separate materials lands on 512 instead of 96 MB per map kind (textureArray.ts).
    const edge = opts.layerSize ?? budgetedLayerSize(layerTable.size);
    const build = (kind: 'base' | 'normal' | 'mr') =>
      createLayerTexture(layerTable.layers, rasterize, edge, kind);
    const built = layerTable.size > 0 ? build('base') : null;
    if (built) built.texture.name = `crawlout-unit-layers-${assetId}`;
    // The normal array only exists when at least one material brings a normal map: without one it would be a whole
    // extra array of flat (0.5, 0.5, 1) texels and a sample per fragment for nothing. The metallicRoughness array is
    // worth building either way, because its fallback carries the material's own roughness and metalness factors.
    const hasNormal = layerTable.has('normal');
    const normal = built && hasNormal ? build('normal') : null;
    if (normal) normal.texture.name = `crawlout-unit-normal-${assetId}`;
    const mr = built ? build('mr') : null;
    if (mr) mr.texture.name = `crawlout-unit-mr-${assetId}`;
    const counts = {
      normal: layerTable.layers.filter((l) => l.normalImage).length,
      mr: layerTable.layers.filter((l) => l.mrImage).length,
    };
    return {
      id: assetId,
      entry,
      anims,
      lods: [lod0, rest[0]!, rest[1]!],
      layers: built?.texture ?? null,
      normalLayers: normal?.texture ?? null,
      mrLayers: mr?.texture ?? null,
      layerSize: built?.size ?? 0,
      layerBytes: built
        ? layerArrayBytes(
            layerTable.size,
            built.size,
            1 + (normal ? 1 : 0) + (mr ? 1 : 0),
          )
        : 0,
      missingLayers: built?.missing ?? [],
      mapCounts: counts,
    };
  }
}
