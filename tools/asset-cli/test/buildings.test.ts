import { join } from 'node:path';
import { getBounds } from '@gltf-transform/functions';
import { beforeAll, describe, expect, it } from 'vitest';
import { BUDGETS } from '../src/budgets.js';
import {
  buildBuildings,
  buildingLodTargets,
  checkBuildingDocument,
  generateBuilding,
  loadSourceHouse,
  validateBuildingDocument,
  type BuildingsResult,
  type SourceHouse,
} from '../src/buildings.js';
import { createIO } from '../src/lods.js';
import { manifestSchema } from '../src/manifest.js';
import { parseVariants, type HousePart, type VariantsConfig } from '../src/variants.js';
import { config, deepCopy, ids, srcDir } from './buildings.helpers.js';

let built: BuildingsResult;
beforeAll(async () => {
  built = await buildBuildings(config, srcDir, 'buildings/variants.json');
}, 240_000);

describe('budgetten voor kind building', () => {
  it('LOD0 tot LOD2 dalen en LOD0 van elke variant blijft binnen het plafond', () => {
    const [m0, m1, m2] = BUDGETS.buildingMaxTris;
    expect(m0).toBeGreaterThan(m1);
    expect(m1).toBeGreaterThan(m2);
    // Plafond is verhoogd naar 6000 voor photogrammetry-scans (dweller_building_storage, 2,75M driehoeken).
    // Bestaande variants hebben elk hun eigen lod0Triangles ≤ 2500 en blijven ongewijzigd.
    expect(m0).toBeLessThanOrEqual(6000);
    for (const [id, variant] of Object.entries(config.variants)) {
      expect(variant.lod0Triangles, id).toBeLessThanOrEqual(m0);
      const [t0, t1, t2] = buildingLodTargets(variant.lod0Triangles);
      expect(t0, id).toBeGreaterThanOrEqual(t1);
      expect(t1, id).toBeGreaterThanOrEqual(t2);
      expect(t1, id).toBeLessThanOrEqual(m1);
      expect(t2, id).toBeLessThanOrEqual(m2);
    }
  });

  it('de gebouwen in de uitvoer houden de budgetten per LOD en het hoofdgebouw zit rond 1500 tot 2500', () => {
    for (const entry of built.entries) {
      entry.lods.forEach((lod, level) => {
        expect(lod.triangles, `${entry.id} LOD${level}`).toBeGreaterThan(0);
        expect(lod.triangles, `${entry.id} LOD${level}`).toBeLessThanOrEqual(
          BUDGETS.buildingMaxTris[level]!,
        );
      });
      expect(entry.lods[0].triangles, entry.id).toBeGreaterThanOrEqual(entry.lods[1].triangles);
      expect(entry.lods[1].triangles, entry.id).toBeGreaterThanOrEqual(entry.lods[2].triangles);
    }
    const hq = built.entries.find((e) => e.id === 'dweller_building_hq')!;
    expect(hq.lods[0].triangles).toBeGreaterThanOrEqual(1500);
    expect(hq.lods[0].triangles).toBeLessThanOrEqual(2500);
  });
});

describe('gebouwen uit de generator', () => {
  it('bouwt alle acht zonder fouten', () => {
    expect(built.reports.map((r) => r.id).sort()).toEqual(ids);
    for (const report of built.reports) expect(report.errors, report.id).toEqual([]);
    expect(built.entries).toHaveLength(8);
  });

  it('staat binnen de footprint en vult hem grotendeels (geen grondplaat), midden bij de oorsprong, grond op y=0 (alle LODs)', async () => {
    const io = createIO();
    for (const id of ids) {
      const { w, h } = config.variants[id]!.footprint;
      for (const level of [0, 1, 2] as const) {
        const bytes = built.outputs.get(`${id}/lod${level}.glb`)!;
        const document = await io.readBinary(bytes);
        const { min, max } = getBounds(document.getRoot().listScenes()[0]!);
        const label = `${id} LOD${level}`;
        const fill = BUDGETS.buildingFootprintMinFill[level];
        const sx = max[0]! - min[0]!;
        const sz = max[2]! - min[2]!;
        expect(sx, `${label} breedte`).toBeLessThanOrEqual(w * 1.05);
        expect(sz, `${label} diepte`).toBeLessThanOrEqual(h * 1.05);
        expect(sx, `${label} breedte vulling`).toBeGreaterThanOrEqual(w * fill);
        expect(sz, `${label} diepte vulling`).toBeGreaterThanOrEqual(h * fill);
        expect(Math.abs((max[0]! + min[0]!) / 2), `${label} midden x`).toBeLessThanOrEqual(
          w * BUDGETS.buildingCentreTolerance,
        );
        expect(Math.abs((max[2]! + min[2]!) / 2), `${label} midden z`).toBeLessThanOrEqual(
          h * BUDGETS.buildingCentreTolerance,
        );
        expect(Math.abs(min[1]!), `${label} grond`).toBeLessThanOrEqual(0.01);
        expect(max[1]!, `${label} hoogte`).toBeGreaterThan(1);
      }
    }
  });

  it('geen grondplaat: geen onderdeel is een vlakke box die de footprint vult (die stak af tegen het terrein)', () => {
    for (const id of ids) {
      const { w, h } = config.variants[id]!.footprint;
      for (const part of config.variants[id]!.parts) {
        if (part.type !== 'box') continue;
        const [sx, sy, sz] = part.size;
        const flat = sy <= 0.1 && part.position[1] <= 0.01;
        expect(flat && sx >= w * 0.85 && sz >= h * 0.85, `${id}: grondplaat ${part.material}`).toBe(
          false,
        );
      }
    }
    expect(config.flatMaterials['dirt']).toBeUndefined();
  });

  it('manifest: kind building, bounds, drie LODs, footprint en team-materialen; schema accepteert het', () => {
    const manifest = manifestSchema.parse({ version: 1, assets: built.entries });
    for (const entry of manifest.assets) {
      expect(entry.kind).toBe('building');
      expect(entry.lods.map((l) => l.level)).toEqual([0, 1, 2]);
      expect(entry.footprint).toEqual(config.variants[entry.id]!.footprint);
      expect(entry.teamMaterials!.length).toBeGreaterThan(0);
      expect(entry.teamMaterials!.every((n) => /team/i.test(n))).toBe(true);
      expect(entry.boneCount).toBe(0);
      expect(entry.baked).toBeUndefined();
      const { w, h } = entry.footprint!;
      expect(entry.bounds.max[0] - entry.bounds.min[0]).toBeLessThanOrEqual(w * 1.05);
      expect(entry.bounds.max[0] - entry.bounds.min[0]).toBeGreaterThanOrEqual(w * 0.85);
      expect(entry.bounds.max[2] - entry.bounds.min[2]).toBeLessThanOrEqual(h * 1.05);
      expect(entry.bounds.max[2] - entry.bounds.min[2]).toBeGreaterThanOrEqual(h * 0.85);
      expect(entry.bounds.min[1]).toBeCloseTo(0, 2);
    }
  });

  it('elke LOD heeft een team-materiaal, geen PBR-extensies en geen andere textures dan diffuse', async () => {
    const io = createIO();
    for (const id of ids) {
      for (const level of [0, 1, 2] as const) {
        const document = await io.readBinary(built.outputs.get(`${id}/lod${level}.glb`)!);
        const root = document.getRoot();
        expect(
          root.listMaterials().some((m) => /team/i.test(m.getName())),
          `${id} LOD${level} team`,
        ).toBe(true);
        const used = root.listExtensionsUsed().map((e) => e.extensionName);
        expect(
          used.filter((n) => n.startsWith('KHR_materials_')),
          `${id} extensies`,
        ).toEqual([]);
        expect(validateBuildingDocument(document, level), `${id} LOD${level}`).toEqual([]);
        for (const texture of root.listTextures()) {
          const [tw, th] = texture.getSize()!;
          expect(Math.max(tw, th), `${id} textuurmaat`).toBeLessThanOrEqual(
            BUDGETS.buildingTextureSizes[level]!,
          );
        }
      }
    }
  });

  it('textures op 1024, 512 en 256 per LOD (de bron-textures van 1024 blijven op LOD0 op 1024)', async () => {
    expect(BUDGETS.buildingTextureSizes).toEqual([1024, 512, 256]);
    const io = createIO();
    const largest = async (level: number): Promise<number> => {
      const document = await io.readBinary(
        built.outputs.get(`dweller_building_housing/lod${level}.glb`)!,
      );
      return Math.max(
        ...document
          .getRoot()
          .listTextures()
          .map((t) => Math.max(...t.getSize()!)),
      );
    };
    expect(await largest(0)).toBe(1024);
    expect(await largest(1)).toBe(512);
    expect(await largest(2)).toBe(256);
  });

  it('is deterministisch: twee runs geven dezelfde bytes', async () => {
    const again = await buildBuildings(config, srcDir, 'buildings/variants.json');
    expect([...again.outputs.keys()].sort()).toEqual([...built.outputs.keys()].sort());
    for (const [path, bytes] of built.outputs)
      expect(Buffer.from(again.outputs.get(path)!).equals(Buffer.from(bytes)), path).toBe(true);
  }, 240_000);
});

describe('controles op gebouw-documenten', () => {
  let source: SourceHouse;
  const house = config.sources['house']!;
  beforeAll(async () => {
    source = await loadSourceHouse(join(srcDir, house.file), {
      metersPerUnit: house.metersPerUnit,
      keep: house.keep,
    });
  });

  it('wijst een verkeerde footprint, een zwevend gebouw en een ontbrekend team-materiaal af', async () => {
    const id = 'dweller_building_housing';
    const variant = config.variants[id]!;
    // Het huis staat op wereldschaal (12,1 x 18,6 m); een footprint van 3 x 3 past er niet omheen.
    const generated = await generateBuilding(config, id, 0, new Map([['house', source]]));
    const errors = checkBuildingDocument(generated.document, { w: 3, h: 3 }, 0);
    expect(errors.join('\n')).toMatch(/breedte \(x\) is 12\.\d+ m, footprint 3 m/);
    expect(errors.join('\n')).toMatch(/diepte \(z\) is 18\.\d+ m, footprint 3 m/);
    expect(checkBuildingDocument(generated.document, variant.footprint, 0)).toEqual([]);

    const floating = deepCopy(config);
    for (const part of floating.variants[id]!.parts)
      part.position = [part.position[0], 0.5, part.position[2]];
    const lifted = await generateBuilding(floating, id, 0, new Map([['house', source]]));
    expect(checkBuildingDocument(lifted.document, variant.footprint, 0).join('\n')).toMatch(
      /de grond staat op y=0\.5/,
    );

    const plain = await generateBuilding(config, id, 0, new Map([['house', source]]));
    plain.document
      .getRoot()
      .listMaterials()
      .forEach((m) => m.setName(m.getName().replace(/team/i, 'banier')));
    expect(validateBuildingDocument(plain.document, 0).join('\n')).toMatch(/geen team-materiaal/);
  });

  /** Het eerste volledige huisonderdeel van `id` als enige onderdeel (om de bounds van het huis te meten). */
  const houseOnly = (id: string, patch: Partial<HousePart> = {}): VariantsConfig => {
    const copy = deepCopy(config);
    const part = copy.variants[id]!.parts.find((p) => p.type === 'house' && p.maxLod !== 0)!;
    copy.variants[id]!.parts = [{ ...part, ...patch, select: undefined } as HousePart];
    delete copy.variants[id]!.parts[0]!.maxLod;
    return copy;
  };
  const sizeOf = async (cfg: VariantsConfig, id: string, level: 0 | 1 | 2 = 0) => {
    const doc = (await generateBuilding(cfg, id, level, new Map([['house', source]]))).document;
    const { min, max } = getBounds(doc.getRoot().listScenes()[0]!);
    return [max[0]! - min[0]!, max[1]! - min[1]!, max[2]! - min[2]!] as const;
  };

  it('één wereldschaal: elk huis is het bronhuis maal metersPerUnit, ook gedraaid', async () => {
    // Het bronhuis (zonder de losse plank en het touw buiten `keep`) is 494,8 x 407,9 x 759,0 eenheden (x, y, z).
    const natural = [494.84, 407.88, 758.99] as const;
    const s = house.metersPerUnit;
    const id = 'dweller_building_housing';
    const [x, y, z] = await sizeOf(houseOnly(id, { position: [0, 0, 0] }), id);
    expect(x).toBeCloseTo(natural[0] * s, 1);
    expect(y).toBeCloseTo(natural[1] * s, 1);
    expect(z).toBeCloseTo(natural[2] * s, 1);
    const [rx, ry, rz] = await sizeOf(houseOnly(id, { rotation: [0, 90, 0] }), id);
    expect(rx).toBeCloseTo(natural[2] * s, 1);
    expect(ry).toBeCloseTo(natural[1] * s, 1);
    expect(rz).toBeCloseTo(natural[0] * s, 1);
  });

  it('geen eigen maat per variant: een huisonderdeel met size, fit of heightFactor wordt geweigerd', () => {
    for (const field of [{ size: [3, 3] }, { fit: 'contain' }, { heightFactor: 1 }]) {
      const bad = deepCopy(config) as unknown as {
        variants: Record<string, { parts: Record<string, unknown>[] }>;
      };
      const part = bad.variants['dweller_building_housing']!.parts.find((p) => p.type === 'house')!;
      Object.assign(part, field);
      expect(() => parseVariants(bad)).toThrow(/Unrecognized key/);
    }
  });

  it('de deur is minstens 2,1 m hoog, gemeten in de geometrie van de bron', () => {
    const door = house.door!;
    expect(door).toBeDefined();
    const height = (door.lintelY - door.floorY) * house.metersPerUnit;
    expect(height).toBeGreaterThanOrEqual(2.1);
    expect(height).toBeLessThan(2.4);
    // Het kozijn (frame_wood) rond `door.at`: de onderkant van de bovendorpel ligt op lintelY.
    const frame = source.meshes.find((m) => m.material === 'Material.007')!.mesh;
    const lintels = new Set<number>();
    for (let i = 0; i < frame.positions.length; i += 3) {
      const [x, y, z] = [frame.positions[i]!, frame.positions[i + 1]!, frame.positions[i + 2]!];
      if (Math.abs(x - door.at[0]) < 8 && Math.abs(z - door.at[1]) < 25 && y > door.floorY + 50)
        lintels.add(Math.round(y * 10) / 10);
    }
    expect([...lintels].some((y) => Math.abs(y - door.lintelY) < 0.5)).toBe(true);
    // De vloer: een groot horizontaal vlak van de muren (wall_paint) op floorY, en de deuropening loopt erboven door.
    const walls = source.meshes.find((m) => m.material === 'Material.001')!.mesh;
    let floorArea = 0;
    for (let t = 0; t < walls.indices.length; t += 3) {
      const ys = [0, 1, 2].map((k) => walls.positions[walls.indices[t + k]! * 3 + 1]!);
      if (ys.every((y) => Math.abs(y - door.floorY) < 0.5)) floorArea++;
    }
    expect(floorArea).toBeGreaterThan(10);
  });

  it('woning en hoofdgebouw: het huis met de deur zit erin en de nok is minstens 1,9 keer een poppetje van 1,8 m', async () => {
    const io = createIO();
    const door = house.door!;
    const top = source.meshes.flatMap((m) => [...m.mesh.positions].filter((_, i) => i % 3 === 1));
    const [minY, maxY] = [Math.min(...top), Math.max(...top)];
    for (const id of ['dweller_building_housing', 'dweller_building_hq']) {
      // een huisonderdeel op LOD0 met het kozijn en de muren tot boven de bovendorpel
      const withDoor = config.variants[id]!.parts.some(
        (p) =>
          p.type === 'house' &&
          (p.minLod ?? 0) === 0 &&
          (!p.select?.materials ||
            (p.select.materials.includes('Material.007') &&
              p.select.materials.includes('Material.001'))) &&
          (p.select?.yFrom ?? 0) * (maxY - minY) + minY <= door.floorY &&
          (p.select?.yTo ?? 1) * (maxY - minY) + minY >= door.lintelY,
      );
      expect(withDoor, id).toBe(true);
      const document = await io.readBinary(built.outputs.get(`${id}/lod0.glb`)!);
      const { max } = getBounds(document.getRoot().listScenes()[0]!);
      expect(max[1]!, `${id} nokhoogte`).toBeGreaterThanOrEqual(1.9 * 1.8);
    }
  });

  it('een dakdeel staat precies op zijn plek in het huis (zelfde schaal en plaats)', async () => {
    const id = 'dweller_building_housing';
    const parts = config.variants[id]!.parts.filter((p): p is HousePart => p.type === 'house');
    const whole = parts.find((p) => !p.select)!;
    const roof = parts.find((p) => p.select?.materials?.includes('Material.004'))!;
    const only = (part: HousePart): VariantsConfig => {
      const copy = deepCopy(config);
      copy.variants[id]!.parts = [{ ...part, maxLod: undefined, minLod: undefined } as HousePart];
      return copy;
    };
    const full = await generateBuilding(only(whole), id, 0, new Map([['house', source]]));
    const cap = await generateBuilding(only(roof), id, 0, new Map([['house', source]]));
    const a = getBounds(full.document.getRoot().listScenes()[0]!);
    const b = getBounds(cap.document.getRoot().listScenes()[0]!);
    // De dakvlakken liggen binnen de bounds van het hele huis, aan de bovenkant, niet naar het midden geschaald.
    expect(b.max[0]!).toBeLessThanOrEqual(a.max[0]! + 0.05);
    expect(b.min[0]!).toBeGreaterThanOrEqual(a.min[0]! - 0.05);
    expect(b.max[2]!).toBeLessThanOrEqual(a.max[2]! + 0.05);
    expect(b.min[2]!).toBeGreaterThanOrEqual(a.min[2]! - 0.05);
    expect(b.max[1]!).toBeLessThanOrEqual(a.max[1]! + 0.05);
    expect(b.max[1]!).toBeGreaterThan(a.max[1]! * 0.85);
    expect(b.min[1]!).toBeGreaterThan(a.max[1]! * 0.15);
  });
});
