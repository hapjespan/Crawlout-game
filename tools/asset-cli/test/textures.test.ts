// Texture-stappen voor lokale bronnen: atlas-pakking en het teammasker op textuurkleur, met synthetische beelden.
import { Document } from '@gltf-transform/core';
import { dedup } from '@gltf-transform/functions';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { buildAtlas, emissiveAsBaseColor, packSquares, splitTeamMask } from '../src/textures.js';

/** PNG van 2 x 1: links blauw, rechts rood. */
async function twoColorPng(): Promise<Uint8Array> {
  const raw = Buffer.from([30, 60, 200, 255, 200, 40, 30, 255]);
  return new Uint8Array(
    await sharp(raw, { raw: { width: 2, height: 1, channels: 4 } })
      .png()
      .toBuffer(),
  );
}

/** Twee driehoeken: de eerste met UV's in de linkerhelft, de tweede rechts. */
function twoTriangles(doc: Document, texture: ReturnType<Document['createTexture']>) {
  const buffer = doc.createBuffer();
  const f32 = (a: number[], type: 'VEC2' | 'VEC3') =>
    doc.createAccessor().setType(type).setArray(new Float32Array(a)).setBuffer(buffer);
  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', f32([0, 0, 0, 1, 0, 0, 0, 1, 0, 2, 0, 0, 3, 0, 0, 2, 1, 0], 'VEC3'))
    .setAttribute(
      'TEXCOORD_0',
      f32([0.1, 0.2, 0.3, 0.2, 0.2, 0.8, 0.7, 0.2, 0.9, 0.2, 0.8, 0.8], 'VEC2'),
    )
    .setIndices(
      doc
        .createAccessor()
        .setType('SCALAR')
        .setArray(new Uint16Array([0, 1, 2, 3, 4, 5]))
        .setBuffer(buffer),
    )
    .setMaterial(doc.createMaterial('PERSON').setBaseColorTexture(texture));
  doc.createScene().addChild(doc.createNode('n').setMesh(doc.createMesh('m').addPrimitive(prim)));
  return prim;
}

describe('packSquares', () => {
  it('pakt vier kwart-cellen en twee kleinere in een vierkant, of meldt dat het niet past', () => {
    expect(packSquares([1024, 1024, 1024, 512, 256], 2048)).toEqual([
      { x: 0, y: 0 },
      { x: 1024, y: 0 },
      { x: 0, y: 1024 },
      { x: 1024, y: 1024 },
      { x: 1536, y: 1024 },
    ]);
    expect(packSquares([1024, 1024, 1024, 1024, 256], 2048)).toBeNull();
  });
});

describe('splitTeamMask', () => {
  it('splitst de blauwe driehoek af naar een team-materiaal dat dedup overleeft', async () => {
    const doc = new Document();
    const texture = doc
      .createTexture('t')
      .setMimeType('image/png')
      .setImage(await twoColorPng());
    twoTriangles(doc, texture);
    const result = await splitTeamMask(doc, { hue: [195, 250], minSaturation: 0.3 });
    expect(result).toEqual({ masked: 1, total: 2 });
    await doc.transform(dedup());
    const names = doc
      .getRoot()
      .listMeshes()[0]!
      .listPrimitives()
      .map((p) => `${p.getMaterial()!.getName()}:${p.getIndices()!.getCount() / 3}`);
    expect(names.sort()).toEqual(['PERSON:1', 'PERSON_team:1']);
  });
});

describe('buildAtlas en emissiveAsBaseColor', () => {
  it('maakt van een emissive-only materiaal een diffuse en zet twee textures in één atlas', async () => {
    const doc = new Document();
    const a = doc
      .createTexture('a')
      .setMimeType('image/png')
      .setImage(await twoColorPng());
    const prim = twoTriangles(doc, a);
    const emissiveOnly = doc.createMaterial('glow').setEmissiveTexture(
      doc
        .createTexture('b')
        .setMimeType('image/png')
        .setImage(await twoColorPng()),
    );
    const second = prim.clone().setMaterial(emissiveOnly);
    doc.getRoot().listMeshes()[0]!.addPrimitive(second);
    expect(emissiveAsBaseColor(doc)).toBe(1);
    const info = await buildAtlas(doc, 64);
    expect(info.cells).toHaveLength(2);
    expect(doc.getRoot().listTextures()).toHaveLength(1);
    expect(
      doc
        .getRoot()
        .listMaterials()
        .map((m) => m.getName()),
    ).toEqual(['atlas']);
    // De twee primitives hebben elk hun eigen UV's gekregen, in verschillende cellen.
    const u0 = prim.getAttribute('TEXCOORD_0')!.getElement(0, [0, 0]);
    const u1 = second.getAttribute('TEXCOORD_0')!.getElement(0, [0, 0]);
    expect(u0).not.toEqual(u1);
  });
});
