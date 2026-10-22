// Split from props.test.ts to stay under the 5,000-token file limit.
import { Document, Logger, NodeIO } from '@gltf-transform/core';
import { BoxGeometry, Texture, Group, Mesh, MeshStandardMaterial, Vector3 } from 'three/webgpu';
import { quantize } from '@gltf-transform/functions';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import type { AssetManifest } from '@crawlout/asset-cli/manifest';
import { describe, it, expect } from 'vitest';
import { propGeometryFromGltf, createPlaceholderPropGeometry } from './propGeometry.js';
import { NO_UV } from '../units/gltfUnitGeometry.js';
import { createGltfIO } from '../units/unitAssetLoader.js';
import { type PropAssetIO, PropAssetRegistry, type ResolvedSource } from './propAssets.js';
import { PROP_TARGET_HEIGHT } from './propFit.js';

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

  it('takes a manifest prop, fetches identical LODs once and keeps its real size', async () => {
    const glb = await propGlb(true);
    const { registry, requested } = await setup([{ id: 'rock001', kind: 'prop' }], {
      'https://a.test/rock001/lod0.glb': glb,
    });
    const r = await registry.resolve('rock001', src());
    expect(r.origin).toBe('manifest');
    expect(requested).toEqual(['https://a.test/rock001/lod0.glb']);
    expect(r.visual!.lods[0]).toBe(r.visual!.lods[2]);
    expect(r.visual!.height).toBeCloseTo(4, 2); // quantized GLB back in meters
    expect(r.visual!.fit).toBe(1); // a manifest prop is never fitted (shrunk) to a category height
    expect(r.visual!.height * r.visual!.fit).toBeCloseTo(4, 2);
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
