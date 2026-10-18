import { describe, expect, it } from 'vitest';
import { cos1024, createRng, loadProps, sin1024, type MapAssets } from '../src/index.js';
import { assets, def, file, N, withoutProps } from './props.helpers.js';

// The Rustbelt props checks live in props.rustbelt.test.ts and props.rustbelt-placement.test.ts.

describe('integer-trigonometrie van de generator', () => {
  it('sin1024 en cos1024 volgen sin en cos binnen 1,5 procent over de hele cirkel', () => {
    for (let angle = 0; angle < 65536; angle += 97) {
      const rad = (angle / 65536) * Math.PI * 2;
      expect(Math.abs(sin1024(angle) - 1024 * Math.sin(rad))).toBeLessThan(16);
      expect(Math.abs(cos1024(angle) - 1024 * Math.cos(rad))).toBeLessThan(16);
    }
    expect([sin1024(0), sin1024(16384), sin1024(32768), sin1024(49152)]).toEqual([
      0, 1024, 0, -1024,
    ]);
    expect(cos1024(0)).toBe(1024);
  });
});

describe('loadProps', () => {
  it('geeft posities in meters, yaw in radialen en schaal als factor', () => {
    const list = loadProps(def, assets);
    expect(list).toHaveLength(file.props.length);
    list.forEach((p, i) => {
      const r = file.props[i]!;
      expect(p.asset).toBe(r.asset);
      expect(p.x).toBe(r.x / 256);
      expect(p.y).toBe(r.y / 256);
      expect(p.yaw).toBe(r.yaw);
      expect(p.yawRad).toBeCloseTo((r.yaw / 65536) * Math.PI * 2, 9);
      expect(p.scale).toBeCloseTo(r.scalePct / 100, 9);
      expect(p.x).toBeLessThan(N);
    });
  });

  it('geeft [] voor een map zonder props en weigert een ongeldig bestand', () => {
    expect(loadProps(withoutProps(def), assets)).toEqual([]);
    const bad: MapAssets = {
      read: () =>
        JSON.stringify({
          format: 'crawlout-props/1',
          w: N,
          h: N,
          props: [{ asset: 'x', x: 1, y: 1, yaw: 70000, scalePct: 100 }],
        }),
    };
    expect(() => loadProps(def, bad)).toThrow(/yaw/);
    expect(() => loadProps(def, { read: () => '{"format":"nee"}' })).toThrow(/formaat/);
  });
});

describe('createRng', () => {
  it('is deterministisch en blijft in bereik', () => {
    const a = createRng(7);
    const b = createRng(7);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
    const r = createRng(1);
    for (let i = 0; i < 1000; i++) {
      const v = r.range(80, 130);
      expect(v).toBeGreaterThanOrEqual(80);
      expect(v).toBeLessThanOrEqual(130);
    }
  });
});
