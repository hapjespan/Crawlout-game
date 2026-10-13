import { describe, expect, it } from 'vitest';
import { DIST_UNKNOWN, FlowFields, MAX_FLOW_FIELDS } from '../src/flowfield.js';
import { createTestMap } from '../src/testing.js';

describe('flow fields', () => {
  const map = createTestMap(64, 64);
  const target = 40 * 64 + 50;
  const walk = map.passable;
  const fresh = (): FlowFields => new FlowFields(64, 64, walk);
  const at = (ff: FlowFields, c: number): number => ff.acquire(c % 64, Math.floor(c / 64), 1, 1);

  it('bouwt gebudgetteerd op en eindigt gelijk aan een volledige BFS', () => {
    const ff = fresh();
    const s = at(ff, target);
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
    const ref = fresh();
    const r = at(ref, target);
    ref.refcount[r] = 1;
    ref.step(1 << 20);
    expect(Array.from(ff.dist[s]!)).toEqual(Array.from(ref.dist[r]!));
    // geblokkeerde cellen hebben geen afstand
    for (let c = 0; c < map.passable.length; c++) if (map.passable[c] === 0) expect(ff.dist[s]![c]).toBe(DIST_UNKNOWN);
  });

  it('volgt het veld door de opening in de muur', () => {
    const ff = fresh();
    const s = at(ff, target);
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
    const ff = fresh();
    const s = at(ff, target);
    ff.refcount[s] = 1;
    ff.step(777);
    const copy = fresh();
    copy.active.set(ff.active);
    copy.tx0.set(ff.tx0);
    copy.ty0.set(ff.ty0);
    copy.tw.set(ff.tw);
    copy.th.set(ff.th);
    copy.processed.set(ff.processed);
    copy.rebuild();
    expect(copy.tail[s]).toBe(ff.tail[s]);
    expect(Array.from(copy.dist[s]!)).toEqual(Array.from(ff.dist[s]!));
  });

  it('hergebruikt een veld met hetzelfde doel en geeft geen slot als alles in gebruik is', () => {
    const ff = fresh();
    const s = at(ff, target);
    expect(at(ff, target)).toBe(s);
    for (let k = 0; k < MAX_FLOW_FIELDS; k++) {
      const slot = at(ff, 100 + k);
      if (slot !== 255) ff.refcount[slot] = 1;
    }
    ff.refcount[s] = 1;
    expect(at(ff, 5 * 64 + 5)).toBe(255);
  });

  it('een rechthoek als doel: zaadcellen ook als ze geblokkeerd zijn, en het veld wijst naar de rand', () => {
    const w = new Uint8Array(walk);
    // blok van 3x3 dicht, zoals een gebouw
    for (let y = 20; y < 23; y++) for (let x = 10; x < 13; x++) w[y * 64 + x] = 0;
    const ff = new FlowFields(64, 64, w);
    const s = ff.acquire(10, 20, 3, 3);
    ff.refcount[s] = 1;
    ff.step(1 << 20);
    expect(ff.dist[s]![20 * 64 + 9]).toBe(1); // links naast het blok
    expect(ff.dist[s]![21 * 64 + 13]).toBe(1); // rechts naast het blok
    let cell = 30 * 64 + 5;
    for (let steps = 0; steps < 100 && ff.dist[s]![cell] !== 1; steps++) cell = ff.nextCell(s, cell);
    expect(ff.dist[s]![cell]).toBe(1);
    expect(ff.nextCell(s, cell)).toBe(cell); // aan de rand: geen begaanbare buur die beter is
  });

  it('invalidateAll begint gebruikte velden opnieuw en laat ongebruikte vrij', () => {
    const ff = fresh();
    const a = at(ff, target);
    const b = at(ff, 5 * 64 + 5);
    ff.refcount[a] = 1;
    ff.step(1 << 20);
    ff.invalidateAll();
    expect(ff.processed[a]).toBe(0);
    expect(ff.active[a]).toBe(1);
    expect(ff.active[b]).toBe(0);
  });
});
