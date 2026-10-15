import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { Vector3 } from 'three';
import { manifestSchema, type AssetManifest } from '@crawlout/asset-cli/manifest';
import { surfaceOfIndex } from '../look/surfaces.js';
import { createGltfIO } from '../units/unitAssetLoader.js';
import { buildingMeshes, loadBuildingAssets, type BuildingAssetIO } from './buildingAssets.js';
import { NO_LAYER } from './buildingGeometry.js';

const DIST = fileURLToPath(new URL('../../../../assets/dist/', import.meta.url));

async function distIO(): Promise<{ io: BuildingAssetIO; requested: string[] }> {
  const requested: string[] = [];
  const fetchBytes = async (url: string): Promise<ArrayBuffer> => {
    requested.push(url);
    const b = await readFile(DIST + url.replace('dist://', ''));
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  };
  const gltf = createGltfIO(fetchBytes);
  const manifest = manifestSchema.parse(
    JSON.parse(await readFile(DIST + 'manifest.json', 'utf8')),
  ) as AssetManifest;
  return {
    io: { manifest: async () => manifest, fetchBytes, parseGltf: (b, u) => gltf.parseGltf(b, u) },
    requested,
  };
}

const MESHES = new Map<number, string>([
  [0, 'dweller_building_hq'],
  [1, 'dweller_building_housing'],
  [3, 'dweller_building_beacon'],
  [5, 'dweller_building_turret'],
  [9, 'not_there'],
]);

describe('building assets from assets/dist', () => {
  it('turns every LOD into one geometry with team mask and texture layers', async () => {
    // Node has no image decoder: a stand-in bitmap that only knows its size (from the JPEG header is overkill, the
    // rasterizer below never draws it), so the layers stay white.
    vi.stubGlobal('self', globalThis);
    vi.stubGlobal('createImageBitmap', async () => ({ width: 512, height: 512, close() {} }));
    const { io } = await distIO();
    const rasterized: number[] = [];
    const set = await loadBuildingAssets(
      io,
      'dist://manifest.json',
      (_m, p) => `dist://${p}`,
      MESHES,
      {
        rasterize: (_img, size) => (rasterized.push(size), null),
      },
    );
    vi.unstubAllGlobals();
    const byId = new Map(set.statuses.map((s) => [s.assetId, s]));
    expect(byId.get('not_there')).toMatchObject({ state: 'failed', reason: 'not in the manifest' });
    expect(byId.get('dweller_building_hq')).toMatchObject({ state: 'ready', buildingIds: [0] });

    const hq = set.visuals.get('dweller_building_hq')!;
    expect(hq.footprint).toEqual({ w: 21, h: 21 });
    expect(hq.height).toBeCloseTo(13.1, 1);
    expect(hq.triangles).toEqual([2343, 942, 278]);
    const g = hq.lods[0];
    for (const name of ['position', 'normal', 'color', 'uvl'])
      expect(g.getAttribute(name)).toBeDefined();
    const color = g.getAttribute('color');
    const uvl = g.getAttribute('uvl');
    let team = 0;
    let textured = 0;
    let flat = 0;
    let outside = false;
    for (let i = 0; i < color.count; i++) {
      if (color.getW(i) > 0.5) team++;
      if (uvl.getZ(i) === NO_LAYER) flat++;
      else {
        textured++;
        if (uvl.getX(i) < 0 || uvl.getX(i) > 1) outside = true;
      }
    }
    expect(team).toBeGreaterThan(0);
    expect(textured).toBeGreaterThan(0);
    expect(flat).toBeGreaterThan(0);
    expect(outside).toBe(true); // tiling uv's survive
    g.computeBoundingBox();
    expect(g.boundingBox!.min.y).toBeCloseTo(0, 2);
    // No ground plate under the building any more: the model stands inside its 21 x 21 footprint and fills most of it.
    const size = g.boundingBox!.getSize(new Vector3());
    expect(size.x).toBeGreaterThan(21 * 0.85);
    expect(size.x).toBeLessThanOrEqual(21 * 1.05);
    expect(size.z).toBeGreaterThan(21 * 0.85);
    expect(size.z).toBeLessThanOrEqual(21 * 1.05);

    // One shared array: frame_wood, plank_grey, roof, wall_paint (LOD 1 and 2 reuse the LOD 0 layers).
    expect(set.layers).not.toBeNull();
    expect(set.layers!.image.depth).toBe(4);
    expect(rasterized.length).toBe(4);
    expect(byId.get('dweller_building_hq')!.reason).toMatch(/not decoded/);

    // Surface kinds: a layer has the kind of its material name, a flat vertex carries its kind in u.
    expect([...set.layerKinds].sort()).toEqual(['roofing', 'wood', 'wood', 'wood']);
    const flatKinds = new Set<string>();
    for (let i = 0; i < uvl.count; i++)
      if (uvl.getZ(i) === NO_LAYER) flatKinds.add(surfaceOfIndex(uvl.getX(i)));
    expect(flatKinds).toContain('paintedMetal'); // the water tower's steel and the team band

    // The beacon is built from shapes only (no house parts since the real-scale round): the same triangle count on
    // every LOD, so one geometry and one draw. The housing has three different LODs.
    const beacon = set.visuals.get('dweller_building_beacon')!;
    expect(beacon.lods[0]).toBe(beacon.lods[1]);
    expect(beacon.lods[1]).toBe(beacon.lods[2]);
    const housing = set.visuals.get('dweller_building_housing')!;
    expect(housing.lods[1]).not.toBe(housing.lods[2]);
  });

  it('maps building ids to visuals.mesh', () => {
    expect([
      ...buildingMeshes([
        { id: 0, visuals: { mesh: 'a' } },
        { id: 1, visuals: {} },
        { id: 2, visuals: { mesh: 'a' } },
      ]),
    ]).toEqual([
      [0, 'a'],
      [2, 'a'],
    ]);
  });

  it('fails every asset with the reason when the manifest cannot be read', async () => {
    const io: BuildingAssetIO = {
      manifest: () => Promise.reject(new Error('HTTP 404')),
      fetchBytes: () => Promise.reject(new Error('no')),
      parseGltf: () => Promise.reject(new Error('no')),
    };
    const set = await loadBuildingAssets(io, 'x', (_m, p) => p, MESHES);
    expect(set.visuals.size).toBe(0);
    expect(
      set.statuses.every((s) => s.state === 'failed' && s.reason === 'manifest: HTTP 404'),
    ).toBe(true);
  });
});
