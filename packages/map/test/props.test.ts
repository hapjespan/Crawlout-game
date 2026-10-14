import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MapDef } from '@crawlout/data';
import {
  allConnected,
  createRng,
  generateRustbelt,
  loadMap,
  loadProps,
  parseProps,
  PROP_CLEARANCE_M,
  PROP_KINDS,
  PROP_SCALE_MAX,
  PROP_SCALE_MIN,
  RUSTBELT_SPEC,
  scatterProps,
  pathCorridor,
  type MapAssets,
  type PropsFile,
} from '../src/index.js';

const dataDir = fileURLToPath(new URL('../../../data/', import.meta.url));
const assets: MapAssets = { read: (ref) => readFileSync(dataDir + ref, 'utf8') };
const def = MapDef.parse(JSON.parse(assets.read('maps/rustbelt.json')));
const map = loadMap(def, assets);
const file: PropsFile = parseProps(assets.read(def.props as string), 128, 128);
const U = 256;
const cellOf = (v: number): number => v >> 8;
const onPassable = (x: number, y: number): boolean =>
  map.passable[cellOf(y) * 128 + cellOf(x)] === 1;
const withoutProps = (d: MapDef): MapDef => {
  const copy: Record<string, unknown> = { ...d };
  delete copy['props'];
  return copy as MapDef;
};
const kindOf = (asset: string): string => PROP_KINDS[asset] as string;

describe('rustbelt props', () => {
  it('MapDef verwijst naar het props-bestand en het schema laat het veld weg toe', () => {
    expect(def.props).toBe('maps/rustbelt.props.json');
    expect(MapDef.safeParse(withoutProps(def)).success).toBe(true);
  });

  it('het totaal ligt tussen 150 en 300 en elke soort is aanwezig', () => {
    expect(file.props.length).toBeGreaterThanOrEqual(150);
    expect(file.props.length).toBeLessThanOrEqual(300);
    const counts = new Map<string, number>();
    for (const p of file.props) counts.set(p.asset, (counts.get(p.asset) ?? 0) + 1);
    for (const asset of Object.keys(PROP_KINDS))
      expect(counts.get(asset) ?? 0, asset).toBeGreaterThan(0);
  });

  it('asset-ids zijn de bestandsnamen in assets/src/props in kleine letters', () => {
    const dir = fileURLToPath(new URL('../../../assets/src/props/', import.meta.url));
    const ids = readdirSync(dir)
      .filter((f) => f.endsWith('.glb'))
      .map((f) => f.slice(0, -4).toLowerCase())
      .sort();
    expect(Object.keys(PROP_KINDS).sort()).toEqual(ids);
    for (const p of file.props) expect(ids).toContain(p.asset);
  });

  it('yaw en scalePct liggen binnen de grenzen en alles ligt binnen de map', () => {
    for (const p of file.props) {
      expect(p.yaw).toBeGreaterThanOrEqual(0);
      expect(p.yaw).toBeLessThanOrEqual(65535);
      expect(p.scalePct).toBeGreaterThanOrEqual(PROP_SCALE_MIN);
      expect(p.scalePct).toBeLessThanOrEqual(PROP_SCALE_MAX);
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThan(128 * U);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThan(128 * U);
    }
  });

  it('geen prop binnen 3 m van spawns, scrap-nodes, claimpunten en creep-kampen', () => {
    const keys = [...map.spawns, ...map.scrapNodes, ...map.claimPoints, ...map.creepCamps];
    const min = PROP_CLEARANCE_M * U;
    for (const p of file.props) {
      for (const k of keys) {
        const d2 = (p.x - k.ux) ** 2 + (p.y - k.uy) ** 2;
        expect(d2, `${p.asset} (${p.x},${p.y}) bij (${k.x},${k.y})`).toBeGreaterThanOrEqual(
          min * min,
        );
      }
    }
  });

  it('is puntsymmetrisch: elke prop heeft een gespiegeld partner (zelfde soort, schaal, yaw + 180 graden)', () => {
    const key = (p: {
      asset: string;
      x: number;
      y: number;
      yaw: number;
      scalePct: number;
    }): string => `${p.asset}|${p.x}|${p.y}|${p.yaw}|${p.scalePct}`;
    const all = new Set(file.props.map(key));
    for (const p of file.props) {
      const m = {
        asset: p.asset,
        x: 128 * U - 1 - p.x,
        y: 128 * U - 1 - p.y,
        yaw: (p.yaw + 32768) & 65535,
        scalePct: p.scalePct,
      };
      expect(all.has(key(m)), key(p)).toBe(true);
    }
    for (const asset of Object.keys(PROP_KINDS))
      expect(file.props.filter((p) => p.asset === asset).length & 1).toBe(0);
  });

  it('bomen en rotsen staan vooral op of langs onbegaanbare cellen, gras op begaanbare grond', () => {
    const heavy = file.props.filter((p) => ['tree', 'rock'].includes(kindOf(p.asset)));
    const onBlocked = heavy.filter((p) => !onPassable(p.x, p.y)).length;
    expect(onBlocked / heavy.length).toBeGreaterThan(0.5);
    const near = (p: { x: number; y: number }): boolean => {
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const cx = cellOf(p.x) + dx;
          const cy = cellOf(p.y) + dy;
          if (cx < 0 || cy < 0 || cx >= 128 || cy >= 128 || map.passable[cy * 128 + cx] === 0)
            return true;
        }
      return false;
    };
    for (const p of heavy) expect(near(p), `${p.asset} (${p.x},${p.y})`).toBe(true);
    for (const p of file.props.filter((q) => kindOf(q.asset) === 'grass'))
      expect(onPassable(p.x, p.y)).toBe(true);
    const sparse = file.props.filter((p) => ['grass', 'bush'].includes(kindOf(p.asset))).length;
    expect(sparse).toBeLessThan(file.props.length / 2);
  });

  it('geen prop blokkeert een pad: de padcorridor is vrij en zonder begaanbare tall-props blijft alles verbonden', () => {
    const keys = [...map.spawns, ...map.scrapNodes, ...map.claimPoints, ...map.creepCamps];
    const corridor = pathCorridor(map, map.spawns, keys);
    for (const p of file.props) {
      if (!onPassable(p.x, p.y)) continue;
      expect(
        corridor[cellOf(p.y) * 128 + cellOf(p.x)],
        `${p.asset} (${p.x},${p.y}) op een pad`,
      ).toBe(0);
    }
    const blockedByProps = { ...map, passable: map.passable.slice() };
    for (const p of file.props)
      if (['tree', 'rock'].includes(kindOf(p.asset)))
        blockedByProps.passable[cellOf(p.y) * 128 + cellOf(p.x)] = 0;
    expect(allConnected(blockedByProps, keys)).toBe(true);
  });

  it('niets staat op een spawn-cel (ook niet op de cel zelf)', () => {
    const spawnCells = new Set(map.spawns.map((s) => s.y * 128 + s.x));
    for (const p of file.props) expect(spawnCells.has(cellOf(p.y) * 128 + cellOf(p.x))).toBe(false);
  });

  it('is reproduceerbaar: dezelfde seed geeft dezelfde lijst, een andere seed een andere', () => {
    const g = generateRustbelt();
    const spec = RUSTBELT_SPEC.props!;
    const again = scatterProps(g.def, g.passable, spec);
    expect(JSON.stringify(again.props)).toBe(JSON.stringify(file.props));
    const other = scatterProps(g.def, g.passable, { ...spec, seed: spec.seed + 1 });
    expect(JSON.stringify(other.props)).not.toBe(JSON.stringify(file.props));
  });

  it('props veranderen de sim-gerichte mapdata niet (MapGrid met en zonder props-ref is gelijk)', () => {
    const without = loadMap(withoutProps(def), assets);
    expect(without).toEqual(map);
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
      expect(p.x).toBeLessThan(128);
    });
  });

  it('geeft [] voor een map zonder props en weigert een ongeldig bestand', () => {
    expect(loadProps(withoutProps(def), assets)).toEqual([]);
    const bad: MapAssets = {
      read: () =>
        JSON.stringify({
          format: 'crawlout-props/1',
          w: 128,
          h: 128,
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
