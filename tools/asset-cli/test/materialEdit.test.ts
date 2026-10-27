import { Document } from '@gltf-transform/core';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { dropMaterials, recolorMaterials } from '../src/materialEdit.js';
import { parseRigmap } from '../src/rigmap.js';

async function twoParts(): Promise<Document> {
  const doc = new Document();
  doc.createBuffer();
  // A 2x1 diffuse: one dark and one darker texel, mean luminance 30.
  const png = await sharp(Buffer.from([40, 40, 40, 255, 20, 20, 20, 255]), {
    raw: { width: 2, height: 1, channels: 4 },
  })
    .png()
    .toBuffer();
  const texture = doc.createTexture('coat').setMimeType('image/png').setImage(new Uint8Array(png));
  const mesh = doc.createMesh('body');
  for (const name of ['coat', 'backpack'])
    mesh.addPrimitive(
      doc
        .createPrimitive()
        .setMaterial(doc.createMaterial(name).setBaseColorTexture(texture))
        .setAttribute(
          'POSITION',
          doc.createAccessor().setType('VEC3').setArray(new Float32Array(9)),
        ),
    );
  return doc;
}

describe('materialEdit', () => {
  it('drops the parts of a material and refuses an unknown name', async () => {
    const doc = await twoParts();
    expect(dropMaterials(doc, ['backpack'])).toBe(1);
    const prims = doc.getRoot().listMeshes()[0]!.listPrimitives();
    expect(prims.map((p) => p.getMaterial()!.getName())).toEqual(['coat']);
    expect(() => dropMaterials(doc, ['helmet'])).toThrow(/helmet/);
  });

  it('recolours to the mean colour, keeps the wear at the given contrast, leaves a shared texture alone', async () => {
    const doc = await twoParts();
    const shared = doc.getRoot().listTextures()[0]!;
    await recolorMaterials(doc, { coat: { color: '#a08060', contrast: 0.5 } });
    const coat = doc.getRoot().listMaterials()[0]!.getBaseColorTexture()!;
    expect(coat).not.toBe(shared);
    const px = await sharp(Buffer.from(coat.getImage()!)).raw().toBuffer();
    // Luminance 40 and 20 against mean 30, half contrast: 1 ± 1/6 times the target colour.
    expect([...px.subarray(0, 3)]).toEqual([187, 149, 112]);
    expect([...px.subarray(px.length / 2, px.length / 2 + 3)]).toEqual([133, 107, 80]);
  });

  it('is part of the rigmap schema', () => {
    const map = parseRigmap({
      assets: { a: { dropMaterials: ['backpack'], recolor: { coat: { color: '#a8987a' } } } },
    });
    expect(map.assets.a?.recolor?.coat?.color).toBe('#a8987a');
    expect(() => parseRigmap({ assets: { a: { recolor: { coat: { color: 'tan' } } } } })).toThrow();
  });
});
