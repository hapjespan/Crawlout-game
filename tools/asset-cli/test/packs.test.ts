// Prop-packs: splitsregel, FBX-draaiing, echte schaal, atlas met alfa (MASK) en de config. Synthetische pack-GLB,
// dus geen echte bronnen nodig (die staan niet in git).
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildAssets } from '../src/build.js';
import { manifestSchema } from '../src/manifest.js';
import { buildPacks, classifyFoliage, parsePacksConfig, type PacksConfig } from '../src/packs.js';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'asset-cli-packs-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const CATEGORY = { heightRangeM: [0.05, 15], tris: [200, 100, 50], atlas: 512 };

function config(overrides: Record<string, unknown> = {}): unknown {
  const categories: Record<string, unknown> = {};
  for (const name of [
    'tree-leafy',
    'tree-bare',
    'grass',
    'plant',
    'rock',
    'crate',
    'chest',
    'barrel',
    'structure',
    'debris',
  ])
    categories[name] = CATEGORY;
  return {
    version: 1,
    attribution: 'Test pack by Tester, CC-BY-4.0',
    categories,
    textureQuality: { jpeg: 80, webp: 80 },
    sources: {
      pack: {
        file: 'pack.glb',
        unit: 0.01,
        split: { parent: 'RootNode' },
        props: {
          crate_01: { node: 'cube', category: 'crate', heightM: 0.9 },
          tree_leafy_01: { node: 'bush', category: 'tree-leafy', heightM: 7, alpha: 'mask' },
        },
      },
    },
    ...overrides,
  };
}

async function png(
  width: number,
  height: number,
  rgba: (x: number, y: number) => [number, number, number, number],
): Promise<Uint8Array> {
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) data.set(rgba(x, y), (y * width + x) * 4);
  return new Uint8Array(
    await sharp(data, { raw: { width, height, channels: 4 } })
      .png()
      .toBuffer(),
  );
}

/** Cube (144 cm) en een kaart-struik (alfa, groen), onder een RootNode met de Sketchfab-FBX-draaiing (-90 en +90 graden om X). */
async function makePack(): Promise<Uint8Array> {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const bark = doc
    .createTexture('bark')
    .setMimeType('image/png')
    .setImage(await png(512, 512, () => [120, 90, 60, 255]));
  const leaf = doc
    .createTexture('leaf')
    .setMimeType('image/png')
    .setImage(await png(512, 512, (x) => (x < 256 ? [40, 160, 50, 255] : [0, 0, 0, 0])));
  const wood = doc.createMaterial('wood').setBaseColorTexture(bark);
  const leaves = doc
    .createMaterial('leaves')
    .setBaseColorTexture(leaf)
    .setAlphaMode('BLEND')
    .setDoubleSided(true);

  const quad = (x0: number, y0: number, x1: number, y1: number, z: number) => ({
    positions: [x0, y0, z, x1, y0, z, x1, y1, z, x0, y1, z],
    normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
    uvs: [0, 1, 1, 1, 1, 0, 0, 0],
  });
  const addMesh = (
    name: string,
    parts: ReturnType<typeof quad>[],
    material: ReturnType<Document['createMaterial']>,
  ) => {
    const mesh = doc.createMesh(name);
    for (const part of parts) {
      const accessor = (type: 'VEC3' | 'VEC2' | 'SCALAR', array: Float32Array | Uint16Array) =>
        doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
      mesh.addPrimitive(
        doc
          .createPrimitive()
          .setAttribute('POSITION', accessor('VEC3', new Float32Array(part.positions)))
          .setAttribute('NORMAL', accessor('VEC3', new Float32Array(part.normals)))
          .setAttribute('TEXCOORD_0', accessor('VEC2', new Float32Array(part.uvs)))
          .setIndices(accessor('SCALAR', new Uint16Array([0, 1, 2, 0, 2, 3])))
          .setMaterial(material),
      );
    }
    return mesh;
  };
  // De cube: zes vlakken van 144 cm, ver van de oorsprong geplaatst en gekanteld in de pack (plaatsing valt weg).
  const faces = [quad(0, 0, 144, 144, 144), quad(0, 0, 144, 144, 0), quad(0, 0, 144, 144, 72)];
  const sketchfab = doc
    .createNode('Sketchfab_model')
    .setRotation([-Math.SQRT1_2, 0, 0, Math.SQRT1_2]);
  const fbx = doc
    .createNode('fbx')
    .setRotation([Math.SQRT1_2, 0, 0, Math.SQRT1_2])
    .setScale([0.5, 0.5, 0.5]);
  const rootNode = doc.createNode('RootNode');
  const cube = doc
    .createNode('cube')
    .setMesh(addMesh('cube', faces, wood))
    .setTranslation([500, 20, -300]);
  const bush = doc
    .createNode('bush')
    .setMesh(addMesh('bush', [quad(0, 0, 300, 500, 0), quad(0, 0, 300, 500, 40)], leaves))
    .setTranslation([-900, 7, 12]);
  sketchfab.addChild(fbx);
  fbx.addChild(rootNode);
  rootNode.addChild(cube).addChild(bush);
  doc.createScene('scene').addChild(sketchfab);
  return new NodeIO().registerExtensions(ALL_EXTENSIONS).writeBinary(doc);
}

async function setup(cfg: unknown = config()) {
  const packsDir = join(root, 'packs');
  mkdirSync(packsDir);
  writeFileSync(join(packsDir, 'pack.glb'), await makePack());
  return { packsDir, parsed: parsePacksConfig(cfg) };
}

async function readLod(bytes: Uint8Array): Promise<Document> {
  await MeshoptDecoder.ready;
  return new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
    .readBinary(bytes);
}

describe('config', () => {
  it('weigert een ontbrekende categorie', () => {
    const cfg = config() as PacksConfig & { categories: Record<string, unknown> };
    delete cfg.categories['barrel'];
    expect(() => parsePacksConfig(cfg)).toThrow(/categorie "barrel" ontbreekt/);
  });
  it('weigert een id die in twee bronnen voorkomt en een node die twee keer gekoppeld is', () => {
    const cfg = config() as { sources: Record<string, { props: Record<string, unknown> }> };
    cfg.sources['other'] = {
      ...(cfg.sources['pack'] as object),
      props: { crate_01: { node: 'x', category: 'crate' } },
    } as never;
    expect(() => parsePacksConfig(cfg)).toThrow(/crate_01/);
    const dup = config() as { sources: { pack: { props: Record<string, unknown> } } };
    dup.sources.pack.props['crate_02'] = { node: 'cube', category: 'crate' };
    expect(() => parsePacksConfig(dup)).toThrow(/twee props/);
  });
  it('weigert tris die niet aflopen en heightM met longestM', () => {
    const cfg = config({
      categories: {
        ...(config() as { categories: object }).categories,
        crate: { ...CATEGORY, tris: [100, 200, 50] },
      },
    });
    expect(() => parsePacksConfig(cfg)).toThrow(/aflopen/);
    const both = config() as {
      sources: { pack: { props: { crate_01: Record<string, unknown> } } };
    };
    both.sources.pack.props.crate_01.longestM = 1;
    expect(() => parsePacksConfig(both)).toThrow(/heightM en longestM/);
  });
});

describe('buildPacks', () => {
  it('splitst, corrigeert de FBX-draaiing, schaalt naar de echte maat en zet de voet op y=0 en het midden op x en z', async () => {
    const { packsDir, parsed } = await setup();
    const result = await buildPacks(parsed, { packsDir });
    expect(result.reports.flatMap((r) => r.errors)).toEqual([]);
    expect(result.entries.map((e) => e.id).sort()).toEqual(['crate_01', 'tree_leafy_01']);
    const crate = result.entries.find((e) => e.id === 'crate_01')!;
    expect(crate.kind).toBe('prop');
    expect(crate.category).toBe('crate');
    expect(crate.alpha).toBeUndefined();
    const [min, max] = [crate.bounds.min, crate.bounds.max];
    // Een kubus van 144 cm, op 0,9 m gebracht: 0,9 m hoog, Y omhoog (de draaiing van de FBX valt weg), gecentreerd.
    expect(max[1] - min[1]).toBeCloseTo(0.9, 2);
    expect(min[1]).toBeCloseTo(0, 3);
    expect((min[0] + max[0]) / 2).toBeCloseTo(0, 2);
    expect((min[2] + max[2]) / 2).toBeCloseTo(0, 2);
    expect(max[0] - min[0]).toBeCloseTo(0.9, 2);
    const details = result.reports.find((r) => r.id === 'crate_01')!.details!;
    expect(details.sourceHeightM).toBeCloseTo(1.44, 2);
    expect(details.heightM).toBeCloseTo(0.9, 2);
  });

  it('behoudt alfa: MASK met alphaCutoff, WebP met alfakanaal, manifest alpha: mask', async () => {
    const { packsDir, parsed } = await setup();
    const result = await buildPacks(parsed, { packsDir });
    const tree = result.entries.find((e) => e.id === 'tree_leafy_01')!;
    expect(tree.alpha).toBe('mask');
    expect(tree.category).toBe('tree-leafy');
    expect(manifestSchema.parse({ version: 1, assets: result.entries }).assets).toHaveLength(2);
    for (const lod of tree.lods) {
      const doc = await readLod(result.outputs.get(lod.path) as Uint8Array);
      const material = doc.getRoot().listMaterials()[0]!;
      expect(doc.getRoot().listMaterials()).toHaveLength(1);
      expect(material.getAlphaMode()).toBe('MASK');
      expect(material.getAlphaCutoff()).toBeGreaterThan(0);
      expect(material.getDoubleSided()).toBe(true);
      const texture = doc.getRoot().listTextures()[0]!;
      expect(texture.getMimeType()).toBe('image/webp');
      const meta = await sharp(Buffer.from(texture.getImage()!)).metadata();
      expect(meta.hasAlpha).toBe(true);
      const raw = await sharp(Buffer.from(texture.getImage()!)).ensureAlpha().raw().toBuffer();
      let clear = 0;
      for (let i = 3; i < raw.length; i += 4) if (raw[i]! < 128) clear++;
      expect(clear).toBeGreaterThan(0);
      expect(meta.width).toBeLessThanOrEqual(512);
    }
    // De LOD's krimpen de atlas: 512, 256, 128.
    const sizes = await Promise.all(
      tree.lods.map(
        async (lod) =>
          (await readLod(result.outputs.get(lod.path) as Uint8Array))
            .getRoot()
            .listTextures()[0]!
            .getSize()![0],
      ),
    );
    expect(sizes).toEqual([512, 256, 128]);
    // Een ondoorzichtig prop krijgt JPEG en geen alfa.
    const crateDoc = await readLod(result.outputs.get('crate_01/lod0.glb') as Uint8Array);
    expect(crateDoc.getRoot().listTextures()[0]!.getMimeType()).toBe('image/jpeg');
    expect(crateDoc.getRoot().listMaterials()[0]!.getAlphaMode()).toBe('OPAQUE');
  });

  it('zet de hoogte van de bounds in het manifest gelijk aan het GLB, per LOD de voet op y=0', async () => {
    const { packsDir, parsed } = await setup();
    const result = await buildPacks(parsed, { packsDir });
    for (const entry of result.entries)
      for (const lod of entry.lods) {
        const doc = await readLod(result.outputs.get(lod.path) as Uint8Array);
        const { min, max } = getBounds(doc.getRoot().listScenes()[0]!);
        expect(min[1]).toBeCloseTo(0, 2);
        expect(max[1] - min[1]).toBeCloseTo(entry.bounds.max[1] - entry.bounds.min[1], 1);
      }
  });

  it('faalt leesbaar bij een hoogte buiten het bereik, een niet-gekoppeld object en verkeerde bladsoort', async () => {
    const cfg = config() as {
      categories: Record<string, unknown>;
      sources: { pack: { props: Record<string, Record<string, unknown>>; skip?: object } };
    };
    cfg.categories['crate'] = { ...CATEGORY, heightRangeM: [2, 3] };
    const { packsDir, parsed } = await setup(cfg);
    let result = await buildPacks(parsed, { packsDir });
    expect(result.reports.find((r) => r.id === 'crate_01')!.errors.join('\n')).toMatch(
      /hoogte 0.90 m valt buiten 2 tot 3 m voor crate/,
    );

    const stray = config() as { sources: { pack: { props: Record<string, unknown> } } };
    delete stray.sources.pack.props['crate_01'];
    result = await buildPacks(parsePacksConfig(stray), { packsDir });
    expect(result.reports.flatMap((r) => r.errors).join('\n')).toMatch(
      /objecten zonder prop of skip in packs.json: cube/,
    );

    const wrong = config() as {
      sources: { pack: { props: Record<string, Record<string, unknown>> } };
    };
    wrong.sources.pack.props['tree_leafy_01']!['category'] = 'tree-bare';
    result = await buildPacks(parsePacksConfig(wrong), { packsDir });
    expect(result.reports.find((r) => r.id === 'tree_leafy_01')!.errors.join('\n')).toMatch(
      /tree-bare, maar de kaarten zijn .* blad/,
    );
  });

  it('classificeert blad en twijgwerk op tint en verzadiging', () => {
    expect(classifyFoliage(110, 0.6)).toBe('leafy');
    expect(classifyFoliage(56, 0.59)).toBe('leafy');
    expect(classifyFoliage(35, 0.2)).toBe('bare');
  });

  it('is deterministisch: twee runs geven gelijke bytes', async () => {
    const { packsDir, parsed } = await setup();
    const a = await buildPacks(parsed, { packsDir });
    const b = await buildPacks(parsed, { packsDir });
    expect([...a.outputs.keys()]).toEqual([...b.outputs.keys()]);
    for (const [path, bytes] of a.outputs)
      expect(Buffer.from(b.outputs.get(path)!).equals(Buffer.from(bytes))).toBe(true);
  });

  it('behoudt de bestaande uitvoer als de pack-bron ontbreekt (de bronnen staan niet in git)', async () => {
    const { packsDir, parsed } = await setup();
    const built = await buildPacks(parsed, { packsDir });
    const dist = join(root, 'dist');
    for (const [path, bytes] of built.outputs) {
      mkdirSync(join(dist, path, '..'), { recursive: true });
      writeFileSync(join(dist, path), bytes);
    }
    writeFileSync(
      join(dist, 'manifest.json'),
      JSON.stringify({ version: 1, assets: built.entries }),
    );
    const kept = await buildPacks(parsed, {
      packsDir: join(root, 'bestaat-niet'),
      previousDist: dist,
    });
    expect(kept.reports.flatMap((r) => r.errors)).toEqual([]);
    expect(kept.entries.map((e) => e.id).sort()).toEqual(['crate_01', 'tree_leafy_01']);
    expect(kept.reports[0]!.warnings.join('')).toMatch(/behouden/);
    for (const [path, bytes] of built.outputs)
      expect(Buffer.from(kept.outputs.get(path)!).equals(Buffer.from(bytes))).toBe(true);
    // Zonder eerdere uitvoer is het een fout met uitleg.
    const none = await buildPacks(parsed, { packsDir: null });
    expect(none.reports[0]!.errors.join('')).toMatch(/ontbreekt/);
  });
});

describe('buildAssets met packs.json', () => {
  it('neemt de pack-props op in manifest en validation-report en laat assets/src/packs met rust', async () => {
    const src = join(root, 'src');
    mkdirSync(join(src, 'packs'), { recursive: true });
    writeFileSync(join(src, 'packs', 'pack.glb'), await makePack());
    writeFileSync(join(src, 'packs.json'), JSON.stringify(config()));
    const dist = join(root, 'dist');
    const result = await buildAssets({ srcDir: src, distDir: dist, toktx: null });
    expect(result.reports.flatMap((r) => r.errors)).toEqual([]);
    expect(result.manifest!.assets.map((a) => a.id)).toEqual(['crate_01', 'tree_leafy_01']);
    const written = manifestSchema.parse(
      JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8')),
    );
    expect(written.assets.every((a) => a.kind === 'prop' && a.teamMask === 'none')).toBe(true);
    const report = JSON.parse(readFileSync(join(dist, 'validation-report.json'), 'utf8'));
    expect(report.assets.find((a: { id: string }) => a.id === 'tree_leafy_01').alpha.foliage).toBe(
      'leafy',
    );
  });
});
