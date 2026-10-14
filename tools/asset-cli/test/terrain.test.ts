// Tests voor de terrein-buis met synthetische terreinen (helling, piramide, zwevend schijfje); de echte bron
// (assets/local/rock_terrain_4.glb) wordt nooit gebruikt.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  HEIGHTFIELD_FORMAT,
  TERRAIN_MANIFEST_FORMAT,
  heightAt,
  heightfieldSchema,
  terrainManifestSchema,
  type Heightfield,
} from '../src/heightfield.js';
import {
  bakeAlbedo,
  buildTerrain,
  chooseCrop,
  formatHeightfield,
  heightfieldFromSurface,
  rasterizeTopSurface,
  removeFloaters,
  rotateMeshY,
  texturedOnly,
  type TerrainMesh,
} from '../src/terrain.js';
import { makePng } from './fixtures.js';

/** Regelmatig raster x in [x0, x0 + size], z in [z0, z0 + size] met y = f(x, z); twee driehoeken per vierkantje. */
function gridMesh(f: (x: number, z: number) => number, size: number, step = 0.5, x0 = 0, z0 = 0): TerrainMesh {
  const n = Math.round(size / step);
  const positions: number[] = [];
  for (let b = 0; b <= n; b++) for (let a = 0; a <= n; a++) positions.push(x0 + a * step, f(x0 + a * step, z0 + b * step), z0 + b * step);
  const indices: number[] = [];
  for (let b = 0; b < n; b++) {
    for (let a = 0; a < n; a++) {
      const i = b * (n + 1) + a;
      indices.push(i, i + 1, i + n + 1, i + 1, i + n + 2, i + n + 1);
    }
  }
  return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices) };
}

/** Piramide met vierkante basis [0, 16]^2 en top (8, 10, 8): vier driehoeken. */
function pyramid(): TerrainMesh {
  const positions = Float32Array.from([0, 0, 0, 16, 0, 0, 16, 0, 16, 0, 0, 16, 8, 10, 8]);
  const indices = Uint32Array.from([0, 1, 4, 1, 2, 4, 2, 3, 4, 3, 0, 4]);
  return { positions, indices };
}
const pyramidHeight = (x: number, z: number): number => Math.max(0, 10 * (1 - Math.max(Math.abs(x - 8), Math.abs(z - 8)) / 8));

describe('heightfieldSchema', () => {
  const valid: Heightfield = { format: HEIGHTFIELD_FORMAT, w: 2, h: 2, metersPerCell: 1, minM: 0, maxM: 3.5, heights: [0, 1.25, 3.5, 2] };

  it('accepteert een geldig veld', () => {
    expect(heightfieldSchema.parse(valid)).toEqual(valid);
  });
  it('weigert een verkeerd formaat', () => {
    expect(() => heightfieldSchema.parse({ ...valid, format: 'crawlout-heightfield/2' })).toThrow();
  });
  it('weigert een verkeerd aantal waarden', () => {
    expect(() => heightfieldSchema.parse({ ...valid, heights: [0, 1, 2] })).toThrow(/verwacht w\*h = 4/);
  });
  it('weigert minM en maxM die niet bij de heights passen', () => {
    expect(() => heightfieldSchema.parse({ ...valid, maxM: 9 })).toThrow(/komen niet overeen/);
    expect(() => heightfieldSchema.parse({ ...valid, minM: -1 })).toThrow(/komen niet overeen/);
  });
  it('weigert een niet-positieve celgrootte of niet-getallen', () => {
    expect(() => heightfieldSchema.parse({ ...valid, metersPerCell: 0 })).toThrow();
    expect(() => heightfieldSchema.parse({ ...valid, heights: [0, 1, 'x', 2] })).toThrow();
  });
  it('heightAt interpoleert tussen celmiddens en klemt aan de rand', () => {
    const field = heightfieldSchema.parse(valid);
    expect(heightAt(field, 0.5, 0.5)).toBe(0);
    expect(heightAt(field, 1.5, 0.5)).toBe(1.25);
    expect(heightAt(field, 1, 0.5)).toBeCloseTo(0.625, 10);
    expect(heightAt(field, 1, 1)).toBeCloseTo((0 + 1.25 + 3.5 + 2) / 4, 10);
    expect(heightAt(field, -5, 99)).toBe(3.5);
  });
});

describe('terrainManifestSchema', () => {
  const manifest = {
    format: TERRAIN_MANIFEST_FORMAT,
    id: 'rock_terrain_4',
    attribution: 'Rock Terrain 4 by Lassi Kaukonen, CC-BY-4.0',
    heightfield: { path: 'rock_terrain_4.height.json', w: 128, h: 128, metersPerCell: 1, minM: 0, maxM: 26.25 },
    albedo: { path: 'rock_terrain_4.albedo.jpg', width: 1024, height: 1024, mime: 'image/jpeg' },
    rockTint: '#464340',
    groundTint: '#2b2b2b',
    crop: { rotationDeg: 20, minX: -10, minZ: -43, sizeM: 64, scale: 2, heightOffsetM: 2.0089 },
  };
  it('accepteert een geldig manifest en weigert een ongeldige kleur', () => {
    expect(terrainManifestSchema.parse(manifest).heightfield.w).toBe(128);
    expect(() => terrainManifestSchema.parse({ ...manifest, rockTint: 'red' })).toThrow();
    expect(() => terrainManifestSchema.parse({ ...manifest, attribution: '' })).toThrow();
  });
});

describe('rasterizeTopSurface en heightfieldFromSurface', () => {
  it('geeft op een helling de juiste hoogtes (y = 0,5 x)', () => {
    const mesh = gridMesh((x) => 0.5 * x, 16, 1);
    const surface = rasterizeTopSurface(mesh, { minX: 0, minZ: 0, sizeM: 16, resolution: 64 });
    expect(surface.height.every((value) => !Number.isNaN(value))).toBe(true);
    const { field, scale, heightOffsetM } = heightfieldFromSurface(surface, { cells: 16, metersPerCell: 1 });
    expect(scale).toBe(1);
    expect(heightOffsetM).toBeCloseTo(0.25, 5); // het gemiddelde van cel 0 (x 0 tot 1)
    for (let j = 0; j < 16; j++) for (let i = 0; i < 16; i++) expect(field.heights[j * 16 + i]).toBeCloseTo(0.5 * i, 2);
    expect(field.minM).toBe(0);
    expect(field.maxM).toBe(7.5);
    heightfieldSchema.parse(field);
  });

  it('geeft bij een piramide de analytische celgemiddelden', () => {
    const surface = rasterizeTopSurface(pyramid(), { minX: 0, minZ: 0, sizeM: 16, resolution: 64 });
    const { field } = heightfieldFromSurface(surface, { cells: 16, metersPerCell: 1 });
    // Verwacht: het gemiddelde van de piramidehoogte over de 4 x 4 monsterpunten van elke cel, minus het laagste celgemiddelde.
    const expected: number[] = [];
    for (let j = 0; j < 16; j++) {
      for (let i = 0; i < 16; i++) {
        let sum = 0;
        for (let b = 0; b < 4; b++) for (let a = 0; a < 4; a++) sum += pyramidHeight(i + (a + 0.5) / 4, j + (b + 0.5) / 4);
        expected.push(sum / 16);
      }
    }
    const low = Math.min(...expected);
    expected.forEach((value, index) => expect(field.heights[index]).toBeCloseTo(value - low, 1));
    const top = field.heights[7 * 16 + 7] as number;
    expect(top).toBe(field.maxM);
    expect(top).toBeGreaterThan(8.5);
    expect(field.heights[0]).toBe(field.minM);
    // Symmetrie: de piramide is puntsymmetrisch rond (8, 8).
    expect(field.heights[3 * 16 + 5]).toBeCloseTo(field.heights[12 * 16 + 10] as number, 5);
  });

  it('neemt bij gestapelde vlakken (overhang) het hoogste', () => {
    const low = gridMesh(() => 1, 8, 2);
    const high = gridMesh(() => 5, 4, 2, 2, 2);
    const mesh: TerrainMesh = {
      positions: Float32Array.from([...low.positions, ...high.positions]),
      indices: Uint32Array.from([...low.indices, ...Array.from(high.indices, (i) => i + low.positions.length / 3)]),
    };
    const surface = rasterizeTopSurface(mesh, { minX: 0, minZ: 0, sizeM: 8, resolution: 8 });
    expect(surface.height[0]).toBeCloseTo(1, 5);
    expect(surface.height[3 * 8 + 3]).toBeCloseTo(5, 5);
    expect(surface.height[3 * 8 + 6]).toBeCloseTo(1, 5);
  });

  it('schaalt horizontaal en verticaal uniform naar de veldgrootte', () => {
    const mesh = gridMesh((x) => 0.5 * x, 8, 1);
    const surface = rasterizeTopSurface(mesh, { minX: 0, minZ: 0, sizeM: 8, resolution: 32 });
    const { field, scale } = heightfieldFromSurface(surface, { cells: 16, metersPerCell: 1 });
    expect(scale).toBe(2);
    expect(field.heights[5]).toBeCloseTo(5 * 0.5 * 2 * 0.5 + 0, 1); // cel 5 is 2,5 m naar rechts in de bron: (5 / 2) * 0,5 * 2 = 2,5
    expect(field.maxM).toBeCloseTo(7.5, 1);
  });

  it('vult cellen zonder dekking op uit de buren', () => {
    const mesh = gridMesh(() => 2, 8, 1);
    // Een gat: laat de driehoeken weg die boven cel (3, 3) en (4, 3) liggen.
    const keep: number[] = [];
    const centre = (t: number): [number, number] => {
      const ids = [0, 1, 2].map((k) => (mesh.indices[t * 3 + k] as number) * 3);
      return [ids.reduce((s, i) => s + (mesh.positions[i] as number), 0) / 3, ids.reduce((s, i) => s + (mesh.positions[i + 2] as number), 0) / 3];
    };
    for (let t = 0; t < mesh.indices.length / 3; t++) {
      const [cx, cz] = centre(t);
      if (!(cx > 2.9 && cx < 5.1 && cz > 2.9 && cz < 4.1)) keep.push(t);
    }
    const holed: TerrainMesh = { positions: mesh.positions, indices: Uint32Array.from(keep.flatMap((t) => [0, 1, 2].map((k) => mesh.indices[t * 3 + k] as number))) };
    const surface = rasterizeTopSurface(holed, { minX: 0, minZ: 0, sizeM: 8, resolution: 8 });
    expect(Number.isNaN(surface.height[3 * 8 + 3])).toBe(true);
    const { field, filledCells } = heightfieldFromSurface(surface, { cells: 8, metersPerCell: 1 });
    expect(filledCells).toBeGreaterThan(0);
    expect(field.heights.every((value) => value === 0)).toBe(true);
  });

  it('weigert een resolutie die geen veelvoud van het aantal cellen is', () => {
    const surface = rasterizeTopSurface(gridMesh(() => 0, 4, 1), { minX: 0, minZ: 0, sizeM: 4, resolution: 6 });
    expect(() => heightfieldFromSurface(surface, { cells: 4, metersPerCell: 1 })).toThrow(/geen veelvoud/);
  });
});

describe('formatHeightfield', () => {
  it('schrijft geldige JSON met één rij per regel die het schema doorstaat', () => {
    const field: Heightfield = { format: HEIGHTFIELD_FORMAT, w: 3, h: 2, metersPerCell: 1, minM: 0, maxM: 12, heights: [0, 1.5, 12, 3.25, 10, 0.07] };
    const text = formatHeightfield(field);
    expect(heightfieldSchema.parse(JSON.parse(text))).toEqual(field);
    expect(text.trim().split('\n')).toHaveLength(5);
  });
});

describe('removeFloaters', () => {
  it('haalt een zwevend schijfje weg en laat brede vormen staan', () => {
    const ground = gridMesh((x) => 0.25 * x, 40, 0.5);
    const plate = gridMesh(() => 14, 2, 0.5, 20, 20); // 2 x 2 m, 14 m boven de grond
    const wall = gridMesh((x, z) => (x > 5 && x < 15 && z > 5 && z < 15 ? 3 + 0.25 * x : 0.25 * x), 40, 0.5); // brede verhoging (10 m)
    const withPlate: TerrainMesh = {
      positions: Float32Array.from([...ground.positions, ...plate.positions]),
      indices: Uint32Array.from([...ground.indices, ...Array.from(plate.indices, (i) => i + ground.positions.length / 3)]),
    };
    const before = rasterizeTopSurface(withPlate, { minX: 0, minZ: 0, sizeM: 40, resolution: 40 });
    expect(before.height[21 * 40 + 21]).toBeGreaterThan(13);
    const cleaned = removeFloaters(withPlate, { cellM: 0.5, radiusM: 3, thresholdM: 4 });
    expect(cleaned.removedTriangles).toBeGreaterThan(0);
    const after = rasterizeTopSurface(cleaned.mesh, { minX: 0, minZ: 0, sizeM: 40, resolution: 40 });
    expect(after.height[21 * 40 + 21]).toBeCloseTo(0.25 * 21.5, 0); // grond eronder
    // De brede verhoging blijft behouden.
    const kept = removeFloaters(wall, { cellM: 0.5, radiusM: 3, thresholdM: 4 });
    expect(kept.removedTriangles).toBe(0);
  });
});

describe('rotateMeshY en chooseCrop', () => {
  it('draait x en z om de y-as en laat y staan', () => {
    const mesh: TerrainMesh = { positions: Float32Array.from([1, 7, 0]), indices: new Uint32Array(0) };
    const turned = rotateMeshY(mesh, 90);
    expect(turned.positions[0]).toBeCloseTo(0, 5);
    expect(turned.positions[1]).toBe(7);
    expect(turned.positions[2]).toBeCloseTo(1, 5);
  });

  it('kiest het vierkant met het meeste reliëf binnen de dekking', () => {
    const bump = (x: number, z: number): number => Math.max(0, 6 - Math.hypot(x - 24, z - 10));
    const mesh = gridMesh(bump, 32, 0.5);
    const crop = chooseCrop(mesh, { sizeM: 12, rotationsDeg: [0], minCoverage: 0.99 });
    expect(crop.rotationDeg).toBe(0);
    // De bult ligt op (24, 10): het vierkant moet hem bevatten.
    expect(crop.minX).toBeLessThanOrEqual(24);
    expect(crop.minX + crop.sizeM).toBeGreaterThanOrEqual(24);
    expect(crop.minZ).toBeLessThanOrEqual(10);
    expect(crop.minZ + crop.sizeM).toBeGreaterThanOrEqual(10);
  });

  it('weigert een uitsnede die groter is dan de dekking', () => {
    expect(() => chooseCrop(gridMesh(() => 0, 8, 1), { sizeM: 20, rotationsDeg: [0], minCoverage: 0.99 })).toThrow(/dekt/);
  });

  it('kiest bij een gedraaide strook de draaihoek die erin past', () => {
    // Een strook van 30 x 10 m, 45 graden gedraaid: alleen met hoek 45 past een vierkant van 9 m ruim.
    const strip = gridMesh(() => 0, 30, 0.5);
    const kept: number[] = [];
    for (let t = 0; t < strip.indices.length / 3; t++) {
      const i = (strip.indices[t * 3] as number) * 3;
      if ((strip.positions[i + 2] as number) < 10) kept.push(t);
    }
    const band: TerrainMesh = { positions: strip.positions, indices: Uint32Array.from(kept.flatMap((t) => [0, 1, 2].map((k) => strip.indices[t * 3 + k] as number))) };
    const turned = rotateMeshY(band, 45);
    const crop = chooseCrop(turned, { sizeM: 9, rotationsDeg: [0, 45, 90, 135, 315], minCoverage: 0.99 });
    expect([45, 315]).toContain(crop.rotationDeg); // terugdraaien van de 45 graden, of een kwartslag verder
    expect(() => chooseCrop(turned, { sizeM: 9, rotationsDeg: [0], minCoverage: 0.99 })).toThrow(/dekt/);
  });
});

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
      materials: [{ factor: [1, 1, 1], texture: { width: 2, height: 2, data: texture } }, { factor: [1, 1, 1] }],
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
    const pixel = (x: number, z: number): number[] => Array.from(rgb.subarray((z * 4 + x) * 3, (z * 4 + x) * 3 + 3));
    // v loopt met z (uv-origine linksboven): z klein is de bovenste textuurrij (rood, groen).
    expect(pixel(0, 0)).toEqual([255, 0, 0]);
    expect(pixel(3, 0)).toEqual([0, 255, 0]);
    expect(pixel(0, 3)).toEqual([0, 0, 255]);
    expect(pixel(3, 3)).toEqual([255, 255, 255]);
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
    for (let b = 0; b <= n; b++) for (let a = 0; a <= n; a++) {
      positions.push(a, b, 0.5 * a);
      uvs.push(a / n, b / n);
    }
    const indices: number[] = [];
    for (let b = 0; b < n; b++) for (let a = 0; a < n; a++) {
      const i = b * (n + 1) + a;
      indices.push(i, i + 1, i + n + 1, i + 1, i + n + 2, i + n + 1);
    }
    const accessor = (array: Float32Array | Uint32Array, type: 'VEC3' | 'VEC2' | 'SCALAR') => doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
    const surface = doc.createPrimitive()
      .setAttribute('POSITION', accessor(Float32Array.from(positions), 'VEC3'))
      .setAttribute('TEXCOORD_0', accessor(Float32Array.from(uvs), 'VEC2'))
      .setIndices(accessor(Uint32Array.from(indices), 'SCALAR'))
      .setMaterial(rock);
    // Een Base-vlak ver boven de helling (y = 50 in Y-up); moet genegeerd worden.
    const foot = doc.createPrimitive()
      .setAttribute('POSITION', accessor(Float32Array.from([0, 0, 50, 20, 0, 50, 0, 20, 50]), 'VEC3'))
      .setIndices(accessor(Uint32Array.from([0, 1, 2]), 'SCALAR'))
      .setMaterial(base);
    const mesh = doc.createMesh('terrain').addPrimitive(surface).addPrimitive(foot);
    const child = doc.createNode('Object').setMesh(mesh);
    const root = doc.createNode('Sketchfab_model').setRotation([-Math.SQRT1_2, 0, 0, Math.SQRT1_2]).addChild(child);
    doc.createScene().addChild(root);
    await new NodeIO().write(path, doc);
  }

  it('past node-transformaties en Z-up naar Y-up toe, negeert Base en is reproduceerbaar', async () => {
    const source = join(dir, 'slope.glb');
    await writeSlopeGlb(source);
    const options = { source, id: 'slope', attribution: 'test', cropSizeM: 16, rotationsDeg: [0], cells: 16, sub: 2 };
    const first = await buildTerrain({ ...options, outDir: join(dir, 'a') });
    const second = await buildTerrain({ ...options, outDir: join(dir, 'b') });

    expect(first.manifest.crop.scale).toBe(1);
    expect(first.manifest.groundTint).toBe('#272727'); // 0,02 lineair
    const field = heightfieldSchema.parse(JSON.parse(readFileSync(join(dir, 'a', 'slope.height.json'), 'utf8')));
    // Mesh-y wordt wereld -z (kolom = x, rij = z). De uitsnede ligt over z van -20 tot 0: de helling hangt aan x, dus
    // elke rij heeft dezelfde hoogtes 0,5 * i en niets uit het Base-vlak (50 m) komt erin.
    expect(field.maxM).toBeCloseTo(7.5, 1);
    for (let j = 0; j < 16; j++) for (let i = 0; i < 16; i++) expect(field.heights[j * 16 + i]).toBeCloseTo(0.5 * i, 1);

    for (const name of ['slope.height.json', 'slope.albedo.jpg', 'terrain.json']) {
      expect(readFileSync(join(dir, 'a', name)).equals(readFileSync(join(dir, 'b', name)))).toBe(true);
    }
    const manifest = terrainManifestSchema.parse(JSON.parse(readFileSync(join(dir, 'a', 'terrain.json'), 'utf8')));
    expect(manifest.heightfield.path).toBe('slope.height.json');
    expect(second.files.map((f) => f.path)).toEqual(['slope.height.json', 'slope.albedo.jpg', 'terrain.json']);
  });
});
