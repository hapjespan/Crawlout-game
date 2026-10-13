import { describe, expect, it } from 'vitest';
import { DIST_UNKNOWN, FlowFields, MAX_FLOW_FIELDS } from '../src/flowfield.js';
import { createTestMap } from '../src/testing.js';

describe('flow fields', () => {
  const map = createTestMap(64, 64);
  const target = 40 * 64 + 50;

  it('bouwt gebudgetteerd op en eindigt gelijk aan een volledige BFS', () => {
    const ff = new FlowFields(map);
    const s = ff.acquire(target);
    ff.refcount[s] = 1;
    ff.step(100);
    expect(ff.processed[s]).toBe(100);
    expect(ff.isComplete(s)).toBe(false);
    let ticks = 1;
    while (!ff.isComplete(s)) {
      ff.step(100);
      ticks++;
    }
    expect(ticks).toBeGreaterThan(10);
    // referentie in één keer
    const ref = new FlowFields(map);
    const r = ref.acquire(target);
    ref.refcount[r] = 1;
    ref.step(1 << 20);
    expect(Array.from(ff.dist[s]!)).toEqual(Array.from(ref.dist[r]!));
    // geblokkeerde cellen hebben geen afstand
    for (let c = 0; c < map.passable.length; c++) if (map.passable[c] === 0) expect(ff.dist[s]![c]).toBe(DIST_UNKNOWN);
  });

  it('volgt het veld door de opening in de muur', () => {
    const ff = new FlowFields(map);
    const s = ff.acquire(target);
    ff.refcount[s] = 1;
    ff.step(1 << 20);
    let cell = 10 * 64 + 5;
    for (let steps = 0; steps < 500 && cell !== target; steps++) {
      const next = ff.nextCell(s, cell);
      expect(next).toBeGreaterThanOrEqual(0);
      expect(map.passable[next]).toBe(1);
      expect(ff.dist[s]![next]!).toBeLessThan(ff.dist[s]![cell]!);
      cell = next;
    }
    expect(cell).toBe(target);
  });

  it('rebuild reproduceert een half opgebouwd veld uit (doel, voortgang)', () => {
    const ff = new FlowFields(map);
    const s = ff.acquire(target);
    ff.refcount[s] = 1;
    ff.step(777);
    const copy = new FlowFields(map);
    copy.active.set(ff.active);
    copy.target.set(ff.target);
    copy.processed.set(ff.processed);
    copy.rebuild();
    expect(copy.tail[s]).toBe(ff.tail[s]);
    expect(Array.from(copy.dist[s]!)).toEqual(Array.from(ff.dist[s]!));
  });

  it('hergebruikt een veld met hetzelfde doel en geeft geen slot als alles in gebruik is', () => {
    const ff = new FlowFields(map);
    const s = ff.acquire(target);
    expect(ff.acquire(target)).toBe(s);
    for (let k = 0; k < MAX_FLOW_FIELDS; k++) {
      const slot = ff.acquire(100 + k);
      if (slot !== 255) ff.refcount[slot] = 1;
    }
    ff.refcount[s] = 1;
    expect(ff.acquire(5 * 64 + 5)).toBe(255);
  });
});
