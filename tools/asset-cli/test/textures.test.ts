// Texture-stappen voor lokale bronnen: atlas-pakking en het teammasker op textuurkleur, met synthetische beelden.
import { Document } from '@gltf-transform/core';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  applyTeamMaskAlpha,
  buildAtlas,
  emissiveAsBaseColor,
  packSquares,
  triangleTile,
} from '../src/textures.js';

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

/** RGBA-PNG van w x h uit een functie (x, y) naar [r, g, b, a]. */
async function makeImage(
  width: number,
  height: number,
  pixel: (x: number, y: number) => [number, number, number, number],
): Promise<Uint8Array> {
  const raw = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) raw.set(pixel(x, y), (y * width + x) * 4);
  return new Uint8Array(
    await sharp(raw, { raw: { width, height, channels: 4 } })
      .png()
      .toBuffer(),
  );
}

async function decode(image: Uint8Array) {
  const { data, info } = await sharp(Buffer.from(image))
    .raw()
    .toBuffer({ resolveWithObject: true });
  const at = (x: number, y: number): number[] => {
    const o = (y * info.width + x) * info.channels;
    return [...data.subarray(o, o + info.channels)];
  };
  return { width: info.width, height: info.height, at };
}

describe('applyTeamMaskAlpha (teammasker per texel)', () => {
  it('zet alfa 1 op blauwe texels en 0 op de rest, met een zachte rand en behoud van de kleur', async () => {
    const doc = new Document();
    // Links blauw (het pak), rechts geel (de rits): in één driehoek, dus per driehoek was dit niet te scheiden.
    const image = await makeImage(32, 8, (x) =>
      x < 16 ? [30, 60, 200, 255] : [230, 200, 40, 255],
    );
    const texture = doc.createTexture('t').setMimeType('image/png').setImage(image);
    twoTriangles(doc, texture);
    const info = await applyTeamMaskAlpha(doc, { hue: [195, 250], minSaturation: 0.3 });
    expect(info).toEqual({ masked: 16 * 8, total: 32 * 8, textures: 1 });
    const out = await decode(texture.getImage()!);
    expect(out.at(3, 4)[3]).toBe(255); // diep in het blauwe pak
    expect(out.at(28, 4)[3]).toBe(0); // diep in de gele rits
    const edge = out.at(15, 4)[3]!; // aan de rand: tussenwaarde
    expect(edge).toBeGreaterThan(100);
    expect(edge).toBeLessThan(255);
    const beside = out.at(16, 4)[3]!;
    expect(beside).toBeGreaterThan(0);
    expect(beside).toBeLessThan(155);
    // De kleur van de gele texels blijft geel, ook waar de alfa 0 is.
    expect(out.at(28, 4).slice(0, 3)).toEqual([230, 200, 40]);
    expect(doc.getRoot().listMaterials()[0]!.getAlphaMode()).toBe('OPAQUE');
  });

  it('een hard masker (softness 0) en een tintbereik dat over 0 heen loopt', async () => {
    const doc = new Document();
    const image = await makeImage(4, 2, (x) => (x < 2 ? [220, 20, 40, 255] : [30, 200, 30, 255]));
    const texture = doc.createTexture('t').setMimeType('image/png').setImage(image);
    twoTriangles(doc, texture);
    await applyTeamMaskAlpha(doc, { hue: [330, 20], softness: 0 }); // rood
    const out = await decode(texture.getImage()!);
    expect([out.at(0, 0)[3], out.at(1, 1)[3], out.at(2, 0)[3], out.at(3, 1)[3]]).toEqual([
      255, 255, 0, 0,
    ]);
  });

  it('een speldeprik in het masker verdwijnt, een kleine vlek blijft', async () => {
    const doc = new Document();
    const image = await makeImage(16, 16, (x, y) =>
      x === 8 && y === 8 ? [230, 200, 40, 255] : [30, 60, 200, 255],
    );
    const texture = doc.createTexture('t').setMimeType('image/png').setImage(image);
    twoTriangles(doc, texture);
    await applyTeamMaskAlpha(doc, { hue: [195, 250], minSaturation: 0.3 });
    expect((await decode(texture.getImage()!)).at(8, 8)[3]).toBeGreaterThan(240);
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

/** Een quad (twee driehoeken) met de gegeven UV's op een eigen textuur; positie speelt geen rol. */
function quad(doc: Document, texture: ReturnType<Document['createTexture']>, uvs: number[]) {
  const buffer = doc.createBuffer();
  const prim = doc
    .createPrimitive()
    .setAttribute(
      'POSITION',
      doc
        .createAccessor()
        .setType('VEC3')
        .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]))
        .setBuffer(buffer),
    )
    .setAttribute(
      'TEXCOORD_0',
      doc.createAccessor().setType('VEC2').setArray(new Float32Array(uvs)).setBuffer(buffer),
    )
    .setIndices(
      doc
        .createAccessor()
        .setType('SCALAR')
        .setArray(new Uint16Array([0, 1, 2, 0, 2, 3]))
        .setBuffer(buffer),
    )
    .setMaterial(doc.createMaterial('m').setBaseColorTexture(texture));
  const mesh = doc.getRoot().listMeshes()[0] ?? doc.createMesh('m');
  mesh.addPrimitive(prim);
  if (doc.getRoot().listScenes().length === 0)
    doc.createScene().addChild(doc.createNode('n').setMesh(mesh));
  return prim;
}

/** Kleur van de atlas op een UV (nearest). */
async function sampleAtlas(doc: Document, u: number, v: number): Promise<number[]> {
  const atlas = await decode(doc.getRoot().listTextures()[0]!.getImage()!);
  return atlas.at(
    Math.min(atlas.width - 1, Math.floor(u * atlas.width)),
    Math.min(atlas.height - 1, Math.floor(v * atlas.height)),
  );
}

function uvsOf(prim: ReturnType<typeof quad>): [number, number][] {
  const uv = prim.getAttribute('TEXCOORD_0')!;
  return Array.from({ length: uv.getCount() }, (_, i) => {
    const e = uv.getElement(i, [0, 0]);
    return [e[0]!, e[1]!];
  });
}

describe('buildAtlas: UV buiten 0 tot 1', () => {
  /** 64 x 64 textuur met vier kleuren per kwadrant: linksboven rood, rechtsboven groen, linksonder blauw, rechtsonder wit. */
  const quadrants = (): Promise<Uint8Array> =>
    makeImage(64, 64, (x, y) =>
      y < 32
        ? x < 32
          ? [255, 0, 0, 255]
          : [0, 255, 0, 255]
        : x < 32
          ? [0, 0, 255, 255]
          : [255, 255, 255, 255],
    );

  it('regressie laarzen: een UV-minimum van -0,0003 klemt de primitive niet naar de celrand', async () => {
    const doc = new Document();
    const texture = doc
      .createTexture('t')
      .setMimeType('image/png')
      .setImage(await quadrants());
    // De laarzen van de held: u van -0,0003 tot 0,85, v van 0,005 tot 0,77.
    const prim = quad(doc, texture, [-0.0003, 0.005, 0.85, 0.005, 0.85, 0.77, -0.0003, 0.77]);
    await buildAtlas(doc, 256);
    const uvs = uvsOf(prim);
    // De cel is de hele atlas (één textuur): UV's volgen de bron, niet allemaal 1,0 (de oude verschuiving met -1).
    expect(uvs[1]![0]).toBeGreaterThan(0.8);
    expect(uvs[1]![0]).toBeLessThan(0.9);
    expect(uvs[0]![0]).toBeLessThan(0.02);
    expect(uvs[2]![1]).toBeGreaterThan(0.7);
    expect(uvs[2]![1]).toBeLessThan(0.8);
  });

  it('een primitive in een andere tegel (v van -0,87 tot -0,05) schuift terug naar 0 tot 1', async () => {
    const doc = new Document();
    const texture = doc
      .createTexture('t')
      .setMimeType('image/png')
      .setImage(await quadrants());
    const prim = quad(doc, texture, [0.1, -0.87, 0.9, -0.87, 0.9, -0.05, 0.1, -0.05]);
    await buildAtlas(doc, 256);
    const uvs = uvsOf(prim);
    expect(uvs[0]![1]).toBeCloseTo(0.13, 1);
    expect(uvs[2]![1]).toBeCloseTo(0.95, 1);
  });

  it('tegelende UV (0 tot 3): elke tegel in de atlas toont de textuur, ook de tweede en derde', async () => {
    const doc = new Document();
    const texture = doc
      .createTexture('t')
      .setMimeType('image/png')
      .setImage(await quadrants());
    const prim = quad(doc, texture, [0, 0, 3, 0, 3, 3, 0, 3]);
    const info = await buildAtlas(doc, 256);
    expect(info.cells[0]!.repeat).toBe(3);
    const uvs = uvsOf(prim);
    // Alle UV's liggen binnen de atlas.
    for (const [u, v] of uvs) {
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThanOrEqual(1);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    // Bronpunt (u, v) in tegel (tu, tv) toont dezelfde kleur als (u - tu, v - tv) in de eerste tegel: de linkerbovenhoek
    // van tegel (2, 1) is rood, de rechterbovenhoek van tegel (0, 0) is groen.
    const at = (srcU: number, srcV: number): [number, number] => [srcU / 3, srcV / 3];
    const color = async (srcU: number, srcV: number): Promise<number[]> => {
      const [u, v] = at(srcU, srcV);
      // Atlas-UV = (0,5 + t * (maat - 1)) / maat, met t = bron-UV / 3; hier is de cel de hele atlas.
      const size = (await decode(doc.getRoot().listTextures()[0]!.getImage()!)).width;
      return sampleAtlas(doc, (0.5 + u * (size - 1)) / size, (0.5 + v * (size - 1)) / size);
    };
    expect((await color(2.1, 1.1)).slice(0, 3)).toEqual([255, 0, 0]);
    expect((await color(0.9, 0.1)).slice(0, 3)).toEqual([0, 255, 0]);
    expect((await color(1.1, 2.9)).slice(0, 3)).toEqual([0, 0, 255]);
    expect((await color(2.9, 2.9)).slice(0, 3)).toEqual([255, 255, 255]);
  });

  it('een hoekpunt in twee tegels wordt gedupliceerd, de tegels blijven aansluiten', async () => {
    const doc = new Document();
    const texture = doc
      .createTexture('t')
      .setMimeType('image/png')
      .setImage(await quadrants());
    // Twee driehoeken die een hoekpunt delen op u = 1: de eerste ligt in tegel 0, de tweede in tegel 1.
    const buffer = doc.createBuffer();
    const prim = doc
      .createPrimitive()
      .setAttribute(
        'POSITION',
        doc
          .createAccessor()
          .setType('VEC3')
          .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 2, 0, 0, 1, 1, 0]))
          .setBuffer(buffer),
      )
      .setAttribute(
        'TEXCOORD_0',
        doc
          .createAccessor()
          .setType('VEC2')
          .setArray(new Float32Array([0.1, 0.1, 1, 0.1, 0.1, 0.9, 1.9, 0.1, 1.5, 0.9]))
          .setBuffer(buffer),
      )
      .setIndices(
        doc
          .createAccessor()
          .setType('SCALAR')
          .setArray(new Uint16Array([0, 1, 2, 1, 3, 4]))
          .setBuffer(buffer),
      )
      .setMaterial(doc.createMaterial('m').setBaseColorTexture(texture));
    doc.createScene().addChild(doc.createNode('n').setMesh(doc.createMesh('m').addPrimitive(prim)));
    await buildAtlas(doc, 256);
    expect(prim.getAttribute('POSITION')!.getCount()).toBe(6); // hoekpunt 1 staat er twee keer in
    const uvs = uvsOf(prim);
    const indices = prim.getIndices()!;
    const first = uvs[indices.getScalar(1)]!; // hoekpunt 1 in driehoek 1: rechterrand van de tegel
    const second = uvs[indices.getScalar(3)]!; // hoekpunt 1 in driehoek 2: linkerrand van de tegel
    expect(first[0]).toBeGreaterThan(0.95);
    expect(second[0]).toBeLessThan(0.05);
  });

  it('wrap CLAMP_TO_EDGE klemt in plaats van te tegelen', async () => {
    const doc = new Document();
    const texture = doc
      .createTexture('t')
      .setMimeType('image/png')
      .setImage(await quadrants());
    const prim = quad(doc, texture, [0, 0, 3, 0, 3, 3, 0, 3]);
    prim.getMaterial()!.getBaseColorTextureInfo()!.setWrapS(33071).setWrapT(33071);
    const info = await buildAtlas(doc, 256);
    expect(info.cells[0]!.repeat).toBe(1);
    expect(Math.max(...uvsOf(prim).map(([u]) => u))).toBeLessThanOrEqual(1);
  });

  it('triangleTile: tegel en aantal geraakte tegels', () => {
    expect(
      triangleTile([
        [0.1, 0.1],
        [0.9, 0.1],
        [0.5, 0.9],
      ]).touched,
    ).toEqual([1, 1]);
    expect(
      triangleTile([
        [-0.0003, 0.2],
        [0.8, 0.2],
        [0.4, 0.7],
      ]).base,
    ).toEqual([0, 0]);
    expect(
      triangleTile([
        [0.1, -0.9],
        [0.9, -0.9],
        [0.5, -0.1],
      ]).base,
    ).toEqual([0, -1]);
    expect(
      triangleTile([
        [0, 0],
        [3, 0],
        [0, 1],
      ]).touched,
    ).toEqual([3, 1]);
    // Een kleine overschrijding over een tegelgrens telt niet als tegelen.
    expect(
      triangleTile([
        [0.1, 0.1],
        [1.02, 0.1],
        [0.5, 0.9],
      ]).touched,
    ).toEqual([1, 1]);
  });
});
