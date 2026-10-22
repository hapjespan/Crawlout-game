// Split from rigidUnits.test.ts to stay under the 5,000-token file limit.
import {
  type RigidFixtureEntry,
  rigidManifest,
  FIXTURE_ID,
  rigidFiles,
  GUARD_ID,
  TRIANGLES,
  DRONE_ID,
  SENTINEL_ID,
} from './testing/rigidFixture.js';
import { resolveManifestPath, UnitAssetLoader, createGltfIO } from './unitAssetLoader.js';
import { fixtureGlb, fixtureAnimF32 } from './testing/skinnedFixture.js';
import { describe, it, expect } from 'vitest';
import { Scene, Vector3 } from 'three/webgpu';
import { UnitLayer } from './unitLayer.js';
import { RigidUnitLayer } from './rigidUnitLayer.js';
import { RigidUnitRegistry } from './rigidUnitAssets.js';
import { UnitAssetRegistry } from './unitAssets.js';
import { byName, camera, frameOf, meshes, recorder, row } from './rigidUnits.helpers.js';

const MANIFEST_URL = 'https://assets.test/dist/manifest.json';

const encode = (value: unknown): ArrayBuffer =>
  new TextEncoder().encode(JSON.stringify(value)).buffer as ArrayBuffer;

/** In-memory dist folder with the skinned fixture character and the robots, three's real GLTFLoader behind it. */
async function fakeDist(
  opts: { raw?: unknown; broken?: string; entries?: readonly RigidFixtureEntry[] } = {},
) {
  const files = new Map<string, ArrayBuffer>();
  const at = (path: string) => resolveManifestPath(MANIFEST_URL, path);
  files.set(MANIFEST_URL, encode(opts.raw ?? rigidManifest(opts.entries)));
  const skinned = (await fixtureGlb()).slice().buffer as ArrayBuffer;
  files.set(at(`${FIXTURE_ID}/${FIXTURE_ID}.anim.f32`), fixtureAnimF32());
  for (const level of [0, 1, 2]) files.set(at(`${FIXTURE_ID}/lod${level}.glb`), skinned);
  for (const [path, bytes] of await rigidFiles(opts.entries)) files.set(at(path), bytes);
  if (opts.broken) files.set(at(`${opts.broken}/lod0.glb`), new ArrayBuffer(16));
  const fetchBytes = async (url: string): Promise<ArrayBuffer> => {
    const f = files.get(url);
    if (!f) throw new Error(`404 ${url}`);
    return f;
  };
  return new UnitAssetLoader(createGltfIO(fetchBytes));
}

describe('rigid unit assets', () => {
  it('loads the LODs as static team-masked geometry on y = 0, merging identical LODs', async () => {
    const loader = await fakeDist();
    const guard = await loader.loadRigid(MANIFEST_URL, GUARD_ID);
    expect(guard.triangles).toEqual(TRIANGLES);
    expect(new Set(guard.lods).size).toBe(3);
    expect(guard.height).toBeCloseTo(2.2, 5);
    expect(guard.teamVertices).toBeGreaterThan(0);
    for (const g of guard.lods) {
      for (const name of ['position', 'normal', 'color', 'uvl'])
        expect(g.getAttribute(name)).toBeDefined();
      expect(g.getAttribute('skinIndex')).toBeUndefined();
    }
    // The drone's model has its hover height baked in: the loader leaves it where it is authored.
    const drone = await loader.loadRigid(MANIFEST_URL, DRONE_ID);
    drone.lods[0].computeBoundingBox();
    expect(drone.lods[0].boundingBox!.min.y).toBeCloseTo(1.35, 4);
    expect(drone.lods[0].boundingBox!.max.y).toBeCloseTo(2.15, 4);
    expect(drone.entry.hover).toBe(1.35);
    expect(drone.height).toBeCloseTo(0.8, 5);
    expect(drone.width).toBeGreaterThan(0.5); // mean of the two horizontal sizes
    expect(drone.reach).toBeGreaterThanOrEqual(0.45);
  });

  it('does not offer a rigid unit as a skinned character, and refuses a character as a rigid unit', async () => {
    const loader = await fakeDist();
    expect(await loader.has(MANIFEST_URL, GUARD_ID)).toBe(false);
    expect(await loader.has(MANIFEST_URL, FIXTURE_ID)).toBe(true);
    await expect(loader.loadRigid(MANIFEST_URL, FIXTURE_ID)).rejects.toThrow(/not a rigid unit/);
    await expect(loader.loadRigid(MANIFEST_URL, 'nope')).rejects.toThrow(/not a rigid unit/);
  });

  const loadouts = [
    { id: 0, visuals: { meshSlots: { body: FIXTURE_ID } } }, // skinned
    { id: 1, visuals: { meshSlots: { body: GUARD_ID } } }, // rigid
    { id: 2, visuals: { meshSlots: { body: DRONE_ID, tool: 'wrench' } } }, // rigid
    { id: 3, visuals: { meshSlots: { body: 'not_made_yet' } } }, // unknown
    { id: 4, visuals: { meshSlots: { weapon: 'pipe' } } }, // no body
    { id: 5, visuals: { meshSlots: { body: SENTINEL_ID } } }, // rigid
  ];

  it('takes the loadouts whose body is a rigid asset and leaves the others to the skinned registry', async () => {
    const loader = await fakeDist();
    const scene = new Scene();
    const humanoids = new UnitLayer(scene, { capacity: 16, lightDir: new Vector3(0, 1, 0) });
    const rigid = new RigidUnitLayer(scene, { capacity: 16, lightDir: new Vector3(0, 1, 0) });
    humanoids.setSkip((t) => rigid.owns(t));
    const config = { manifestUrl: MANIFEST_URL };
    const rigidUnits = new RigidUnitRegistry(rigid, loader, { config, maxTextureSize: 4096 });
    const skinned = new UnitAssetRegistry(humanoids, loader, {
      config,
      maxTextureSize: 4096,
      rigidIds: (url) => rigidUnits.rigidIds(url),
    });
    await Promise.all([skinned.setLoadouts(loadouts), rigidUnits.setLoadouts(loadouts)]);

    // typeId = 1 + loadout id. Rigid: loadouts 1, 2, 5.
    expect(rigid.owns(2)).toBe(true);
    expect(rigid.owns(3)).toBe(true);
    expect(rigid.owns(6)).toBe(true);
    expect(rigid.owns(1)).toBe(false); // skinned
    expect(rigid.owns(4)).toBe(false); // body not in the manifest
    expect(rigid.owns(5)).toBe(false); // no body slot
    expect(rigid.owns(1000)).toBe(false);
    expect(rigid.assetName(rigid.assetFor(3)!)).toBe(DRONE_ID);

    // The skinned registry loaded only its character, which became the default rig; a robot never did.
    expect(skinned.statuses().map((s) => s.assetId)).toEqual([FIXTURE_ID]);
    expect(humanoids.rigName(humanoids.rigFor(1))).toBe(FIXTURE_ID);
    expect(humanoids.rigCount).toBe(2);

    const statuses = rigidUnits.statuses();
    expect(statuses.map((s) => s.assetId).sort()).toEqual([DRONE_ID, GUARD_ID, SENTINEL_ID].sort());
    const drone = statuses.find((s) => s.assetId === DRONE_ID)!;
    expect(drone).toMatchObject({
      state: 'ready',
      typeIds: [3],
      hover: 1.35,
      triangles: TRIANGLES,
    });
    expect(drone.height).toBeCloseTo(0.8, 5);
  });

  it('keeps a robot loadout with a first-in-line body from taking the default rig of the humanoids', async () => {
    const loader = await fakeDist();
    const humanoids = new UnitLayer(new Scene(), { capacity: 4, lightDir: new Vector3(0, 1, 0) });
    const rigid = new RigidUnitLayer(new Scene(), { capacity: 4, lightDir: new Vector3(0, 1, 0) });
    const config = { manifestUrl: MANIFEST_URL };
    const rigidUnits = new RigidUnitRegistry(rigid, loader, { config, maxTextureSize: 4096 });
    const skinned = new UnitAssetRegistry(humanoids, loader, {
      config,
      maxTextureSize: 4096,
      rigidIds: (url) => rigidUnits.rigidIds(url),
    });
    await skinned.setLoadouts([
      { id: 0, visuals: { meshSlots: { body: GUARD_ID } } },
      { id: 1, visuals: { meshSlots: { body: FIXTURE_ID } } },
    ]);
    expect(humanoids.rigName(humanoids.rigFor(777))).toBe(FIXTURE_ID);
  });

  it('keeps the humanoid for a rigid asset that fails to load, and says why', async () => {
    const loader = await fakeDist({ broken: GUARD_ID });
    const rigid = new RigidUnitLayer(new Scene(), { capacity: 4, lightDir: new Vector3(0, 1, 0) });
    const warnings: string[] = [];
    const registry = new RigidUnitRegistry(rigid, loader, {
      config: { manifestUrl: MANIFEST_URL },
      maxTextureSize: 4096,
      warn: (m) => warnings.push(m),
    });
    await registry.setLoadouts(loadouts);
    const failed = registry.statuses().find((s) => s.assetId === GUARD_ID)!;
    expect(failed.state).toBe('failed');
    expect(failed.reason).toBeTruthy();
    expect(failed.typeIds).toEqual([]);
    expect(rigid.owns(2)).toBe(false); // typeId of loadout 1: back to the humanoid
    expect(rigid.owns(3)).toBe(true); // the drone loaded fine
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/humanoid/);
  });

  it('reports a rigid entry that is unusable as failed with its reason', async () => {
    const raw = rigidManifest([{ id: GUARD_ID, height: 2.2 }]) as {
      assets: Record<string, unknown>[];
    };
    for (const a of raw.assets) if (a.id === GUARD_ID) delete a.bounds;
    const loader = await fakeDist({ raw });
    const registry = new RigidUnitRegistry(
      new RigidUnitLayer(new Scene(), { capacity: 4, lightDir: new Vector3(0, 1, 0) }),
      loader,
      { config: { manifestUrl: MANIFEST_URL }, maxTextureSize: 4096, warn: () => {} },
    );
    const status = await registry.load(MANIFEST_URL, GUARD_ID);
    expect(status).toMatchObject({ state: 'failed' });
    expect(status.reason).toMatch(/bounds/);
  });

  it('binds a rigid asset to typeIds without a loadout through config.bind', async () => {
    const loader = await fakeDist();
    const rigid = new RigidUnitLayer(new Scene(), { capacity: 4, lightDir: new Vector3(0, 1, 0) });
    const registry = new RigidUnitRegistry(rigid, loader, {
      config: { manifestUrl: MANIFEST_URL, bind: { [GUARD_ID]: [1003] } },
      maxTextureSize: 4096,
    });
    await registry.start();
    expect(rigid.owns(1003)).toBe(true);
    expect(registry.statuses().map((s) => [s.assetId, s.typeIds])).toEqual([[GUARD_ID, [1003]]]);
    await registry.setLoadouts(loadouts); // the loadout body reuses the loaded asset and keeps the binding
    expect(rigid.owns(1003)).toBe(true);
    expect(rigid.owns(2)).toBe(true);
    expect(registry.statuses().find((s) => s.assetId === GUARD_ID)!.typeIds).toEqual([1003, 2]);
  });

  it('notes a model without a team material in its status', async () => {
    const entries = [
      { id: GUARD_ID, height: 2.2, glbMaterial: 'Hull' }, // the manifest lists Team_Plate, the GLB has no such material
      { id: DRONE_ID, height: 0.8, hover: 1.2, lowest: 1.2, teamName: 'Hull', glbMaterial: 'Hull' }, // listed by the manifest: masked
    ];
    const loader = await fakeDist({ entries });
    const registry = new RigidUnitRegistry(
      new RigidUnitLayer(new Scene(), { capacity: 4, lightDir: new Vector3(0, 1, 0) }),
      loader,
      { config: { manifestUrl: MANIFEST_URL }, maxTextureSize: 4096 },
    );
    expect((await registry.load(MANIFEST_URL, GUARD_ID)).reason).toMatch(/no team material/);
    const drone = await registry.load(MANIFEST_URL, DRONE_ID);
    expect(drone.state).toBe('ready');
    expect(drone.reason).toBeUndefined();
  });

  it('draws what the registry loaded: one batch per LOD of the manifest asset', async () => {
    const loader = await fakeDist();
    const scene = new Scene();
    const rigid = new RigidUnitLayer(scene, { capacity: 8, lightDir: new Vector3(0, 1, 0) });
    const registry = new RigidUnitRegistry(rigid, loader, {
      config: { manifestUrl: MANIFEST_URL },
      maxTextureSize: 4096,
    });
    await registry.setLoadouts(loadouts);
    expect(meshes(scene)).toHaveLength(9); // three assets, three distinct LODs each
    rigid.update(
      frameOf([
        { id: 1, typeId: 2, x: 0, z: 0 },
        { id: 2, typeId: 2, x: 2, z: 0 },
        { id: 3, typeId: 3, x: -2, z: 0, owner: 3 },
      ]),
      camera(),
      recorder().decals,
      0,
    );
    expect(rigid.drawCount).toBe(2);
    const drone = byName(scene, `rigid-${DRONE_ID}-lod0`);
    expect(drone.count).toBe(1);
    expect(row(drone, 'iScale', 0)[3]).toBe(3);
    expect(Math.abs(row(drone, 'iPos', 0)[1]!)).toBeLessThan(0.1); // the hover is baked into the model
  });
});
