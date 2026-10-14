import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MapDef } from '@crawlout/data';
import { readDataDir } from '@crawlout/data/node';
import {
  allConnected,
  decodeGrid,
  encodeGrid,
  generateMap,
  generateRustbelt,
  RUSTBELT_SPEC,
  generateTestmap,
  greyboxMesh,
  isPassable,
  loadHeightmap,
  loadMap,
  MARK_CLAIM_RGB,
  MARK_SCRAP_RGB,
  type GeneratedMap,
  type MapSpec,
  type MapAssets,
} from '../src/index.js';
import { nodeGenIo } from '../src/gen/node.js';

const dataDir = fileURLToPath(new URL('../../../data/', import.meta.url));
const assets: MapAssets = { read: (ref) => readFileSync(dataDir + ref, 'utf8') };
const readDef = (name: string): MapDef =>
  MapDef.parse(JSON.parse(assets.read(`maps/${name}.json`)));
const readDominance = (name: string): unknown => readDef(name).dominance;

const claimRadiusM = (): number =>
  (readDataDir(dataDir).sim as { claimRadiusM: number }).claimRadiusM;
const claimFootprint = (): { w: number; h: number } => {
  const b = (
    readDataDir(dataDir).buildings as Array<{ id: string; footprint: { w: number; h: number } }>
  ).find((x) => x.id === 'claimpaal');
  if (b === undefined) throw new Error('claimpaal ontbreekt in data/buildings.json');
  return b.footprint;
};

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
    expect(
      allConnected(map, [...map.spawns, ...map.scrapNodes, ...map.claimPoints, ...map.creepCamps]),
    ).toBe(true);
  });

  it('heeft onbegaanbare ruines en kliffen, maar blijft grotendeels open', () => {
    let blocked = 0;
    for (const v of map.passable) if (v === 0) blocked++;
    expect(blocked).toBeGreaterThan(500);
    expect(blocked).toBeLessThan((128 * 128) / 3);
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
      list.every((p) =>
        list.some((q) => Math.abs(q.x - (127 - p.x)) <= 1 && Math.abs(q.y - (127 - p.y)) <= 1),
      );
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
            for (let x = fx; x < fx + fw; x++)
              if (!isPassable(map, x, y) || occupied.has(y * map.w + x)) ok = false;
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
      const open = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ].filter(([dx, dy]) => isPassable(map, p.x + dx!, p.y + dy!)).length;
      expect(open).toBeGreaterThanOrEqual(2);
    }
  });

  it('creep-kampen liggen op de route tussen een basis en het middenpunt (omweg hooguit 8 m)', () => {
    const center = map.claimPoints.find((c) => c.kind === 'powerArmor')!;
    const spawnOf = (camp: { x: number }): { x: number; y: number } =>
      camp.x < 64 ? map.spawns[0]! : map.spawns[1]!;
    const distFrom = (sx: number, sy: number): Int32Array => {
      const d = new Int32Array(map.w * map.h).fill(-1);
      const q = [sy * map.w + sx];
      d[q[0]!] = 0;
      for (let h = 0; h < q.length; h++) {
        const i = q[h]!;
        const x = i % map.w;
        const y = (i - x) / map.w;
        for (const [dx, dy] of [
          [1, 0],
          [0, 1],
          [-1, 0],
          [0, -1],
        ] as const) {
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
      expect(fromSpawn[i]! + fromCenter[i]!).toBeLessThanOrEqual(
        fromSpawn[center.y * map.w + center.x]! + 8,
      );
    }
  });

  it('heeft precies 2 spawns, in playerId-volgorde (spawn i is van speler i)', () => {
    expect(map.spawns).toHaveLength(2);
    // A-helft (linksboven) eerst, gespiegelde B-helft (rechtsonder) tweede.
    expect(map.spawns[0]!.x).toBeLessThan(64);
    expect(map.spawns[1]!.x).toBeGreaterThanOrEqual(64);
  });

  it('heeft dominance 2 van 3 punten gedurende 8 minuten (besluit Martien, advies architect sectie 17)', () => {
    expect(readDominance('rustbelt')).toEqual({ pointsRequired: 2, minutes: 8 });
    expect(2).toBeLessThanOrEqual(def.claimPoints.length);
  });

  it('geeft posities in sim-eenheden als celmiddelpunt', () => {
    const s = map.spawns[0]!;
    expect(s.ux).toBe(s.x * 256 + 128);
    expect(s.uy).toBe(s.y * 256 + 128);
  });
});

describe('rustbelt: terrein, routes en bases', () => {
  const def = readDef('rustbelt');
  const map = loadMap(def, assets);
  const heights = loadHeightmap(def, assets);
  const N = 128;
  const dist2 = (ax: number, ay: number, bx: number, by: number): number =>
    (ax - bx) * (ax - bx) + (ay - by) * (ay - by);

  /** BFS-pad (4-buren) van a naar b over begaanbare cellen, minus de cellen in `blocked`. null als er geen pad is. */
  const path = (
    a: { x: number; y: number },
    b: { x: number; y: number },
    blocked: Uint8Array,
  ): number[] | null => {
    const parent = new Int32Array(N * N).fill(-2);
    const queue = [a.y * N + a.x];
    parent[queue[0]!] = -1;
    for (let head = 0; head < queue.length; head++) {
      const i = queue[head]!;
      if (i === b.y * N + b.x) {
        const out: number[] = [];
        for (let c = i; c >= 0; c = parent[c]!) out.push(c);
        return out;
      }
      const x = i % N;
      const y = (i - x) / N;
      for (const [dx, dy] of [
        [1, 0],
        [0, 1],
        [-1, 0],
        [0, -1],
      ] as const) {
        const j = (y + dy) * N + x + dx;
        if (!isPassable(map, x + dx, y + dy) || blocked[j] === 1 || parent[j] !== -2) continue;
        parent[j] = i;
        queue.push(j);
      }
    }
    return null;
  };

  it('heeft de hoogteschaal van de spec: begaanbaar terrein van 0 tot ongeveer 7 m, een klifwand van meer dan 0,5 m per cel', () => {
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < heights.data.length; i++) {
      // Ruines (2,5 m boven het terrein) en de klifwand zelf tellen niet mee; het begaanbare terrein wel.
      if (map.passable[i] !== 1) continue;
      min = Math.min(min, heights.data[i]!);
      max = Math.max(max, heights.data[i]!);
    }
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeGreaterThan(4 * 256);
    expect(max).toBeLessThan(7 * 256);
    // Grootste hoogteverschil over een klifwand: onbegaanbare terreincel naast een begaanbare cel, zonder ruines (die zitten er 2,5 m bovenop).
    let wall = 0;
    for (let y = 3; y < N - 3; y++)
      for (let x = 3; x < N - 3; x++) {
        if (map.passable[y * N + x] !== 0) continue;
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const)
          wall = Math.max(
            wall,
            Math.abs(heights.data[y * N + x]! - heights.data[(y + dy) * N + x + dx]!),
          );
      }
    expect(wall).toBeGreaterThan(0.5 * 256);
  });

  it('kliffen volgen de helling: open cellen naast open cellen zijn zelden steiler dan de drempel (32 graden)', () => {
    // De generator ruimt klifspikkels op (minCliffCells), dus een enkele cel mag boven de drempel blijven.
    const maxStep = 0.625 * 256 + 2; // 0,625 m per cel, in 1/256 m
    let pairs = 0;
    let over = 0;
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        if (map.passable[y * N + x] !== 1) continue;
        for (const [dx, dy] of [
          [1, 0],
          [0, 1],
        ] as const) {
          if (!isPassable(map, x + dx, y + dy)) continue;
          pairs++;
          const dh = Math.abs(heights.data[y * N + x]! - heights.data[(y + dy) * N + x + dx]!);
          if (dh > maxStep) over++;
        }
      }
    expect(over).toBeLessThan(pairs / 200);
  });

  it('heeft minstens twee onafhankelijke routes tussen de bases (geen flessenhals van minder dan 7 m breed)', () => {
    const a = map.spawns[0]!;
    const b = map.spawns[1]!;
    const none = new Uint8Array(N * N);
    const first = path(a, b, none);
    expect(first).not.toBeNull();
    // Blokkeer alles binnen 4 cellen van de eerste route, behalve rond de bases zelf (daar lopen alle routes uit).
    const block = new Uint8Array(N * N);
    for (const i of first!) {
      const x = i % N;
      const y = (i - x) / N;
      if (dist2(x, y, a.x, a.y) < 20 * 20 || dist2(x, y, b.x, b.y) < 20 * 20) continue;
      for (let dy = -4; dy <= 4; dy++)
        for (let dx = -4; dx <= 4; dx++) {
          const bx = x + dx;
          const by = y + dy;
          if (bx >= 0 && by >= 0 && bx < N && by < N) block[by * N + bx] = 1;
        }
    }
    const second = path(a, b, block);
    expect(second, 'tweede route').not.toBeNull();
    // De tweede route is een echte omweg, maar geen labyrint.
    expect(second!.length).toBeLessThan(first!.length * 3);
  });

  it('elke basis ligt op een vlak, open bouwvlak (hoofdgebouw 5x5 plus bouwruimte, straal 7 m)', () => {
    for (const s of map.spawns) {
      let lo = Infinity;
      let hi = -Infinity;
      for (let y = s.y - 7; y <= s.y + 7; y++)
        for (let x = s.x - 7; x <= s.x + 7; x++) {
          if (dist2(x, y, s.x, s.y) > 49) continue;
          expect(isPassable(map, x, y), `(${x},${y}) bij spawn (${s.x},${s.y})`).toBe(true);
          lo = Math.min(lo, heights.data[y * N + x]!);
          hi = Math.max(hi, heights.data[y * N + x]!);
        }
      expect(hi - lo).toBeLessThanOrEqual(64); // 0,25 m
    }
  });

  it('heeft 3 claimpunten waarvan een in het midden, 2 creep-kampen en 6 scrap-nodes, waarvan 2 bij de settlements', () => {
    expect(map.claimPoints.filter((c) => c.x === 64 && c.y === 64)).toHaveLength(1);
    expect(map.creepCamps).toHaveLength(2);
    expect(map.scrapNodes).toHaveLength(6);
    const radius = claimRadiusM();
    const nearSettlement = map.scrapNodes.filter((n) =>
      map.claimPoints.some(
        (c) => c.kind === 'settlement' && Math.hypot(n.x - c.x, n.y - c.y) <= radius,
      ),
    );
    expect(nearSettlement).toHaveLength(2);
  });
});

describe('een tweede map is alleen data', () => {
  it('een tweede terreinmap met dezelfde techniek is alleen een spec: andere oriëntatie, zelfde generator', () => {
    const spec: MapSpec = {
      ...RUSTBELT_SPEC,
      props: undefined as never,
      id: 'rustbelt-b',
      terrain: { ...RUSTBELT_SPEC.terrain!, orientation: 6 },
      ruins: [],
      spawns: [],
      scrapNodes: [],
      claimPoints: [],
      centerClaims: [],
      creepCamps: [],
    };
    const g = generateMap(spec, nodeGenIo);
    for (let y = 0; y < 128; y++)
      for (let x = 0; x < 128; x++) {
        expect(g.heights[y * 128 + x]).toBe(g.heights[(127 - y) * 128 + 127 - x]);
        expect(g.passable[y * 128 + x]).toBe(g.passable[(127 - y) * 128 + 127 - x]);
      }
    expect(JSON.stringify(g.def)).not.toBe(JSON.stringify(readDef('rustbelt')));
  });

  it('testmap laadt via dezelfde loader zonder codewijziging', () => {
    const def = readDef('testmap');
    const map = loadMap(def, assets);
    expect(map.w).toBe(32);
    expect(map.h).toBe(32);
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
    const colorOf = (x: number, y: number): number[] =>
      Array.from(mesh.colors.subarray((y * 32 + x) * 12, (y * 32 + x) * 12 + 3));
    expect(colorOf(13, 7)).not.toEqual(colorOf(20, 20)); // ruine versus grond
  });

  it('markeert scrap-node- en claimpunt-cellen met eigen kleur', () => {
    const colorAt = (x: number, y: number): number[] =>
      Array.from(mesh.colors.subarray((y * 32 + x) * 12, (y * 32 + x) * 12 + 3));
    const node = map.scrapNodes[0]!;
    const claim = map.claimPoints[0]!;
    expect(colorAt(node.x, node.y)).toEqual(Array.from(MARK_SCRAP_RGB));
    expect(colorAt(claim.x, claim.y)).toEqual(Array.from(MARK_CLAIM_RGB));
  });
});
