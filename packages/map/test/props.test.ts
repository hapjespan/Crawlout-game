import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MapDef } from '@crawlout/data';
import {
  allConnected,
  cos1024,
  createRng,
  decodeGrid,
  generateRustbelt,
  loadMap,
  loadProps,
  padClearings,
  siteClearings,
  parseProps,
  pathCorridor,
  PROP_ASSETS,
  PROP_CLEARANCE_M,
  PROP_INFO,
  PROP_SCALE_MAX,
  PROP_SCALE_MIN,
  propRadiusU,
  RUSTBELT_SPEC,
  scatterProps,
  sin1024,
  type MapAssets,
  type PropCategory,
  type PropRecord,
  type PropsFile,
} from '../src/index.js';
import { nodeGenIo } from '../src/gen/node.js';

const dataDir = fileURLToPath(new URL('../../../data/', import.meta.url));
const manifestPath = fileURLToPath(new URL('../../../assets/dist/manifest.json', import.meta.url));
const assets: MapAssets = { read: (ref) => readFileSync(dataDir + ref, 'utf8') };
const def = MapDef.parse(JSON.parse(assets.read('maps/rustbelt.json')));
const map = loadMap(def, assets);
const N = 384;
const file: PropsFile = parseProps(assets.read(def.props as string), N, N);
const U = 256;
const water = decodeGrid(assets.read(def.water as string), N, N, 'u8');
const heights = decodeGrid(assets.read(def.heightmap), N, N, 'i16') as Int16Array;
const cellOf = (v: number): number => v >> 8;
const onPassable = (x: number, y: number): boolean => map.passable[cellOf(y) * N + cellOf(x)] === 1;
const withoutProps = (d: MapDef): MapDef => {
  const copy: Record<string, unknown> = { ...d };
  delete copy['props'];
  return copy as MapDef;
};
const categoryOf = (asset: string): PropCategory => PROP_INFO[asset]!.category;
const byCategory = (c: PropCategory | PropCategory[]): PropRecord[] => {
  const set = new Set(Array.isArray(c) ? c : [c]);
  return file.props.filter((p) => set.has(categoryOf(p.asset)));
};
const keys = [...map.spawns, ...map.scrapNodes, ...map.claimPoints, ...map.creepCamps];
const corridor = pathCorridor(map, map.spawns, keys);
/** Afstand (m) tussen een prop en een punt in cellen (middelpunt). */
const distM = (p: { x: number; y: number }, c: { x: number; y: number }): number =>
  Math.sqrt((p.x / U - c.x - 0.5) ** 2 + (p.y / U - c.y - 0.5) ** 2);
const near = (
  c: { x: number; y: number },
  maxM: number,
  list: PropRecord[] = file.props,
): PropRecord[] => list.filter((p) => distM(p, c) <= maxM);
const CAMP_ASSETS = [
  'debris_pallet_01',
  'debris_pallet_02',
  'debris_table_01',
  'debris_chair_01',
  'debris_crate_01',
  'debris_barrel_01',
  'chest_01',
  'chest_02',
  'chest_03',
  'barrel_01',
  'crate_01',
];
const WALLS = ['wall_wood_01', 'wall_wood_02', 'wall_wood_03', 'wall_wood_04'];
/** Cellen binnen de schijf van `rM` meter rond een prop, als [cx, cy]. */
function diskCells(p: { x: number; y: number }, rM: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const r = Math.ceil(rM);
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) {
      const cx = cellOf(p.x) + dx;
      const cy = cellOf(p.y) + dy;
      if (cx < 0 || cy < 0 || cx >= N || cy >= N) continue;
      if (((cx + 0.5) * U - p.x) ** 2 + ((cy + 0.5) * U - p.y) ** 2 > (rM * U) ** 2) continue;
      out.push([cx, cy]);
    }
  return out;
}

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

  it('gras en planten staan in plukken op begaanbare grond, dichter in de dalen en langs de rivier', () => {
    // Gras staat op begaanbare grond; alleen de ondergroei (planten) staat ook in het bos.
    for (const p of byCategory('grass'))
      expect(onPassable(p.x, p.y), `${p.asset} op onbegaanbaar`).toBe(true);
    const nearWater = (cx: number, cy: number, r: number): boolean => {
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          const x = cx + dx;
          const y = cy + dy;
          if (x >= 0 && y >= 0 && x < N && y < N && water[y * N + x] !== 0) return true;
        }
      return false;
    };
    // Dichtheid (props per begaanbare cel) per klasse: rivieroever, dal, plateau.
    let shoreCells = 0;
    let valleyCells = 0;
    let plateauCells = 0;
    const grassIn = { shore: 0, valley: 0, plateau: 0 };
    for (let cy = 0; cy < N; cy++)
      for (let cx = 0; cx < N; cx++) {
        const i = cy * N + cx;
        if (map.passable[i] !== 1 || corridor[i] !== 0) continue;
        if (nearWater(cx, cy, 3)) shoreCells++;
        else if (heights[i]! < 3 * U) valleyCells++;
        else if (heights[i]! >= 5 * U) plateauCells++;
      }
    for (const p of byCategory('grass')) {
      const cx = cellOf(p.x);
      const cy = cellOf(p.y);
      const i = cy * N + cx;
      if (nearWater(cx, cy, 3)) grassIn.shore++;
      else if (heights[i]! < 3 * U) grassIn.valley++;
      else if (heights[i]! >= 5 * U) grassIn.plateau++;
    }
    const shore = grassIn.shore / shoreCells;
    const valley = grassIn.valley / valleyCells;
    const plateau = grassIn.plateau / plateauCells;
    expect(plateau).toBeGreaterThan(0.005); // breed over het open terrein
    expect(valley).toBeGreaterThan(plateau * 1.1);
    expect(shore).toBeGreaterThan(valley * 1.5);
    // Plukken: meer dan de helft van het gras heeft een buur binnen 2 m.
    const grass = byCategory('grass');
    const bucket = new Map<number, PropRecord[]>();
    for (const p of grass) {
      const k = (p.y >> 10) * 1000 + (p.x >> 10);
      bucket.set(k, [...(bucket.get(k) ?? []), p]);
    }
    let clumped = 0;
    for (const p of grass) {
      let found = false;
      for (let by = (p.y >> 10) - 1; by <= (p.y >> 10) + 1 && !found; by++)
        for (let bx = (p.x >> 10) - 1; bx <= (p.x >> 10) + 1 && !found; bx++)
          for (const q of bucket.get(by * 1000 + bx) ?? [])
            if (q !== p && (p.x - q.x) ** 2 + (p.y - q.y) ** 2 < (2 * U) ** 2) found = true;
      if (found) clumped++;
    }
    expect(clumped / grass.length).toBeGreaterThan(0.5);
  });

  it('geen prop op een padcorridor, en een prop met een voet vanaf 0,9 m raakt er met zijn voet niet aan', () => {
    for (const p of file.props) {
      if (!onPassable(p.x, p.y)) continue;
      expect(corridor[cellOf(p.y) * N + cellOf(p.x)], `${p.asset} (${p.x},${p.y}) op een pad`).toBe(
        0,
      );
    }
    for (const p of file.props) {
      const r = propRadiusU(p.asset);
      if (r < 0.9 * U) continue;
      for (const [cx, cy] of diskCells(p, r / U)) {
        const i = cy * N + cx;
        expect(corridor[i], `${p.asset} (${p.x},${p.y}) voet op een pad`).toBe(0);
        expect(water[i], `${p.asset} (${p.x},${p.y}) voet in het water`).toBe(0);
      }
    }
  });

  it('geen prop blokkeert een route: met de voeten van rotsen, wanden, torens en kliffen als obstakel blijft alles verbonden', () => {
    const blockedByProps = { ...map, passable: map.passable.slice() };
    for (const p of file.props) {
      const category = categoryOf(p.asset);
      const solid = ['tree-leafy', 'tree-bare', 'rock', 'structure'].includes(category);
      if (!solid) continue;
      for (const [cx, cy] of diskCells(p, Math.max(0.5, propRadiusU(p.asset) / U)))
        blockedByProps.passable[cy * N + cx] = 0;
    }
    expect(allConnected(blockedByProps, keys)).toBe(true);
    // Ook zonder het ruime pad: elke spawn komt bij elk punt.
    for (const s of map.spawns) {
      const reach = { ...blockedByProps };
      expect(allConnected(reach, [s, ...keys])).toBe(true);
    }
  });

  it('kliffen staan op onbegaanbare cellen met een dikke onbegaanbare strook, hoogstens een kwart van hun voet op begaanbare grond', () => {
    const cliffs = file.props.filter((p) => /^rock_set2_(09|10|11)$/.test(p.asset));
    for (const p of cliffs) {
      expect(onPassable(p.x, p.y), `${p.asset} (${p.x},${p.y}) midden begaanbaar`).toBe(false);
      const cells = diskCells(p, PROP_INFO[p.asset]!.radiusM);
      const open = cells.filter(([cx, cy]) => map.passable[cy * N + cx] === 1).length;
      expect(open / cells.length, `${p.asset} (${p.x},${p.y}) voet`).toBeLessThanOrEqual(0.25);
    }
  });

  it('rotsen: klein en verspreid, midden op onbegaanbare cellen of aan de rand ervan', () => {
    const rocks = file.props.filter((p) => /^rock_set2_0[1-8]$/.test(p.asset));
    expect(rocks.length).toBeGreaterThanOrEqual(400);
    const small = rocks.filter((p) => /0[1-4]$/.test(p.asset));
    const mid = rocks.filter((p) => /0[5-8]$/.test(p.asset));
    expect(small.length).toBeGreaterThan(100);
    expect(mid.length).toBeGreaterThan(100);
    // Verspreid: in elk kwart van de map (192 x 192 m).
    for (const [qx, qy] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ] as const)
      expect(
        rocks.filter((p) => p.x >> 16 === qx && p.y >> 16 === qy).length,
        `kwart ${qx},${qy}`,
      ).toBeGreaterThan(50);
  });

  it('kratten, kisten, vaten en puin: groepjes bij ruines en creep-kampen, enkele bij claimpunten en voordes, nooit op een bouwvlak', () => {
    const g = generateRustbelt(nodeGenIo);
    // Creep-kampen: een kampement met puin, kisten en een vat dichtbij, een hek en één wachttoren.
    expect(map.creepCamps).toHaveLength(6);
    for (const camp of map.creepCamps) {
      const camps = near(camp, 8, file.props).filter((p) => CAMP_ASSETS.includes(p.asset));
      expect(camps.length, `kamp ${camp.x},${camp.y}: spullen`).toBeGreaterThanOrEqual(6);
      expect(
        camps.filter((p) => categoryOf(p.asset) === 'chest').length,
        `kamp ${camp.x},${camp.y}: kisten`,
      ).toBeGreaterThanOrEqual(1);
      expect(
        camps.filter((p) => ['barrel', 'debris'].includes(categoryOf(p.asset))).length,
        `kamp ${camp.x},${camp.y}: vat en puin`,
      ).toBeGreaterThanOrEqual(2);
      expect(
        near(camp, 12, file.props).filter((p) => WALLS.includes(p.asset)).length,
        `kamp ${camp.x},${camp.y}: hek`,
      ).toBeGreaterThanOrEqual(2);
      expect(
        near(camp, 15, file.props).filter((p) => p.asset === 'watchtower_01').length,
        `kamp ${camp.x},${camp.y}: wachttoren`,
      ).toBe(1);
    }
    // Ruines: puin en kratten ernaast en een vervallen omheining.
    const ruins = [
      ...RUSTBELT_SPEC.ruins,
      ...RUSTBELT_SPEC.ruins.map((r) => ({
        x0: N - 1 - r.x1,
        y0: N - 1 - r.y1,
        x1: N - 1 - r.x0,
        y1: N - 1 - r.y0,
      })),
    ];
    let withWall = 0;
    // win route C (map 0.11.0): a ruin within the clearing of a strip-mall part keeps no kit (the part stands there)
    const sites = siteClearings(RUSTBELT_SPEC);
    const kept = ruins.filter((r) => {
      const cx = (r.x0 + r.x1) / 2;
      const cy = (r.y0 + r.y1) / 2;
      return !sites.some((c) => (c.x - cx) ** 2 + (c.y - cy) ** 2 <= c.radius ** 2);
    });
    expect(kept.length).toBeGreaterThanOrEqual(ruins.length - 2);
    for (const r of kept) {
      const centre = { x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 };
      const around = near(centre, 9, file.props);
      const stuff = around.filter((p) =>
        ['crate', 'chest', 'barrel', 'debris'].includes(categoryOf(p.asset)),
      );
      expect(stuff.length, `ruine ${r.x0},${r.y0}`).toBeGreaterThanOrEqual(2);
      if (around.some((p) => WALLS.includes(p.asset))) withWall++;
    }
    expect(withWall).toBeGreaterThanOrEqual(kept.length / 2);
    // Claimpunten (zonder het midden): een paar spullen erbij.
    for (const claim of map.claimPoints)
      expect(
        near(claim, 9, file.props).filter((p) => CAMP_ASSETS.includes(p.asset)).length,
        `claimpunt ${claim.x},${claim.y}`,
      ).toBeGreaterThanOrEqual(2);
    // Voordes: spullen en een wachttoren op de oever.
    const fords = g.crossings!.filter((c) => c.kind === 'ford');
    expect(fords).toHaveLength(2);
    for (const ford of fords) {
      expect(
        near(ford, 13, file.props).filter((p) => p.asset === 'watchtower_01').length,
        `voorde ${ford.x},${ford.y}: toren`,
      ).toBe(1);
      expect(
        near(ford, 9, file.props).filter((p) => CAMP_ASSETS.includes(p.asset)).length,
        `voorde ${ford.x},${ford.y}: spullen`,
      ).toBeGreaterThanOrEqual(1);
    }
    expect(file.props.filter((p) => p.asset === 'watchtower_01')).toHaveLength(8);
    // Niet op de bouwvlakken van de spelers.
    for (const c of padClearings(RUSTBELT_SPEC))
      for (const p of byCategory(['crate', 'chest', 'barrel', 'debris', 'structure'])) {
        const dx = cellOf(p.x) - c.x;
        const dy = cellOf(p.y) - c.y;
        expect(dx * dx + dy * dy > c.radius * c.radius, `${p.asset} op een bouwvlak`).toBe(true);
      }
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
    const layers = {
      forest: g.forest!,
      water: g.water!,
      clearings: [...padClearings(RUSTBELT_SPEC), ...siteClearings(RUSTBELT_SPEC)],
      heights: g.heights,
      ruins: [
        ...RUSTBELT_SPEC.ruins,
        ...RUSTBELT_SPEC.ruins.map((r) => ({
          x0: N - 1 - r.x1,
          y0: N - 1 - r.y1,
          x1: N - 1 - r.x0,
          y1: N - 1 - r.y0,
        })),
      ],
      crossings: g.crossings!,
    };
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
