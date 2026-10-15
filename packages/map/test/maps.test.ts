import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MapDef } from '@crawlout/data';
import { readDataDir } from '@crawlout/data/node';
import {
  allConnected,
  decodeGrid,
  floodReachable,
  encodeGrid,
  generateMap,
  generateRustbelt,
  RUSTBELT_SPEC,
  generateTestmap,
  greyboxMesh,
  isPassable,
  loadHeightmap,
  loadMap,
  loadWater,
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

const N = 384;
const MID = N - 1; // spiegel: (x, y) -> (MID - x, MID - y)

describe('rustbelt', () => {
  const def = readDef('rustbelt');
  const map = loadMap(def, assets);

  it('valideert tegen het MapDef-schema en heeft de afgesproken aantallen', () => {
    expect(def.size).toEqual({ w: N, h: N });
    expect(def.spawns).toHaveLength(2);
    expect(def.scrapNodes).toHaveLength(18);
    expect(def.claimPoints).toHaveLength(5);
    expect(def.creepCamps).toHaveLength(6);
    expect(def.water).toBe('maps/rustbelt.water.json');
    expect(map.passable).toHaveLength(N * N);
    // Het watermasker is alleen voor de renderer: de sim-gerichte MapGrid is gelijk met en zonder de ref.
    const copy: Record<string, unknown> = { ...def };
    delete copy['water'];
    expect(MapDef.safeParse(copy).success).toBe(true);
    expect(loadMap(copy as MapDef, assets)).toEqual(map);
    expect(loadWater(def, assets)).toHaveLength(N * N);
    expect(loadWater(copy as MapDef, assets)).toBeNull();
  });

  it('spawns, scrap-nodes, claimpunten en creep-kampen liggen op begaanbare cellen', () => {
    for (const p of [...map.spawns, ...map.scrapNodes, ...map.claimPoints, ...map.creepCamps]) {
      expect(isPassable(map, p.x, p.y)).toBe(true);
    }
  });

  it('alle spawns, scrap-nodes en claimpunten zijn met elkaar verbonden, en elke begaanbare cel hoort erbij', () => {
    expect(
      allConnected(map, [...map.spawns, ...map.scrapNodes, ...map.claimPoints, ...map.creepCamps]),
    ).toBe(true);
    // keepMainComponent: geen afgesloten begaanbare zakken of plateaus.
    const seen = floodReachable(map, map.spawns[0]!.x, map.spawns[0]!.y);
    for (let i = 0; i < N * N; i++) if (map.passable[i] === 1) expect(seen[i]).toBe(1);
  });

  it('heeft onbegaanbare kliffen, water, bos en ruines, maar blijft grotendeels open', () => {
    let blocked = 0;
    for (const v of map.passable) if (v === 0) blocked++;
    expect(blocked).toBeGreaterThan((N * N) / 8);
    expect(blocked).toBeLessThan((N * N) / 3);
  });

  it('is puntsymmetrisch (bitmap, hoogtes en water) en eerlijk', () => {
    const heights = loadHeightmap(def, assets);
    const water = decodeGrid(assets.read(def.water!), N, N, 'u8');
    for (let i = 0; i < N * N; i++) {
      const j = N * N - 1 - i;
      if (map.passable[i] !== map.passable[j]) expect.fail(`passability ${i}`);
      if (heights.data[i] !== heights.data[j]) expect.fail(`hoogte ${i}`);
      if (water[i] !== water[j]) expect.fail(`water ${i}`);
    }
    const mirrored = (list: Array<{ x: number; y: number }>): boolean =>
      list.every((p) =>
        list.some((q) => Math.abs(q.x - (MID - p.x)) <= 1 && Math.abs(q.y - (MID - p.y)) <= 1),
      );
    expect(mirrored(map.spawns)).toBe(true);
    expect(mirrored(map.scrapNodes)).toBe(true);
    expect(mirrored(map.claimPoints)).toBe(true);
    expect(mirrored(map.creepCamps)).toBe(true);
    // Gelijke loopafstanden: elke speler even ver van zijn eigen punten als de ander van de gespiegelde.
    const [a, b] = map.spawns;
    const fromA = bfsDist(map, a!.x, a!.y);
    const fromB = bfsDist(map, b!.x, b!.y);
    for (const p of [...map.scrapNodes, ...map.claimPoints, ...map.creepCamps]) {
      const q = { x: MID - p.x, y: MID - p.y };
      const mq = [...map.scrapNodes, ...map.claimPoints, ...map.creepCamps].find(
        (r) => Math.abs(r.x - q.x) <= 1 && Math.abs(r.y - q.y) <= 1,
      )!;
      expect(Math.abs(fromA[p.y * N + p.x]! - fromB[mq.y * N + mq.x]!)).toBeLessThanOrEqual(2);
    }
  });

  it('elk settlement-claimpunt heeft een scrap-node binnen claimRadiusM (besluit 9)', () => {
    const radius = claimRadiusM();
    const settlements = map.claimPoints.filter((c) => c.kind === 'settlement');
    expect(settlements).toHaveLength(4);
    for (const c of settlements) {
      const near = map.scrapNodes.filter(
        (n) => n.amount === 2500 && Math.hypot(n.x - c.x, n.y - c.y) <= radius,
      );
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

  it('creep-kampen liggen op een route van de eigen basis naar een claimpunt of oversteek (omweg hooguit 30 m)', () => {
    const g = generateRustbelt(nodeGenIo);
    const targets = [...map.claimPoints, ...g.crossings!];
    for (const camp of map.creepCamps) {
      const own = [...map.spawns].sort(
        (p, q) => Math.hypot(p.x - camp.x, p.y - camp.y) - Math.hypot(q.x - camp.x, q.y - camp.y),
      )[0]!;
      const fromSpawn = bfsDist(map, own.x, own.y);
      const fromCamp = bfsDist(map, camp.x, camp.y);
      const detour = Math.min(
        ...targets.map(
          (t) =>
            fromSpawn[camp.y * N + camp.x]! + fromCamp[t.y * N + t.x]! - fromSpawn[t.y * N + t.x]!,
        ),
      );
      expect(detour, `kamp (${camp.x},${camp.y})`).toBeLessThanOrEqual(30);
      expect(Math.hypot(camp.x - own.x, camp.y - own.y)).toBeGreaterThan(30);
    }
  });

  it('heeft precies 2 spawns in tegenover elkaar liggende hoektegels, in playerId-volgorde', () => {
    expect(map.spawns).toHaveLength(2);
    const [a, b] = map.spawns;
    // Speler 0 rechtsboven (tegel 2,0), speler 1 linksonder (tegel 0,2).
    expect(a!.x).toBeGreaterThanOrEqual(256);
    expect(a!.y).toBeLessThan(128);
    expect(b!.x).toBeLessThan(128);
    expect(b!.y).toBeGreaterThanOrEqual(256);
  });

  it('heeft dominance 3 van 5 punten gedurende 8 minuten', () => {
    expect(readDominance('rustbelt')).toEqual({ pointsRequired: 3, minutes: 8 });
    expect(def.claimPoints).toHaveLength(5);
  });

  it('geeft posities in sim-eenheden als celmiddelpunt', () => {
    const s = map.spawns[0]!;
    expect(s.ux).toBe(s.x * 256 + 128);
    expect(s.uy).toBe(s.y * 256 + 128);
  });
});

/** BFS-afstand (4-buren) in cellen over begaanbare cellen, minus `blocked`; -1 = onbereikbaar. */
function bfsDist(
  map: ReturnType<typeof loadMap>,
  sx: number,
  sy: number,
  blocked?: Uint8Array,
): Int32Array {
  const w = map.w;
  const d = new Int32Array(w * map.h).fill(-1);
  const q = new Int32Array(w * map.h);
  let tail = 0;
  q[tail++] = sy * w + sx;
  d[sy * w + sx] = 0;
  for (let head = 0; head < tail; head++) {
    const i = q[head]!;
    const x = i % w;
    const y = (i - x) / w;
    for (const [dx, dy] of [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
    ] as const) {
      if (!isPassable(map, x + dx, y + dy)) continue;
      const j = (y + dy) * w + x + dx;
      if (d[j] !== -1 || blocked?.[j] === 1) continue;
      d[j] = d[i]! + 1;
      q[tail++] = j;
    }
  }
  return d;
}

/** Pad (celindices) van a naar b langs dalende afstand; null als b onbereikbaar is. */
function pathTo(
  map: ReturnType<typeof loadMap>,
  a: { x: number; y: number },
  b: { x: number; y: number },
  blocked?: Uint8Array,
): number[] | null {
  const d = bfsDist(map, b.x, b.y, blocked);
  const w = map.w;
  let i = a.y * w + a.x;
  if (d[i] === -1) return null;
  const out = [i];
  while (d[i] !== 0) {
    const x = i % w;
    const y = (i - x) / w;
    for (const [dx, dy] of [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
    ] as const) {
      const j = (y + dy) * w + x + dx;
      if (isPassable(map, x + dx, y + dy) && d[j] === d[i]! - 1) {
        i = j;
        break;
      }
    }
    out.push(i);
  }
  return out;
}

describe('rustbelt: terrein, rivier, bos en routes', () => {
  const def = readDef('rustbelt');
  const map = loadMap(def, assets);
  const heights = loadHeightmap(def, assets);
  const water = decodeGrid(assets.read(def.water!), N, N, 'u8') as Uint8Array;
  const g = generateRustbelt(nodeGenIo);
  const crossings = g.crossings!;
  const dist2 = (ax: number, ay: number, bx: number, by: number): number =>
    (ax - bx) * (ax - bx) + (ay - by) * (ay - by);
  const disc = (list: Array<{ x: number; y: number }>, r: number): Uint8Array => {
    const out = new Uint8Array(N * N);
    for (const c of list)
      for (let y = c.y - r; y <= c.y + r; y++)
        for (let x = c.x - r; x <= c.x + r; x++)
          if (x >= 0 && y >= 0 && x < N && y < N && dist2(x, y, c.x, c.y) <= r * r)
            out[y * N + x] = 1;
    return out;
  };

  it('heeft de hoogteschaal van de spec: begaanbaar land van 0 tot ongeveer 7 m, een klifwand van meer dan 0,5 m per cel', () => {
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < heights.data.length; i++) {
      if (map.passable[i] !== 1 || water[i] !== 0) continue;
      min = Math.min(min, heights.data[i]!);
      max = Math.max(max, heights.data[i]!);
    }
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeGreaterThan(5 * 256);
    expect(max).toBeLessThan(7.5 * 256);
    let wall = 0;
    for (let y = 30; y < N - 30; y++)
      for (let x = 30; x < N - 30; x++) {
        if (map.passable[y * N + x] !== 0 || water[y * N + x] !== 0) continue;
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
    const maxStep = 0.625 * 256 + 2;
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

  it('watermasker klopt met de passability: water is onbegaanbaar, ondiep is begaanbaar, en het water ligt onder 0', () => {
    let deep = 0;
    let shallow = 0;
    for (let i = 0; i < N * N; i++) {
      const v = water[i]!;
      expect([0, 1, 2]).toContain(v);
      if (v === 1) {
        deep++;
        if (map.passable[i] !== 0) expect.fail(`water ${i} is begaanbaar`);
      }
      if (v === 2) {
        shallow++;
        if (map.passable[i] !== 1) expect.fail(`voorde ${i} is onbegaanbaar`);
      }
      if (v !== 0 && heights.data[i]! >= 0)
        expect.fail(`water ${i} ligt niet onder het wateroppervlak`);
      if (v === 0 && map.passable[i] === 1 && heights.data[i]! < 0)
        expect.fail(`droge cel ${i} ligt onder water`);
    }
    // Een rivier van 6 tot 10 m breed over ruim 500 m.
    expect(deep).toBeGreaterThan(3000);
    expect(deep).toBeLessThan(6000);
    expect(shallow).toBeGreaterThan(60);
    expect(water).toEqual(g.water);
  });

  it('de rivier is 6 tot 10 m breed (gemeten loodrecht op de middellijn, buiten de oversteken)', () => {
    // Breedte per rij in het noordelijke dal: aantal waterscellen op rij y, gecorrigeerd voor de schuinte is lastig,
    // dus: de grootste schijf die in het water past (straal 3 tot 5) langs de hele rivier.
    const inWater = (x: number, y: number): boolean =>
      x >= 0 && y >= 0 && x < N && y < N && water[y * N + x] === 1;
    let maxR = 0;
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        if (!inWater(x, y)) continue;
        let r = 0;
        for (;;) {
          let all = true;
          for (let dy = -(r + 1); dy <= r + 1 && all; dy++)
            for (let dx = -(r + 1); dx <= r + 1 && all; dx++)
              if (dx * dx + dy * dy <= (r + 1) * (r + 1) && !inWater(x + dx, y + dy)) all = false;
          if (!all) break;
          r++;
        }
        maxR = Math.max(maxR, r);
      }
    expect(maxR).toBeGreaterThanOrEqual(2); // minstens ongeveer 5 m doorsnede ergens
    expect(maxR).toBeLessThanOrEqual(5); // nergens breder dan ongeveer 11 m
  });

  it('de rivier heeft precies 3 oversteken: twee voordes en een landbrug in het midden, elk 6 tot 8 m', () => {
    expect(crossings.filter((c) => c.kind === 'ford')).toHaveLength(2);
    const bridge = crossings.filter((c) => c.kind === 'bridge');
    expect(bridge).toHaveLength(1);
    expect(Math.abs(bridge[0]!.x - 191.5)).toBeLessThanOrEqual(1);
    expect(Math.abs(bridge[0]!.y - 191.5)).toBeLessThanOrEqual(1);
    const [a, b] = map.spawns;
    // Zonder de drie oversteken zijn de bases gescheiden; met elk alleen verbonden.
    expect(bfsDist(map, a!.x, a!.y, disc(crossings, 14))[b!.y * N + b!.x]).toBe(-1);
    for (const c of crossings) {
      const others = crossings.filter((o) => o !== c);
      expect(
        bfsDist(map, a!.x, a!.y, disc(others, 14))[b!.y * N + b!.x],
        `${c.kind} (${c.x},${c.y})`,
      ).toBeGreaterThan(0);
    }
    // Twee ondiepe stukken (de voordes), elk een samenhangend stuk van de oever tot de oever.
    const seen = new Uint8Array(N * N);
    let parts = 0;
    for (let i = 0; i < N * N; i++) {
      if (water[i] !== 2 || seen[i] === 1) continue;
      parts++;
      const q = [i];
      seen[i] = 1;
      for (let h = 0; h < q.length; h++) {
        const x = q[h]! % N;
        const y = (q[h]! - x) / N;
        for (const [dx, dy] of [
          [1, 0],
          [0, 1],
          [-1, 0],
          [0, -1],
        ] as const) {
          const j = (y + dy) * N + x + dx;
          if (water[j] === 2 && seen[j] === 0) {
            seen[j] = 1;
            q.push(j);
          }
        }
      }
    }
    expect(parts).toBe(2);
    // Breedte: een rij van 6 open cellen dwars op de stroom past op elke oversteek; de stroom loopt hier schuin,
    // dus: in een vierkant van 6 x 6 rond het midden van de oversteek zijn alle cellen begaanbaar.
    for (const c of crossings) {
      let best = 0;
      for (let oy = -4; oy <= 4; oy++)
        for (let ox = -4; ox <= 4; ox++) {
          let side = 0;
          while (side < 12) {
            let ok = true;
            for (let y = 0; y <= side && ok; y++)
              for (let x = 0; x <= side && ok; x++)
                if (!isPassable(map, c.x + ox + x - (side >> 1), c.y + oy + y - (side >> 1)))
                  ok = false;
            if (!ok) break;
            side++;
          }
          best = Math.max(best, side);
        }
      expect(best, `${c.kind} (${c.x},${c.y})`).toBeGreaterThanOrEqual(4);
    }
  });

  it('heeft minstens 3 routes tussen de bases, waarvan 2 ver van het midden', () => {
    const [a, b] = map.spawns;
    const lengths: number[] = [];
    for (const c of crossings) {
      const others = crossings.filter((o) => o !== c);
      const route = pathTo(map, a!, b!, disc(others, 14));
      expect(route, `${c.kind}`).not.toBeNull();
      lengths.push(route!.length);
      if (c.kind === 'ford') {
        // De route over een voorde blijft minstens 50 m van het midden.
        for (const i of route!) {
          const x = i % N;
          const y = (i - x) / N;
          expect(dist2(x, y, 191.5, 191.5)).toBeGreaterThan(50 * 50);
        }
      }
    }
    expect(Math.max(...lengths)).toBeLessThan(Math.min(...lengths) * 1.5);
  });

  it('de bosrand is dicht: 12 tot 20 m diep, onbegaanbaar, met een onregelmatige binnenrand', () => {
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const edge = Math.min(x, y, MID - x, MID - y);
        if (edge < 12 && map.passable[y * N + x] !== 0)
          expect.fail(`(${x},${y}) in de bosrand is open`);
      }
    const forest = g.forest!;
    for (let i = 0; i < N * N; i++)
      if (forest[i] !== 0 && map.passable[i] !== 0) expect.fail(`bos-cel ${i} is begaanbaar`);
    // Diepte van de rand per kolom (boven): tussen 12 en 20 en niet overal gelijk.
    const depths = new Set<number>();
    for (let x = 40; x < N - 40; x++) {
      let d = 0;
      while (forest[d * N + x] === 1) d++;
      expect(d).toBeGreaterThanOrEqual(12);
      expect(d).toBeLessThanOrEqual(20);
      depths.add(d);
    }
    expect(depths.size).toBeGreaterThanOrEqual(5);
    // Bosjes binnen de rand.
    let grove = 0;
    for (const v of forest) if (v === 2) grove++;
    expect(grove).toBeGreaterThan(500);
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

  it('5 claimpunten (een in het midden), 6 creep-kampen en 18 scrap-nodes, waarvan 4 van 2500 bij de settlements', () => {
    expect(
      map.claimPoints.filter((c) => c.kind === 'powerArmor' && c.x === 191 && c.y === 191),
    ).toHaveLength(1);
    expect(map.creepCamps).toHaveLength(6);
    expect(map.scrapNodes).toHaveLength(18);
    const radius = claimRadiusM();
    const nearSettlement = map.scrapNodes.filter((n) =>
      map.claimPoints.some(
        (c) => c.kind === 'settlement' && Math.hypot(n.x - c.x, n.y - c.y) <= radius,
      ),
    );
    expect(nearSettlement.filter((n) => n.amount === 2500)).toHaveLength(4);
    // Settlements aan de eigen kant: dichter bij de eigen spawn dan bij die van de tegenstander.
    const [a, b] = map.spawns;
    const fromA = bfsDist(map, a!.x, a!.y);
    const fromB = bfsDist(map, b!.x, b!.y);
    const own = map.claimPoints
      .filter((c) => c.kind === 'settlement')
      .map((c) => Math.sign(fromA[c.y * N + c.x]! - fromB[c.y * N + c.x]!));
    expect(own.filter((v) => v < 0)).toHaveLength(2);
    expect(own.filter((v) => v > 0)).toHaveLength(2);
  });

  it('de generator is snel genoeg (onder 30 s) en reproduceerbaar', () => {
    const t0 = performance.now();
    const again = generateRustbelt(nodeGenIo);
    expect(performance.now() - t0).toBeLessThan(30000);
    expect(again.passabilityFile).toBe(g.passabilityFile);
    expect(again.propsFile).toBe(g.propsFile);
  });
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
