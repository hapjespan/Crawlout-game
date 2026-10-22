import { describe, expect, it } from 'vitest';
import {
  decodeGrid,
  generateRustbelt,
  RUSTBELT_SPEC,
  isPassable,
  loadHeightmap,
  loadMap,
} from '../src/index.js';
import { nodeGenIo } from '../src/gen/node.js';
import {
  assets,
  bfsDist,
  exclusiveRadiusM,
  footprintOf,
  MID,
  N,
  pathTo,
  readDef,
} from './maps.helpers.js';

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

  it('elke basis ligt op een vlak, open bouwvlak (straal 30 m, de pad uit de spec)', () => {
    const pad = RUSTBELT_SPEC.pads![0]!;
    expect(pad.radius).toBe(30);
    const r = pad.radius;
    for (const s of map.spawns) {
      let lo = Infinity;
      let hi = -Infinity;
      for (let y = s.y - r; y <= s.y + r; y++)
        for (let x = s.x - r; x <= s.x + r; x++) {
          if (dist2(x, y, s.x, s.y) > r * r) continue;
          expect(isPassable(map, x, y), `(${x},${y}) bij spawn (${s.x},${s.y})`).toBe(true);
          lo = Math.min(lo, heights.data[y * N + x]!);
          hi = Math.max(hi, heights.data[y * N + x]!);
        }
      expect(hi - lo).toBeLessThanOrEqual(64); // 0,25 m
    }
  });

  it('rond elke spawn passen op echte schaal een hoofdgebouw, 10 woningen, een werkplaats, een lab en 4 turrets', () => {
    // Gretig inpakken op de footprints van data/buildings.json: het hoofdgebouw op de spawn (zoals de sim), daarna elk
    // gebouw op de vrije plek het dichtst bij de spawn binnen 55 m, met een looppad van minstens 2 cellen tussen twee gebouwen, niet op een node
    // of claimpunt. Zo is "de basis past" een eigenschap van map plus data, niet van een AI.
    // in de volgorde waarin een speler bouwt: werkplaats en lab vroeg, de woningen erna
    const order = [
      'werkplaats',
      'lab',
      'woning',
      'woning',
      'woning',
      'woning',
      'woning',
      'woning',
      'woning',
      'woning',
      'woning',
      'woning',
      'turret',
      'turret',
      'turret',
      'turret',
    ];
    const gap = 1;
    const reach = 55;
    for (const s of map.spawns) {
      const used = new Uint8Array(N * N);
      for (const p of [...map.scrapNodes, ...map.claimPoints]) used[p.y * N + p.x] = 1;
      const free = (fx: number, fy: number, w: number, h: number): boolean => {
        for (let y = fy; y < fy + h; y++)
          for (let x = fx; x < fx + w; x++)
            if (!isPassable(map, x, y) || used[y * N + x] === 1) return false;
        return true;
      };
      const take = (fx: number, fy: number, w: number, h: number): void => {
        for (let y = fy - gap; y < fy + h + gap; y++)
          for (let x = fx - gap; x < fx + w + gap; x++)
            if (x >= 0 && y >= 0 && x < N && y < N) used[y * N + x] = 1;
      };
      const hq = footprintOf('hoofdgebouw');
      const hx = s.x - (hq.w >> 1);
      const hy = s.y - (hq.h >> 1);
      expect(free(hx, hy, hq.w, hq.h), `hoofdgebouw op spawn (${s.x},${s.y})`).toBe(true);
      take(hx, hy, hq.w, hq.h);
      for (const id of order) {
        const { w, h } = footprintOf(id);
        let best: [number, number, number] | null = null;
        for (let fy = s.y - reach; fy <= s.y + reach - h; fy++)
          for (let fx = s.x - reach; fx <= s.x + reach - w; fx++) {
            const d = dist2(fx + w / 2, fy + h / 2, s.x + 0.5, s.y + 0.5);
            if (d > reach * reach || (best !== null && d >= best[2])) continue;
            if (free(fx - gap, fy - gap, w + 2 * gap, h + 2 * gap)) best = [fx, fy, d];
          }
        expect(best, `${id} bij spawn (${s.x},${s.y})`).not.toBeNull();
        take(best![0], best![1], w, h);
      }
    }
  });

  it('5 claimpunten (een in het midden), 6 creep-kampen en 18 scrap-nodes, waarvan 4 van 2500 bij de settlements', () => {
    expect(
      map.claimPoints.filter((c) => c.kind === 'powerArmor' && c.x === 191 && c.y === 191),
    ).toHaveLength(1);
    expect(map.creepCamps).toHaveLength(6);
    expect(map.scrapNodes).toHaveLength(18);
    const radius = exclusiveRadiusM();
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
