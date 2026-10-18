import { describe, expect, it } from 'vitest';
import { MapDef } from '@crawlout/data';
import {
  allConnected,
  decodeGrid,
  floodReachable,
  generateMap,
  generateRustbelt,
  RUSTBELT_SPEC,
  isPassable,
  loadHeightmap,
  loadMap,
  loadWater,
  type MapSpec,
} from '../src/index.js';
import { nodeGenIo } from '../src/gen/node.js';
import {
  assets,
  bfsDist,
  claimFootprint,
  claimRadiusM,
  exclusiveRadiusM,
  MID,
  N,
  readDef,
  readDominance,
} from './maps.helpers.js';

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

  it('scrap ligt niet te dicht bij een claimpunt: minstens claimNodeMinM, en dat is claimRadiusM plus minstens 2 m (claimronde)', () => {
    const min = RUSTBELT_SPEC.claimNodeMinM;
    expect(min).toBeGreaterThanOrEqual(claimRadiusM() + 2);
    for (const n of map.scrapNodes)
      for (const c of map.claimPoints)
        expect(Math.hypot(n.x - c.x, n.y - c.y), `node (${n.x},${n.y})`).toBeGreaterThanOrEqual(
          min,
        );
    // de generator weigert een spec die het breekt
    const close: MapSpec = {
      ...RUSTBELT_SPEC,
      scrapNodes: [...RUSTBELT_SPEC.scrapNodes, { x: 224, y: 60, amount: 100 }],
    };
    expect(() => generateMap(close, nodeGenIo)).toThrow(/binnen 9 m van claimpunt \(220,60\)/);
  });

  it('evenveel scrap aan beide kanten van de spiegel (elke node en zijn spiegelbeeld dezelfde voorraad)', () => {
    const half = (side: number) =>
      map.scrapNodes
        .filter((n) => Math.sign(n.x + n.y - MID) === side)
        .reduce((s, n) => s + n.amount, 0);
    expect(map.scrapNodes.every((n) => n.x + n.y !== MID)).toBe(true);
    expect(half(1)).toBe(half(-1));
  });

  it('elk settlement-claimpunt heeft een scrap-node binnen exclusiveRadiusM (besluit 9, sinds data 0.20.0 los van claimRadiusM)', () => {
    const radius = exclusiveRadiusM();
    expect(radius).toBeGreaterThan(RUSTBELT_SPEC.claimNodeMinM);
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
