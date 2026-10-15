import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MapDef } from '@crawlout/data';
import {
  allConnected,
  createRng,
  decodeGrid,
  generateRustbelt,
  loadMap,
  loadProps,
  padClearings,
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
import { nodeGenIo } from '../src/gen/node.js';

const dataDir = fileURLToPath(new URL('../../../data/', import.meta.url));
const assets: MapAssets = { read: (ref) => readFileSync(dataDir + ref, 'utf8') };
const def = MapDef.parse(JSON.parse(assets.read('maps/rustbelt.json')));
const map = loadMap(def, assets);
const N = 384;
const file: PropsFile = parseProps(assets.read(def.props as string), N, N);
const U = 256;
const water = decodeGrid(assets.read(def.water as string), N, N, 'u8');
const cellOf = (v: number): number => v >> 8;
const onPassable = (x: number, y: number): boolean => map.passable[cellOf(y) * N + cellOf(x)] === 1;
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

  it('het totaal ligt tussen 4000 en 8000 en elke soort is aanwezig', () => {
    expect(file.props.length).toBeGreaterThanOrEqual(4000);
    expect(file.props.length).toBeLessThanOrEqual(8000);
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
      expect(p.x).toBeLessThan(N * U);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThan(N * U);
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
        x: N * U - 1 - p.x,
        y: N * U - 1 - p.y,
        yaw: (p.yaw + 32768) & 65535,
        scalePct: p.scalePct,
      };
      expect(all.has(key(m)), key(p)).toBe(true);
    }
    for (const asset of Object.keys(PROP_KINDS))
      expect(file.props.filter((p) => p.asset === asset).length & 1).toBe(0);
  });

  it('het bos is dicht: de meeste bomen staan in de onbegaanbare bosrand en bosjes, niets staat in het water', () => {
    const g = generateRustbelt(nodeGenIo);
    const forest = g.forest!;
    const trees = file.props.filter((p) => kindOf(p.asset) === 'tree');
    const inForest = trees.filter((p) => forest[cellOf(p.y) * N + cellOf(p.x)] !== 0).length;
    expect(trees.length).toBeGreaterThan(2500);
    expect(inForest / trees.length).toBeGreaterThan(0.75);
    // Dichtheid in de bosrand: minstens één boom per 12 m2.
    let forestCells = 0;
    for (const v of forest) if (v !== 0) forestCells++;
    expect(inForest * 12).toBeGreaterThan(forestCells);
    for (const p of file.props)
      expect(water[cellOf(p.y) * N + cellOf(p.x)], `${p.asset} in het water`).toBe(0);
    for (const p of file.props.filter((q) => ['grass', 'reed'].includes(kindOf(q.asset))))
      expect(onPassable(p.x, p.y)).toBe(true);
    // Riet staat langs het water.
    const nearWater = (p: { x: number; y: number }): boolean => {
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const cx = cellOf(p.x) + dx;
          const cy = cellOf(p.y) + dy;
          if (cx >= 0 && cy >= 0 && cx < N && cy < N && water[cy * N + cx] !== 0) return true;
        }
      return false;
    };
    for (const p of file.props.filter((q) => kindOf(q.asset) === 'reed'))
      expect(nearWater(p)).toBe(true);
  });

  it('geen prop blokkeert een pad: de padcorridor is vrij en zonder begaanbare tall-props blijft alles verbonden', () => {
    const keys = [...map.spawns, ...map.scrapNodes, ...map.claimPoints, ...map.creepCamps];
    const corridor = pathCorridor(map, map.spawns, keys);
    for (const p of file.props) {
      if (!onPassable(p.x, p.y)) continue;
      expect(corridor[cellOf(p.y) * N + cellOf(p.x)], `${p.asset} (${p.x},${p.y}) op een pad`).toBe(
        0,
      );
    }
    const blockedByProps = { ...map, passable: map.passable.slice() };
    for (const p of file.props)
      if (['tree', 'rock'].includes(kindOf(p.asset)))
        blockedByProps.passable[cellOf(p.y) * N + cellOf(p.x)] = 0;
    expect(allConnected(blockedByProps, keys)).toBe(true);
  });

  it('niets staat op een spawn-cel (ook niet op de cel zelf)', () => {
    const spawnCells = new Set(map.spawns.map((s) => s.y * N + s.x));
    for (const p of file.props) expect(spawnCells.has(cellOf(p.y) * N + cellOf(p.x))).toBe(false);
  });

  it('geen props op de bouwvlakken rond de spawns (daar komen gebouwen op echte schaal)', () => {
    const clearings = padClearings(RUSTBELT_SPEC);
    expect(clearings).toHaveLength(2);
    for (const p of file.props)
      for (const c of clearings) {
        const dx = cellOf(p.x) - c.x;
        const dy = cellOf(p.y) - c.y;
        expect(dx * dx + dy * dy > c.radius * c.radius, `${p.asset} op (${p.x},${p.y})`).toBe(true);
      }
  });

  it('is reproduceerbaar: dezelfde seed geeft dezelfde lijst, een andere seed een andere', () => {
    const g = generateRustbelt(nodeGenIo);
    const spec = RUSTBELT_SPEC.props!;
    const layers = { forest: g.forest!, water: g.water!, clearings: padClearings(RUSTBELT_SPEC) };
    const again = scatterProps(g.def, g.passable, spec, layers);
    expect(JSON.stringify(again.props)).toBe(JSON.stringify(file.props));
    const other = scatterProps(g.def, g.passable, { ...spec, seed: spec.seed + 1 }, layers);
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
