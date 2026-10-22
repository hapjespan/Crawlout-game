// Foliage in the prop pipeline: alpha-tested (mask) tree and grass materials against opaque ones, two-sided drawing for
// masks only, one draw per asset per LOD, the thinning order per category, per-instance variation, wind and the
// manifest's category and alpha fields.
import {
  Vector3,
  Texture,
  Group,
  Mesh,
  BoxGeometry,
  MeshStandardMaterial,
  DoubleSide,
  PlaneGeometry,
  FrontSide,
  type Node,
  Scene,
  MeshBasicNodeMaterial,
  type InstancedBufferAttribute,
} from 'three/webgpu';
import { describe, it, expect } from 'vitest';
import { propGeometryFromGltf, ensureCutoffAttribute, distinctTextures } from './propGeometry.js';
import { TextureLayerTable, NO_LAYER } from '../structures/buildingGeometry.js';
import { createPropMaterial } from '../structures/propMaterial.js';
import { uniform } from 'three/tsl';
import { windOf } from './propWind.js';
import { type PropMaterialSpec, PropLayer, type RenderProp, type PropVisual } from './propLayer.js';
import { PROP_LOD_PX } from '../lod/screenLod.js';
import { FOLIAGE_VARIATION, instanceTint } from './propVariation.js';
import { camera, fakeDecals, heightAt } from './foliage.helpers.js';

const LIGHT = new Vector3(0.4, 1, 0.3);

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
      treeLodPixels: PROP_LOD_PX, // these tests read the LOD 0 batch of trees
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
