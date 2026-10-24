// De PBR-set door de karakterbuis (copyMaterial) en de teamband (teamTrim). Geen bronkunst: synthetische documenten.
import { Document } from '@gltf-transform/core';
import { KHRMaterialsSpecular } from '@gltf-transform/extensions';
import { describe, expect, it } from 'vitest';
import { copyMaterial } from '../src/autorig.part2.js';
import { validateBuildingDocument } from '../src/buildings.js';
import { materialMaps } from '../src/inspect.js';
import { addTeamTrim } from '../src/teamTrim.js';
import { parseRigmap } from '../src/rigmap.js';
import { makePng } from './fixtures.js';

function source(): Document {
  const doc = new Document();
  const texture = (name: string, size: number) =>
    doc.createTexture(name).setMimeType('image/png').setImage(makePng(size, size));
  doc
    .createMaterial('coat')
    .setBaseColorTexture(texture('coat_base', 32))
    .setNormalTexture(texture('coat_normal', 32))
    .setMetallicRoughnessTexture(texture('coat_mr', 32));
  doc
    .createMaterial('bag')
    .setBaseColorTexture(texture('bag_base', 32))
    // Een andere maat dan de diffuse: render kan hem niet op dezelfde laagindex leggen.
    .setNormalTexture(texture('bag_normal', 16));
  doc.createMaterial('eye').setBaseColorTexture(texture('eye_base', 32));
  return doc;
}

describe('de PBR-set door de karakterbuis', () => {
  it('neemt normaal en metallic-roughness mee die op de UV van de diffuse liggen', () => {
    const target = new Document();
    const cache = new Map();
    const copied = source()
      .getRoot()
      .listMaterials()
      .map((m) => copyMaterial(m, target, cache));
    const [coat, bag, eye] = copied;
    expect(coat!.getNormalTexture()).not.toBeNull();
    expect(coat!.getMetallicRoughnessTexture()).not.toBeNull();
    expect(coat!.getNormalTextureInfo()!.getTexCoord()).toBe(
      coat!.getBaseColorTextureInfo()!.getTexCoord(),
    );
    // Geen placeholder voor wat niet uitgelijnd is of niet bestaat: render leest een ontbrekende laag als vlak.
    expect(bag!.getNormalTexture()).toBeNull();
    expect(eye!.getNormalTexture()).toBeNull();
    expect(eye!.getMetallicRoughnessTexture()).toBeNull();
    expect(materialMaps(target)).toEqual(['normal', 'metallicRoughness']);
  });

  it('meldt alleen diffuse als er geen extra kaarten zijn', () => {
    const doc = new Document();
    doc
      .createMaterial('flat')
      .setBaseColorTexture(doc.createTexture('t').setMimeType('image/png').setImage(makePng(8, 8)));
    expect(materialMaps(doc)).toEqual([]);
  });
});

// De poort die de oude brief afdwong ("de brief eist geen PBR") is op 23 oktober 2026 vervallen. Wat er voor in de
// plaats staat, is het contract met render: normal en metallic-roughness mogen mee zolang ze op de diffuse liggen.
describe('de PBR-poort van gebouwen, rigide units en props', () => {
  const textured = (): Document => {
    const doc = new Document();
    const tex = (name: string, size: number) =>
      doc.createTexture(name).setMimeType('image/png').setImage(makePng(size, size));
    const material = doc
      .createMaterial('team_trim')
      .setBaseColorTexture(tex('base', 32))
      .setNormalTexture(tex('normal', 32))
      .setMetallicRoughnessTexture(tex('mr', 32));
    const buffer = doc.createBuffer();
    const prim = doc
      .createPrimitive()
      .setMaterial(material)
      .setAttribute(
        'POSITION',
        doc
          .createAccessor()
          .setType('VEC3')
          .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]))
          .setBuffer(buffer),
      )
      .setIndices(
        doc
          .createAccessor()
          .setType('SCALAR')
          .setArray(new Uint16Array([0, 1, 2]))
          .setBuffer(buffer),
      );
    doc.createMesh('m').addPrimitive(prim);
    return doc;
  };

  it('laat albedo, normal en metallic-roughness op dezelfde UV en maat toe', () => {
    expect(validateBuildingDocument(textured(), 0)).toEqual([]);
  });

  it('weigert een kaart met een andere maat of een andere UV-set dan de diffuse', () => {
    const wrongSize = textured();
    const m = wrongSize.getRoot().listMaterials()[0]!;
    m.setNormalTexture(
      wrongSize.createTexture('normal16').setMimeType('image/png').setImage(makePng(16, 16)),
    );
    expect(validateBuildingDocument(wrongSize, 0).join(' ')).toMatch(/16x16.*32x32/);

    const wrongUv = textured();
    wrongUv.getRoot().listMaterials()[0]!.getMetallicRoughnessTextureInfo()!.setTexCoord(1);
    expect(validateBuildingDocument(wrongUv, 0).join(' ')).toMatch(/andere UV-set/);
  });

  it('weigert occlusie en emissive: render leest ze niet', () => {
    const doc = textured();
    const m = doc.getRoot().listMaterials()[0]!;
    m.setOcclusionTexture(
      doc.createTexture('ao').setMimeType('image/png').setImage(makePng(32, 32)),
    );
    expect(validateBuildingDocument(doc, 0).join(' ')).toMatch(/occlusie/);
  });

  it('weigert materiaal-extensies', () => {
    const doc = textured();
    doc.createExtension(KHRMaterialsSpecular).createSpecular();
    expect(validateBuildingDocument(doc, 0).join(' ')).toMatch(/materiaal-extensies/);
  });
});

/** Buis van x=0 tot x=0.3 om de bone LeftArm, volledig op die bone geskind. */
function armDocument(): Document {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene('scene');
  const arm = doc.createNode('mixamorig:LeftArm').setTranslation([0, 1.4, 0]);
  const fore = doc.createNode('mixamorig:LeftForeArm').setTranslation([0.3, 0, 0]);
  arm.addChild(fore);
  scene.addChild(arm);
  const rings = 12;
  const segments = 8;
  const count = (rings + 1) * segments;
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const joints = new Uint16Array(count * 4);
  const weights = new Float32Array(count * 4);
  for (let r = 0; r <= rings; r++)
    for (let s = 0; s < segments; s++) {
      const i = r * segments + s;
      const a = (s / segments) * Math.PI * 2;
      positions.set([(r / rings) * 0.3, 1.4 + Math.cos(a) * 0.05, Math.sin(a) * 0.05], i * 3);
      normals.set([0, Math.cos(a), Math.sin(a)], i * 3);
      joints[i * 4] = 0;
      weights[i * 4] = 1;
    }
  const indices: number[] = [];
  for (let r = 0; r < rings; r++)
    for (let s = 0; s < segments; s++) {
      const a = r * segments + s;
      const b = r * segments + ((s + 1) % segments);
      indices.push(a, b, a + segments, b, b + segments, a + segments);
    }
  const accessor = (array: Float32Array | Uint16Array, type: 'VEC3' | 'VEC4' | 'SCALAR') =>
    doc.createAccessor().setArray(array).setType(type).setBuffer(buffer);
  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', accessor(positions, 'VEC3'))
    .setAttribute('NORMAL', accessor(normals, 'VEC3'))
    .setAttribute('JOINTS_0', accessor(joints, 'VEC4'))
    .setAttribute('WEIGHTS_0', accessor(weights, 'VEC4'))
    .setIndices(accessor(new Uint16Array(indices), 'SCALAR'))
    .setMaterial(doc.createMaterial('sleeve'));
  const skin = doc.createSkin('skin').addJoint(arm).addJoint(fore);
  scene.addChild(
    doc.createNode('body').setMesh(doc.createMesh('body').addPrimitive(prim)).setSkin(skin),
  );
  return doc;
}

describe('de teamband', () => {
  it('legt een geskinde schil met een team-materiaal om het venster van de bone', () => {
    const doc = armDocument();
    const info = addTeamTrim(doc, { bone: 'LeftArm', from: 0.3, to: 0.6, offset: 0.004 });
    expect(info.material).toBe('team_trim');
    expect(info.triangles).toBeGreaterThan(0);
    const prims = doc.getRoot().listMeshes()[0]!.listPrimitives();
    const band = prims.at(-1)!;
    expect(band.getMaterial()!.getName()).toMatch(/team/i);
    expect(band.getAttribute('TEXCOORD_0')).toBeNull();
    expect(band.getAttribute('WEIGHTS_0')).not.toBeNull();
    const p = band.getAttribute('POSITION')!;
    const e = [0, 0, 0];
    let min = Infinity;
    let max = -Infinity;
    let radius = 0;
    for (let i = 0; i < p.getCount(); i++) {
      p.getElement(i, e);
      min = Math.min(min, e[0]!);
      max = Math.max(max, e[0]!);
      radius = Math.max(radius, Math.hypot(e[1]! - 1.4, e[2]!));
    }
    // Binnen het venster langs de bone, en een paar millimeter buiten de huid van 5 cm.
    expect(min).toBeGreaterThanOrEqual(0.3 * 0.3 - 1e-6);
    expect(max).toBeLessThanOrEqual(0.6 * 0.3 + 1e-6);
    expect(radius).toBeCloseTo(0.054, 3);
  });

  it('gooit bij een onbekende bone of een leeg venster', () => {
    expect(() => addTeamTrim(armDocument(), { bone: 'RightArm' })).toThrow(/RightArm/);
    expect(() => addTeamTrim(armDocument(), { bone: 'LeftArm', from: 0.5, to: 0.5001 })).toThrow(
      /geen driehoeken/,
    );
  });

  it('weigert teamTrim naast teamMask', () => {
    expect(() =>
      parseRigmap({
        assets: { a: { teamTrim: { bone: 'LeftArm' }, teamMask: { hue: [0, 30] } } },
      }),
    ).toThrow(/teamTrim/);
  });
});
