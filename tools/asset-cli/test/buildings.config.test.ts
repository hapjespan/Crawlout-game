import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BUDGETS } from '../src/budgets.js';
import { buildAssets } from '../src/build.js';
import {
  largestComponents,
  makeBox,
  makeTransform,
  simplifyMesh,
  transformMesh,
  triangleCount,
} from '../src/geometry.js';
import { makeCylinderClean } from '../src/shapes.js';
import { assetEntrySchema } from '../src/manifest.js';
import { parseVariants } from '../src/variants.js';
import { buildingsJson, config, deepCopy, ids, srcDir, variantsPath } from './buildings.helpers.js';

describe('variants.json', () => {
  it('valideert en dekt alle Dweller-gebouwen uit data/buildings.json (acht hier, de robotgebouwen in robots.json)', () => {
    const dwellers = buildingsJson.filter((b) => b.visuals.mesh.startsWith('dweller_building_'));
    // data 0.15.0: tien gebouwen; robotfabriek en laserturret komen uit assets/src/robots.json (src/robots.ts)
    const robots = JSON.parse(readFileSync(join(srcDir, 'robots.json'), 'utf8')) as {
      buildings: Record<string, { footprint: { w: number; h: number } }>;
    };
    expect(dwellers).toHaveLength(10);
    const inVariants = dwellers.filter((b) => robots.buildings[b.visuals.mesh] === undefined);
    expect(inVariants).toHaveLength(8);
    expect(ids).toEqual(inVariants.map((b) => b.visuals.mesh).sort());
    for (const b of dwellers) {
      const footprint =
        config.variants[b.visuals.mesh]?.footprint ?? robots.buildings[b.visuals.mesh]?.footprint;
      expect(footprint, b.visuals.mesh).toEqual(b.footprint);
    }
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
    const cyl = makeCylinderClean(0.5, 0.25, 2, 8, false);
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
