// Split from terrain.test.ts to stay under the 5,000-token file limit.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  type TerrainMesh,
  texturedOnly,
  rasterizeTopSurface,
  bakeAlbedo,
  fillHolesPullPush,
  buildTerrain,
} from '../src/terrain.js';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Document, NodeIO } from '@gltf-transform/core';
import { makePng } from './fixtures.js';
import { heightfieldSchema, terrainManifestSchema } from '../src/heightfield.js';

describe('texturedOnly en bakeAlbedo', () => {
  function twoMaterials(): TerrainMesh {
    // Linkerhelft (x < 4) met een 2 x 2 textuur, rechterhelft effen; uv loopt 0..1 over de linkerhelft.
    const positions = [0, 0, 0, 4, 0, 0, 4, 0, 4, 0, 0, 4, 8, 0, 0, 8, 0, 4];
    const uvs = [0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 0, 0];
    const indices = [0, 1, 2, 0, 2, 3, 1, 4, 5, 1, 5, 2];
    const texture = Uint8Array.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]); // rood, groen / blauw, wit
    return {
      positions: Float32Array.from(positions),
      uvs: Float32Array.from(uvs),
      indices: Uint32Array.from(indices),
      triMaterial: Uint16Array.from([0, 0, 1, 1]),
      materials: [
        { factor: [1, 1, 1], texture: { width: 2, height: 2, data: texture } },
        { factor: [1, 1, 1] },
      ],
    };
  }

  it('houdt alleen getextureerde driehoeken over', () => {
    const only = texturedOnly(twoMaterials());
    expect(only.indices.length / 3).toBe(2);
    expect(Array.from(only.triMaterial ?? [])).toEqual([0, 0]);
  });

  it('bakt de kleur van het bovenste oppervlak op de juiste pixels', () => {
    const mesh = texturedOnly(twoMaterials());
    const surface = rasterizeTopSurface(mesh, { minX: 0, minZ: 0, sizeM: 4, resolution: 4 });
    const { rgb, coveredFraction } = bakeAlbedo(mesh, surface);
    expect(coveredFraction).toBe(1);
    const pixel = (x: number, z: number): number[] =>
      Array.from(rgb.subarray((z * 4 + x) * 3, (z * 4 + x) * 3 + 3));
    // v loopt met z (uv-origine linksboven): z klein is de bovenste textuurrij (rood, groen).
    expect(pixel(0, 0)).toEqual([255, 0, 0]);
    expect(pixel(3, 0)).toEqual([0, 255, 0]);
    expect(pixel(0, 3)).toEqual([0, 0, 255]);
    expect(pixel(3, 3)).toEqual([255, 255, 255]);
  });

  it('vult gaten met pull-push: zacht tussen de randen, gedekte pixels blijven gelijk', () => {
    const n = 16;
    const linear = new Float32Array(n * n * 3);
    const known = new Uint8Array(n * n);
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const i = y * n + x;
        const hole = x >= 4 && x < 12 && y >= 4 && y < 12;
        if (hole) continue;
        known[i] = 1;
        linear.fill(x < 8 ? 0.2 : 0.6, i * 3, i * 3 + 3);
      }
    const before = linear.slice();
    fillHolesPullPush(linear, known, n);
    for (let i = 0; i < n * n; i++) if (known[i]) expect(linear[i * 3]).toBe(before[i * 3]);
    // In het gat loopt de waarde van links (0,2) naar rechts (0,6), zonder sprongen per pixel.
    const row = Array.from({ length: 8 }, (_, k) => linear[(8 * n + 4 + k) * 3] as number);
    for (const v of row) expect(v).toBeGreaterThanOrEqual(0.19);
    for (const v of row) expect(v).toBeLessThanOrEqual(0.61);
    expect(row[7]! - row[0]!).toBeGreaterThan(0.1);
    for (let k = 1; k < 8; k++) expect(Math.abs(row[k]! - row[k - 1]!)).toBeLessThan(0.15);
  });

  it('vult een gat in de albedo op met de gekleurde buren', () => {
    const mesh = texturedOnly(twoMaterials());
    const surface = rasterizeTopSurface(mesh, { minX: 0, minZ: 0, sizeM: 8, resolution: 8 }); // rechterhelft is leeg
    const { rgb, coveredFraction } = bakeAlbedo(mesh, surface);
    expect(coveredFraction).toBeCloseTo(0.25, 5);
    const lastPixel = Array.from(rgb.subarray(7 * 3, 7 * 3 + 3));
    expect(lastPixel.some((value) => value > 0)).toBe(true);
  });
});

describe('buildTerrain (synthetische GLB)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'terrain-test-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  /** Z-up helling (z = 0,5 x) onder een root met -90 graden X, zoals een Sketchfab-export; plus een Base-vlak. */
  async function writeSlopeGlb(path: string): Promise<void> {
    const doc = new Document();
    const buffer = doc.createBuffer();
    const texture = doc.createTexture('diffuse').setImage(makePng(4, 4)).setMimeType('image/png');
    const rock = doc.createMaterial('Rock').setBaseColorTexture(texture);
    const base = doc.createMaterial('Base').setBaseColorFactor([0.02, 0.02, 0.02, 1]);
    const n = 20;
    const positions: number[] = [];
    const uvs: number[] = [];
    // Mesh-ruimte (Z omhoog): (x, y, z = 0,5 x), y loopt 0 tot 20.
    for (let b = 0; b <= n; b++)
      for (let a = 0; a <= n; a++) {
        positions.push(a, b, 0.5 * a);
        uvs.push(a / n, b / n);
      }
    const indices: number[] = [];
    for (let b = 0; b < n; b++)
      for (let a = 0; a < n; a++) {
        const i = b * (n + 1) + a;
        indices.push(i, i + 1, i + n + 1, i + 1, i + n + 2, i + n + 1);
      }
    const accessor = (array: Float32Array | Uint32Array, type: 'VEC3' | 'VEC2' | 'SCALAR') =>
      doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
    const surface = doc
      .createPrimitive()
      .setAttribute('POSITION', accessor(Float32Array.from(positions), 'VEC3'))
      .setAttribute('TEXCOORD_0', accessor(Float32Array.from(uvs), 'VEC2'))
      .setIndices(accessor(Uint32Array.from(indices), 'SCALAR'))
      .setMaterial(rock);
    // Een Base-vlak ver boven de helling (y = 50 in Y-up); moet genegeerd worden.
    const foot = doc
      .createPrimitive()
      .setAttribute(
        'POSITION',
        accessor(Float32Array.from([0, 0, 50, 20, 0, 50, 0, 20, 50]), 'VEC3'),
      )
      .setIndices(accessor(Uint32Array.from([0, 1, 2]), 'SCALAR'))
      .setMaterial(base);
    const mesh = doc.createMesh('terrain').addPrimitive(surface).addPrimitive(foot);
    const child = doc.createNode('Object').setMesh(mesh);
    const root = doc
      .createNode('Sketchfab_model')
      .setRotation([-Math.SQRT1_2, 0, 0, Math.SQRT1_2])
      .addChild(child);
    doc.createScene().addChild(root);
    await new NodeIO().write(path, doc);
  }

  it('past node-transformaties en Z-up naar Y-up toe, negeert Base en is reproduceerbaar', async () => {
    const source = join(dir, 'slope.glb');
    await writeSlopeGlb(source);
    const options = {
      source,
      id: 'slope',
      attribution: 'test',
      cropSizeM: 16,
      rotationsDeg: [0],
      cells: 16,
      sub: 2,
    };
    const first = await buildTerrain({ ...options, outDir: join(dir, 'a') });
    const second = await buildTerrain({ ...options, outDir: join(dir, 'b') });

    expect(first.manifest.crop.scale).toBe(1);
    expect(first.manifest.groundTint).toBe('#272727'); // 0,02 lineair
    const field = heightfieldSchema.parse(
      JSON.parse(readFileSync(join(dir, 'a', 'slope.height.json'), 'utf8')),
    );
    // Mesh-y wordt wereld -z (kolom = x, rij = z). De uitsnede ligt over z van -20 tot 0: de helling hangt aan x, dus
    // elke rij heeft dezelfde hoogtes 0,5 * i en niets uit het Base-vlak (50 m) komt erin.
    expect(field.maxM).toBeCloseTo(7.5, 1);
    for (let j = 0; j < 16; j++)
      for (let i = 0; i < 16; i++) expect(field.heights[j * 16 + i]).toBeCloseTo(0.5 * i, 1);

    for (const name of ['slope.height.json', 'slope.albedo.jpg', 'terrain.json']) {
      expect(readFileSync(join(dir, 'a', name)).equals(readFileSync(join(dir, 'b', name)))).toBe(
        true,
      );
    }
    const manifest = terrainManifestSchema.parse(
      JSON.parse(readFileSync(join(dir, 'a', 'terrain.json'), 'utf8')),
    );
    expect(manifest.heightfield.path).toBe('slope.height.json');
    expect(second.files.map((f) => f.path)).toEqual([
      'slope.height.json',
      'slope.albedo.jpg',
      'terrain.json',
    ]);
  });

  it('bakt het albedo op een eigen maat (albedoSize) zonder het hoogteveld te veranderen', async () => {
    const source = join(dir, 'slope.glb');
    await writeSlopeGlb(source);
    const options = {
      source,
      id: 'slope',
      attribution: 'test',
      cropSizeM: 16,
      rotationsDeg: [0],
      cells: 16,
      sub: 2,
    };
    const plain = await buildTerrain({ ...options, outDir: join(dir, 'a') });
    const big = await buildTerrain({ ...options, outDir: join(dir, 'b'), albedoSize: 64 });
    expect(plain.manifest.albedo.width).toBe(32);
    expect(big.manifest.albedo).toMatchObject({ width: 64, height: 64 });
    expect(
      readFileSync(join(dir, 'a', 'slope.height.json')).equals(
        readFileSync(join(dir, 'b', 'slope.height.json')),
      ),
    ).toBe(true);
    expect(big.manifest.rockTint).toBe(plain.manifest.rockTint);
    await expect(
      buildTerrain({ ...options, outDir: join(dir, 'c'), albedoSize: 3.5 }),
    ).rejects.toThrow(/albedoSize/);
  });
});
