import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MapDef } from '@crawlout/data';
import {
  generateRustbelt,
  PROP_ASSETS,
  PROP_CLEARANCE_M,
  PROP_INFO,
  PROP_SCALE_MAX,
  PROP_SCALE_MIN,
  type PropCategory,
  type PropRecord,
} from '../src/index.js';
import { nodeGenIo } from '../src/gen/node.js';
import {
  byCategory,
  categoryOf,
  cellOf,
  def,
  file,
  heights,
  keys,
  manifestPath,
  N,
  U,
  water,
  withoutProps,
} from './props.helpers.js';

// Part 1 of the 'rustbelt props' tests: file, catalogue, bounds, symmetry and the forest.
describe('rustbelt props', () => {
  it('MapDef verwijst naar het props-bestand en het schema laat het veld weg toe', () => {
    expect(def.props).toBe('maps/rustbelt.props.json');
    expect(MapDef.safeParse(withoutProps(def)).success).toBe(true);
  });

  it('het totaal ligt tussen 6000 en 9000, het meeste is gras, en elke prop van de catalogus komt voor', () => {
    expect(file.props.length).toBeGreaterThanOrEqual(6000);
    expect(file.props.length).toBeLessThanOrEqual(9000);
    expect(byCategory('grass').length).toBeGreaterThan(file.props.length * 0.4);
    const counts = new Map<string, number>();
    for (const p of file.props) counts.set(p.asset, (counts.get(p.asset) ?? 0) + 1);
    for (const asset of PROP_ASSETS) expect(counts.get(asset) ?? 0, asset).toBeGreaterThan(0);
  });

  it('aantallen per categorie', () => {
    const count = (c: PropCategory): number => byCategory(c).length;
    expect(count('tree-leafy')).toBeGreaterThanOrEqual(1200);
    expect(count('tree-bare')).toBeGreaterThanOrEqual(250);
    expect(count('tree-bare')).toBeLessThan(count('tree-leafy') / 2);
    expect(count('grass')).toBeGreaterThanOrEqual(3000);
    expect(count('plant')).toBeGreaterThanOrEqual(300);
    expect(count('rock')).toBeGreaterThanOrEqual(500);
    for (const c of ['crate', 'chest', 'barrel'] as const)
      expect(count(c), c).toBeGreaterThanOrEqual(10);
    expect(count('debris')).toBeGreaterThanOrEqual(60);
    expect(count('structure')).toBeGreaterThanOrEqual(60);
    // De kliffen (rock_set2_09 tot 11): een flink aantal, en alle drie de vormen.
    const cliffs = file.props.filter((p) => /^rock_set2_(09|10|11)$/.test(p.asset));
    expect(cliffs.length).toBeGreaterThanOrEqual(40);
    for (const id of ['rock_set2_09', 'rock_set2_10', 'rock_set2_11'])
      expect(
        cliffs.some((p) => p.asset === id),
        id,
      ).toBe(true);
  });

  it('de catalogus komt overeen met het manifest: categorie en hoogte (echte schaal), geen Gobkit-props', () => {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      assets: Array<{
        id: string;
        kind: string;
        category?: string;
        bounds: { min: number[]; max: number[] };
      }>;
    };
    const entries = new Map(manifest.assets.map((a) => [a.id, a]));
    for (const id of PROP_ASSETS) {
      const e = entries.get(id);
      expect(e, `${id} in het manifest`).toBeDefined();
      expect(e!.kind).toBe('prop');
      expect(e!.category, id).toBe(PROP_INFO[id]!.category);
      const height = e!.bounds.max[1]! - e!.bounds.min[1]!;
      expect(
        Math.abs(height - PROP_INFO[id]!.heightM) / height,
        `${id} hoogte ${height}`,
      ).toBeLessThan(0.05);
      // De voetstraal past in de bounds (een rots- of grasvoet is nooit breder dan het model).
      const widest = Math.max(
        e!.bounds.max[0]! - e!.bounds.min[0]!,
        e!.bounds.max[2]! - e!.bounds.min[2]!,
      );
      expect(PROP_INFO[id]!.radiusM, `${id} straal`).toBeLessThanOrEqual(widest / 2 + 0.05);
    }
    for (const p of file.props) expect(PROP_INFO[p.asset], p.asset).toBeDefined();
    for (const old of [
      'treehigh001',
      'treemed001',
      'treelow001',
      'rock001',
      'bush001',
      'grass001',
      'reed001',
    ])
      expect(
        file.props.some((p) => p.asset === old),
        old,
      ).toBe(false);
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
    const key = (p: PropRecord): string => `${p.asset}|${p.x}|${p.y}|${p.yaw}|${p.scalePct}`;
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
    for (const asset of PROP_ASSETS)
      expect(file.props.filter((p) => p.asset === asset).length & 1).toBe(0);
  });

  it('het bos is gemengd (eiken en dennen, alle maten) en dicht, en niets staat in het water', () => {
    const g = generateRustbelt(nodeGenIo);
    const forest = g.forest!;
    const trees = byCategory(['tree-leafy', 'tree-bare']);
    const inForest = trees.filter((p) => forest[cellOf(p.y) * N + cellOf(p.x)] !== 0);
    expect(inForest.length / trees.length).toBeGreaterThan(0.6);
    let forestCells = 0;
    for (const v of forest) if (v !== 0) forestCells++;
    // Dichtheid in de bosrand: minstens één boom per 25 m2 (de bomen zijn 7 tot 13 m hoog met een brede kruin).
    expect(inForest.length * 25).toBeGreaterThan(forestCells);
    const oaks = inForest.filter((p) => p.asset.startsWith('tree_oak'));
    const pines = inForest.filter((p) => p.asset.startsWith('tree_pine'));
    expect(oaks.length).toBeGreaterThan(inForest.length * 0.2);
    expect(pines.length).toBeGreaterThan(inForest.length * 0.2);
    // Variatie in grootte: elke eik en den komt voor, de hoge (13 m en 12,9 m) en de lage (7 m en 6,5 m).
    for (const id of [
      'tree_oak_01',
      'tree_oak_02',
      'tree_oak_03',
      'tree_pine_01',
      'tree_pine_02',
      'tree_pine_03',
    ])
      expect(inForest.filter((p) => p.asset === id).length, id).toBeGreaterThan(20);
    // Bossen zijn gemengd, niet overal hetzelfde: per blok van 64 m verschilt het dennenaandeel.
    const share: number[] = [];
    for (let by = 0; by < 6; by++)
      for (let bx = 0; bx < 6; bx++) {
        const inBlock = inForest.filter(
          (p) => p.x >> 14 === bx && p.y >> 14 === by && /oak|pine/.test(p.asset),
        );
        if (inBlock.length > 40)
          share.push(inBlock.filter((p) => p.asset.includes('pine')).length / inBlock.length);
      }
    expect(Math.max(...share) - Math.min(...share)).toBeGreaterThan(0.2);
    for (const p of file.props)
      expect(water[cellOf(p.y) * N + cellOf(p.x)], `${p.asset} in het water`).toBe(0);
  });

  it('kale bomen staan vooral aan de bosrand en op droog (hoog) terrein, niet diep in het bos', () => {
    const g = generateRustbelt(nodeGenIo);
    const forest = g.forest!;
    const nearEdge = (p: PropRecord): boolean => {
      for (let dy = -3; dy <= 3; dy++)
        for (let dx = -3; dx <= 3; dx++) {
          const cx = cellOf(p.x) + dx;
          const cy = cellOf(p.y) + dy;
          if (cx < 0 || cy < 0 || cx >= N || cy >= N || forest[cy * N + cx] === 0) return true;
        }
      return false;
    };
    const high = (p: PropRecord): boolean => heights[cellOf(p.y) * N + cellOf(p.x)]! >= 5 * U;
    const bare = byCategory('tree-bare');
    const leafy = byCategory('tree-leafy');
    const dryOrEdge = (p: PropRecord): boolean => nearEdge(p) || high(p);
    const bareShare = bare.filter(dryOrEdge).length / bare.length;
    const leafyShare = leafy.filter(dryOrEdge).length / leafy.length;
    expect(bareShare).toBeGreaterThan(0.85);
    expect(bareShare).toBeGreaterThan(leafyShare + 0.1);
    // Van de bomen diep in het bos (meer dan 6 m van de rand, laag terrein) is het aandeel kaal klein.
    const deep = [...bare, ...leafy].filter((p) => !dryOrEdge(p));
    expect(
      deep.filter((p) => categoryOf(p.asset) === 'tree-bare').length / deep.length,
    ).toBeLessThan(0.1);
  });
});
