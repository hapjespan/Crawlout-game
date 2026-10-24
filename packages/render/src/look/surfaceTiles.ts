// The shared surface tiles of the asset-cli manifest: the generated relief of a procedural material lives in one file
// set next to manifest.json instead of a copy inside every GLB that uses it.
//
// The contract (docs/fase-0/28-contract-gedeelde-oppervlaktetegels.md): a flat material in a LOD GLB that uses a
// generated surface carries no texture at all, only the glTF extra `surface` with the name of its surface kind
// (three's GLTFLoader puts material extras on `material.userData`). The manifest's `surfaces` block says where the
// base, normal and metallic-roughness tile of that kind live.
//
// This module closes the gap: load the tiles once per manifest, then hang them on the marked materials of a parsed
// scene before anything downstream looks at it. From the texture layer table onwards nothing can tell the difference
// with an embedded copy - same uv set, same size, same layer per material name.
import {
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RepeatWrapping,
  SRGBColorSpace,
  Texture,
  type Material,
  type Object3D,
} from 'three/webgpu';
import { SURFACE_EXTRA, type AssetManifest } from '@crawlout/asset-cli/manifest';
import { SURFACE_KINDS, type SurfaceKind } from './surfaces.js';

/** The three maps of one kind, ready to hang on a material. */
export interface SurfaceTileTextures {
  base: Texture;
  normal: Texture;
  mr: Texture;
}

export interface SurfaceTileSet {
  /** Texel edge of every tile (manifest `surfaces.size`). */
  size: number;
  /** Metres one tile covers in the assets' uv (manifest `surfaces.metersPerTile`). */
  metersPerTile: number;
  byKind: ReadonlyMap<SurfaceKind, SurfaceTileTextures>;
  /** Kinds whose tile did not load; their materials stay flat. */
  missing: string[];
}

/** Network and decoding, injectable so tests run without a browser. */
export interface SurfaceTileIO {
  fetchBytes(url: string): Promise<ArrayBuffer>;
  /** Image bytes to something a Rasterize can draw; the default makes an ImageBitmap. */
  decodeImage?(bytes: ArrayBuffer, mimeType: string): Promise<unknown>;
}

/** Materials three's GLTFLoader produces for a glTF metallic-roughness material. */
interface MaterialLike extends Material {
  map?: Texture | null;
  normalMap?: Texture | null;
  roughnessMap?: Texture | null;
  metalnessMap?: Texture | null;
}

const MIME: Readonly<Record<string, string>> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

function mimeTypeOf(path: string): string {
  return MIME[path.slice(path.lastIndexOf('.') + 1).toLowerCase()] ?? 'application/octet-stream';
}

async function defaultDecodeImage(bytes: ArrayBuffer, mimeType: string): Promise<unknown> {
  if (typeof createImageBitmap !== 'function') return null;
  return createImageBitmap(new Blob([bytes], { type: mimeType }));
}

function makeTexture(image: unknown, srgb: boolean, name: string): Texture {
  const texture = new Texture(image as Texture['image']);
  // Tiles repeat (the uv runs outside 0..1) and the layer array they end up in repeats too.
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  // Base colour is sRGB; normal and metallic-roughness are data. Marking a normal map sRGB bends every vector
  // towards +z and looks worse than no normal map at all.
  texture.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
  // glTF convention, the same orientation GLTFLoader gives an embedded map.
  texture.flipY = false;
  texture.name = name;
  texture.needsUpdate = true;
  return texture;
}

const KINDS = new Set<string>(SURFACE_KINDS);

/**
 * Loads the tile files of a manifest. Resolves with null when the manifest has no `surfaces` block (an older build,
 * where every GLB still carries its own copy) or when not one tile could be decoded. A kind whose files fail lands in
 * `missing` and its materials stay flat; a tile is never a reason to fail an asset.
 */
export async function loadSurfaceTiles(
  manifest: AssetManifest,
  resolveUrl: (path: string) => string,
  io: SurfaceTileIO,
): Promise<SurfaceTileSet | null> {
  const surfaces = manifest.surfaces;
  if (!surfaces) return null;
  const decode = io.decodeImage ?? defaultDecodeImage;
  const byKind = new Map<SurfaceKind, SurfaceTileTextures>();
  const missing: string[] = [];
  await Promise.all(
    surfaces.tiles.map(async (tile) => {
      if (!KINDS.has(tile.kind)) {
        missing.push(tile.kind);
        return;
      }
      try {
        const [base, normal, mr] = await Promise.all(
          ([tile.base, tile.normal, tile.mr] as const).map(async (path) => {
            const image = await decode(await io.fetchBytes(resolveUrl(path)), mimeTypeOf(path));
            if (!image) throw new Error(`${path}: not decoded`);
            return image;
          }),
        );
        const textures: SurfaceTileTextures = {
          base: makeTexture(base, true, `surface-${tile.kind}-base`),
          normal: makeTexture(normal, false, `surface-${tile.kind}-normal`),
          mr: makeTexture(mr, false, `surface-${tile.kind}-mr`),
        };
        byKind.set(tile.kind as SurfaceKind, textures);
      } catch {
        missing.push(tile.kind);
      }
    }),
  );
  if (byKind.size === 0) return null;
  missing.sort();
  return { size: surfaces.size, metersPerTile: surfaces.metersPerTile, byKind, missing };
}

/**
 * The tile set of one manifest, loaded once per manifest URL. The tiles are an immutable build artifact that every
 * loader (buildings, props, attachments, rigid units) shares, so they are cached here rather than passed around: a
 * client that loads four kinds of asset from one manifest still fetches the tile files once.
 *
 * The cached set is shared, so no caller disposes it; `clearSurfaceTileCache` does that for the whole cache.
 */
const CACHE = new Map<string, Promise<SurfaceTileSet | null>>();

export function surfaceTilesFor(
  manifestUrl: string,
  manifest: AssetManifest,
  resolveUrl: (path: string) => string,
  io: SurfaceTileIO,
): Promise<SurfaceTileSet | null> {
  let p = CACHE.get(manifestUrl);
  if (!p) {
    p = loadSurfaceTiles(manifest, resolveUrl, io);
    p.catch(() => CACHE.delete(manifestUrl));
    CACHE.set(manifestUrl, p);
  }
  return p;
}

/** Drops and disposes everything `surfaceTilesFor` holds. For tests and a full renderer teardown. */
export function clearSurfaceTileCache(): void {
  for (const pending of CACHE.values())
    void pending.then((set) => {
      for (const textures of set?.byKind.values() ?? [])
        for (const t of [textures.base, textures.normal, textures.mr]) t.dispose();
    });
  CACHE.clear();
}

function materialsOf(object: Object3D): MaterialLike[] {
  const m = (object as { material?: Material | Material[] }).material;
  if (!m) return [];
  return (Array.isArray(m) ? m : [m]) as MaterialLike[];
}

/** The surface kind a material was marked with by the asset-cli, or null. */
export function surfaceTileKindOf(material: Material): SurfaceKind | null {
  const kind: unknown = (material.userData as Record<string, unknown> | undefined)?.[SURFACE_EXTRA];
  return typeof kind === 'string' && KINDS.has(kind) ? (kind as SurfaceKind) : null;
}

/**
 * Hangs the shared tiles on every marked material of `root`. Idempotent and safe to call on a scene that several LODs
 * share: a material that already has a base colour map is left alone, so an embedded map (an older build, or a
 * material with real art) is never overwritten.
 *
 * Call this between parsing a GLB and handing it to the geometry builders: the texture layer table reads the image
 * sizes to pick a layer and to rescale the uv for texel density, so the tile has to be in place first.
 *
 * Returns how many materials were given a tile.
 */
export function applySurfaceTiles(root: Object3D, tiles: SurfaceTileSet | null): number {
  if (!tiles) return 0;
  let applied = 0;
  root.traverse((object) => {
    for (const material of materialsOf(object)) {
      if (material.map) continue;
      const kind = surfaceTileKindOf(material);
      if (!kind) continue;
      const set = tiles.byKind.get(kind);
      if (!set) continue;
      material.map = set.base;
      material.normalMap = set.normal;
      material.roughnessMap = set.mr;
      material.metalnessMap = set.mr;
      material.needsUpdate = true;
      applied++;
    }
  });
  return applied;
}
