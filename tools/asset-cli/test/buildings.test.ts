import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getBounds } from '@gltf-transform/functions';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BUDGETS } from '../src/budgets.js';
import { buildAssets } from '../src/build.js';
import {
  buildBuildings,
  buildingLodTargets,
  checkBuildingDocument,
  generateBuilding,
  loadSourceHouse,
  loadVariantsConfig,
  validateBuildingDocument,
  type BuildingsResult,
  type SourceHouse,
} from '../src/buildings.js';
import {
  largestComponents,
  makeBox,
  makeCylinder,
  makeTransform,
  simplifyMesh,
  transformMesh,
  triangleCount,
} from '../src/geometry.js';
import { createIO } from '../src/lods.js';
import { assetEntrySchema, manifestSchema } from '../src/manifest.js';
import { parseVariants, type HousePart, type VariantsConfig } from '../src/variants.js';

const srcDir = fileURLToPath(new URL('../../../assets/src/', import.meta.url));
const variantsPath = join(srcDir, 'buildings', 'variants.json');
const buildingsJson = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../data/buildings.json', import.meta.url)), 'utf8'),
) as { id: string; footprint: { w: number; h: number }; visuals: { mesh: string } }[];

const config = loadVariantsConfig(variantsPath);
const ids = Object.keys(config.variants).sort();

let built: BuildingsResult;
beforeAll(async () => {
  built = await buildBuildings(config, srcDir, 'buildings/variants.json');
}, 240_000);

function deepCopy(value: VariantsConfig): VariantsConfig {
  return JSON.parse(JSON.stringify(value)) as VariantsConfig;
}

describe('variants.json', () => {
  it('valideert en dekt alle acht Dweller-gebouwen uit data/buildings.json', () => {
    const dwellers = buildingsJson.filter((b) => b.visuals.mesh.startsWith('dweller_building_'));
    expect(dwellers).toHaveLength(8);
    expect(ids).toEqual(dwellers.map((b) => b.visuals.mesh).sort());
    for (const b of dwellers)
      expect(config.variants[b.visuals.mesh]?.footprint, b.visuals.mesh).toEqual(b.footprint);
  });

  it('verwijst alleen naar bestaande bronnen, bronmaterialen en effen materialen', () => {
    // parseVariants controleert de verwijzingen; een kapotte verwijzing gooit een fout met het pad.
    expect(() => parseVariants(JSON.parse(readFileSync(variantsPath, 'utf8')))).not.toThrow();
  });

  it('weigert een onbekende bron, een onbekend materiaal en een ontbrekend team-materiaal', () => {
    const base = deepCopy(config);
    const first = Object.keys(base.variants)[0]!;
    const bad = deepCopy(base);
    const house = bad.variants[first]!.parts.find((p) => p.type === 'house')!;
    if (house.type === 'house') house.source = 'bestaat_niet';
    expect(() => parseVariants(bad)).toThrow(/onbekende bron "bestaat_niet"/);

    const noTeam = deepCopy(base);
    noTeam.variants[first]!.parts = noTeam.variants[first]!.parts.filter(
      (p) => !('material' in p && /team/i.test(p.material)),
    );
    expect(() => parseVariants(noTeam)).toThrow(/geen team-materiaal/);

    const tint = deepCopy(base);
    tint.variants[first]!.tints = { onbekend: '#ffffff' };
    expect(() => parseVariants(tint)).toThrow(/onbekend uitvoermateriaal "onbekend"/);

    const color = deepCopy(base);
    color.variants[first]!.tints = { roof: 'rood' };
    expect(() => parseVariants(color)).toThrow(/#rrggbb/);
  });
});

describe('budgetten voor kind building', () => {
  it('LOD0 tot LOD2 dalen en LOD0 van elke variant blijft binnen het plafond', () => {
    const [m0, m1, m2] = BUDGETS.buildingMaxTris;
    expect(m0).toBeGreaterThan(m1);
    expect(m1).toBeGreaterThan(m2);
    expect(m0).toBeLessThanOrEqual(2500);
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

  it('vult de footprint in x en z binnen 5 procent, midden op de oorsprong, grond op y=0 (alle LODs)', async () => {
    const io = createIO();
    for (const id of ids) {
      const { w, h } = config.variants[id]!.footprint;
      for (const level of [0, 1, 2]) {
        const bytes = built.outputs.get(`${id}/lod${level}.glb`)!;
        const document = await io.readBinary(bytes);
        const { min, max } = getBounds(document.getRoot().listScenes()[0]!);
        const label = `${id} LOD${level}`;
        expect(Math.abs(max[0]! - min[0]! - w) / w, `${label} breedte`).toBeLessThanOrEqual(0.05);
        expect(Math.abs(max[2]! - min[2]! - h) / h, `${label} diepte`).toBeLessThanOrEqual(0.05);
        expect(Math.abs((max[0]! + min[0]!) / 2), `${label} midden x`).toBeLessThanOrEqual(
          w * 0.05,
        );
        expect(Math.abs((max[2]! + min[2]!) / 2), `${label} midden z`).toBeLessThanOrEqual(
          h * 0.05,
        );
        expect(Math.abs(min[1]!), `${label} grond`).toBeLessThanOrEqual(0.01);
        expect(max[1]!, `${label} hoogte`).toBeGreaterThan(1);
      }
    }
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
      expect(entry.bounds.max[0] - entry.bounds.min[0]).toBeCloseTo(w, 0);
      expect(entry.bounds.max[2] - entry.bounds.min[2]).toBeCloseTo(h, 0);
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
  beforeAll(async () => {
    source = await loadSourceHouse(join(srcDir, 'buildings', 'base_house.glb'));
  });

  it('wijst een verkeerde footprint, een zwevend gebouw en een ontbrekend team-materiaal af', async () => {
    const wrong = deepCopy(config);
    const id = 'dweller_building_housing';
    const variant = wrong.variants[id]!;
    // Uniform (standaard): het huis past in 3 x 3 m en is in de diepte 3 m, de breedte volgt uit de verhouding.
    for (const part of variant.parts) if (part.type === 'house') part.size = [3, 3];
    const generated = await generateBuilding(wrong, id, 0, new Map([['house', source]]));
    const errors = checkBuildingDocument(generated.document, variant.footprint, 0);
    expect(errors.join('\n')).toMatch(/diepte \(z\) is 3\.\d+ m, footprint 2 m/);
    // Bewust uitgerekt ('stretch') vult beide assen.
    for (const part of variant.parts) if (part.type === 'house') part.fit = 'stretch';
    const stretched = await generateBuilding(wrong, id, 0, new Map([['house', source]]));
    const stretchErrors = checkBuildingDocument(stretched.document, variant.footprint, 0);
    expect(stretchErrors.join('\n')).toMatch(/breedte \(x\) is 3\.\d+ m, footprint 2 m/);
    expect(stretchErrors.join('\n')).toMatch(/diepte \(z\) is 3\.\d+ m, footprint 2 m/);

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

  /** Het eerste huisonderdeel van `id` als enige onderdeel (alleen om de bounds van het huis te meten). */
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

  it('hoogtefactor schaalt alleen de hoogte', async () => {
    const id = 'dweller_building_housing';
    const [bx, by, bz] = await sizeOf(houseOnly(id, { heightFactor: 1 }), id);
    const [tx, ty, tz] = await sizeOf(houseOnly(id, { heightFactor: 2 }), id);
    expect(tx).toBeCloseTo(bx, 2);
    expect(tz).toBeCloseTo(bz, 2);
    expect(ty).toBeCloseTo(by * 2, 1);
  });

  it('het huis wordt uniform geschaald: dezelfde verhoudingen als de bron, ook gedraaid', async () => {
    // Het bronhuis is 525,8 x 407,9 x 759,0 (x, y, z). Een uniforme schaal houdt die verhouding, na een kwartslag
    // staan x en z omgewisseld.
    const natural = [525.776, 407.878, 758.989] as const;
    const id = 'dweller_building_housing';
    const [x, y, z] = await sizeOf(houseOnly(id, { size: [4, 4], heightFactor: 1 }), id);
    expect(z).toBeCloseTo(4, 1); // de diepte is de lange as en vult het vak
    expect(x / z).toBeCloseTo(natural[0] / natural[2], 2);
    expect(y / z).toBeCloseTo(natural[1] / natural[2], 2);
    const [rx, ry, rz] = await sizeOf(
      houseOnly(id, { size: [4, 4], heightFactor: 1, rotation: [0, 90, 0] }),
      id,
    );
    expect(rx).toBeCloseTo(4, 1);
    expect(rz / rx).toBeCloseTo(natural[0] / natural[2], 2);
    expect(ry / rx).toBeCloseTo(natural[1] / natural[2], 2);
  });

  it('geen variant rekt het huis uit: alle huisonderdelen zijn uniform en heightFactor 1 of een bewuste keuze', () => {
    for (const [id, variant] of Object.entries(config.variants))
      for (const part of variant.parts)
        if (part.type === 'house') {
          expect(part.fit ?? 'contain', `${id}: fit`).not.toBe('stretch');
          expect(part.heightFactor, `${id}: heightFactor`).toBe(1);
        }
  });

  it('een dakdeel met fit house staat precies op zijn plek in het huis (zelfde schaal en plaats)', async () => {
    const id = 'dweller_building_hq';
    const parts = config.variants[id]!.parts.filter((p): p is HousePart => p.type === 'house');
    const house = parts.find((p) => !p.select)!;
    const roof = parts.find(
      (p) => p.select && p.size[0] === house.size[0] && p.position[2] === house.position[2],
    )!;
    expect(roof.fit).toBe('house');
    const only = (part: HousePart): VariantsConfig => {
      const copy = deepCopy(config);
      copy.variants[id]!.parts = [{ ...part, maxLod: undefined, minLod: undefined } as HousePart];
      return copy;
    };
    const full = await generateBuilding(only(house), id, 0, new Map([['house', source]]));
    const cap = await generateBuilding(only(roof), id, 0, new Map([['house', source]]));
    const a = getBounds(full.document.getRoot().listScenes()[0]!);
    const b = getBounds(cap.document.getRoot().listScenes()[0]!);
    // De dakvlakken liggen binnen de bounds van het hele huis, aan de bovenkant, niet naar het midden geschaald.
    expect(b.max[0]!).toBeLessThanOrEqual(a.max[0]! + 0.05);
    expect(b.min[0]!).toBeGreaterThanOrEqual(a.min[0]! - 0.05);
    expect(b.max[2]!).toBeLessThanOrEqual(a.max[2]! + 0.05);
    expect(b.min[2]!).toBeGreaterThanOrEqual(a.min[2]! - 0.05);
    // De schoorsteen steekt boven het dak uit, dus de bovenkant van het dak is net onder die van het huis.
    expect(b.max[1]!).toBeLessThanOrEqual(a.max[1]! + 0.05);
    expect(b.max[1]!).toBeGreaterThan(a.max[1]! * 0.85);
    expect(b.min[1]!).toBeGreaterThan(a.max[1]! * 0.3);
  });
});

describe('buildAssets met gebouwen', () => {
  let root: string;
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'asset-cli-buildings-'));
    mkdirSync(join(root, 'src', 'buildings'), { recursive: true });
    copyFileSync(
      join(srcDir, 'buildings', 'base_house.glb'),
      join(root, 'src', 'buildings', 'base_house.glb'),
    );
    writeFileSync(
      join(root, 'src', 'buildings', 'variants.json'),
      JSON.stringify({
        ...config,
        variants: {
          dweller_building_beacon: config.variants['dweller_building_beacon'],
          dweller_building_claim_post: config.variants['dweller_building_claim_post'],
        },
      }),
    );
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('maakt van het bron-GLB geen eigen asset en schrijft de gebouwen met kind building', async () => {
    const dist = join(root, 'dist');
    const result = await buildAssets({ srcDir: join(root, 'src'), distDir: dist, toktx: null });
    expect(result.ok, JSON.stringify(result.reports.map((r) => r.errors))).toBe(true);
    expect(result.manifest!.assets.map((a) => a.id)).toEqual([
      'dweller_building_beacon',
      'dweller_building_claim_post',
    ]);
    const written = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'));
    for (const asset of written.assets) {
      expect(() => assetEntrySchema.parse(asset)).not.toThrow();
      expect(asset.kind).toBe('building');
    }
    const report = JSON.parse(readFileSync(join(dist, 'validation-report.json'), 'utf8'));
    expect(report.assets.find((a: { id: string }) => a.id === 'dweller_building_beacon').kind).toBe(
      'building',
    );
  }, 120_000);

  it('faalt leesbaar op een ongeldige variants.json', async () => {
    const broken = join(root, 'broken');
    mkdirSync(join(broken, 'buildings'), { recursive: true });
    writeFileSync(join(broken, 'buildings', 'variants.json'), JSON.stringify({ version: 1 }));
    const result = await buildAssets({ srcDir: broken, distDir: join(root, 'dist2'), toktx: null });
    expect(result.ok).toBe(false);
    expect(result.reports[0]!.errors.join('\n')).toMatch(/ongeldige variants\.json/);
  });
});

describe('manifest-schema voor gebouwen', () => {
  const base = {
    id: 'x',
    kind: 'building',
    bounds: { min: [-1, 0, -1], max: [1, 2, 1] },
    lods: [0, 1, 2].map((level) => ({ level, path: `x/lod${level}.glb`, triangles: 10 })),
    sockets: {},
    animations: [],
    boneCount: 0,
  };
  it('eist footprint en een team-materiaal bij een gebouw', () => {
    expect(assetEntrySchema.safeParse(base).success).toBe(false);
    expect(
      assetEntrySchema.safeParse({
        ...base,
        footprint: { w: 2, h: 2 },
        teamMaterials: ['team_trim'],
      }).success,
    ).toBe(true);
  });
  it('staat footprint niet toe bij een prop', () => {
    expect(
      assetEntrySchema.safeParse({
        ...base,
        kind: 'prop',
        footprint: { w: 2, h: 2 },
        teamMaterials: ['team_trim'],
      }).success,
    ).toBe(false);
  });
});

describe('geometry', () => {
  it('box en cylinder staan met de voet op y=0 en hebben genormaliseerde normalen', () => {
    const box = makeBox([2, 1, 3]);
    expect(triangleCount(box)).toBe(12);
    expect(Math.min(...Array.from({ length: 8 }, (_, i) => box.positions[i * 3 + 1]!))).toBe(0);
    const cyl = makeCylinder(0.5, 0.25, 2, 8);
    for (let i = 0; i < cyl.normals.length; i += 3)
      expect(Math.hypot(cyl.normals[i]!, cyl.normals[i + 1]!, cyl.normals[i + 2]!)).toBeCloseTo(
        1,
        5,
      );
    const ys = Array.from(
      { length: cyl.positions.length / 3 },
      (_, i) => cyl.positions[i * 3 + 1]!,
    );
    expect(Math.min(...ys)).toBe(0);
    expect(Math.max(...ys)).toBeCloseTo(2, 6);
  });

  it('transformeert normalen met de inverse transpose bij niet-uniforme schaal', () => {
    const mesh = makeBox([1, 1, 1]);
    const out = transformMesh(mesh, makeTransform({ scale: [4, 1, 1] }));
    for (let i = 0; i < out.normals.length; i += 3)
      expect(Math.hypot(out.normals[i]!, out.normals[i + 1]!, out.normals[i + 2]!)).toBeCloseTo(
        1,
        5,
      );
    // een normaal langs +y blijft +y, een normaal langs x blijft x
    expect(out.normals[1]).toBeCloseTo(1, 5);
  });

  it('simplifyMesh haalt het doel op een raster en laat een lichte mesh ongemoeid', () => {
    const n = 20;
    const positions: number[] = [];
    const indices: number[] = [];
    for (let y = 0; y <= n; y++)
      for (let x = 0; x <= n; x++) positions.push(x, Math.sin(x / 3) * 0.5, y);
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const a = y * (n + 1) + x;
        indices.push(a, a + n + 1, a + 1, a + 1, a + n + 1, a + n + 2);
      }
    const mesh = {
      positions: new Float32Array(positions),
      normals: new Float32Array(positions.length).fill(0),
      uvs: new Float32Array((positions.length / 3) * 2),
      indices: new Uint32Array(indices),
    };
    for (let i = 1; i < mesh.normals.length; i += 3) mesh.normals[i] = 1;
    const reduced = simplifyMesh(mesh, 100, BUDGETS.buildingSimplify);
    expect(triangleCount(reduced)).toBeLessThanOrEqual(100);
    expect(triangleCount(reduced)).toBeGreaterThan(20);
    expect(simplifyMesh(mesh, 5000, BUDGETS.buildingSimplify)).toBe(mesh);
  });

  it('largestComponents houdt het grootste losse deel', () => {
    const big = transformMesh(makeBox([4, 4, 4]), makeTransform({}));
    const small = transformMesh(
      makeBox([0.1, 0.1, 0.1]),
      makeTransform({ translation: [10, 0, 0] }),
    );
    const merged = {
      positions: new Float32Array([...big.positions, ...small.positions]),
      normals: new Float32Array([...big.normals, ...small.normals]),
      uvs: null,
      indices: new Uint32Array([
        ...big.indices,
        ...Array.from(small.indices, (i) => i + big.positions.length / 3),
      ]),
    };
    const kept = largestComponents(merged, 1, 0.01);
    expect(triangleCount(kept)).toBe(12);
    expect(Math.max(...kept.positions)).toBeLessThanOrEqual(4);
  });
});
