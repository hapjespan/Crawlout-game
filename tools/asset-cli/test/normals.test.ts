// Normalen behouden en berekenen: unlit materialen (Sketchfab) mogen hun NORMAL niet verliezen in de LOD-bouw, en
// primitives zonder normalen krijgen gladde normalen.
import { Document, NodeIO } from '@gltf-transform/core';
import { KHRMaterialsUnlit } from '@gltf-transform/extensions';
import { describe, expect, it } from 'vitest';
import { conformDocument } from '../src/conform.js';
import { buildLods, createIO } from '../src/lods.js';
import { computeSmoothNormals, ensureSmoothNormals } from '../src/normals.js';
import { EMPTY_CLIPMAP } from '../src/clipmap.js';
import { EMPTY_RIGMAP } from '../src/rigmap.js';
import { makePng } from './fixtures.js';

/** UV-bol met `withNormals`; unlit als gevraagd. Hoekpunten langs de UV-naad staan dubbel (zoals in echte bronnen). */
function makeSphere(options: {
  withNormals: boolean;
  unlit: boolean;
  segments?: number;
}): Document {
  const segments = options.segments ?? 16;
  const rings = segments / 2;
  const doc = new Document();
  const buffer = doc.createBuffer();
  const columns = segments + 1; // de naad (eerste en laatste kolom) is dubbel
  const positions = new Float32Array((rings + 1) * columns * 3);
  const normals = new Float32Array((rings + 1) * columns * 3);
  const uvs = new Float32Array((rings + 1) * columns * 2);
  for (let r = 0; r <= rings; r++)
    for (let s = 0; s < columns; s++) {
      const theta = (r / rings) * Math.PI;
      const phi = (s / segments) * Math.PI * 2;
      const n = [Math.sin(theta) * Math.cos(phi), Math.cos(theta), Math.sin(theta) * Math.sin(phi)];
      const i = r * columns + s;
      positions.set(
        n.map((c) => c * 0.5),
        i * 3,
      );
      normals.set(n, i * 3);
      uvs.set([s / segments, r / rings], i * 2);
    }
  const indices: number[] = [];
  for (let r = 0; r < rings; r++)
    for (let s = 0; s < segments; s++) {
      const a = r * columns + s;
      const b = a + 1;
      const c = a + columns;
      const d = c + 1;
      indices.push(a, b, c, b, d, c);
    }
  const accessor = (array: Float32Array | Uint16Array, type: 'VEC3' | 'VEC2' | 'SCALAR') =>
    doc.createAccessor().setArray(array).setType(type).setBuffer(buffer);
  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', accessor(positions, 'VEC3'))
    .setAttribute('TEXCOORD_0', accessor(uvs, 'VEC2'))
    .setIndices(accessor(new Uint16Array(indices), 'SCALAR'));
  if (options.withNormals) prim.setAttribute('NORMAL', accessor(normals, 'VEC3'));
  const material = doc
    .createMaterial('unlit_skin')
    .setBaseColorTexture(doc.createTexture('t').setMimeType('image/png').setImage(makePng(8, 8)));
  if (options.unlit)
    material.setExtension(
      'KHR_materials_unlit',
      doc.createExtension(KHRMaterialsUnlit).createUnlit(),
    );
  prim.setMaterial(material);
  doc
    .createScene()
    .addChild(doc.createNode('sphere').setMesh(doc.createMesh('sphere').addPrimitive(prim)));
  return doc;
}

async function normalsOfLods(
  doc: Document,
  kind: 'prop' | 'character' = 'prop',
): Promise<number[][]> {
  const lods = await buildLods(
    await new NodeIO().registerExtensions([KHRMaterialsUnlit]).writeBinary(doc),
    kind,
    { toktx: null },
  );
  const out: number[][] = [];
  const io = createIO();
  for (const lod of lods) {
    const read = await io.readBinary(lod.glb);
    const normal = read.getRoot().listMeshes()[0]!.listPrimitives()[0]!.getAttribute('NORMAL');
    expect(normal, `LOD${lod.level} heeft NORMAL`).not.toBeNull();
    out.push(Array.from(normal!.getArray()!));
  }
  return out;
}

describe('normalen bij unlit materialen', () => {
  it('prune in de LOD-bouw behoudt NORMAL van een unlit model', async () => {
    const lods = await normalsOfLods(makeSphere({ withNormals: true, unlit: true }));
    expect(lods).toHaveLength(3);
    for (const normals of lods) expect(normals.length).toBeGreaterThan(0);
  });

  it('een unlit model zonder normalen krijgt gladde normalen in elke LOD, naar buiten gericht', async () => {
    const doc = makeSphere({ withNormals: false, unlit: true });
    const info = await conformDocument(doc, {
      assetId: 'sphere',
      rigmap: EMPTY_RIGMAP,
      clipmap: EMPTY_CLIPMAP,
    });
    expect(info.normalsComputed).toBe(1);
    const lods = await normalsOfLods(doc);
    for (const normals of lods) {
      for (let i = 0; i < normals.length; i += 3) {
        expect(Math.hypot(normals[i]!, normals[i + 1]!, normals[i + 2]!)).toBeCloseTo(1, 2);
      }
    }
  });
});

describe('ensureSmoothNormals', () => {
  it('berekent unit-normalen die naar buiten wijzen en laat de UV-naad gelijk', () => {
    const doc = makeSphere({ withNormals: false, unlit: false });
    expect(ensureSmoothNormals(doc)).toBe(1);
    const prim = doc.getRoot().listMeshes()[0]!.listPrimitives()[0]!;
    const normals = prim.getAttribute('NORMAL')!;
    const position = prim.getAttribute('POSITION')!;
    const n = [0, 0, 0];
    const p = [0, 0, 0];
    let checked = 0;
    for (let i = 0; i < normals.getCount(); i++) {
      normals.getElement(i, n);
      position.getElement(i, p);
      const length = Math.hypot(n[0]!, n[1]!, n[2]!);
      expect(length).toBeCloseTo(1, 4);
      // Bij een bol is de normaal de gegeven positie; de polen (waar alle driehoeken samenkomen) zijn uitgezonderd.
      if (Math.abs(p[1]!) < 0.4) {
        expect(n[0]! * p[0]! + n[1]! * p[1]! + n[2]! * p[2]!).toBeGreaterThan(0.9 * 0.5);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(20);
    // Eerste en laatste kolom van een rij liggen op dezelfde plek en delen dus dezelfde normaal.
    const columns = 17;
    const a = normals.getElement(4 * columns, [0, 0, 0]);
    const b = normals.getElement(4 * columns + 16, [0, 0, 0]);
    for (let k = 0; k < 3; k++) expect(a[k]).toBeCloseTo(b[k]!, 4);
  });

  it('laat bestaande normalen ongemoeid en vervangt een nul-normaalbuffer', () => {
    const withNormals = makeSphere({ withNormals: true, unlit: false });
    expect(ensureSmoothNormals(withNormals)).toBe(0);
    const zero = makeSphere({ withNormals: true, unlit: false });
    const prim = zero.getRoot().listMeshes()[0]!.listPrimitives()[0]!;
    const normal = prim.getAttribute('NORMAL')!;
    normal.setArray(new Float32Array(normal.getCount() * 3));
    expect(ensureSmoothNormals(zero)).toBe(1);
    expect(Array.from(computeSmoothNormals(prim).slice(0, 3)).some((v) => v !== 0)).toBe(true);
  });
});
