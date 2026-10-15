// Where a prop's mesh comes from, in order:
//   1. the asset-cli manifest: an entry of kind 'prop' with three LOD GLBs (meters, standing on y = 0);
//   2. the source GLB (assets/src/props), when the client gives a sourceUrl for the id, e.g. before the asset-cli
//      has run;
//   3. a placeholder per kind (propGeometry.ts), unless placeholders are off.
// Every mesh is then fitted to its target height (propFit.ts). Loads are cached per manifest, source URL and id.
// The manifest may add `category` (propCategory.ts) and `alpha: 'mask'` (leaf cards and grass: alpha-tested, two-sided);
// both are optional and read loosely, so an older manifest without them, or an asset-cli that does not write them yet,
// works: alpha-tested materials are also recognised from the GLB itself (alphaMode MASK), the category from the id.
import type { AssetManifest } from '@crawlout/asset-cli/manifest';
import type { BufferGeometry, Object3D, Texture } from 'three/webgpu';
import { TextureLayerTable } from '../structures/buildingGeometry.js';
import { canvasRasterize, createLayerTexture, type Rasterize } from '../structures/textureArray.js';
import { parsePropCategory, propCategoryOf, type PropCategory } from './propCategory.js';
import { propFitScale, propKindOf } from './propFit.js';
import {
  createPlaceholderPropGeometry,
  distinctTextures,
  propGeometryFromGltf,
  type PropMesh,
} from './propGeometry.js';
import type { PropVisual } from './propLayer.js';

export interface PropSourceOptions {
  /** asset-cli manifest.json; default: the renderer's `assets.manifestUrl`; null skips the manifest. */
  manifestUrl?: string | null;
  /** Maps a manifest path to a URL; default: the renderer's `assets.resolveUrl`, else next to manifest.json. */
  resolveUrl?: (path: string) => string;
  /** URL of the source GLB for an asset id that the manifest lacks (undefined: none). */
  sourceUrl?: (assetId: string) => string | undefined;
  /** Placeholder per kind when neither has the asset. Default true. */
  placeholders?: boolean;
  /** Target height in meters per asset id, over PROP_TARGET_HEIGHT. */
  heights?: Readonly<Record<string, number>>;
  /** Category per asset id for assets without one in the manifest (source GLBs, placeholders); else read from the id. */
  categories?: Readonly<Record<string, PropCategory>>;
}

export type PropOrigin = 'manifest' | 'source' | 'placeholder' | 'none';

export interface PropAssetStatus {
  assetId: string;
  /** Props of this asset in the current set. */
  instances: number;
  state: 'loading' | 'ready';
  /** Where the mesh came from; 'none' draws nothing. */
  origin: PropOrigin;
  /** Why the manifest or source was skipped. */
  reason?: string;
  /** What the prop layer treats the asset as (manifest category, else the options, else read from the id). */
  category?: PropCategory;
  /** True when the asset is alpha-tested (drawn two-sided with a mask material). */
  mask?: boolean;
  /** Triangles per LOD. */
  triangles?: [number, number, number];
  /** Drawn height in meters at scale 100 %. */
  height?: number;
}

/** Network and parsing, injectable for tests. */
export interface PropAssetIO {
  manifest(url: string): Promise<AssetManifest>;
  fetchBytes(url: string): Promise<ArrayBuffer>;
  parseGltf(bytes: ArrayBuffer, url: string): Promise<Object3D>;
}

export interface ResolvedProp {
  visual: PropVisual | null;
  origin: PropOrigin;
  reasons: string[];
  triangles?: [number, number, number];
}

interface MeshSet {
  lods: [PropMesh, PropMesh, PropMesh];
  /** Texture array of an asset whose materials use more than one texture (layered layout), else null. */
  layers: Texture | null;
  /** Category from the manifest, if it gave one. */
  category: PropCategory | null;
}

/** `category` and `alpha` of a manifest entry, read loosely (the manifest schema may not have them yet). */
function foliageFields(entry: object): { category: PropCategory | null; forceMask: boolean } {
  const e = entry as { category?: unknown; alpha?: unknown };
  return { category: parsePropCategory(e.category), forceMask: e.alpha === 'mask' };
}

export interface ResolvedSource {
  manifestUrl: string | undefined;
  resolveUrl: (manifestUrl: string, path: string) => string;
  sourceUrl: ((assetId: string) => string | undefined) | undefined;
  placeholders: boolean;
  heights: Readonly<Record<string, number>> | undefined;
  categories?: Readonly<Record<string, PropCategory>> | undefined;
}

export class PropAssetRegistry {
  private readonly cache = new Map<string, Promise<MeshSet>>();
  private readonly owned: (BufferGeometry | Texture)[] = [];

  constructor(
    private readonly io: PropAssetIO,
    /** Draws a texture into pixels for the texture array of multi-texture props (browser canvas by default). */
    private readonly rasterize: Rasterize = canvasRasterize,
  ) {}

  private loadOnce(key: string, load: () => Promise<MeshSet>): Promise<MeshSet> {
    let p = this.cache.get(key);
    if (!p) {
      p = load().then((set) => {
        for (const m of set.lods) {
          if (!this.owned.includes(m.geometry)) this.owned.push(m.geometry);
          if (m.map && !this.owned.includes(m.map)) this.owned.push(m.map);
        }
        if (set.layers) this.owned.push(set.layers);
        return set;
      });
      p.catch(() => this.cache.delete(key));
      this.cache.set(key, p);
    }
    return p;
  }

  private async glb(url: string): Promise<Object3D> {
    return this.io.parseGltf(await this.io.fetchBytes(url), url);
  }

  /**
   * The meshes of LOD scenes (the same scene object gives the same mesh, so identical LODs stay one draw). When a
   * LOD uses more than one texture, all of them take the layered layout with one shared texture array.
   */
  private build(
    roots: readonly [Object3D, Object3D, Object3D],
    forceMask: boolean,
    category: PropCategory | null,
  ): MeshSet {
    const table = roots.some((r) => distinctTextures(r) > 1) ? new TextureLayerTable() : undefined;
    const made = new Map<Object3D, PropMesh>();
    const lods = roots.map((root) => {
      let m = made.get(root);
      if (!m) {
        m = propGeometryFromGltf(root, { forceMask, ...(table ? { layers: table } : {}) });
        made.set(root, m);
      }
      return m;
    }) as MeshSet['lods'];
    const layers = table ? createLayerTexture(table.layers, this.rasterize).texture : null;
    return { lods, layers, category };
  }

  private async fromManifest(
    src: ResolvedSource,
    manifestUrl: string,
    assetId: string,
  ): Promise<MeshSet | null> {
    const manifest = await this.io.manifest(manifestUrl);
    const entry = manifest.assets.find((a) => a.id === assetId);
    if (!entry) return null;
    if (entry.kind !== 'prop')
      throw new Error(`"${assetId}" is a ${entry.kind} in the manifest, not a prop`);
    const { category, forceMask } = foliageFields(entry);
    return this.loadOnce(`m|${manifestUrl}|${assetId}`, async () => {
      // Identical LODs (same file or same triangle count as the one before) share one scene and so one draw.
      const roots: Object3D[] = [];
      for (let i = 0; i < 3; i++) {
        const lod = entry.lods[i]!;
        const prev = i > 0 ? entry.lods[i - 1]! : null;
        if (prev && (prev.path === lod.path || prev.triangles === lod.triangles))
          roots.push(roots[i - 1]!);
        else roots.push(await this.glb(src.resolveUrl(manifestUrl, lod.path)));
      }
      return this.build(roots as [Object3D, Object3D, Object3D], forceMask, category);
    });
  }

  /** The visual for one asset id. Never rejects: what fails is a reason, and the next origin is tried. */
  async resolve(assetId: string, src: ResolvedSource): Promise<ResolvedProp> {
    const reasons: string[] = [];
    let set: MeshSet | null = null;
    let origin: PropOrigin = 'none';
    if (src.manifestUrl) {
      try {
        set = await this.fromManifest(src, src.manifestUrl, assetId);
        if (set) origin = 'manifest';
        else reasons.push('not in the manifest');
      } catch (err) {
        reasons.push(`manifest: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    const url = set ? undefined : src.sourceUrl?.(assetId);
    if (url) {
      try {
        set = await this.loadOnce(`s|${url}`, async () => {
          const root = await this.glb(url);
          return this.build([root, root, root], false, null);
        });
        origin = 'source';
      } catch (err) {
        reasons.push(`source: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (!set && src.placeholders) {
      const kind = propKindOf(assetId);
      set = await this.loadOnce(`p|${kind}`, () => {
        const m = createPlaceholderPropGeometry(kind);
        return Promise.resolve({ lods: [m, m, m], layers: null, category: null });
      });
      origin = 'placeholder';
    }
    if (!set) return { visual: null, origin, reasons };
    const [l0, l1, l2] = set.lods;
    const given = set.category ?? src.categories?.[assetId] ?? null;
    const category = given ?? propCategoryOf(assetId);
    const mask = set.lods.some((m) => m.mask);
    const fit = propFitScale(assetId, l0.height, src.heights, given);
    return {
      visual: {
        lods: [l0.geometry, l1.geometry, l2.geometry],
        map: l0.map,
        layers: set.layers,
        mask,
        category,
        fit,
        height: l0.height,
        radius: l0.radius,
      },
      origin,
      reasons,
      triangles: [l0.triangles, l1.triangles, l2.triangles],
    };
  }

  dispose(): void {
    for (const o of this.owned) o.dispose();
    this.owned.length = 0;
    this.cache.clear();
  }
}
