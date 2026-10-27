import { describe, expect, it } from 'vitest';
import {
  allConnected,
  generateRustbelt,
  loadMap,
  padClearings,
  siteClearings,
  propRadiusU,
  PROP_INFO,
  RUSTBELT_SPEC,
  scatterProps,
  type PropRecord,
} from '../src/index.js';
import { nodeGenIo } from '../src/gen/node.js';
import {
  assets,
  byCategory,
  CAMP_ASSETS,
  categoryOf,
  cellOf,
  corridor,
  def,
  diskCells,
  file,
  heights,
  keys,
  map,
  N,
  near,
  onPassable,
  U,
  WALLS,
  water,
  withoutProps,
} from './props.helpers.js';

// Part 2 of the 'rustbelt props' tests: grass, corridors, cliffs, rocks, kits, clearings and reproducibility.
describe('rustbelt props', () => {
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
