// Split from foliage.test.ts to stay under the 5,000-token file limit.
import { describe, it, expect } from 'vitest';
import { thinTier, tierDensity, shedPlan } from './propThinning.js';
import { PROP_CATEGORIES, parsePropCategory, propCategoryOf } from './propCategory.js';
import { PropLayer, type RenderProp } from './propLayer.js';
import {
  Scene,
  MeshBasicNodeMaterial,
  BoxGeometry,
  Vector3,
  PlaneGeometry,
  Mesh,
  MeshStandardMaterial,
  DoubleSide,
} from 'three/webgpu';
import { windOf } from './propWind.js';
import { propFitScale } from './propFit.js';
import { Document, Logger, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import type { AssetManifest } from '@crawlout/asset-cli/manifest';
import { type ResolvedSource, type PropAssetIO, PropAssetRegistry } from './propAssets.js';
import { createGltfIO } from '../units/unitAssetLoader.js';
import { camera, fakeDecals, heightAt } from './foliage.helpers.js';

describe('thinning order per category', () => {
  it('puts ground cover first and trees and structures last', () => {
    expect(thinTier('grass')).toBe(0);
    expect(thinTier('plant')).toBe(0);
    expect(thinTier('debris')).toBe(0);
    for (const c of ['rock', 'crate', 'chest', 'barrel'] as const) expect(thinTier(c)).toBe(1);
    for (const c of ['tree-leafy', 'tree-bare', 'structure'] as const) expect(thinTier(c)).toBe(2);
    expect(PROP_CATEGORIES.every((c) => [0, 1, 2].includes(thinTier(c)))).toBe(true);
  });

  it('thins grass from nearer and further than a tree at the same distance', () => {
    const thin = 160;
    const min = 0.15;
    expect(tierDensity(0, 70, thin, min)).toBe(1);
    expect(tierDensity(0, 110, thin, min)).toBeLessThan(1);
    expect(tierDensity(2, 100, thin, min)).toBe(1);
    for (const d of [110, 130, 200, 400]) {
      expect(tierDensity(0, d, thin, min)).toBeLessThan(tierDensity(1, d, thin, min));
      expect(tierDensity(1, d, thin, min)).toBeLessThanOrEqual(tierDensity(2, d, thin, min));
    }
    expect(tierDensity(2, 1e6, thin, min)).toBe(min); // trees keep the configured floor
  });

  it('sheds the budget from ground cover first, far before near, trees last', () => {
    // 1000 of each tier, half far: 3000 wanted.
    const near = [500, 500, 500];
    const far = [500, 500, 500];
    expect(shedPlan(near, far, 3000)).toEqual({ near: [1, 1, 1], far: [1, 1, 1] });
    const a = shedPlan(near, far, 2500); // 500 over: the far grass goes
    expect(a.far[0]).toBe(0);
    expect(a.near[0]).toBe(1);
    expect(a.far[2]).toBe(1);
    const b = shedPlan(near, far, 1700); // 1300 over: all grass, 300 of the 500 far rocks
    expect(b.far[0]).toBe(0);
    expect(b.near[0]).toBe(0);
    expect(b.far[1]).toBeCloseTo(1 - 300 / 500, 5);
    expect(b.near[1]).toBe(1);
    expect(b.far[2]).toBe(1);
    expect(b.near[2]).toBe(1);
    const c = shedPlan(near, far, 600); // trees lose only once the rest is gone
    expect(c.far[1]).toBe(0);
    expect(c.near[1]).toBe(0);
    expect(c.far[2]).toBeLessThan(1);
    expect(c.near[2]).toBe(1);
    // The same props in a single tier shed like before: far first.
    const single = shedPlan([800, 0, 0], [800, 0, 0], 1000);
    expect(single.far[0]).toBe(0.25);
    expect(single.near[0]).toBe(1);
  });

  it('draws trees before grass when the budget is short, in the layer', () => {
    const l = new PropLayer(new Scene(), {
      heightAt,
      maxVisible: 500,
      material: () => new MeshBasicNodeMaterial(),
    });
    const list: RenderProp[] = [];
    for (let k = 0; k < 2000; k++) {
      const x = (k * 7.13) % 300;
      const y = (k * 3.71 + (k % 7) * 11.3) % 300;
      list.push({ asset: k % 2 ? 'grassfield' : 'treeoak', x, y, yaw: 0, scale: 1 });
    }
    l.setProps(list);
    const box = (h: number): BoxGeometry => new BoxGeometry(1, h, 1).translate(0, h / 2, 0);
    l.setVisual('treeoak', {
      lods: [box(5), box(5), box(5)],
      map: null,
      category: 'tree-leafy',
      fit: 1,
      height: 5,
      radius: 1,
    });
    l.setVisual('grassfield', {
      lods: [box(0.5), box(0.5), box(0.5)],
      map: null,
      category: 'grass',
      fit: 1,
      height: 0.5,
      radius: 0.3,
    });
    l.update(camera(new Vector3(150, 300, 190), new Vector3(150, 0, 150)), fakeDecals());
    const drawn = (id: string): number =>
      l
        .meshes()
        .filter((m) => m.name.startsWith(`props-${id}-`))
        .reduce((n, m) => n + m.count, 0);
    const trees = drawn('treeoak');
    const grass = drawn('grassfield');
    expect(trees + grass).toBeLessThanOrEqual(500 * 1.3);
    expect(trees).toBeGreaterThan(grass * 3);
    expect(trees).toBeGreaterThan(350);
  });
});

describe('category', () => {
  it('parses manifest values and rejects others', () => {
    expect(parsePropCategory('tree-leafy')).toBe('tree-leafy');
    expect(parsePropCategory('tree')).toBeNull();
    expect(parsePropCategory(undefined)).toBeNull();
    expect(parsePropCategory(3)).toBeNull();
  });

  it('falls back to the id for assets without a category', () => {
    expect(propCategoryOf('treehigh001')).toBe('tree-leafy');
    expect(propCategoryOf('Tree_Dead_02')).toBe('tree-bare');
    expect(propCategoryOf('grass001')).toBe('grass');
    expect(propCategoryOf('bush001')).toBe('plant');
    expect(propCategoryOf('rock003')).toBe('rock');
    expect(propCategoryOf('crate_wood')).toBe('crate');
    expect(propCategoryOf('chest01')).toBe('chest');
    expect(propCategoryOf('barrel_a')).toBe('barrel');
    expect(propCategoryOf('watchtower')).toBe('structure');
    expect(propCategoryOf('mystery')).toBe('debris');
  });

  it('wind only for trees with leaves, grass and plants', () => {
    expect(windOf('tree-leafy')).not.toBeNull();
    expect(windOf('grass')).not.toBeNull();
    expect(windOf('plant')).not.toBeNull();
    for (const c of [
      'tree-bare',
      'rock',
      'crate',
      'chest',
      'barrel',
      'structure',
      'debris',
    ] as const)
      expect(windOf(c)).toBeNull();
    expect(windOf('grass')!.amplitude).toBeGreaterThan(windOf('tree-leafy')!.amplitude);
  });

  it('fits by the category when the id says nothing (an asset without a manifest entry)', () => {
    expect(propFitScale('foo', 2.5, undefined, 'tree-leafy')).toBeCloseTo(2, 5); // 5 m
    expect(propFitScale('foo', 2.5, undefined, 'crate')).toBe(1); // keeps its own size
    expect(propFitScale('foo', 2.5, { foo: 1.25 }, 'tree-leafy')).toBeCloseTo(0.5, 5);
  });

  it('never fits a manifest prop: real size at scale 1, whatever the category or id', () => {
    // The DJMaesen props come at real scale (a 13 m oak, a 20 m cliff, a 0.6 m grass patch).
    expect(propFitScale('tree_oak_03', 13, undefined, 'tree-leafy', true)).toBe(1);
    expect(propFitScale('rock_set2_10', 7.75, undefined, 'rock', true)).toBe(1);
    expect(propFitScale('grass_patch_01', 0.6, undefined, 'grass', true)).toBe(1);
    expect(propFitScale('treehigh001', 8.49, undefined, null, true)).toBe(1); // old id table: not for the manifest
    // An explicit client override still wins.
    expect(propFitScale('tree_oak_03', 13, { tree_oak_03: 6.5 }, 'tree-leafy', true)).toBeCloseTo(
      0.5,
      5,
    );
  });
});

describe('PropAssetRegistry: manifest category and alpha', () => {
  async function leafGlb(): Promise<ArrayBuffer> {
    const doc = new Document().setLogger(new Logger(Logger.Verbosity.WARN));
    const buffer = doc.createBuffer();
    const quad = new PlaneGeometry(4, 3).translate(0, 1.5, 0);
    const acc = (a: Float32Array | Uint16Array, type: 'VEC3' | 'VEC2' | 'SCALAR') =>
      doc.createAccessor().setArray(a).setType(type).setBuffer(buffer);
    const prim = doc
      .createPrimitive()
      .setAttribute('POSITION', acc(new Float32Array(quad.getAttribute('position').array), 'VEC3'))
      .setAttribute('NORMAL', acc(new Float32Array(quad.getAttribute('normal').array), 'VEC3'))
      .setIndices(acc(new Uint16Array(quad.getIndex()!.array), 'SCALAR'))
      .setMaterial(
        doc.createMaterial('leaf').setAlphaMode('MASK').setAlphaCutoff(0.65).setDoubleSided(true),
      );
    doc
      .createScene('s')
      .addChild(doc.createNode('n').setMesh(doc.createMesh('m').addPrimitive(prim)));
    const bytes = await new NodeIO().registerExtensions(ALL_EXTENSIONS).writeBinary(doc);
    return bytes.slice().buffer as ArrayBuffer;
  }

  function manifestOf(entries: { id: string; extra?: object }[]): AssetManifest {
    return {
      version: 1,
      assets: entries.map(({ id, extra }) => ({
        id,
        kind: 'prop',
        bounds: { min: [-1, 0, -1], max: [1, 3, 1] },
        lods: [0, 1, 2].map((level) => ({
          level,
          path: `${id}/lod0.glb`,
          triangles: 2,
        })),
        sockets: {},
        animations: [],
        boneCount: 0,
        ...extra,
      })),
    } as unknown as AssetManifest;
  }

  const src = (over: Partial<ResolvedSource> = {}): ResolvedSource => ({
    manifestUrl: 'https://a.test/manifest.json',
    resolveUrl: (_m, path) => `https://a.test/${path}`,
    sourceUrl: undefined,
    placeholders: false,
    heights: undefined,
    ...over,
  });

  async function registry(entries: Parameters<typeof manifestOf>[0], glb: ArrayBuffer) {
    const gltf = createGltfIO();
    const io: PropAssetIO = {
      manifest: async () => manifestOf(entries),
      fetchBytes: async () => glb,
      parseGltf: (bytes, url) => gltf.parseGltf(bytes, url),
    };
    return new PropAssetRegistry(io);
  }

  it('reads three.js alphaTest and double-sidedness from a glTF MASK material', async () => {
    const gltf = createGltfIO();
    const root = await gltf.parseGltf(await leafGlb(), 'https://a.test/');
    const mesh = root.getObjectByProperty('isMesh', true) as Mesh;
    const material = mesh.material as MeshStandardMaterial;
    expect(material.alphaTest).toBeCloseTo(0.65, 5);
    expect(material.side).toBe(DoubleSide);
  });

  it('carries the manifest category into the visual and the fit, with the alpha forced by the manifest', async () => {
    const r = await registry(
      [{ id: 'leafy_a', extra: { category: 'tree-leafy', alpha: 'mask' } }],
      await leafGlb(),
    );
    const out = await r.resolve('leafy_a', src());
    expect(out.origin).toBe('manifest');
    expect(out.visual!.category).toBe('tree-leafy');
    // A GLB leaf material has no texture here, so nothing can be alpha-tested: the visual stays opaque.
    expect(out.visual!.mask).toBe(false);
    // The category does not shrink a manifest prop: real size, fit 1.
    expect(out.visual!.fit).toBe(1);
  });

  it('ignores a category it does not know and reads one from the id', async () => {
    const r = await registry([{ id: 'grass_tuft', extra: { category: 'weeds' } }], await leafGlb());
    const out = await r.resolve('grass_tuft', src());
    expect(out.visual!.category).toBe('grass');
  });

  it('takes a category from the source options for assets without a manifest entry', async () => {
    const r = await registry([], await leafGlb());
    const out = await r.resolve(
      'thing',
      src({
        manifestUrl: undefined,
        sourceUrl: () => 'https://a.test/thing.glb',
        categories: { thing: 'plant' },
      }),
    );
    expect(out.origin).toBe('source');
    expect(out.visual!.category).toBe('plant');
    expect(out.visual!.height * out.visual!.fit).toBeCloseTo(0.7, 5); // the fallback fit still serves sources
  });
});
