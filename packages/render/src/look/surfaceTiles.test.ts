// The shared surface tiles of the manifest (look/surfaceTiles.ts). Two halves: the loader, with a stubbed decoder so
// no browser is needed, and the applier, which has to behave exactly like an embedded map from the layer table's
// point of view. The second half runs against the real assets/dist, so a build that stops marking its materials, or
// a prune that eats TEXCOORD_0, fails here instead of in a flat-looking screenshot.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MeshStandardMaterial, Mesh, Object3D, BufferGeometry } from 'three/webgpu';
import { manifestSchema, SURFACE_EXTRA, type AssetManifest } from '@crawlout/asset-cli/manifest';
import {
  applySurfaceTiles,
  clearSurfaceTileCache,
  loadSurfaceTiles,
  surfaceTileKindOf,
  surfaceTilesFor,
  type SurfaceTileIO,
} from './surfaceTiles.js';
import { createGltfIO } from '../units/unitAssetLoader.js';
import { NO_LAYER, TextureLayerTable } from '../structures/buildingGeometry.js';

const DIST = fileURLToPath(new URL('../../../../assets/dist/', import.meta.url));

async function distBytes(url: string): Promise<ArrayBuffer> {
  const b = await readFile(DIST + url.replace('dist://', ''));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

/** Node has no image decoder; a stand-in that only knows its size is all the layer table reads. */
const stubIO = (
  fetchBytes: (url: string) => Promise<ArrayBuffer>,
  size = 256,
): SurfaceTileIO => ({
  fetchBytes,
  decodeImage: () => Promise.resolve({ width: size, height: size }),
});

function manifestWith(surfaces: AssetManifest['surfaces']): AssetManifest {
  return { version: 1, assets: [], ...(surfaces ? { surfaces } : {}) } as AssetManifest;
}

const TILES = {
  size: 128,
  metersPerTile: 2,
  tiles: [
    { kind: 'cloth', base: 's/cloth.base.jpg', normal: 's/cloth.normal.jpg', mr: 's/cloth.mr.jpg' },
    { kind: 'wood', base: 's/wood.base.jpg', normal: 's/wood.normal.jpg', mr: 's/wood.mr.jpg' },
  ],
} as AssetManifest['surfaces'];

/** A mesh with one material, the shape every loader hands to applySurfaceTiles. */
function sceneWith(...materials: MeshStandardMaterial[]): Object3D {
  const root = new Object3D();
  for (const material of materials) root.add(new Mesh(new BufferGeometry(), material));
  return root;
}

function marked(name: string, kind: string): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ name });
  m.userData = { [SURFACE_EXTRA]: kind };
  return m;
}

beforeEach(() => clearSurfaceTileCache());
afterEach(() => vi.unstubAllGlobals());

describe('loading the shared surface tiles', () => {
  it('is null for a manifest without a surfaces block (an older build embeds its own maps)', async () => {
    const io = stubIO(() => Promise.reject(new Error('should not fetch')));
    expect(await loadSurfaceTiles(manifestWith(undefined), (p) => p, io)).toBeNull();
  });

  it('fetches three files per kind and keeps the size and scale from the manifest', async () => {
    const asked: string[] = [];
    const io = stubIO((url) => {
      asked.push(url);
      return Promise.resolve(new ArrayBuffer(4));
    });
    const set = (await loadSurfaceTiles(manifestWith(TILES), (p) => `base/${p}`, io))!;
    expect(set).not.toBeNull();
    expect(set.size).toBe(128);
    expect(set.metersPerTile).toBe(2);
    expect([...set.byKind.keys()].sort()).toEqual(['cloth', 'wood']);
    expect(asked.length).toBe(6);
    expect(asked.every((u) => u.startsWith('base/s/'))).toBe(true);
    // Base colour is sRGB, the two data maps are not; a normal map marked sRGB is worse than no normal map.
    const wood = set.byKind.get('wood')!;
    expect(wood.base.colorSpace).not.toBe(wood.normal.colorSpace);
    expect(wood.normal.colorSpace).toBe(wood.mr.colorSpace);
  });

  it('skips a kind whose files fail instead of failing the load', async () => {
    const io = stubIO((url) =>
      url.includes('cloth') ? Promise.reject(new Error('HTTP 404')) : Promise.resolve(new ArrayBuffer(4)),
    );
    const set = (await loadSurfaceTiles(manifestWith(TILES), (p) => p, io))!;
    expect(set.missing).toEqual(['cloth']);
    expect([...set.byKind.keys()]).toEqual(['wood']);
  });

  it('is null when not one tile decoded', async () => {
    const io: SurfaceTileIO = {
      fetchBytes: () => Promise.resolve(new ArrayBuffer(4)),
      decodeImage: () => Promise.resolve(null),
    };
    expect(await loadSurfaceTiles(manifestWith(TILES), (p) => p, io)).toBeNull();
  });

  it('fetches once per manifest url, however many loaders ask', async () => {
    let fetches = 0;
    const io = stubIO(() => {
      fetches++;
      return Promise.resolve(new ArrayBuffer(4));
    });
    const manifest = manifestWith(TILES);
    const [a, b] = await Promise.all([
      surfaceTilesFor('m.json', manifest, (p) => p, io),
      surfaceTilesFor('m.json', manifest, (p) => p, io),
    ]);
    expect(a).toBe(b);
    expect(fetches).toBe(6);
  });
});

describe('hanging a shared tile on a material', () => {
  it('fills base, normal and metallic-roughness of a marked material', async () => {
    const io = stubIO(() => Promise.resolve(new ArrayBuffer(4)));
    const tiles = await loadSurfaceTiles(manifestWith(TILES), (p) => p, io);
    const material = marked('plank', 'wood');
    expect(applySurfaceTiles(sceneWith(material), tiles)).toBe(1);
    expect(material.map).toBe(tiles!.byKind.get('wood')!.base);
    expect(material.normalMap).toBe(tiles!.byKind.get('wood')!.normal);
    // glTF points roughness and metalness at one metallicRoughness texture; so does the layer table.
    expect(material.roughnessMap).toBe(tiles!.byKind.get('wood')!.mr);
    expect(material.metalnessMap).toBe(material.roughnessMap);
  });

  it('is idempotent and never overwrites a map the GLB already had', async () => {
    const io = stubIO(() => Promise.resolve(new ArrayBuffer(4)));
    const tiles = await loadSurfaceTiles(manifestWith(TILES), (p) => p, io);
    const material = marked('plank', 'wood');
    const scene = sceneWith(material);
    // Several LODs can share one scene object, so a second pass has to be a no-op.
    expect(applySurfaceTiles(scene, tiles)).toBe(1);
    expect(applySurfaceTiles(scene, tiles)).toBe(0);

    const own = marked('painted', 'cloth');
    own.map = tiles!.byKind.get('wood')!.base;
    expect(applySurfaceTiles(sceneWith(own), tiles)).toBe(0);
    expect(own.normalMap).toBeNull();
  });

  it('leaves unmarked materials and unknown kinds alone, and does nothing without tiles', async () => {
    const io = stubIO(() => Promise.resolve(new ArrayBuffer(4)));
    const tiles = await loadSurfaceTiles(manifestWith(TILES), (p) => p, io);
    const plain = new MeshStandardMaterial({ name: 'frame_wood' });
    const nonsense = marked('odd', 'marsepein');
    const unlisted = marked('steel', 'paintedMetal'); // a kind this manifest has no tile for
    expect(applySurfaceTiles(sceneWith(plain, nonsense, unlisted), tiles)).toBe(0);
    expect(plain.map).toBeNull();
    expect(surfaceTileKindOf(plain)).toBeNull();
    expect(surfaceTileKindOf(nonsense)).toBeNull();
    expect(surfaceTileKindOf(unlisted)).toBe('paintedMetal');
    expect(applySurfaceTiles(sceneWith(marked('plank', 'wood')), null)).toBe(0);
  });
});

describe('against assets/dist', () => {
  it('gives every marked material of a real building a texture layer', async () => {
    // Node has no image decoder; GLTFLoader needs both of these to get through the GLB's own textures.
    vi.stubGlobal('self', globalThis);
    vi.stubGlobal('createImageBitmap', () =>
      Promise.resolve({ width: 512, height: 512, close() {} }),
    );
    const manifest = manifestSchema.parse(
      JSON.parse(await readFile(DIST + 'manifest.json', 'utf8')),
    ) as AssetManifest;
    expect(manifest.surfaces, 'the build writes a surfaces block').toBeDefined();
    const tiles = (await loadSurfaceTiles(
      manifest,
      (p) => `dist://${p}`,
      stubIO(distBytes, manifest.surfaces!.size),
    ))!;
    expect(tiles.missing).toEqual([]);

    const entry = manifest.assets.find((a) => a.id === 'dweller_building_hq')!;
    const url = `dist://${entry.lods[0].path}`;
    const scene = await createGltfIO(distBytes).parseGltf(await distBytes(url), url);
    // The HQ's steel and team band are flat materials with a generated surface; before the tile they have no map.
    type Marked = Parameters<TextureLayerTable['layerOf']>[0] & {
      name: string;
      userData?: Record<string, unknown>;
    };
    const marked: Marked[] = [];
    scene.traverse((o) => {
      const m = (o as { material?: Marked }).material;
      if (m?.userData?.[SURFACE_EXTRA]) marked.push(m);
    });
    expect(marked.map((m) => m.name).sort()).toEqual(['metal', 'team_trim']);
    expect(applySurfaceTiles(scene, tiles)).toBe(2);

    // The layer table is the thing that must not see a difference with an embedded copy: every marked material has to
    // reach a layer at the tile's size, with both extra maps on it. Resolve through layerOf rather than by material
    // name, because that is what the geometry does: two materials of one surface kind are handed the very same tile
    // images and therefore share a layer (buildingGeometry.ts), which is the whole point of sharing the tile. The HQ's
    // `metal` and `team_trim` are both paintedMetal, so they land on one layer that carries the first one's name.
    const table = new TextureLayerTable();
    scene.traverse((o) => {
      const m = (o as { material?: Parameters<TextureLayerTable['layerOf']>[0] }).material;
      if (m) table.layerOf(m);
    });
    for (const m of marked) {
      const index = table.layerOf(m);
      expect(index, m.name).not.toBe(NO_LAYER);
      const layer = table.layers[index]!;
      expect(layer.width, m.name).toBe(manifest.surfaces!.size);
      expect(layer.normalImage, m.name).not.toBeNull();
      expect(layer.mrImage, m.name).not.toBeNull();
    }
    // Sharing the kind has to mean sharing the layer, or the saving is not real.
    expect(new Set(marked.map((m) => table.layerOf(m))).size).toBe(1);
  });
});
