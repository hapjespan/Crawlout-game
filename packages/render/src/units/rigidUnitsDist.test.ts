// The robots of assets/dist (the asset side's real GLBs and manifest), through the rigid-unit loader and layer.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { Scene, Vector3 } from 'three/webgpu';
import { createGltfIO, UnitAssetLoader } from './unitAssetLoader.js';
import { UnitAssetRegistry } from './unitAssets.js';
import { UnitLayer } from './unitLayer.js';
import { RigidUnitLayer } from './rigidUnitLayer.js';
import { RigidUnitRegistry } from './rigidUnitAssets.js';

const DIST = fileURLToPath(new URL('../../../../assets/dist/', import.meta.url));
const URL_BASE = 'dist://manifest.json';

async function distLoader(): Promise<UnitAssetLoader> {
  const fetchBytes = async (url: string): Promise<ArrayBuffer> => {
    const b = await readFile(DIST + url.replace('dist://', ''));
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  };
  return new UnitAssetLoader(createGltfIO(fetchBytes), (_manifest, path) => `dist://${path}`);
}

const loadouts = [
  { id: 0, visuals: { meshSlots: { body: 'dweller_robot_guard' } } },
  { id: 1, visuals: { meshSlots: { body: 'dweller_robot_drone' } } },
  { id: 2, visuals: { meshSlots: { body: 'dweller_robot_sentinel' } } },
];

describe('the robots in assets/dist', () => {
  it('loads guard, drone and sentinel as rigid units, the drone with its hover baked into the model', async () => {
    vi.stubGlobal('self', globalThis);
    vi.stubGlobal('createImageBitmap', async () => ({ width: 64, height: 64, close() {} }));
    const loader = await distLoader();
    const allRigid = [...(await loader.rigidEntries(URL_BASE)).keys()].sort();
    // The Raider buggy and hound are rigid units too (raiders.json); this test is about the Dweller robots.
    const rigidIds = allRigid.filter((id) => id.startsWith('dweller_'));
    expect(allRigid).toEqual(expect.arrayContaining(['raider_body_hound', 'raider_vehicle_buggy']));
    expect(rigidIds).toEqual([
      'dweller_robot_builder', // the Bouwrobot (data 0.26.0, asset-cli robots.json)
      'dweller_robot_drone',
      'dweller_robot_guard',
      'dweller_robot_sentinel',
    ]);
    // The skinned registry leaves them alone (no character asset is requested for a robot).
    expect(await loader.has(URL_BASE, 'dweller_robot_guard')).toBe(false);

    const guard = await loader.loadRigid(URL_BASE, 'dweller_robot_guard');
    expect(guard.height).toBeCloseTo(2.2, 1);
    expect(guard.teamVertices).toBeGreaterThan(0); // team_trim
    expect(guard.entry.hover).toBe(0);
    const drone = await loader.loadRigid(URL_BASE, 'dweller_robot_drone');
    drone.lods[0].computeBoundingBox();
    expect(drone.entry.hover).toBeGreaterThan(1.2);
    expect(drone.lods[0].boundingBox!.min.y).toBeCloseTo(drone.entry.hover, 1); // baked in, not lifted again
    expect(drone.teamVertices).toBeGreaterThan(0);
    const sentinel = await loader.loadRigid(URL_BASE, 'dweller_robot_sentinel');
    expect(sentinel.height).toBeCloseTo(3.5, 1);
    expect(sentinel.teamVertices).toBeGreaterThan(0);
    vi.unstubAllGlobals();
  });

  it('draws the loadouts whose body is a robot with the rigid layer and nothing else', async () => {
    vi.stubGlobal('self', globalThis);
    vi.stubGlobal('createImageBitmap', async () => ({ width: 64, height: 64, close() {} }));
    const loader = await distLoader();
    const scene = new Scene();
    const humanoids = new UnitLayer(scene, { capacity: 4, lightDir: new Vector3(0, 1, 0) });
    const rigid = new RigidUnitLayer(scene, { capacity: 4, lightDir: new Vector3(0, 1, 0) });
    humanoids.setSkip((t) => rigid.owns(t));
    const config = { manifestUrl: URL_BASE };
    const rigidUnits = new RigidUnitRegistry(rigid, loader, {
      config,
      maxTextureSize: 4096,
      rasterize: () => null,
    });
    const skinned = new UnitAssetRegistry(humanoids, loader, {
      config,
      maxTextureSize: 4096,
      rigidIds: (url) => rigidUnits.rigidIds(url),
    });
    await Promise.all([skinned.setLoadouts(loadouts), rigidUnits.setLoadouts(loadouts)]);
    vi.unstubAllGlobals();
    for (const typeId of [1, 2, 3]) expect(rigid.owns(typeId)).toBe(true);
    expect(rigid.owns(4)).toBe(false);
    expect(rigidUnits.statuses().map((s) => s.state)).toEqual(['ready', 'ready', 'ready']);
    expect(skinned.statuses()).toEqual([]);
    expect(humanoids.rigCount).toBe(1); // only the placeholder
  });
});
