// Loads a character asset of the asset-cli: manifest.json (tools/asset-cli/src/manifest.ts), the baked bone-matrix
// texture `<id>.anim.f32` and the three LOD GLBs (meshopt, via three's GLTFLoader with the meshopt decoder from
// three/examples). Paths in the manifest are relative to manifest.json; which asset a unit uses is data
// (loadout.visuals.meshSlots.body) or one config value, never a path in code.
import { manifestSchema, type AssetEntry, type AssetManifest } from '@crawlout/asset-cli/manifest';
import type { Object3D } from 'three/webgpu';
import type { BakedAnimations } from './bake.js';
import { bakedAnimationsFromManifest } from './bakedManifest.js';
import { unitGeometryFromGltf, type TeamMaskSource, type UnitGeometryResult } from './gltfUnitGeometry.js';

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
}

export interface UnitAssetLoadOptions {
  teamMask?: TeamMaskSource;
}

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
export function createGltfIO(fetcher: (url: string) => Promise<ArrayBuffer> = fetchBytes): UnitAssetIO {
  let loader: Promise<{ parseAsync(data: ArrayBuffer, path: string): Promise<{ scene: Object3D }> }> | null = null;
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
      const gltf = await (await getLoader()).parseAsync(bytes, url.slice(0, url.lastIndexOf('/') + 1));
      return gltf.scene;
    },
  };
}

export class UnitAssetLoader {
  private readonly manifests = new Map<string, Promise<AssetManifest>>();

  constructor(
    private readonly io: UnitAssetIO = createGltfIO(),
    /** Maps a manifest path to a URL; default resolves it next to manifest.json. */
    private readonly resolveUrl: (manifestUrl: string, path: string) => string = resolveManifestPath,
  ) {}

  /** The parsed manifest, fetched once per URL. */
  manifest(manifestUrl: string): Promise<AssetManifest> {
    let m = this.manifests.get(manifestUrl);
    if (!m) {
      m = (async () => {
        const bytes = await this.io.fetchBytes(manifestUrl);
        const parsed = manifestSchema.safeParse(JSON.parse(new TextDecoder().decode(bytes)));
        if (!parsed.success) throw new UnitAssetError(`invalid manifest ${manifestUrl}: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
        return parsed.data;
      })();
      m.catch(() => this.manifests.delete(manifestUrl));
      this.manifests.set(manifestUrl, m);
    }
    return m;
  }

  /** True when the manifest lists `assetId` as a character with baked clips. */
  async has(manifestUrl: string, assetId: string): Promise<boolean> {
    const m = await this.manifest(manifestUrl);
    return m.assets.some((a) => a.id === assetId && a.kind === 'character' && a.baked !== undefined);
  }

  /** Loads one character asset completely. Rejects (UnitAssetError and friends) when anything does not fit. */
  async load(manifestUrl: string, assetId: string, opts: UnitAssetLoadOptions = {}): Promise<LoadedUnitAsset> {
    const manifest = await this.manifest(manifestUrl);
    const entry = manifest.assets.find((a) => a.id === assetId);
    if (!entry) throw new UnitAssetError(`asset "${assetId}" is not in ${manifestUrl}`);
    if (entry.kind !== 'character') throw new UnitAssetError(`asset "${assetId}" is a ${entry.kind}, not a character`);
    const baked = entry.baked;
    if (!baked) throw new UnitAssetError(`asset "${assetId}" has no baked animations`);
    const url = (path: string): string => this.resolveUrl(manifestUrl, path);

    const [animBytes, ...glbs] = await Promise.all([
      this.io.fetchBytes(url(baked.path)),
      ...entry.lods.map((lod) => this.io.fetchBytes(url(lod.path))),
    ]);
    const anims = bakedAnimationsFromManifest(baked, entry.boneCount, animBytes!);
    const lods = await Promise.all(
      entry.lods.map(async (lod, i) => {
        const scene = await this.io.parseGltf(glbs[i]!, url(lod.path));
        return unitGeometryFromGltf(scene, { boneCount: entry.boneCount, ...(opts.teamMask ? { teamMask: opts.teamMask } : {}) });
      }),
    );
    return { id: assetId, entry, anims, lods: lods as LoadedUnitAsset['lods'] };
  }
}
