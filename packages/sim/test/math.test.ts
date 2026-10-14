import { describe, expect, it } from 'vitest';
import { SIN_TABLE, TRIG_ONE, atan2A, cosA, sinA } from '../src/math/trig.js';
import { isqrt } from '../src/math/sqrt.js';
import { FNV_OFFSET, fnv1a, fnv1aInt } from '../src/math/fnv.js';
import { Rng, seedToState } from '../src/rng.js';
import { idiv, imod } from '../src/math/int.js';

describe('int', () => {
  it('idiv rondt af naar nul en imod is altijd niet-negatief', () => {
    expect(idiv(7, 2)).toBe(3);
    expect(idiv(-7, 2)).toBe(-3);
    expect(imod(-1, 4)).toBe(3);
    expect(imod(5, 4)).toBe(1);
  });
});

describe('sinustabel', () => {
  it('heeft 1024 integers binnen 1 van de echte sinus', () => {
    expect(SIN_TABLE.length).toBe(1024);
    for (let k = 0; k < 1024; k++) {
      const exact = Math.sin((2 * Math.PI * k) / 1024) * TRIG_ONE;
      expect(Math.abs(SIN_TABLE[k]! - exact)).toBeLessThanOrEqual(1);
      expect(Number.isInteger(SIN_TABLE[k])).toBe(true);
    }
  });
  it('is exact symmetrisch op de kwadranten', () => {
    expect(SIN_TABLE[0]).toBe(0);
    expect(SIN_TABLE[256]).toBe(TRIG_ONE);
    expect(SIN_TABLE[512]).toBe(0);
    expect(SIN_TABLE[768]).toBe(-TRIG_ONE);
    for (let k = 1; k < 256; k++) {
      expect(SIN_TABLE[512 - k]).toBe(SIN_TABLE[k]);
      expect(SIN_TABLE[512 + k]).toBe(-SIN_TABLE[k]!);
    }
  });
  it('sinA en cosA werken op uint16-hoeken', () => {
    expect(sinA(16384)).toBe(TRIG_ONE);
    expect(cosA(0)).toBe(TRIG_ONE);
    expect(cosA(32768)).toBe(-TRIG_ONE);
  });
});

describe('atan2A', () => {
  it('geeft de hoofdrichtingen exact', () => {
    expect(atan2A(0, 5)).toBe(0);
    expect(atan2A(5, 0)).toBe(16384);
    expect(atan2A(0, -5)).toBe(32768);
    expect(atan2A(-5, 0)).toBe(49152);
    expect(atan2A(7, 7)).toBe(8192);
    expect(atan2A(0, 0)).toBe(0);
  });
  it('ligt binnen een tabelstap van Math.atan2', () => {
    for (let i = 0; i < 2000; i++) {
      const dx = ((i * 7919) % 2001) - 1000;
      const dy = ((i * 104729) % 1999) - 999;
      if (dx === 0 && dy === 0) continue;
      let exact = (Math.atan2(dy, dx) / (2 * Math.PI)) * 65536;
      if (exact < 0) exact += 65536;
      let diff = Math.abs(atan2A(dy, dx) - exact);
      if (diff > 32768) diff = 65536 - diff;
      expect(diff).toBeLessThanOrEqual(64);
    }
  });
});

describe('isqrt', () => {
  it('is floor(sqrt(n)) voor kleine en grote n', () => {
    for (let n = 0; n < 5000; n++) expect(isqrt(n)).toBe(Math.floor(Math.sqrt(n)));
    const big = [2 ** 32 - 1, 2 ** 32, 2 ** 40 + 12345, 2 ** 52 + 1, Number.MAX_SAFE_INTEGER];
    for (const n of big) {
      const r = isqrt(n);
      expect(BigInt(r) * BigInt(r) <= BigInt(n)).toBe(true);
      expect(BigInt(r + 1) * BigInt(r + 1) > BigInt(n)).toBe(true);
    }
  });
  it('weigert negatieve invoer', () => {
    expect(() => isqrt(-1)).toThrow(RangeError);
  });
});

describe('fnv1a', () => {
  it('klopt met de referentievectoren', () => {
    const enc = (s: string) => new TextEncoder().encode(s);
    expect(fnv1a(FNV_OFFSET, enc(''))).toBe(0x811c9dc5);
    expect(fnv1a(FNV_OFFSET, enc('a'))).toBe(0xe40c292c);
    expect(fnv1a(FNV_OFFSET, enc('foobar'))).toBe(0xbf9cf968);
  });
  it('fnv1aInt is gelijk aan vier bytes little-endian', () => {
    const v = 0xdeadbeef | 0;
    expect(fnv1aInt(FNV_OFFSET, v)).toBe(
      fnv1a(FNV_OFFSET, new Uint8Array([0xef, 0xbe, 0xad, 0xde])),
    );
  });
});

describe('Rng', () => {
  it('xorshift32 geeft een vaste reeks voor een vaste seed', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    const seqA = Array.from({ length: 100 }, () => a.next());
    const seqB = Array.from({ length: 100 }, () => b.next());
    expect(seqA).toEqual(seqB);
    for (const v of seqA) expect(v >>> 0).toBe(v);
    expect(new Rng(43).next()).not.toBe(seqA[0]);
  });
  it('volgt de xorshift32-stap', () => {
    const r = new Rng(1);
    let x = seedToState(1);
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    expect(r.next()).toBe(x >>> 0);
  });
  it('seed 0 geeft geen nul-state', () => {
    expect(seedToState(0)).not.toBe(0);
    const r = new Rng(0);
    expect(r.next()).not.toBe(0);
  });
  it('nextInt blijft binnen bereik', () => {
    const r = new Rng(7);
    for (let i = 0; i < 1000; i++) {
      const v = r.nextInt(10);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(10);
    }
  });
});
