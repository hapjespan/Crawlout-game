import { describe, expect, it } from 'vitest';
import { ANIM, ANIM_NAMES } from '@crawlout/protocol';
import { manifestSchema } from '@crawlout/asset-cli/manifest';
import { Matrix4, Scene, Vector3, type BufferAttribute, type SkinnedMesh } from 'three/webgpu';
import { bakeAnimations } from './bake.js';
import { applyCharacterFit, BakedManifestError, bakedAnimationsFromManifest, CHARACTER_HEIGHT, characterFit } from './bakedManifest.js';
import { dequantizationOf, TEAM_FALLBACK_BASE, unitGeometryFromGltf } from './gltfUnitGeometry.js';
import { createGltfIO, resolveManifestPath, UnitAssetLoader } from './unitAssetLoader.js';
import { UnitAssetRegistry } from './unitAssets.js';
import { PLACEHOLDER_RIG, UnitLayer } from './unitLayer.js';
import {
  FIXTURE_ID,
  fixtureAnimF32,
  fixtureGlb,
  fixtureManifest,
  FRAMES_PER_CLIP,
  JOINTS,
  MATERIAL_COLORS,
  skinMatrix,
  sourceVertices,
} from './testing/skinnedFixture.js';

const MANIFEST_URL = 'https://assets.test/dist/manifest.json';
const encode = (value: unknown): ArrayBuffer => new TextEncoder().encode(JSON.stringify(value)).buffer as ArrayBuffer;
const copy = (bytes: Uint8Array): ArrayBuffer => bytes.slice().buffer as ArrayBuffer;

/** In-memory "server" for the files of an asset-cli dist folder, with three's real GLTFLoader and meshopt decoder. */
async function fakeDist(opts: { quantized?: boolean; manifest?: unknown; anim?: ArrayBuffer } = {}) {
  const files = new Map<string, ArrayBuffer>();
  const glb = copy(await fixtureGlb({ quantized: opts.quantized ?? false }));
  const at = (path: string) => resolveManifestPath(MANIFEST_URL, path);
  files.set(MANIFEST_URL, encode(opts.manifest ?? fixtureManifest()));
  files.set(at(`${FIXTURE_ID}/${FIXTURE_ID}.anim.f32`), opts.anim ?? fixtureAnimF32());
  for (const level of [0, 1, 2]) files.set(at(`${FIXTURE_ID}/lod${level}.glb`), glb);
  const requested: string[] = [];
  const fetchBytes = async (url: string): Promise<ArrayBuffer> => {
    requested.push(url);
    const f = files.get(url);
    if (!f) throw new Error(`404 ${url}`);
    return f;
  };
  return { loader: new UnitAssetLoader(createGltfIO(fetchBytes)), requested };
}

/** Skins a loaded vertex with the loaded bone texture: sum of weight * texel matrix * position. */
function skinVertex(data: Float32Array, width: number, row: number, pos: Vector3, joints: number[], weights: number[]): Vector3 {
  const out = new Vector3();
  const m = new Matrix4();
  for (let k = 0; k < 4; k++) {
    if (weights[k]! === 0) continue;
    m.fromArray(data, (row * width + joints[k]! * 4) * 4);
    out.add(pos.clone().applyMatrix4(m).multiplyScalar(weights[k]!));
  }
  return out;
}

describe('bakedAnimationsFromManifest', () => {
  it('turns the procedural bake, written as manifest plus anim.f32, back into the same BakedAnimations', () => {
    const baked = bakeAnimations();
    const bytes = new ArrayBuffer(baked.data.length * 4);
    const dv = new DataView(bytes);
    baked.data.forEach((v, i) => dv.setFloat32(i * 4, v, true));
    const entry = {
      path: 'x/x.anim.f32',
      width: baked.width,
      height: baked.height,
      fps: 30,
      clips: baked.clips.map((c) => ({ name: c.name, startRow: c.startRow, frames: c.frameCount, loop: c.loop, durationSeconds: c.duration })),
    };
    const back = bakedAnimationsFromManifest(entry, baked.boneCount, bytes);
    expect(back.width).toBe(baked.width);
    expect(back.height).toBe(baked.height);
    expect(back.clips).toEqual(baked.clips);
    expect([...back.clipTable]).toEqual([...baked.clipTable]);
    expect([...back.data]).toEqual([...baked.data]);
  });

  it('refuses a texture that does not fit its manifest entry', () => {
    const m = fixtureManifest().assets[0]!;
    const bytes = fixtureAnimF32();
    expect(() => bakedAnimationsFromManifest(m.baked!, m.boneCount, bytes.slice(0, bytes.byteLength - 16))).toThrow(BakedManifestError);
    expect(() => bakedAnimationsFromManifest(m.baked!, m.boneCount + 1, bytes)).toThrow(/boneCount/);
    const swapped = { ...m.baked!, clips: [m.baked!.clips[1]!, m.baked!.clips[0]!, ...m.baked!.clips.slice(2)] };
    expect(() => bakedAnimationsFromManifest(swapped, m.boneCount, bytes)).toThrow(/clips must be/);
  });
});

describe('UnitAssetLoader', () => {
  it('builds a valid manifest in the fixture (the asset-cli schema accepts it)', () => {
    expect(manifestSchema.safeParse(fixtureManifest()).success).toBe(true);
  });

  for (const quantized of [false, true]) {
    it(`loads manifest, anim.f32 and meshopt LOD GLBs${quantized ? ' (quantized)' : ''} into the unit vertex layout`, async () => {
      const { loader, requested } = await fakeDist({ quantized });
      const asset = await loader.load(MANIFEST_URL, FIXTURE_ID);
      expect(requested).toContain(`https://assets.test/dist/${FIXTURE_ID}/${FIXTURE_ID}.anim.f32`);
      expect(asset.anims.boneCount).toBe(JOINTS.length);
      expect(asset.anims.clips.map((c) => c.name)).toEqual([...ANIM_NAMES]);
      expect(asset.anims.clips[ANIM.death]!.loop).toBe(false);

      const lod = asset.lods[0];
      const g = lod.geometry;
      for (const name of ['position', 'normal', 'color', 'skinIndex', 'skinWeight']) expect(g.getAttribute(name)).toBeDefined();
      expect(g.getAttribute('uv')).toBeUndefined(); // no texture in this asset
      expect(lod.map).toBeNull();
      const source = sourceVertices();
      expect(lod.triangles).toBe(36);
      const p = g.getAttribute('position');
      const c = g.getAttribute('color');
      const si = g.getAttribute('skinIndex');
      const sw = g.getAttribute('skinWeight');
      expect(p.count).toBe(source.length);

      const tol = quantized ? 2e-3 : 1e-5;
      const pos = new Vector3();
      for (let i = 0; i < p.count; i++) {
        pos.fromBufferAttribute(p, i);
        // Every loaded vertex is a source vertex in source bind space (dequantized when needed).
        const match = source.find((s) => pos.distanceTo(new Vector3(...s.position)) < tol && s.team === (c.getW(i) === 1));
        expect(match, `vertex ${i} at ${pos.toArray().join(', ')}`).toBeDefined();
        const joints = [0, 1, 2, 3].map((k) => si.getComponent(i, k));
        const weights = [0, 1, 2, 3].map((k) => sw.getComponent(i, k));
        for (let k = 0; k < 4; k++) if (match!.weights[k]! > 0) expect(weights[joints.indexOf(match!.joints[k]!)]).toBeCloseTo(match!.weights[k]!, 2);
        // The baked texture moves it where the analytic skin puts the source vertex.
        const clip = ANIM.walk;
        const frame = 2;
        const got = skinVertex(asset.anims.data, asset.anims.width, clip * FRAMES_PER_CLIP + frame, pos, joints, weights);
        const want = new Vector3();
        for (let k = 0; k < 4; k++) {
          const w = match!.weights[k]!;
          if (w > 0) want.add(new Vector3(...match!.position).applyMatrix4(skinMatrix(clip, frame, match!.joints[k]!)).multiplyScalar(w));
        }
        expect(got.distanceTo(want)).toBeLessThan(tol * 4);
        // Linear material color, team mask from the material name.
        const color = match!.team ? MATERIAL_COLORS.Team_Shirt : MATERIAL_COLORS.Skin;
        expect(c.getX(i)).toBeCloseTo(color[0], 4);
        expect(c.getW(i)).toBe(match!.team ? 1 : 0);
      }
    });
  }

  it('rejects ids that are missing, props and broken textures, with a reason', async () => {
    const { loader } = await fakeDist();
    await expect(loader.load(MANIFEST_URL, 'nope')).rejects.toThrow(/not in/);
    await expect(loader.load(MANIFEST_URL, 'crate')).rejects.toThrow(/prop/);
    const broken = await fakeDist({ anim: new ArrayBuffer(64) });
    await expect(broken.loader.load(MANIFEST_URL, FIXTURE_ID)).rejects.toThrow(/anim.f32/);
    expect(await loader.has(MANIFEST_URL, FIXTURE_ID)).toBe(true);
    expect(await loader.has(MANIFEST_URL, 'crate')).toBe(false);
  });

  it('really reads quantized positions in the quantized fixture, and brings them back with the IBM transform', async () => {
    const io = createGltfIO(async () => new ArrayBuffer(0));
    const scene = await io.parseGltf(copy(await fixtureGlb({ quantized: true })), 'https://assets.test/q.glb');
    let mesh: SkinnedMesh | undefined;
    scene.traverse((o) => {
      if ((o as SkinnedMesh).isSkinnedMesh && !mesh) mesh = o as SkinnedMesh;
    });
    const attr = mesh!.geometry.getAttribute('position') as BufferAttribute;
    expect(attr.array).not.toBeInstanceOf(Float32Array);
    scene.updateMatrixWorld(true);
    const t = dequantizationOf(mesh!);
    expect(t.elements[0]).toBeGreaterThan(0.1); // a real scale, not the identity
    expect(t.elements[0]).not.toBeCloseTo(1, 2);
  });

  it('refuses a GLB whose skin does not match the baked bone count', async () => {
    const { loader } = await fakeDist();
    const asset = await loader.load(MANIFEST_URL, FIXTURE_ID);
    expect(asset.lods[1].geometry.getAttribute('position').count).toBeGreaterThan(0);
    const io = createGltfIO(async () => new ArrayBuffer(0));
    const scene = await io.parseGltf(copy(await fixtureGlb()), 'https://assets.test/x.glb');
    expect(() => unitGeometryFromGltf(scene, { boneCount: JOINTS.length + 1 })).toThrow(/joints/);
  });
});

describe('UnitAssetRegistry', () => {
  const loadouts = [
    { id: 0, visuals: { meshSlots: { body: FIXTURE_ID, tool: 'dweller_tool_scrapbag' } } },
    { id: 1, visuals: { meshSlots: { body: 'not_made_yet' } } },
    { id: 2, visuals: { meshSlots: { weapon: 'pipe' } } },
  ];

  function layer(): UnitLayer {
    return new UnitLayer(new Scene(), { capacity: 8, lightDir: new Vector3(0, 1, 0) });
  }

  it('draws loadouts whose body slot names a manifest asset with it, and the first body for everyone else', async () => {
    const { loader } = await fakeDist();
    const units = layer();
    const warnings: string[] = [];
    const registry = new UnitAssetRegistry(units, loader, { config: { manifestUrl: MANIFEST_URL }, maxTextureSize: 4096, warn: (m) => warnings.push(m) });
    await registry.setLoadouts(loadouts);
    expect(units.rigCount).toBe(2);
    expect(units.rigName(units.rigFor(1))).toBe(FIXTURE_ID); // typeId 1 = loadout 0
    // Asset not in the manifest yet (no warning) or no body: the first loadout body, also for the hero.
    expect(units.rigName(units.rigFor(2))).toBe(FIXTURE_ID);
    expect(units.rigName(units.rigFor(3))).toBe(FIXTURE_ID);
    expect(units.rigName(units.rigFor(1000))).toBe(FIXTURE_ID);
    expect(warnings).toEqual([]);
    const [status] = registry.statuses();
    expect(status).toMatchObject({ assetId: FIXTURE_ID, state: 'ready', typeIds: [1], triangles: [36, 36, 36] });
  });

  it('makes the configured default unit the rig for everyone without an asset of their own', async () => {
    const { loader } = await fakeDist();
    const units = layer();
    const registry = new UnitAssetRegistry(units, loader, { config: { manifestUrl: MANIFEST_URL, defaultUnit: FIXTURE_ID }, maxTextureSize: 4096 });
    await registry.start();
    expect(units.rigName(units.rigFor(2))).toBe(FIXTURE_ID);
    expect(units.rigName(units.rigFor(1000))).toBe(FIXTURE_ID);
    await registry.setLoadouts(loadouts); // loading the same asset again reuses the rig
    expect(units.rigCount).toBe(2);
  });

  it('keeps the placeholder when loading fails and reports why', async () => {
    const { loader } = await fakeDist({ anim: new ArrayBuffer(32) });
    const units = layer();
    const warnings: string[] = [];
    const registry = new UnitAssetRegistry(units, loader, { maxTextureSize: 4096, warn: (m) => warnings.push(m) });
    const status = await registry.load(MANIFEST_URL, FIXTURE_ID, { asDefault: true });
    expect(status.state).toBe('failed');
    expect(status.reason).toMatch(/anim.f32/);
    expect(units.rigCount).toBe(1);
    expect(units.rigFor(1)).toBe(PLACEHOLDER_RIG);
    expect(warnings.length).toBe(1);
    const tooBig = new UnitAssetRegistry(layer(), (await fakeDist()).loader, { maxTextureSize: 8 });
    expect((await tooBig.load(MANIFEST_URL, FIXTURE_ID)).reason).toMatch(/GPU limit/);
  });
});

describe('real characters without a team material', () => {
  async function geometryWith(names: Record<string, string>) {
    const io = createGltfIO(async () => new ArrayBuffer(0));
    const scene = await io.parseGltf(copy(await fixtureGlb({ materialNames: names })), 'https://assets.test/x.glb');
    return unitGeometryFromGltf(scene, { boneCount: JOINTS.length }).geometry;
  }
  const maskedColors = (g: Awaited<ReturnType<typeof geometryWith>>) => {
    const c = g.getAttribute('color');
    const masked = new Set<string>();
    let unmasked = 0;
    for (let i = 0; i < c.count; i++) {
      if (c.getW(i) > 0.5) masked.add([c.getX(i), c.getY(i), c.getZ(i)].map((v) => v.toFixed(3)).join(','));
      else unmasked++;
    }
    return { masked, unmasked, total: c.count };
  };

  it('masks the main material (Quaternius M_Main) on a neutral base when no material says "team"', async () => {
    const g = await geometryWith({ Team_Shirt: 'M_Main', Skin: 'M_Joints' });
    const { masked, unmasked } = maskedColors(g);
    const grey = TEAM_FALLBACK_BASE.toFixed(3);
    expect([...masked]).toEqual([`${grey},${grey},${grey}`]); // the team color shows pure
    expect(unmasked).toBeGreaterThan(0); // M_Joints keeps its own color
  });

  it('keeps an explicit team material as the only mask and its own color', async () => {
    const g = await geometryWith({ Team_Shirt: 'Team_Shirt', Skin: 'M_Main' });
    const { masked } = maskedColors(g);
    expect([...masked]).toEqual([MATERIAL_COLORS.Team_Shirt.slice(0, 3).map((v) => v.toFixed(3)).join(',')]);
  });

  it('masks nothing when no material is team or main', async () => {
    const g = await geometryWith({ Team_Shirt: 'Cloth', Skin: 'Skin' });
    expect(maskedColors(g).masked.size).toBe(0);
  });
});

describe('characterFit', () => {
  it('leaves a character in meters at a human height as authored (Quaternius: 1.83 m, feet at 2 mm)', () => {
    expect(characterFit({ min: [-0.97, 0.002415, -0.16], max: [0.97, 1.827399, 0.2] })).toEqual({ scale: 1, lift: 0 });
  });

  it('scales centimeters to 1.8 m and puts the feet on y = 0', () => {
    const fit = characterFit({ min: [-50, -10, -20], max: [50, 170, 20] });
    expect(fit.scale).toBeCloseTo(CHARACTER_HEIGHT / 180, 9);
    expect(fit.lift).toBeCloseTo(0.1, 9);
    const anims = bakeAnimations();
    const before = anims.data.slice();
    applyCharacterFit(anims, fit);
    // Every skin matrix maps a point p to fit.scale * (M p) + lift on y.
    const m0 = new Matrix4().fromArray(before, 0);
    const m1 = new Matrix4().fromArray(anims.data, 0);
    const p = new Vector3(0.3, 1.2, -0.4);
    const want = p.clone().applyMatrix4(m0).multiplyScalar(fit.scale).add(new Vector3(0, fit.lift, 0));
    const got = p.clone().applyMatrix4(m1);
    expect(got.distanceTo(want)).toBeLessThan(1e-5);
  });

  it('is a no-op for the identity fit', () => {
    const anims = bakeAnimations();
    const before = anims.data.slice();
    applyCharacterFit(anims, { scale: 1, lift: 0 });
    expect(anims.data).toEqual(before);
  });
});
