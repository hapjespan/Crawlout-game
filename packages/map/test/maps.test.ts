import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  allConnected,
  decodeGrid,
  encodeGrid,
  generateMap,
  generateRustbelt,
  RUSTBELT_SPEC,
  generateTestmap,
  greyboxMesh,
  loadHeightmap,
  loadMap,
  MARK_CLAIM_RGB,
  MARK_SCRAP_RGB,
  type GeneratedMap,
  type MapSpec,
  type MapAssets,
} from '../src/index.js';
import { nodeGenIo } from '../src/gen/node.js';
import { assets, dataDir, N, readDef, readDominance } from './maps.helpers.js';

// The Rustbelt checks live in maps.rustbelt.test.ts and maps.rustbelt-terrain.test.ts; `pnpm gen` regenerates
// data/maps here first and then runs all of them.

const generated: Array<[string, () => GeneratedMap]> = [
  ['rustbelt', () => generateRustbelt(nodeGenIo)],
  ['testmap', generateTestmap],
];

const expectedFiles = (name: string, g: GeneratedMap): Array<[string, string]> => [
  [`maps/${name}.json`, JSON.stringify(g.def, null, 2) + '\n'],
  [`maps/${name}.passability.json`, g.passabilityFile + '\n'],
  [`maps/${name}.heightmap.json`, g.heightmapFile + '\n'],
  ...(g.propsFile === undefined
    ? []
    : ([[`maps/${name}.props.json`, g.propsFile + '\n']] as Array<[string, string]>)),
  ...(g.waterFile === undefined
    ? []
    : ([[`maps/${name}.water.json`, g.waterFile + '\n']] as Array<[string, string]>)),
];

// UPDATE_MAPS=1 pnpm --filter @crawlout/map gen schrijft data/maps/* opnieuw (voor de tests hieronder lezen).
if (process.env['UPDATE_MAPS'] === '1') {
  for (const [name, gen] of generated)
    for (const [ref, content] of expectedFiles(name, gen())) writeFileSync(dataDir + ref, content);
}

describe('gegenereerde bestanden', () => {
  for (const [name, gen] of generated) {
    it(`${name}: data/maps komt overeen met de generator`, () => {
      for (const [ref, content] of expectedFiles(name, gen()))
        expect(assets.read(ref)).toBe(content);
    });
  }
});

describe('een tweede map is alleen data', () => {
  it('een tweede terreinmap met dezelfde techniek is alleen een spec: andere oriëntatie, zelfde generator', () => {
    const spec: MapSpec = {
      ...RUSTBELT_SPEC,
      props: undefined as never,
      river: undefined as never,
      forest: undefined as never,
      id: 'rustbelt-b',
      terrain: { ...RUSTBELT_SPEC.terrain!, orientation: 6 },
      pads: [],
      ruins: [],
      spawns: [],
      scrapNodes: [],
      claimPoints: [],
      centerClaims: [],
      creepCamps: [],
    };
    const g = generateMap(spec, nodeGenIo);
    for (let i = 0; i < N * N; i++) {
      if (g.heights[i] !== g.heights[N * N - 1 - i]) expect.fail(`hoogte ${i}`);
      if (g.passable[i] !== g.passable[N * N - 1 - i]) expect.fail(`passability ${i}`);
    }
    expect(JSON.stringify(g.def)).not.toBe(JSON.stringify(readDef('rustbelt')));
  });

  it('testmap laadt via dezelfde loader zonder codewijziging', () => {
    const def = readDef('testmap');
    const map = loadMap(def, assets);
    expect(map.w).toBe(64);
    expect(map.h).toBe(64);
    expect(map.spawns).toHaveLength(2);
    expect(readDominance('testmap')).toEqual({ pointsRequired: 1, minutes: 1 });
    expect(
      allConnected(map, [...map.spawns, ...map.scrapNodes, ...map.claimPoints, ...map.creepCamps]),
    ).toBe(true);
  });

  it('loader weigert een bitmap met verkeerde afmetingen', () => {
    const def = readDef('testmap');
    const bad: MapAssets = {
      read: (ref) =>
        ref === def.passability ? encodeGrid(2, 2, 'u8', [1, 1, 1, 1]) : assets.read(ref),
    };
    expect(() => loadMap(def, bad)).toThrow(/past niet/);
  });
});

describe('grid-formaat', () => {
  it('rle roundtript u8 en i16', () => {
    const cells = [0, 0, 0, 5, 5, 1, 0, 0];
    expect(Array.from(decodeGrid(encodeGrid(4, 2, 'u8', cells), 4, 2, 'u8'))).toEqual(cells);
    const signed = [-300, -300, 0, 1280, 1280, 7, 7, 7];
    expect(Array.from(decodeGrid(encodeGrid(2, 4, 'i16', signed), 2, 4, 'i16'))).toEqual(signed);
  });
});

describe('greyboxMesh', () => {
  const def = readDef('testmap');
  const map = loadMap(def, assets);
  const heights = loadHeightmap(def, assets);
  const mesh = greyboxMesh(map, heights);

  it('geeft consistente typed arrays', () => {
    expect(mesh.vertexCount).toBe(64 * 64 * 4);
    expect(mesh.positions).toHaveLength(mesh.vertexCount * 3);
    expect(mesh.colors).toHaveLength(mesh.vertexCount * 3);
    expect(mesh.indices).toHaveLength(64 * 64 * 6);
    expect(mesh.unitsPerMeter).toBe(256);
    for (const idx of mesh.indices) expect(idx).toBeLessThan(mesh.vertexCount);
  });

  it('is deterministisch en tekent onbegaanbare cellen anders dan open grond', () => {
    const again = greyboxMesh(map, heights);
    expect(Array.from(again.positions)).toEqual(Array.from(mesh.positions));
    const colorOf = (x: number, y: number): number[] =>
      Array.from(mesh.colors.subarray((y * 64 + x) * 12, (y * 64 + x) * 12 + 3));
    expect(colorOf(31, 15)).not.toEqual(colorOf(40, 40)); // ruine versus grond
  });

  it('markeert scrap-node- en claimpunt-cellen met eigen kleur', () => {
    const colorAt = (x: number, y: number): number[] =>
      Array.from(mesh.colors.subarray((y * 64 + x) * 12, (y * 64 + x) * 12 + 3));
    const node = map.scrapNodes[0]!;
    const claim = map.claimPoints[0]!;
    expect(colorAt(node.x, node.y)).toEqual(Array.from(MARK_SCRAP_RGB));
    expect(colorAt(claim.x, claim.y)).toEqual(Array.from(MARK_CLAIM_RGB));
  });
});
