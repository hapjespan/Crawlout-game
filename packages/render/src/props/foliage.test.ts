// Foliage in the prop pipeline: alpha-tested (mask) tree and grass materials against opaque ones, two-sided drawing for
// masks only, one draw per asset per LOD, the thinning order per category, per-instance variation, wind and the
// manifest's category and alpha fields.
import { describe, expect, it } from 'vitest';
import { Document, Logger, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import type { AssetManifest } from '@crawlout/asset-cli/manifest';
import {
  BoxGeometry,
  DoubleSide,
  FrontSide,
  Group,
  Mesh,
  MeshBasicNodeMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  Texture,
  Vector3,
  type InstancedBufferAttribute,
  type Node,
} from 'three/webgpu';
import { uniform } from 'three/tsl';
import type { DecalLayer } from '../decals/decalLayer.js';
import { createPropMaterial } from '../structures/propMaterial.js';
import { createGltfIO } from '../units/unitAssetLoader.js';
import { PropAssetRegistry, type PropAssetIO, type ResolvedSource } from './propAssets.js';
import { parsePropCategory, propCategoryOf, PROP_CATEGORIES } from './propCategory.js';
import { propFitScale } from './propFit.js';
import { distinctTextures, ensureCutoffAttribute, propGeometryFromGltf } from './propGeometry.js';
import { PropLayer, type PropMaterialSpec, type PropVisual, type RenderProp } from './propLayer.js';
import { shedPlan, thinTier, tierDensity } from './propThinning.js';
import { FOLIAGE_VARIATION, instanceTint } from './propVariation.js';
import { windOf } from './propWind.js';
import { TextureLayerTable } from '../structures/buildingGeometry.js';
import { NO_LAYER } from '../structures/buildingGeometry.js';

const LIGHT = new Vector3(0.4, 1, 0.3);
const heightAt = (): number => 0;

function fakeDecals(): DecalLayer {
  return { push: () => {}, pushContact: () => {} } as unknown as DecalLayer;
}

function camera(at: Vector3, lookAt: Vector3): PerspectiveCamera {
  const c = new PerspectiveCamera(45, 1, 0.5, 800);
  c.position.copy(at);
  c.lookAt(lookAt);
  c.updateMatrixWorld();
  return c;
}

/** A tree-like scene: an opaque trunk and two crossed leaf cards that are alpha-tested through `leafMap`. */
function leafyTree(opts: { leafMap: Texture; trunkMap?: Texture; cutoff?: number }): Group {
  const root = new Group();
  const trunk = new Mesh(
    new BoxGeometry(0.4, 3, 0.4).translate(0, 1.5, 0),
    new MeshStandardMaterial({ color: 0x553311, ...(opts.trunkMap ? { map: opts.trunkMap } : {}) }),
  );
  trunk.name = 'trunk';
  const leaves = new MeshStandardMaterial({
    map: opts.leafMap,
    alphaTest: opts.cutoff ?? 0.65,
    side: DoubleSide,
  });
  const a = new Mesh(new PlaneGeometry(4, 3).translate(0, 4, 0), leaves);
  const b = new Mesh(new PlaneGeometry(4, 3).rotateY(Math.PI / 2).translate(0, 4, 0), leaves);
  root.add(trunk, a, b);
  return root;
}

describe('propGeometryFromGltf: alpha-tested art', () => {
  it('gives masked primitives their cutoff in aCut and leaves the opaque trunk at 0', () => {
    const atlas = new Texture();
    const root = new Group();
    const trunk = new Mesh(new BoxGeometry(0.4, 3, 0.4), new MeshStandardMaterial({ map: atlas }));
    trunk.position.y = 1.5;
    const leaves = new Mesh(
      new PlaneGeometry(4, 3),
      new MeshStandardMaterial({ map: atlas, alphaTest: 0.65, side: DoubleSide }),
    );
    leaves.position.y = 4;
    root.add(trunk, leaves);
    const m = propGeometryFromGltf(root);
    expect(m.mask).toBe(true);
    const cut = m.geometry.getAttribute('aCut');
    const values = new Set<number>();
    for (let i = 0; i < cut.count; i++) values.add(Math.round(cut.getX(i) * 100) / 100);
    expect([...values].sort()).toEqual([0, 0.65]);
    expect(cut.count).toBe(m.geometry.getAttribute('position').count);
    expect(m.map).toBe(atlas); // the atlas is the leaves' texture, shared with the trunk
  });

  it('has no aCut for an opaque prop, and a mask needs a texture to read alpha from', () => {
    const opaque = propGeometryFromGltf(
      Object.assign(new Group(), {}).add(
        new Mesh(new BoxGeometry(), new MeshStandardMaterial({ map: new Texture() })),
      ),
    );
    expect(opaque.mask).toBe(false);
    expect(opaque.geometry.getAttribute('aCut')).toBeUndefined();
    const untextured = propGeometryFromGltf(
      new Group().add(new Mesh(new PlaneGeometry(), new MeshStandardMaterial({ alphaTest: 0.5 }))),
    );
    expect(untextured.mask).toBe(false);
  });

  it('forces a mask when the manifest says alpha: mask, and reads blended textures as masks', () => {
    const map = new Texture();
    const opaqueGlb = (): Group =>
      new Group().add(new Mesh(new PlaneGeometry(), new MeshStandardMaterial({ map })));
    expect(propGeometryFromGltf(opaqueGlb()).mask).toBe(false);
    const forced = propGeometryFromGltf(opaqueGlb(), { forceMask: true });
    expect(forced.mask).toBe(true);
    expect(forced.geometry.getAttribute('aCut').getX(0)).toBeCloseTo(0.5, 5);
    const blended = new Group().add(
      new Mesh(new PlaneGeometry(), new MeshStandardMaterial({ map, transparent: true })),
    );
    expect(propGeometryFromGltf(blended).mask).toBe(true);
  });

  it('adds a zero aCut to an LOD without leaf cards so it can share the mask material', () => {
    const g = new BoxGeometry();
    ensureCutoffAttribute(g);
    const cut = g.getAttribute('aCut');
    expect(cut.count).toBe(g.getAttribute('position').count);
    expect(cut.getX(0)).toBe(0);
  });

  it('takes the layered layout when the materials use different textures (bark and leaves)', () => {
    const bark = new Texture();
    const leaf = new Texture();
    const root = leafyTree({ leafMap: leaf, trunkMap: bark });
    // GLTFLoader gives equal images one Source; two distinct textures count as two.
    expect(distinctTextures(root)).toBe(2);
    const table = new TextureLayerTable();
    const m = propGeometryFromGltf(root, { layers: table });
    expect(m.layered).toBe(true);
    expect(m.map).toBeNull();
    expect(table.size).toBe(2);
    const uvl = m.geometry.getAttribute('uvl');
    const layers = new Set<number>();
    for (let i = 0; i < uvl.count; i++) layers.add(uvl.getZ(i));
    expect(layers.has(NO_LAYER)).toBe(false);
    expect(layers.size).toBe(2);
    expect(m.geometry.getAttribute('uv')).toBeUndefined();
    expect(m.mask).toBe(true);
  });

  it('keeps one texture per prop in the usual layout', () => {
    const root = leafyTree({ leafMap: new Texture() });
    expect(distinctTextures(root)).toBe(1);
  });
});

describe('createPropMaterial: mask against opaque', () => {
  const map = new Texture();

  it('draws an opaque prop single-sided, a mask prop two-sided', () => {
    const opaque = createPropMaterial({ lightDir: LIGHT, name: 'o', map });
    const mask = createPropMaterial({ lightDir: LIGHT, name: 'm', map, alphaMask: true });
    expect(opaque.side).toBe(FrontSide);
    expect(mask.side).toBe(DoubleSide);
    expect(mask.fragmentNode).not.toBeNull(); // the alpha test is built in
    expect(opaque.fragmentNode).toBeNull();
    expect(opaque.colorNode).not.toBeNull();
  });

  it('keeps the shadow-receiving opaque variant single-sided and the mask variant two-sided', () => {
    const shadow = { factor: uniform(1), receivePosition: (p: Node<'vec3'>) => p };
    const opaque = createPropMaterial({ lightDir: LIGHT, name: 'o', map, shadow });
    const mask = createPropMaterial({ lightDir: LIGHT, name: 'm', map, shadow, alphaMask: true });
    expect(opaque.side).toBe(FrontSide);
    expect(opaque.fragmentNode).not.toBeNull();
    expect(opaque.receivedShadowPositionNode).not.toBeNull();
    expect(mask.side).toBe(DoubleSide);
  });

  it('runs the alpha test in the shadow pass too, so a tree casts leaves, not cards', () => {
    const mask = createPropMaterial({ lightDir: LIGHT, name: 'm', map, alphaMask: true });
    const opaque = createPropMaterial({ lightDir: LIGHT, name: 'o', map });
    expect(mask.maskShadowNode).not.toBeNull();
    expect(opaque.maskShadowNode).toBeNull();
  });

  it('does not make a material two-sided that has nothing to alpha-test', () => {
    const noTexture = createPropMaterial({ lightDir: LIGHT, name: 'x', alphaMask: true });
    expect(noTexture.side).toBe(FrontSide);
  });

  it('takes wind without changing the side or the alpha test', () => {
    const wind = windOf('grass')!;
    const m = createPropMaterial({
      lightDir: LIGHT,
      name: 'w',
      map,
      alphaMask: true,
      wind: { ...wind, height: 0.5, time: uniform(0), strength: uniform(1) },
    });
    expect(m.side).toBe(DoubleSide);
    expect(m.positionNode).not.toBeNull();
  });
});

describe('PropLayer: mask variants', () => {
  function geo(height = 2, cutoff = false): BoxGeometry {
    const g = new BoxGeometry(1, height, 1).translate(0, height / 2, 0);
    if (cutoff) ensureCutoffAttribute(g);
    return g;
  }
  const specs: PropMaterialSpec[] = [];
  const make = (): PropLayer =>
    new PropLayer(new Scene(), {
      heightAt,
      material: (spec) => {
        specs.push(spec);
        return createPropMaterial({
          lightDir: LIGHT,
          name: 'p',
          map: spec.map,
          alphaMask: spec.mask,
        });
      },
    });
  const props: RenderProp[] = [
    { asset: 'treeoak', x: 10, y: 10, yaw: 0, scale: 1 },
    { asset: 'treeoak', x: 14, y: 12, yaw: 0, scale: 1 },
    { asset: 'crate001', x: 20, y: 20, yaw: 0, scale: 1 },
  ];
  const view = camera(new Vector3(15, 60, 15.01), new Vector3(15, 0, 15));

  it('builds the mask material only for the asset that has leaf cards, two-sided only there', () => {
    specs.length = 0;
    const l = make();
    l.setProps(props);
    const tree: PropVisual = {
      lods: [geo(4, true), geo(4, true), geo(4, true)],
      map: new Texture(),
      mask: true,
      category: 'tree-leafy',
      fit: 1,
      height: 4,
      radius: 2,
    };
    const crate: PropVisual = {
      lods: [geo(1), geo(1), geo(1)],
      map: new Texture(),
      mask: false,
      category: 'crate',
      fit: 1,
      height: 1,
      radius: 0.5,
    };
    l.setVisual('treeoak', tree);
    l.setVisual('crate001', crate);
    expect(specs.map((s) => [s.category, s.mask])).toEqual([
      ['tree-leafy', true],
      ['crate', false],
    ]);
    l.update(view, fakeDecals());
    const sides = new Map(
      l.meshes().map((m) => [m.name, (m.material as MeshBasicNodeMaterial).side]),
    );
    expect(sides.get('props-treeoak-0')).toBe(DoubleSide);
    expect(sides.get('props-crate001-0')).toBe(FrontSide);
    // Still one draw per asset when the LODs are one geometry.
    expect(l.drawCount()).toBe(2);
  });

  it('keeps one batch per distinct LOD geometry for a mask asset, every LOD with an aCut attribute', () => {
    specs.length = 0;
    const l = make();
    l.setProps(props.slice(0, 2));
    const far = geo(1); // an LOD without leaf cards: no aCut of its own
    l.setVisual('treeoak', {
      lods: [geo(4, true), far, far],
      map: new Texture(),
      mask: true,
      category: 'tree-leafy',
      fit: 1,
      height: 4,
      radius: 2,
    });
    const meshes = l.meshes();
    expect(meshes.length).toBe(2);
    for (const m of meshes) expect(m.geometry.getAttribute('aCut')).toBeDefined();
    expect(meshes[0]!.material).toBe(meshes[1]!.material); // one material for the asset
  });

  it('gives each foliage instance its own colour and wind phase', () => {
    const l = make();
    const trees: RenderProp[] = Array.from({ length: 40 }, (_, k) => ({
      asset: 'treeoak',
      x: 10 + (k % 8) * 2,
      y: 10 + Math.floor(k / 8) * 2,
      yaw: 0,
      scale: 1,
    }));
    l.setProps(trees);
    l.setVisual('treeoak', {
      lods: [geo(4, true), geo(4, true), geo(4, true)],
      map: new Texture(),
      mask: true,
      category: 'tree-leafy',
      fit: 1,
      height: 4,
      radius: 2,
    });
    l.update(view, fakeDecals());
    const g = l.meshes()[0]!.geometry;
    const tint = g.getAttribute('iTint') as InstancedBufferAttribute;
    const rs = new Set<number>();
    const phases = new Set<number>();
    for (let k = 0; k < 40; k++) {
      rs.add(Math.round(tint.getX(k) * 1000));
      phases.add(Math.round(tint.getW(k) * 1000));
      for (const c of [tint.getX(k), tint.getY(k), tint.getZ(k)]) {
        expect(c).toBeGreaterThanOrEqual(1 - 1.5 * FOLIAGE_VARIATION);
        expect(c).toBeLessThanOrEqual(1 + 1.5 * FOLIAGE_VARIATION);
      }
      expect(tint.getW(k)).toBeGreaterThanOrEqual(0);
      expect(tint.getW(k)).toBeLessThan(Math.PI * 2);
    }
    expect(rs.size).toBeGreaterThan(20);
    expect(phases.size).toBeGreaterThan(20);
  });
});

describe('instanceTint', () => {
  const out: [number, number, number] = [0, 0, 0];

  it('keeps brightness within 8 percent and red against blue within 8 percent for trees and plants', () => {
    for (const c of ['tree-leafy', 'tree-bare', 'plant'] as const) {
      for (let i = 0; i <= 10; i++)
        for (let j = 0; j <= 10; j++) {
          instanceTint(c, i / 10, j / 10, 1, out);
          expect(out[1]).toBeGreaterThanOrEqual(0.92 - 1e-9);
          expect(out[1]).toBeLessThanOrEqual(1.08 + 1e-9);
          expect(Math.abs(out[0] / out[1] - 1)).toBeLessThanOrEqual(FOLIAGE_VARIATION / 2 + 1e-9);
          expect(Math.abs(out[2] / out[1] - 1)).toBeLessThanOrEqual(FOLIAGE_VARIATION / 2 + 1e-9);
          expect(out[0] / out[2]).toBeLessThanOrEqual(1.09);
        }
    }
  });

  it('freshens grass: greener and brighter than the art, within its own variation', () => {
    for (let i = 0; i <= 10; i++)
      for (let j = 0; j <= 10; j++) {
        instanceTint('grass', i / 10, j / 10, 1, out);
        expect(out[1]).toBeGreaterThan(out[0]);
        expect(out[1]).toBeGreaterThan(out[2]);
        expect(out[1]).toBeGreaterThan(1.3);
        expect(out[1]).toBeLessThan(2.8);
      }
  });

  it('tints foliage and keeps rocks and crates grey, applying the asset gain', () => {
    instanceTint('tree-leafy', 0.5, 1, 1, out);
    expect(out[0]).toBeGreaterThan(out[2]);
    instanceTint('rock', 0.5, 1, 1, out);
    expect(out[0]).toBe(out[2]);
    instanceTint('rock', 0.5, 0, 1.5, out);
    expect(out[0]).toBeCloseTo(1.5 * 0.99, 5);
  });
});

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
