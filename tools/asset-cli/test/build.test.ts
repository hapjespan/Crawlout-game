import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildAssets } from '../src/build.js';
import { BUDGETS } from '../src/budgets.js';
import { manifestSchema } from '../src/manifest.js';
import { validateAsset } from '../src/validate.js';
import { createIO } from '../src/lods.js';
import { makeHumanoid, makeProp } from './fixtures.js';

let root: string;
let src: string;
let dist: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'asset-cli-test-'));
  src = join(root, 'src');
  dist = join(root, 'dist');
  mkdirSync(src);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

async function violations(bytes: Uint8Array): Promise<string[]> {
  return validateAsset(await new NodeIO().readBinary(bytes)).errors;
}

describe('validatie', () => {
  it('laat een geldige humanoid door', async () => {
    expect(await violations(await makeHumanoid({ withSockets: true }))).toEqual([]);
  });
  it('weigert te veel driehoeken', async () => {
    const errors = await violations(await makeHumanoid({ segments: 160, rings: 80 }));
    expect(errors.join('\n')).toMatch(/25600 driehoeken in LOD0, maximaal 24000/);
  });
  it('weigert meer dan 28 bones', async () => {
    expect((await violations(await makeHumanoid({ extraBones: 10 }))).join('\n')).toMatch(
      /30 bones, maximaal 28/,
    );
  });
  it('weigert niet-Mixamo botnamen', async () => {
    const errors = await violations(await makeHumanoid({ boneNamePrefix: 'Bone_' }));
    expect(errors.join('\n')).toMatch(/Mixamo/);
  });
  it('weigert een textuur boven 2048', async () => {
    expect((await violations(await makeHumanoid({ hugeTexture: 4096 }))).join('\n')).toMatch(
      /4096x4096, maximaal 2048/,
    );
  });
  it('weigert een tweede UV-set', async () => {
    expect((await violations(await makeHumanoid({ secondUv: true }))).join('\n')).toMatch(
      /2 UV-sets/,
    );
  });
  it('weigert verkeerde schaal en voeten niet op y=0', async () => {
    const errors = (await violations(await makeHumanoid({ height: 180, footY: 1 }))).join('\n');
    expect(errors).toMatch(/hoogte is/);
    const feet = (await violations(await makeHumanoid({ footY: 0.5 }))).join('\n');
    expect(feet).toMatch(/voeten staan op y=0.50/);
  });

  // Het krachtpantser is 2,25 m; de config zegt dat, dus daar wordt op getoetst in plaats van op de 1,8 m van de brief.
  it('toetst een karakter op de hoogte uit de config in plaats van 1,8 m', async () => {
    const tall = await new NodeIO().readBinary(await makeHumanoid({ height: 2.25 }));
    expect(validateAsset(tall).errors.join('\n')).toMatch(
      /hoogte is 2.25 m, verwacht ongeveer 1.8/,
    );
    expect(validateAsset(tall, { height: 2.25 }).errors).toEqual([]);
    expect(validateAsset(tall, { height: 1.8 }).errors.join('\n')).toMatch(/hoogte is 2.25 m/);
  });
});

describe('buis', () => {
  it('geeft groen met "geen assets" op een lege src en schrijft een lege manifest', async () => {
    const result = await buildAssets({ srcDir: src, distDir: dist, toktx: null });
    expect(result.ok).toBe(true);
    expect(result.reports).toEqual([]);
    expect(
      manifestSchema.parse(JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'))).assets,
    ).toEqual([]);
  });

  it('weigert een manifest met een dubbele asset-id', async () => {
    writeFileSync(join(src, 'rock.glb'), await makeProp({ segments: 30, rings: 20 }));
    await buildAssets({ srcDir: src, distDir: dist, toktx: null });
    const manifest = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'));
    manifest.assets.push(manifest.assets[0]);
    expect(() => manifestSchema.parse(manifest)).toThrow(/twee keer/);
  });

  it('bouwt LODs, meshopt en manifest voor humanoid en prop', async () => {
    // 19.200 driehoeken: zwaar genoeg dat LOD1 en LOD2 echt reduceren onder de band van 2026-10-23.
    writeFileSync(
      join(src, 'Hero Dummy.glb'),
      await makeHumanoid({ withSockets: true, segments: 120, rings: 80 }),
    );
    writeFileSync(join(src, 'rock.glb'), await makeProp({ segments: 30, rings: 20 }));
    const result = await buildAssets({ srcDir: src, distDir: dist, toktx: null });
    expect(result.reports.flatMap((r) => r.errors)).toEqual([]);
    expect(result.ok).toBe(true);

    const manifest = manifestSchema.parse(
      JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8')),
    );
    expect(manifest.assets.map((a) => a.id)).toEqual(['hero_dummy', 'rock']);
    const hero = manifest.assets[0]!;
    expect(hero.kind).toBe('character');
    expect(
      hero.lods.map((l) => l.triangles).every((t, i) => t <= BUDGETS.characterMaxTris[i]!),
    ).toBe(true);
    expect(hero.lods[1].triangles).toBeLessThan(hero.lods[0].triangles);
    expect(hero.lods[2].triangles).toBeLessThan(hero.lods[1].triangles);
    expect(hero.sockets.hand).toBeDefined();
    expect(hero.sockets.head).toBeDefined();
    expect(hero.sockets.back).toBeDefined();
    expect(hero.animations.map((a) => a.name)).toContain('idle');
    expect(hero.animations[0]?.durationSeconds).toBe(2);
    expect(hero.bounds.min[1]).toBeCloseTo(0, 1);
    expect(hero.bounds.max[1]).toBeCloseTo(1.8, 1);
    expect(hero.boneCount).toBeLessThanOrEqual(28);

    const rock = manifest.assets[1]!;
    expect(rock.kind).toBe('prop');
    expect(rock.sockets).toEqual({});

    for (const lod of hero.lods) {
      const bytes = new Uint8Array(readFileSync(join(dist, lod.path)));
      expect(existsSync(join(dist, lod.path))).toBe(true);
      const doc = await new NodeIO()
        .registerExtensions(ALL_EXTENSIONS)
        .registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
        .readBinary(bytes);
      expect(
        doc
          .getRoot()
          .listExtensionsUsed()
          .map((e) => e.extensionName),
      ).toContain('EXT_meshopt_compression');
    }
    // Leesbaar door onze eigen IO (zoals render het laadt).
    await createIO().readBinary(new Uint8Array(readFileSync(join(dist, 'hero_dummy/lod2.glb'))));
  });

  it('zet de modus van het teammasker in het manifest: materialName als default, diffuseAlpha met een masker', async () => {
    writeFileSync(join(src, 'plain.glb'), await makeHumanoid());
    writeFileSync(join(src, 'masked.glb'), await makeHumanoid());
    writeFileSync(
      join(src, 'rigmap.json'),
      JSON.stringify({ assets: { masked: { teamMask: { hue: [0, 360] } } } }),
    );
    const result = await buildAssets({ srcDir: src, distDir: dist, toktx: null });
    expect(result.reports.flatMap((r) => r.errors)).toEqual([]);
    const manifest = manifestSchema.parse(
      JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8')),
    );
    expect(manifest.assets.map((a) => [a.id, a.teamMask])).toEqual([
      ['masked', 'diffuseAlpha'],
      ['plain', 'materialName'],
    ]);
    // Het masker zit per texel in de alfa van de diffuse van elke LOD (alle texels vallen binnen hue 0 tot 360).
    for (const lod of manifest.assets[0]!.lods) {
      const doc = await new NodeIO()
        .registerExtensions(ALL_EXTENSIONS)
        .registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
        .readBinary(new Uint8Array(readFileSync(join(dist, lod.path))));
      const image = doc.getRoot().listTextures()[0]!.getImage()!;
      // ensureAlpha: hier valt elke texel binnen het bereik, dus het masker is overal 1 en de LOD-stap mag de
      // volledig dekkende alfa laten vallen (WebP doet dat) — hij leest terug als 255, precies wat hij was. Een
      // masker met echte doorzichtige texels blijft PNG, want WebP wist de rgb eronder (textures.part2.ts).
      const { data, info } = await sharp(Buffer.from(image))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      expect(info.channels).toBe(4);
      expect(data[3]).toBe(255);
    }
  });

  it('faalt met leesbare reden, exit-status ok=false en schrijft niets', async () => {
    writeFileSync(join(src, 'good.glb'), await makeHumanoid());
    writeFileSync(
      join(src, 'zwaar.glb'),
      await makeHumanoid({ segments: 160, rings: 80, extraBones: 10 }),
    );
    const result = await buildAssets({ srcDir: src, distDir: dist, toktx: null });
    expect(result.ok).toBe(false);
    const bad = result.reports.find((r) => r.id === 'zwaar')!;
    expect(bad.errors.length).toBeGreaterThanOrEqual(2);
    expect(result.reports.find((r) => r.id === 'good')!.errors).toEqual([]);
    expect(existsSync(join(dist, 'manifest.json'))).toBe(false);
  });

  it('exporteert geen KTX2 zonder expliciete vraag, ook niet met een encoder op PATH', async () => {
    writeFileSync(join(src, 'plain.glb'), await makeHumanoid());
    const result = await buildAssets({ srcDir: src, distDir: dist, toktx: null });
    expect(result.ok).toBe(true);
    const manifest = manifestSchema.parse(
      JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8')),
    );
    const doc = await new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
      .readBinary(new Uint8Array(readFileSync(join(dist, manifest.assets[0]!.lods[0]!.path))));
    // De render-buis rastert elke textuur naar een RGBA8-array en leest geen CompressedTexture (ktx2.ts).
    for (const texture of doc.getRoot().listTextures())
      expect(texture.getMimeType()).not.toBe('image/ktx2');
  });
});
