import { describe, expect, it } from 'vitest';
import { Document, Logger, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { quantize } from '@gltf-transform/functions';
import type { AssetManifest } from '@crawlout/asset-cli/manifest';
import {
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicNodeMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Texture,
  Vector2,
  Vector3,
  type InstancedBufferAttribute,
} from 'three/webgpu';
import type { DecalLayer } from '../decals/decalLayer.js';
import { createGltfIO } from '../units/unitAssetLoader.js';
import { NO_UV } from '../units/gltfUnitGeometry.js';
import { PropAssetRegistry, type PropAssetIO, type ResolvedSource } from './propAssets.js';
import { propFitScale, propKindOf, PROP_TARGET_HEIGHT, propTargetHeight } from './propFit.js';
import { createPlaceholderPropGeometry, propGeometryFromGltf } from './propGeometry.js';
import { PROP_CHUNK_SIZE, PropLayer, type PropVisual, type RenderProp } from './propLayer.js';

const heightAt = (x: number, z: number): number => 0.1 * x + 0.05 * z;

function fakeDecals(): DecalLayer & { pushed: number } {
  const d = { pushed: 0, push: () => void d.pushed++ };
  return d as unknown as DecalLayer & { pushed: number };
}

function camera(at: Vector3, lookAt: Vector3): PerspectiveCamera {
  const c = new PerspectiveCamera(45, 1, 0.5, 800);
  c.position.copy(at);
  c.lookAt(lookAt);
  c.updateMatrixWorld();
  return c;
}

function visual(height = 2, lods?: PropVisual['lods']): PropVisual {
  const g = new BoxGeometry(1, height, 1).translate(0, height / 2, 0);
  return { lods: lods ?? [g, g, g], map: null, fit: 1, height, radius: 0.7 };
}

function layer(scene = new Scene()): PropLayer {
  return new PropLayer(scene, { heightAt, material: () => new MeshBasicNodeMaterial() });
}

const props: RenderProp[] = [
  { asset: 'treehigh001', x: 10, y: 10, yaw: 0, scale: 1 },
  { asset: 'treehigh001', x: 12, y: 30, yaw: 16384, scale: 1.2 },
  { asset: 'treehigh001', x: 40, y: 12, yaw: 0, scale: 0.8 },
  { asset: 'rock001', x: 20, y: 20, yaw: 0, scale: 1 },
  { asset: 'rock001', x: 50, y: 50, yaw: 0, scale: 1 },
  { asset: 'grass001', x: 30, y: 25, yaw: 0, scale: 1 },
];

const overview = (): PerspectiveCamera =>
  camera(new Vector3(30, 120, 30.01), new Vector3(30, 0, 30));

describe('PropLayer', () => {
  it('draws one instanced draw per prop asset when its LODs are identical', () => {
    const scene = new Scene();
    const l = layer(scene);
    l.setProps(props);
    expect(l.assetIds()).toEqual(['treehigh001', 'rock001', 'grass001']);
    for (const id of l.assetIds()) l.setVisual(id, visual());
    l.update(overview(), fakeDecals());
    expect(l.drawCount()).toBe(3);
    const counts = l.meshes().map((m) => m.count);
    expect(counts).toEqual([3, 2, 1]);
    expect(scene.children.length).toBe(3);
  });

  it('splits an asset into one draw per distinct LOD geometry, by chunk distance', () => {
    const l = layer();
    const near = new BoxGeometry();
    const far = new BoxGeometry();
    l.setProps([
      { asset: 'rock001', x: 2, y: 2, yaw: 0, scale: 1 },
      { asset: 'rock001', x: 2 + PROP_CHUNK_SIZE * 8, y: 2, yaw: 0, scale: 1 },
    ]);
    l.setVisual('rock001', visual(1, [near, far, far]));
    expect(l.meshes().length).toBe(2);
    l.update(camera(new Vector3(-10, 6, 2), new Vector3(200, 0, 2)), fakeDecals());
    expect(l.lodCounts).toEqual([1, 0, 1]);
    expect(l.meshes().map((m) => m.count)).toEqual([1, 1]);
  });

  it('stands every prop on the terrain, with its yaw and scale times the fit', () => {
    const l = layer();
    l.setProps([{ asset: 'rock001', x: 20, y: 8, yaw: 16384, scale: 1.25 }]);
    l.setVisual('rock001', { ...visual(), fit: 0.5 });
    l.update(overview(), fakeDecals());
    const geo = l.meshes()[0]!.geometry;
    const pos = geo.getAttribute('iPos') as InstancedBufferAttribute;
    const scale = geo.getAttribute('iScale') as InstancedBufferAttribute;
    expect(pos.getX(0)).toBeCloseTo(20, 5);
    expect(pos.getZ(0)).toBeCloseTo(8, 5);
    expect(pos.getY(0)).toBeCloseTo(heightAt(20, 8) - 0.06, 5); // slightly sunk, no gap on slopes
    expect(pos.getW(0)).toBeCloseTo(0, 5); // sim yaw 16384 (sim +y = world +z) is render yaw 0 (model +Z)
    expect(scale.getX(0)).toBeCloseTo(0.625, 5);
  });

  it('follows a new terrain after relayout', () => {
    let h = 0;
    const l = new PropLayer(new Scene(), {
      heightAt: () => h,
      material: () => new MeshBasicNodeMaterial(),
    });
    l.setProps([{ asset: 'rock001', x: 5, y: 5, yaw: 0, scale: 1 }]);
    l.setVisual('rock001', visual());
    l.update(overview(), fakeDecals());
    h = 3;
    l.relayout();
    l.update(overview(), fakeDecals());
    const pos = l.meshes()[0]!.geometry.getAttribute('iPos') as InstancedBufferAttribute;
    expect(pos.getY(0)).toBeCloseTo(3 - 0.06, 5);
  });

  it('culls whole chunks outside the view and only rewrites the buffers when that changes', () => {
    const l = layer();
    l.setProps(props);
    for (const id of l.assetIds()) l.setVisual(id, visual());
    const decals = fakeDecals();
    l.update(overview(), decals);
    const attr = l.meshes()[0]!.geometry.getAttribute('iPos') as InstancedBufferAttribute;
    const version = attr.version;
    l.update(overview(), decals);
    expect(attr.version).toBe(version); // still camera: no upload
    l.update(camera(new Vector3(30, 20, 30), new Vector3(30, 60, 30)), decals); // looking at the sky
    expect(l.drawCount()).toBe(0);
    expect(l.lodCounts).toEqual([0, 0, 0]);
  });

  it('pushes a blob shadow per visible nearby prop, except ground cover (grass, plants)', () => {
    const l = layer();
    l.setProps(props);
    for (const id of l.assetIds()) l.setVisual(id, visual());
    const decals = fakeDecals();
    l.update(camera(new Vector3(30, 70, 30.01), new Vector3(30, 0, 30)), decals);
    expect(l.lodCounts[2]).toBe(0);
    expect(decals.pushed).toBe(props.filter((p) => !p.asset.startsWith('grass')).length);
  });

  it('is never hit by a raycast, so it neither picks nor blocks a pick', () => {
    const scene = new Scene();
    const l = layer(scene);
    l.setProps([{ asset: 'rock001', x: 0, y: 0, yaw: 0, scale: 1 }]);
    l.setVisual('rock001', visual(4));
    const cam = overview();
    l.update(cam, fakeDecals());
    const ray = new Raycaster();
    ray.setFromCamera(new Vector2(0, 0), cam);
    ray.ray.origin.set(0, 50, 0);
    ray.ray.direction.set(0, -1, 0);
    expect(l.meshes().length).toBe(1);
    expect(ray.intersectObjects(scene.children, true)).toEqual([]);
  });

  it('keeps the visuals of assets that stay when the props are replaced, and drops the rest', () => {
    const scene = new Scene();
    const l = layer(scene);
    l.setProps(props);
    for (const id of l.assetIds()) l.setVisual(id, visual());
    l.setProps(props.filter((p) => p.asset === 'rock001'));
    l.update(overview(), fakeDecals());
    expect(l.assetIds()).toEqual(['rock001']);
    expect(scene.children.length).toBe(1);
    expect(l.drawCount()).toBe(1);
    l.setProps([]);
    expect(scene.children.length).toBe(0);
  });
});

describe('PropLayer at scale', () => {
  /** 8000 trees over a 384 m map: a dense border and a scatter. */
  function forest(): RenderProp[] {
    const out: RenderProp[] = [];
    for (let k = 0; out.length < 8000; k++) {
      const x = (k * 7.13) % 384;
      const y = (k * 3.71 + (k % 7) * 11.3) % 384;
      out.push({
        asset: k % 3 === 0 ? 'treehigh001' : 'treemed001',
        x,
        y,
        yaw: (k * 977) % 65536,
        scale: 1,
      });
    }
    return out;
  }
  const make = (opts = {}): PropLayer => {
    const l = new PropLayer(new Scene(), {
      heightAt,
      material: () => new MeshBasicNodeMaterial(),
      ...opts,
    });
    l.setProps(forest());
    for (const id of l.assetIds()) l.setVisual(id, visual(5));
    return l;
  };

  it('draws at most about maxVisible props in an overview of the whole map', () => {
    const l = make();
    l.update(camera(new Vector3(192, 420, 300), new Vector3(192, 0, 192)), fakeDecals());
    expect(l.visibleCount).toBeLessThanOrEqual(3000 + 300); // rounded per chunk and asset
    expect(l.visibleCount).toBeGreaterThan(2000);
    expect(l.drawCount()).toBe(2); // still one draw per asset
  });

  /** Drawn instances as "x,z" keys plus their scales. */
  const drawn = (l: PropLayer): Map<string, number> => {
    const out = new Map<string, number>();
    for (const m of l.meshes()) {
      const pos = m.geometry.getAttribute('iPos') as InstancedBufferAttribute;
      const scale = m.geometry.getAttribute('iScale') as InstancedBufferAttribute;
      for (let k = 0; k < m.count; k++)
        out.set(`${pos.getX(k).toFixed(3)},${pos.getZ(k).toFixed(3)}`, scale.getX(k));
    }
    return out;
  };

  it('keeps every prop near the camera and thins the far ones, drawing those a little larger', () => {
    const l = make({ maxVisible: 100_000 });
    l.update(camera(new Vector3(100, 60, 100.01), new Vector3(100, 0, 100)), fakeDecals());
    const shown = drawn(l);
    const close = forest().filter((p) => Math.hypot(p.x - 100, p.y - 100) < 15);
    expect(close.length).toBeGreaterThan(20);
    for (const p of close) expect(shown.get(`${p.x.toFixed(3)},${p.y.toFixed(3)}`)).toBe(1);
    l.update(camera(new Vector3(20, 40, 20), new Vector3(300, 0, 300)), fakeDecals());
    const scales = [...drawn(l).values()];
    expect(Math.max(...scales)).toBeGreaterThan(1.05);
    expect(Math.max(...scales)).toBeLessThanOrEqual(1.6 + 1e-6);
  });

  it('thins to the same props: a smaller budget draws a subset of a larger one', () => {
    const cam = camera(new Vector3(192, 420, 300), new Vector3(192, 0, 192));
    const small = make({ maxVisible: 1500 });
    const large = make({ maxVisible: 3000 });
    small.update(cam, fakeDecals());
    large.update(cam, fakeDecals());
    const a = drawn(small);
    const b = drawn(large);
    expect(a.size).toBeLessThanOrEqual(1500 * 1.15);
    expect(b.size).toBeGreaterThan(a.size);
    let kept = 0;
    for (const id of a.keys()) if (b.has(id)) kept++;
    expect(kept).toBe(a.size);
  });

  it('pushes at most maxBlobs blob shadows, nearest first', () => {
    const l = make({ maxBlobs: 20 });
    const decals = fakeDecals();
    l.update(camera(new Vector3(190, 30, 190), new Vector3(200, 0, 200)), decals);
    expect(decals.pushed).toBe(20);
  });
});

describe('prop fit', () => {
  it('reads the kind from the asset id', () => {
    expect(propKindOf('treehigh001')).toBe('tree');
    expect(propKindOf('Rock003')).toBe('rock');
    expect(propKindOf('bush002')).toBe('bush');
    expect(propKindOf('grass001')).toBe('grass');
    expect(propKindOf('reed001')).toBe('reed');
    expect(propKindOf('lamp_post')).toBe('other');
  });

  it('fits the Gobkit sizes next to a 1.8 m character', () => {
    // Manifest heights (m) of the Gobkit Nature Kit after the asset-cli.
    expect(propFitScale('grass001', 3.842866) * 3.842866).toBeCloseTo(0.45, 6);
    expect(propFitScale('treehigh001', 8.491107) * 8.491107).toBeCloseTo(
      PROP_TARGET_HEIGHT.treehigh001!,
      6,
    );
    for (const h of Object.values(PROP_TARGET_HEIGHT)) expect(h).toBeLessThanOrEqual(6);
    expect(propTargetHeight('pine_big')).toBe(5); // kind fallback
    expect(propTargetHeight('rock001', { rock001: 2 })).toBe(2); // override
    expect(propFitScale('lamp_post', 4)).toBe(1); // unknown kind keeps its size
  });
});

describe('propGeometryFromGltf', () => {
  it('merges the meshes with their node transforms, stands on y = 0, keeps uv for the atlas only', () => {
    const map = new Texture();
    const root = new Group();
    const textured = new Mesh(new BoxGeometry(2, 2, 2), new MeshStandardMaterial({ map }));
    textured.position.set(5, 1, 0); // bottom at y = 0, off-center as Gobkit nodes are
    const plain = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial({ color: 0xff0000 }));
    plain.position.set(5, 2.5, 0);
    plain.scale.setScalar(2); // 2 m cube on top: top at y = 3.5
    root.add(textured, plain);
    const m = propGeometryFromGltf(root);
    expect(m.map).toBe(map);
    expect(m.triangles).toBe(24);
    expect(m.height).toBeCloseTo(3.5, 5);
    const uv = m.geometry.getAttribute('uv');
    let plainUv = 0;
    for (let i = 0; i < uv.count; i++) if (uv.getX(i) === NO_UV) plainUv++;
    expect(plainUv).toBe(24); // the untextured cube reads white from the map
    expect(m.geometry.getAttribute('color').getW(0)).toBe(0); // no team mask on props
  });

  it('has a placeholder for every kind, standing on y = 0', () => {
    for (const kind of ['tree', 'rock', 'bush', 'grass', 'reed', 'other'] as const) {
      const m = createPlaceholderPropGeometry(kind);
      expect(m.triangles).toBeGreaterThan(0);
      expect(m.height).toBeGreaterThan(0.2);
      m.geometry.computeBoundingBox();
      expect(m.geometry.boundingBox!.min.y).toBeCloseTo(0, 5);
    }
  });
});

/** A small static prop GLB: a 2 x 4 x 2 m box on y = 0, under a translated node, optionally quantized. */
async function propGlb(quantized: boolean): Promise<ArrayBuffer> {
  const doc = new Document().setLogger(new Logger(Logger.Verbosity.WARN));
  const buffer = doc.createBuffer();
  const box = new BoxGeometry(2, 4, 2).translate(0, 2, 0);
  const acc = (a: Float32Array | Uint16Array, type: 'VEC3' | 'SCALAR') =>
    doc.createAccessor().setArray(a).setType(type).setBuffer(buffer);
  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', acc(new Float32Array(box.getAttribute('position').array), 'VEC3'))
    .setAttribute('NORMAL', acc(new Float32Array(box.getAttribute('normal').array), 'VEC3'))
    .setIndices(acc(new Uint16Array(box.getIndex()!.array), 'SCALAR'))
    .setMaterial(doc.createMaterial('material').setBaseColorFactor([0.5, 0.6, 0.3, 1]));
  doc
    .createScene('scene')
    .addChild(
      doc
        .createNode('prop')
        .setMesh(doc.createMesh('prop').addPrimitive(prim))
        .setTranslation([-12, 0, 4]),
    );
  if (quantized) await doc.transform(quantize());
  const bytes = await new NodeIO().registerExtensions(ALL_EXTENSIONS).writeBinary(doc);
  return bytes.slice().buffer as ArrayBuffer;
}

function manifest(entries: { id: string; kind: 'prop' | 'character' }[]): AssetManifest {
  return {
    version: 1,
    assets: entries.map(({ id, kind }) => ({
      id,
      kind,
      bounds: { min: [-1, 0, -1], max: [1, 4, 1] },
      lods: [0, 1, 2].map((level) => ({
        level: level as 0 | 1 | 2,
        path: `${id}/lod${level}.glb`,
        triangles: 12,
      })) as AssetManifest['assets'][number]['lods'],
      sockets: {},
      animations: [],
      boneCount: 0,
    })),
  };
}

describe('PropAssetRegistry', () => {
  async function setup(
    manifestEntries: { id: string; kind: 'prop' | 'character' }[],
    files: Record<string, ArrayBuffer>,
  ) {
    const requested: string[] = [];
    const gltf = createGltfIO();
    const io: PropAssetIO = {
      manifest: async () => manifest(manifestEntries),
      fetchBytes: async (url) => {
        requested.push(url);
        const f = files[url];
        if (!f) throw new Error(`404 ${url}`);
        return f;
      },
      parseGltf: (bytes, url) => gltf.parseGltf(bytes, url),
    };
    return { registry: new PropAssetRegistry(io), requested };
  }
  const src = (over: Partial<ResolvedSource> = {}): ResolvedSource => ({
    manifestUrl: 'https://a.test/manifest.json',
    resolveUrl: (_m, path) => `https://a.test/${path}`,
    sourceUrl: undefined,
    placeholders: true,
    heights: undefined,
    ...over,
  });

  it('takes a manifest prop, fetches identical LODs once and fits it', async () => {
    const glb = await propGlb(true);
    const { registry, requested } = await setup([{ id: 'rock001', kind: 'prop' }], {
      'https://a.test/rock001/lod0.glb': glb,
    });
    const r = await registry.resolve('rock001', src());
    expect(r.origin).toBe('manifest');
    expect(requested).toEqual(['https://a.test/rock001/lod0.glb']);
    expect(r.visual!.lods[0]).toBe(r.visual!.lods[2]);
    expect(r.visual!.height).toBeCloseTo(4, 2); // quantized GLB back in meters
    expect(r.visual!.height * r.visual!.fit).toBeCloseTo(PROP_TARGET_HEIGHT.rock001!, 5);
    r.visual!.lods[0].computeBoundingBox();
    expect(r.visual!.lods[0].boundingBox!.min.y).toBeCloseTo(0, 2);
    expect(r.visual!.lods[0].boundingBox!.getCenter(new Vector3()).x).toBeCloseTo(-12, 2); // node transform applied
    await registry.resolve('rock001', src());
    expect(requested.length).toBe(1); // cached
  });

  it('falls back to the source GLB, then to a placeholder, and reports why', async () => {
    const glb = await propGlb(false);
    const { registry } = await setup([{ id: 'dweller_body_human', kind: 'character' }], {
      'https://src.test/Bush001.glb': glb,
    });
    const sourceUrl = (id: string) =>
      id === 'bush001' ? 'https://src.test/Bush001.glb' : undefined;
    const bush = await registry.resolve('bush001', src({ sourceUrl }));
    expect(bush.origin).toBe('source');
    expect(bush.reasons).toEqual(['not in the manifest']);
    const tree = await registry.resolve('treelow001', src({ sourceUrl }));
    expect(tree.origin).toBe('placeholder');
    expect(tree.visual!.height * tree.visual!.fit).toBeCloseTo(PROP_TARGET_HEIGHT.treelow001!, 5);
    const char = await registry.resolve('dweller_body_human', src({ placeholders: false }));
    expect(char.origin).toBe('none');
    expect(char.visual).toBeNull();
    expect(char.reasons[0]).toMatch(/character/);
  });

  it('survives a missing manifest', async () => {
    const io: PropAssetIO = {
      manifest: () => Promise.reject(new Error('HTTP 404')),
      fetchBytes: () => Promise.reject(new Error('no')),
      parseGltf: () => Promise.reject(new Error('no')),
    };
    const r = await new PropAssetRegistry(io).resolve('rock002', src());
    expect(r.origin).toBe('placeholder');
    expect(r.reasons[0]).toMatch(/404/);
  });
});
