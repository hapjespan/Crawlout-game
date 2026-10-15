import { describe, expect, it } from 'vitest';
import type { PathTuning } from '../src/flowfield.js';
import { DIST_UNKNOWN, FlowFields, MAX_FLOW_FIELDS } from '../src/flowfield.js';
import {
  XL_CROSSINGS,
  XL_CROSSING_ROWS,
  XL_RIVER_HALF,
  createOpenMap,
  createTestMap,
  createXlTestMap,
  xlRiverX,
} from '../src/testing.js';
import { CONFIG } from './helpers.js';

// De hiërarchische padvinding (src/flowfield.ts) los van de sim: tegen een exacte BFS, op de testmap van 64, de open
// map van 128 en de XL-testmap van 384 (rivier met drie oversteken, bosrand, bosjes).

const TUNING: PathTuning = {
  sectorCells: CONFIG.pathSectorCells,
  entranceMaxCells: CONFIG.pathEntranceMaxCells,
  cacheCells: CONFIG.pathCacheCells,
};
/** Kleinste cache: de pool verdringt voortdurend. */
const TINY: PathTuning = { ...TUNING, cacheCells: 1 };

/** Exacte BFS (4-buren) vanaf één doelcel, de referentie. */
function bfs(w: number, h: number, pass: Uint8Array, goal: number): Int32Array {
  const d = new Int32Array(w * h).fill(-1);
  const q = new Int32Array(w * h);
  let qh = 0;
  let qt = 0;
  d[goal] = 0;
  q[qt++] = goal;
  while (qh < qt) {
    const c = q[qh++]!;
    const x = c % w;
    const y = (c - x) / w;
    const nbs = [
      x + 1 < w ? c + 1 : -1,
      x > 0 ? c - 1 : -1,
      y + 1 < h ? c + w : -1,
      y > 0 ? c - w : -1,
    ];
    for (const n of nbs) {
      if (n < 0 || pass[n] !== 1 || d[n]! >= 0) continue;
      d[n] = d[c]! + 1;
      q[qt++] = n;
    }
  }
  return d;
}

/** Vaste pseudo-toevalsreeks voor de testkeuzes (buiten de sim). */
function lcg(seed: number): () => number {
  let s = seed;
  return () => {
    s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff;
    return s;
  };
}

function randomWalkable(pass: Uint8Array, next: () => number): number {
  for (;;) {
    const c = next() % pass.length;
    if (pass[c] === 1) return c;
  }
}

/** Volgt nextCell vanaf `from` tot het doel; geeft de cellen, of null als hij vastloopt. */
function follow(
  ff: FlowFields,
  s: number,
  from: number,
  goal: number,
  max: number,
): number[] | null {
  const path = [from];
  let cell = from;
  for (let k = 0; k < max && cell !== goal; k++) {
    const next = ff.nextCell(s, cell);
    if (next < 0 || next === cell) return null;
    cell = next;
    path.push(cell);
  }
  return cell === goal ? path : null;
}

describe('hiërarchische flow fields', () => {
  for (const [name, make] of [
    ['testmap 64', () => createTestMap(64, 64)],
    ['open map 128', () => createOpenMap(128, 128)],
    ['XL-testmap 384', () => createXlTestMap()],
  ] as const) {
    it(`${name}: bereikbaarheid exact, nooit vast, elke stap begaanbaar en dalend, omweg klein`, () => {
      const map = make();
      const { w, h, passable } = map;
      const ff = new FlowFields(w, h, new Uint8Array(passable), TUNING);
      const next = lcg(7);
      let ratio = 0;
      let n = 0;
      let worst = 0;
      for (let trial = 0; trial < 12; trial++) {
        const goal = randomWalkable(passable, next);
        const s = ff.acquire(goal % w, Math.floor(goal / w), 1, 1);
        ff.refcount[s] = 1;
        const ref = bfs(w, h, passable, goal);
        for (let k = 0; k < 12; k++) {
          const from = randomWalkable(passable, next);
          const v = ff.distance(s, from);
          expect(v === DIST_UNKNOWN, `bereikbaarheid ${from} naar ${goal}`).toBe(ref[from] === -1);
          if (ref[from]! <= 0) continue;
          expect(v).toBeGreaterThanOrEqual(ref[from]!);
          const path = follow(ff, s, from, goal, 4 * w * h);
          expect(path, `vast op weg van ${from} naar ${goal}`).not.toBeNull();
          for (let i = 1; i < path!.length; i++) {
            expect(passable[path![i]!]).toBe(1);
            expect(ff.distance(s, path![i]!)).toBeLessThan(ff.distance(s, path![i - 1]!));
          }
          ratio += v / ref[from]!;
          n++;
          worst = Math.max(worst, v - ref[from]!);
        }
        ff.refcount[s] = 0;
      }
      // gemeten (sim-xl): gemiddeld 0,2 tot 0,9 procent langer dan de exacte BFS, hoogstens 18 cellen omweg
      expect(ratio / n).toBeLessThan(1.02);
      expect(worst).toBeLessThanOrEqual(2 * TUNING.sectorCells);
    });
  }

  it('dichtbij het doel (in het doelvenster) is de afstand exact', () => {
    const map = createXlTestMap();
    const { w, h, passable } = map;
    const ff = new FlowFields(w, h, new Uint8Array(passable), TUNING);
    const next = lcg(3);
    for (let trial = 0; trial < 20; trial++) {
      const goal = randomWalkable(passable, next);
      const gx = goal % w;
      const gy = Math.floor(goal / w);
      const s = ff.acquire(gx, gy, 1, 1);
      ff.refcount[s] = 1;
      const ref = bfs(w, h, passable, goal);
      // alle cellen tot 8 cellen ver (Chebyshev) waarvan het kortste pad ook binnen 8 blijft
      for (let y = gy - 8; y <= gy + 8; y++) {
        for (let x = gx - 8; x <= gx + 8; x++) {
          if (x < 0 || y < 0 || x >= w || y >= h || passable[y * w + x] !== 1) continue;
          const r = ref[y * w + x]!;
          if (r < 0 || r > 8) continue;
          expect(ff.distance(s, y * w + x)).toBe(r);
        }
      }
      ff.refcount[s] = 0;
    }
  });

  it('een rechthoek als doel: zaadcellen ook als ze geblokkeerd zijn, en het veld wijst naar de rand', () => {
    const map = createTestMap(64, 64);
    const w = new Uint8Array(map.passable);
    // blok van 3x3 dicht, zoals een gebouw, precies op een sectorgrens (x 15..17)
    for (let y = 20; y < 23; y++) for (let x = 15; x < 18; x++) w[y * 64 + x] = 0;
    const ff = new FlowFields(64, 64, w, TUNING);
    const s = ff.acquire(15, 20, 3, 3);
    ff.refcount[s] = 1;
    expect(ff.distance(s, 20 * 64 + 14)).toBe(1); // links naast het blok
    expect(ff.distance(s, 21 * 64 + 18)).toBe(1); // rechts naast het blok
    expect(ff.distance(s, 23 * 64 + 16)).toBe(1); // eronder
    let cell = 30 * 64 + 5;
    for (let steps = 0; steps < 100 && ff.distance(s, cell) !== 1; steps++)
      cell = ff.nextCell(s, cell);
    expect(ff.distance(s, cell)).toBe(1);
    expect(ff.nextCell(s, cell)).toBe(cell); // aan de rand: geen begaanbare buur die beter is
  });

  it('hergebruikt een veld met hetzelfde doel en geeft geen slot als alles in gebruik is', () => {
    const map = createTestMap(64, 64);
    const ff = new FlowFields(64, 64, new Uint8Array(map.passable), TUNING);
    const s = ff.acquire(50, 40, 1, 1);
    expect(ff.acquire(50, 40, 1, 1)).toBe(s);
    for (let k = 0; k < MAX_FLOW_FIELDS; k++) {
      const slot = ff.acquire(36 + (k % 20), 2 + Math.floor(k / 20), 1, 1);
      if (slot !== 255) ff.refcount[slot] = 1;
    }
    ff.refcount[s] = 1;
    expect(ff.acquire(5, 5, 1, 1)).toBe(255);
  });

  it('de uitkomst hangt niet af van de cache: kleine pool en andere volgorde van vragen geven dezelfde waarden', () => {
    const map = createXlTestMap();
    const { w, h, passable } = map;
    const big = new FlowFields(w, h, new Uint8Array(passable), TUNING);
    const tiny = new FlowFields(w, h, new Uint8Array(passable), TINY);
    const next = lcg(11);
    const goals: number[] = [];
    for (let k = 0; k < 6; k++) goals.push(randomWalkable(passable, next));
    const cells: number[] = [];
    for (let k = 0; k < 300; k++) cells.push(randomWalkable(passable, next));
    const ask = (ff: FlowFields, order: readonly number[]): number[] => {
      const out: number[] = [];
      for (const g of goals) {
        const s = ff.acquire(g % w, Math.floor(g / w), 1, 1);
        ff.refcount[s] = 1;
      }
      for (const c of order) {
        for (const g of goals) {
          const s = ff.acquire(g % w, Math.floor(g / w), 1, 1);
          out.push(ff.distance(s, c), ff.nextCell(s, c));
        }
      }
      return out;
    };
    const a = ask(big, cells);
    expect(ask(tiny, cells)).toEqual(a);
    // omgekeerde volgorde op een verse instantie, daarna terugzetten naar de oorspronkelijke volgorde
    const rev = ask(new FlowFields(w, h, new Uint8Array(passable), TINY), [...cells].reverse());
    const back: number[] = [];
    for (let k = cells.length - 1; k >= 0; k--) {
      const o = k * goals.length * 2;
      back.push(...rev.slice(o, o + goals.length * 2));
    }
    expect(back).toEqual(a);
  });

  it('invalidate: gebruikte slots blijven, ongebruikte vallen vrij; lokaal herbouwd gelijk aan volledig opnieuw', () => {
    const map = createXlTestMap();
    const { w, h, passable } = map;
    const walk = new Uint8Array(passable);
    const ff = new FlowFields(w, h, walk, TUNING);
    const goal = { x: w - 41, y: h - 41 };
    const a = ff.acquire(goal.x, goal.y, 1, 1);
    const b = ff.acquire(5, 5, 1, 1);
    ff.refcount[a] = 1;
    const start = 40 * w + 40;
    const before = ff.distance(a, start);
    expect(before).toBeGreaterThan(0);
    // de middelste oversteek dicht, zoals een rij gebouwen
    const y0 = XL_CROSSINGS[1]!;
    const cx = xlRiverX(w, y0 + 2);
    for (let y = y0; y < y0 + XL_CROSSING_ROWS; y++)
      for (let x = cx - XL_RIVER_HALF; x <= cx + XL_RIVER_HALF; x++) walk[y * w + x] = 0;
    ff.invalidate(cx - XL_RIVER_HALF, y0, 2 * XL_RIVER_HALF + 1, XL_CROSSING_ROWS);
    expect(ff.active[a]).toBe(1);
    expect(ff.active[b]).toBe(0);
    const after = ff.distance(a, start); // bouwt de graaf lokaal opnieuw op
    expect(after).toBeGreaterThanOrEqual(before);
    const fresh = new FlowFields(w, h, new Uint8Array(walk), TUNING);
    const f = fresh.acquire(goal.x, goal.y, 1, 1);
    fresh.refcount[f] = 1;
    expect(ff.nodeCount).toBe(fresh.nodeCount);
    expect(ff.regionCount).toBe(fresh.regionCount);
    const next = lcg(5);
    for (let k = 0; k < 200; k++) {
      const c = randomWalkable(walk, next);
      expect(ff.distance(a, c)).toBe(fresh.distance(f, c));
      expect(ff.nextCell(a, c)).toBe(fresh.nextCell(f, c));
    }
    expect(fresh.distance(f, start)).toBe(after);
  });

  it('XL: van spawn naar spawn over een oversteek, nooit door water of bos', () => {
    const map = createXlTestMap();
    const { w, h, passable } = map;
    const ff = new FlowFields(w, h, new Uint8Array(passable), TUNING);
    const goal = (h - 41) * w + (w - 41);
    const s = ff.acquire(w - 41, h - 41, 1, 1);
    ff.refcount[s] = 1;
    const path = follow(ff, s, 40 * w + 40, goal, w * h)!;
    expect(path).not.toBeNull();
    let crossedAt = -1;
    for (const c of path) {
      expect(passable[c]).toBe(1);
      const x = c % w;
      const y = Math.floor(c / w);
      if (Math.abs(x - xlRiverX(w, y)) <= XL_RIVER_HALF) crossedAt = y;
    }
    expect(XL_CROSSINGS.some((y0) => crossedAt >= y0 && crossedAt < y0 + XL_CROSSING_ROWS)).toBe(
      true,
    );
    const ref = bfs(w, h, passable, goal);
    expect(ff.distance(s, 40 * w + 40)).toBeLessThanOrEqual(
      ref[40 * w + 40]! + 2 * TUNING.sectorCells,
    );
  });

  it('geheugen blijft begrensd: de pool groeit niet boven pathCacheCells', () => {
    const map = createXlTestMap();
    const { w, h, passable } = map;
    const small: PathTuning = {
      ...TUNING,
      cacheCells: 64 * TUNING.sectorCells * TUNING.sectorCells,
    };
    const ff = new FlowFields(w, h, new Uint8Array(passable), small);
    const next = lcg(9);
    const base = ff.memoryBytes();
    for (let k = 0; k < 8; k++) {
      const g = randomWalkable(passable, next);
      const s = ff.acquire(g % w, Math.floor(g / w), 1, 1);
      ff.refcount[s] = 1;
      for (let j = 0; j < 400; j++) ff.distance(s, randomWalkable(passable, next));
    }
    // 64 regiovelden van 16x16 int32 plus de zoekopdrachten: ruim onder een paar MB
    expect(ff.memoryBytes() - base).toBeLessThan(2 * 1024 * 1024);
  });
});
