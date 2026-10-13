import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MapDef } from '@crawlout/data';
import {
  allConnected,
  decodeGrid,
  encodeGrid,
  generateRustbelt,
  generateTestmap,
  greyboxMesh,
  isPassable,
  loadHeightmap,
  loadMap,
  type GeneratedMap,
  type MapAssets,
} from '../src/index.js';

const dataDir = fileURLToPath(new URL('../../../data/', import.meta.url));
const assets: MapAssets = { read: (ref) => readFileSync(dataDir + ref, 'utf8') };
// Tijdelijk: ws4-s2 voegt `dominance` toe aan het MapDef-schema op een andere branch. Zolang het schema het veld
// nog niet kent, strippen we het voor de strict-validatie. Verwijderen na merge ws4-s2.
const readDef = (name: string): MapDef => {
  const raw = JSON.parse(assets.read(`maps/${name}.json`)) as Record<string, unknown>;
  if (!('dominance' in MapDef.shape)) delete raw['dominance'];
  return MapDef.parse(raw);
};
const readDominance = (name: string): unknown => (JSON.parse(assets.read(`maps/${name}.json`)) as Record<string, unknown>)['dominance'];

const generated: Array<[string, () => GeneratedMap]> = [
  ['rustbelt', generateRustbelt],
  ['testmap', generateTestmap],
];

const expectedFiles = (name: string, g: GeneratedMap): Array<[string, string]> => [
  [`maps/${name}.json`, JSON.stringify(g.def, null, 2) + '\n'],
  [`maps/${name}.passability.json`, g.passabilityFile + '\n'],
  [`maps/${name}.heightmap.json`, g.heightmapFile + '\n'],
];

// UPDATE_MAPS=1 pnpm --filter @crawlout/map gen schrijft data/maps/* opnieuw (voor de tests hieronder lezen).
if (process.env['UPDATE_MAPS'] === '1') {
  for (const [name, gen] of generated) for (const [ref, content] of expectedFiles(name, gen())) writeFileSync(dataDir + ref, content);
}

describe('gegenereerde bestanden', () => {
  for (const [name, gen] of generated) {
    it(`${name}: data/maps komt overeen met de generator`, () => {
      for (const [ref, content] of expectedFiles(name, gen())) expect(assets.read(ref)).toBe(content);
    });
  }
});

describe('rustbelt', () => {
  const def = readDef('rustbelt');
  const map = loadMap(def, assets);

  it('valideert tegen het MapDef-schema en heeft de afgesproken aantallen', () => {
    expect(def.size).toEqual({ w: 128, h: 128 });
    expect(def.spawns).toHaveLength(2);
    expect(def.scrapNodes).toHaveLength(6);
    expect(def.claimPoints).toHaveLength(3);
    expect(def.creepCamps).toHaveLength(2);
    expect(map.passable).toHaveLength(128 * 128);
  });

  it('spawns, scrap-nodes, claimpunten en creep-kampen liggen op begaanbare cellen', () => {
    for (const p of [...map.spawns, ...map.scrapNodes, ...map.claimPoints, ...map.creepCamps]) {
      expect(isPassable(map, p.x, p.y)).toBe(true);
    }
  });

  it('alle spawns, scrap-nodes en claimpunten zijn met elkaar verbonden (flood fill)', () => {
    expect(allConnected(map, [...map.spawns, ...map.scrapNodes, ...map.claimPoints, ...map.creepCamps])).toBe(true);
  });

  it('heeft onbegaanbare ruines en kliffen, maar blijft grotendeels open', () => {
    let blocked = 0;
    for (const v of map.passable) if (v === 0) blocked++;
    expect(blocked).toBeGreaterThan(500);
    expect(blocked).toBeLessThan(128 * 128 / 3);
  });

  it('is puntsymmetrisch (bitmap en hoogtes) en eerlijk', () => {
    const heights = loadHeightmap(def, assets);
    for (let y = 0; y < 128; y++) {
      for (let x = 0; x < 128; x++) {
        const i = y * 128 + x;
        const j = (127 - y) * 128 + (127 - x);
        expect(map.passable[i]).toBe(map.passable[j]);
        expect(heights.data[i]).toBe(heights.data[j]);
      }
    }
    const mirrored = (list: Array<{ x: number; y: number }>): boolean =>
      list.every((p) => list.some((q) => Math.abs(q.x - (127 - p.x)) <= 1 && Math.abs(q.y - (127 - p.y)) <= 1));
    expect(mirrored(map.spawns)).toBe(true);
    expect(mirrored(map.scrapNodes)).toBe(true);
    expect(mirrored(map.claimPoints)).toBe(true);
    expect(mirrored(map.creepCamps)).toBe(true);
  });

  it('heeft precies 2 spawns, in playerId-volgorde (spawn i is van speler i)', () => {
    expect(map.spawns).toHaveLength(2);
    // A-helft (linksboven) eerst, gespiegelde B-helft (rechtsonder) tweede.
    expect(map.spawns[0]!.x).toBeLessThan(64);
    expect(map.spawns[1]!.x).toBeGreaterThanOrEqual(64);
  });

  it('heeft dominance als startwaarde (2 van 3 punten, 3 minuten)', () => {
    expect(readDominance('rustbelt')).toEqual({ pointsRequired: 2, minutes: 3 });
    expect(2).toBeLessThanOrEqual(def.claimPoints.length);
  });

  it('geeft posities in sim-eenheden als celmiddelpunt', () => {
    const s = map.spawns[0]!;
    expect(s.ux).toBe(s.x * 256 + 128);
    expect(s.uy).toBe(s.y * 256 + 128);
  });
});

describe('een tweede map is alleen data', () => {
  it('testmap laadt via dezelfde loader zonder codewijziging', () => {
    const def = readDef('testmap');
    const map = loadMap(def, assets);
    expect(map.w).toBe(32);
    expect(map.h).toBe(32);
    expect(map.spawns).toHaveLength(2);
    expect(readDominance('testmap')).toEqual({ pointsRequired: 1, minutes: 1 });
    expect(allConnected(map, [...map.spawns, ...map.scrapNodes, ...map.claimPoints, ...map.creepCamps])).toBe(true);
  });

  it('loader weigert een bitmap met verkeerde afmetingen', () => {
    const def = readDef('testmap');
    const bad: MapAssets = { read: (ref) => (ref === def.passability ? encodeGrid(2, 2, 'u8', [1, 1, 1, 1]) : assets.read(ref)) };
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
    expect(mesh.vertexCount).toBe(32 * 32 * 4);
    expect(mesh.positions).toHaveLength(mesh.vertexCount * 3);
    expect(mesh.colors).toHaveLength(mesh.vertexCount * 3);
    expect(mesh.indices).toHaveLength(32 * 32 * 6);
    expect(mesh.unitsPerMeter).toBe(256);
    for (const idx of mesh.indices) expect(idx).toBeLessThan(mesh.vertexCount);
  });

  it('is deterministisch en tekent onbegaanbare cellen anders dan open grond', () => {
    const again = greyboxMesh(map, heights);
    expect(Array.from(again.positions)).toEqual(Array.from(mesh.positions));
    const colorOf = (x: number, y: number): number[] => Array.from(mesh.colors.subarray((y * 32 + x) * 12, (y * 32 + x) * 12 + 3));
    expect(colorOf(13, 7)).not.toEqual(colorOf(20, 20)); // ruine versus grond
  });
});
