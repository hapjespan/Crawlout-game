import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MapDef } from '@crawlout/data';
import { readDataDir } from '@crawlout/data/node';
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
  MARK_CLAIM_RGB,
  MARK_SCRAP_RGB,
  type GeneratedMap,
  type MapAssets,
} from '../src/index.js';

const dataDir = fileURLToPath(new URL('../../../data/', import.meta.url));
const assets: MapAssets = { read: (ref) => readFileSync(dataDir + ref, 'utf8') };
const readDef = (name: string): MapDef => MapDef.parse(JSON.parse(assets.read(`maps/${name}.json`)));
const readDominance = (name: string): unknown => readDef(name).dominance;

const claimRadiusM = (): number => (readDataDir(dataDir).sim as { claimRadiusM: number }).claimRadiusM;
const claimFootprint = (): { w: number; h: number } => {
  const b = (readDataDir(dataDir).buildings as Array<{ id: string; footprint: { w: number; h: number } }>).find((x) => x.id === 'claimpaal');
  if (b === undefined) throw new Error('claimpaal ontbreekt in data/buildings.json');
  return b.footprint;
};

const generated: Array<[string, () => GeneratedMap]> = [
  ['rustbelt', generateRustbelt],
  ['testmap', generateTestmap],
];

const expectedFiles = (name: string, g: GeneratedMap): Array<[string, string]> => [
  [`maps/${name}.json`, JSON.stringify(g.def, null, 2) + '\n'],
  [`maps/${name}.passability.json`, g.passabilityFile + '\n'],
  [`maps/${name}.heightmap.json`, g.heightmapFile + '\n'],
  ...(g.propsFile === undefined ? [] : ([[`maps/${name}.props.json`, g.propsFile + '\n']] as Array<[string, string]>)),
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

  it('elk settlement-claimpunt heeft een scrap-node binnen claimRadiusM (besluit 9)', () => {
    const radius = claimRadiusM();
    const settlements = map.claimPoints.filter((c) => c.kind === 'settlement');
    expect(settlements.length).toBeGreaterThanOrEqual(2);
    for (const c of settlements) {
      const near = map.scrapNodes.filter((n) => Math.hypot(n.x - c.x, n.y - c.y) <= radius);
      expect(near.length, `claimpunt (${c.x},${c.y})`).toBeGreaterThanOrEqual(1);
    }
  });

  it('naast elk claimpunt past een claimgebouw, op open cellen binnen claimRadiusM en niet op een node of claimpunt', () => {
    const radius = claimRadiusM();
    const { w: fw, h: fh } = claimFootprint();
    const occupied = new Set([...map.scrapNodes, ...map.claimPoints].map((p) => p.y * map.w + p.x));
    for (const c of map.claimPoints) {
      let found = false;
      for (let fy = c.y - 8; fy <= c.y + 8 && !found; fy++) {
        for (let fx = c.x - 8; fx <= c.x + 8 && !found; fx++) {
          let ok = true;
          for (let y = fy; y < fy + fh; y++) {
            for (let x = fx; x < fx + fw; x++) if (!isPassable(map, x, y) || occupied.has(y * map.w + x)) ok = false;
          }
          // Afstand van het punt tot de footprint (dichtstbijzijnde cel), zoals de sim het rekent.
          const dx = Math.max(fx - c.x, 0, c.x - (fx + fw - 1));
          const dy = Math.max(fy - c.y, 0, c.y - (fy + fh - 1));
          if (ok && Math.hypot(dx, dy) <= radius) found = true;
        }
      }
      expect(found, `claimpunt (${c.x},${c.y})`).toBe(true);
    }
  });

  it('claimpunten en nodes liggen op een cel met begaanbare buren (geen ingesloten punt)', () => {
    for (const p of [...map.claimPoints, ...map.scrapNodes]) {
      const open = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => isPassable(map, p.x + dx!, p.y + dy!)).length;
      expect(open).toBeGreaterThanOrEqual(2);
    }
  });

  it('creep-kampen liggen op de route tussen een basis en het middenpunt (omweg hooguit 8 m)', () => {
    const center = map.claimPoints.find((c) => c.kind === 'powerArmor')!;
    const spawnOf = (camp: { x: number }): { x: number; y: number } => (camp.x < 64 ? map.spawns[0]! : map.spawns[1]!);
    const distFrom = (sx: number, sy: number): Int32Array => {
      const d = new Int32Array(map.w * map.h).fill(-1);
      const q = [sy * map.w + sx];
      d[q[0]!] = 0;
      for (let h = 0; h < q.length; h++) {
        const i = q[h]!;
        const x = i % map.w;
        const y = (i - x) / map.w;
        for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]] as const) {
          if (!isPassable(map, x + dx, y + dy)) continue;
          const j = (y + dy) * map.w + x + dx;
          if (d[j] !== -1) continue;
          d[j] = d[i]! + 1;
          q.push(j);
        }
      }
      return d;
    };
    for (const camp of map.creepCamps) {
      const s = spawnOf(camp);
      const fromSpawn = distFrom(s.x, s.y);
      const fromCenter = distFrom(center.x, center.y);
      const i = camp.y * map.w + camp.x;
      expect(fromSpawn[i]! + fromCenter[i]!).toBeLessThanOrEqual(fromSpawn[center.y * map.w + center.x]! + 8);
    }
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

  it('markeert scrap-node- en claimpunt-cellen met eigen kleur', () => {
    const colorAt = (x: number, y: number): number[] => Array.from(mesh.colors.subarray((y * 32 + x) * 12, (y * 32 + x) * 12 + 3));
    const node = map.scrapNodes[0]!;
    const claim = map.claimPoints[0]!;
    expect(colorAt(node.x, node.y)).toEqual(Array.from(MARK_SCRAP_RGB));
    expect(colorAt(claim.x, claim.y)).toEqual(Array.from(MARK_CLAIM_RGB));
  });
});
