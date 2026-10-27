// Robots (assets/src/robots.json, gesplitst in assets/src/robots/*.json): maten per id op echte schaal (poppetje 1,8 m), team-materiaal, de manifest-velden voor
// rigide units (kind, rigid, teamMaterials, hover) en de gecommitte uitvoer in assets/dist.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression } from '@gltf-transform/extensions';
import { getBounds } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';
import { beforeAll, describe, expect, it } from 'vitest';
import { BUDGETS } from '../src/budgets.js';
import { assetEntrySchema, manifestSchema, type AssetEntry } from '../src/manifest.js';
import { buildRobots, loadRobotsConfig, parseRobots, type RobotsResult } from '../src/robots.js';
import { readSplitJson } from '../src/splitJson.js';
// The render look reads the surface kind of a flat part from its glTF material name; the same table, so a robot can
// not end up on the unknown-name fallback (wood) by accident.
import {
  surfaceKindOfMaterial,
  type SurfaceKind,
} from '../../../packages/render/src/look/surfaces.js';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const configPath = join(repo, 'assets/src/robots.json');
const config = loadRobotsConfig(configPath);
const unitIds = Object.keys(config.units).sort();
const buildingIds = Object.keys(config.buildings).sort();
const CHARACTER_HEIGHT = 1.8;

/** Verwachte maten (m), los van de config: het contract met de opdracht (echte schaal). */
const EXPECTED: Record<string, { height: [number, number]; hover?: number }> = {
  dweller_robot_guard: { height: [2.1, 2.3] },
  dweller_robot_drone: { height: [0.7, 0.9], hover: 1.3 },
  dweller_robot_sentinel: { height: [3.3, 3.7] },
  dweller_robot_builder: { height: [1.8, 2.0] },
  dweller_building_robotfactory: { height: [8.5, 10.5] },
};

/** Bounds (b x h x d, m) of the previous primitive placeholders: the upgrade keeps within about 10 percent of them. */
const PLACEHOLDER_SIZE: Record<string, [number, number, number]> = {
  dweller_robot_guard: [2.9, 2.2, 3.625],
  dweller_robot_drone: [0.875, 0.84, 1.195],
  dweller_robot_sentinel: [3.94, 3.5, 6.4],
  dweller_building_robotfactory: [14.8, 9.6, 12.975],
};
/** Triangles of LOD0 of the placeholders; the upgrade has clearly more silhouette detail. */
const PLACEHOLDER_LOD0_TRIANGLES: Record<string, number> = {
  dweller_robot_guard: 832,
  dweller_robot_drone: 434,
  dweller_robot_sentinel: 940,
  dweller_building_robotfactory: 400,
};

let built: RobotsResult;
beforeAll(async () => {
  built = await buildRobots(config, 'robots.json');
}, 240_000);

const manifest = manifestSchema.parse(
  JSON.parse(readFileSync(join(repo, 'assets/dist/manifest.json'), 'utf8')),
);
const entry = (id: string): AssetEntry => manifest.assets.find((a) => a.id === id)!;
const size = (e: AssetEntry): [number, number, number] => [
  e.bounds.max[0] - e.bounds.min[0],
  e.bounds.max[1] - e.bounds.min[1],
  e.bounds.max[2] - e.bounds.min[2],
];

describe('robots.json', () => {
  it('heeft de vijf verwachte ids (turret_laser nu via delivered.json)', () => {
    expect([...unitIds, ...buildingIds].sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it('weigert een config zonder team-materiaal, met een bronhuis of een onbekend materiaal', () => {
    const raw = readSplitJson(configPath) as {
      units: Record<string, { parts: { material: string }[] }>;
    };
    const noTeam = structuredClone(raw);
    noTeam.units.dweller_robot_guard!.parts = noTeam.units.dweller_robot_guard!.parts.filter(
      (p: { material: string }) => !/team/.test(p.material),
    );
    expect(() => parseRobots(noTeam)).toThrow(/team-materiaal/);
    const unknown = structuredClone(raw);
    unknown.units.dweller_robot_guard!.parts[0]!.material = 'goud';
    expect(() => parseRobots(unknown)).toThrow(/onbekend effen materiaal/);
  });

  it('bouwt zonder fouten', () => {
    expect(built.reports.flatMap((r) => r.errors)).toEqual([]);
    expect(built.entries.map((e) => e.id).sort()).toEqual(Object.keys(EXPECTED).sort());
  });
});

describe('maten per id (gebouwd uit de config)', () => {
  for (const [id, expected] of Object.entries(EXPECTED))
    it(`${id}: hoogte ${expected.height[0]} tot ${expected.height[1]} m, lod-budget`, () => {
      const e = built.entries.find((x) => x.id === id)!;
      const [, h] = size(e);
      expect(h).toBeGreaterThanOrEqual(expected.height[0]);
      expect(h).toBeLessThanOrEqual(expected.height[1]);
      const budgets = e.kind === 'rigid-unit' ? BUDGETS.rigidUnitMaxTris : BUDGETS.buildingMaxTris;
      e.lods.forEach((lod, level) => {
        expect(lod.triangles).toBeGreaterThan(0);
        expect(lod.triangles).toBeLessThanOrEqual(budgets[level]!);
      });
      expect(e.lods[0].triangles).toBeGreaterThan(e.lods[2].triangles);
    });
});

describe('manifest-velden in assets/dist', () => {
  it('de guard en sentinel zijn groter dan een poppetje, de drone kleiner dan 1 m', () => {
    expect(size(entry('dweller_robot_guard'))[1]).toBeGreaterThan(CHARACTER_HEIGHT);
    expect(size(entry('dweller_robot_sentinel'))[1]).toBeGreaterThan(
      size(entry('dweller_robot_guard'))[1],
    );
    expect(size(entry('dweller_robot_drone'))[1]).toBeLessThan(1);
  });

  for (const id of unitIds)
    it(`${id}: kind rigid-unit, rigid, team-materiaal, geen skelet`, () => {
      const e = entry(id);
      expect(e.kind).toBe('rigid-unit');
      expect(e.rigid).toBe(true);
      expect(e.teamMask).toBe('materialName');
      expect(e.teamMaterials).toEqual(['team_trim']);
      expect(e.boneCount).toBe(0);
      expect(e.animations).toEqual([]);
      expect(e.baked).toBeUndefined();
      expect(e.footprint).toBeUndefined();
      expect(e.lods.map((l) => l.level)).toEqual([0, 1, 2]);
    });

  it('guard, sentinel en bouwrobot staan op de grond, zonder hover', () => {
    for (const id of ['dweller_robot_guard', 'dweller_robot_sentinel', 'dweller_robot_builder']) {
      expect(entry(id).bounds.min[1]).toBeCloseTo(0, 2);
      expect(entry(id).hover).toBeUndefined();
    }
  });

  it('de bouwrobot is ongeveer mensgroot: rond 1,8 m, lager dan de guard, compact (b en d onder 1,5 m)', () => {
    const builder = entry('dweller_robot_builder');
    const [w, h, d] = size(builder);
    expect(h).toBeGreaterThan(CHARACTER_HEIGHT - 0.1);
    expect(h).toBeLessThan(size(entry('dweller_robot_guard'))[1]);
    expect(w).toBeLessThan(1.3);
    expect(d).toBeLessThan(1.5);
    expect(builder.bounds.min[1]).toBeCloseTo(0, 2);
    expect(builder.hover).toBeUndefined();
    expect(config.units.dweller_robot_builder!.hover).toBeUndefined();
  });

  it('de drone zweeft: hover 1,3 m is de onderkant van de bounds (gebakken in het model)', () => {
    const drone = entry('dweller_robot_drone');
    expect(drone.hover).toBeCloseTo(1.3, 6);
    expect(drone.bounds.min[1]).toBeCloseTo(1.3, 2);
    expect(drone.bounds.max[1]).toBeCloseTo(2.1, 1);
  });

  it('de gebouwen hebben een footprint met oneven cellen die de bounds volgt en een team-materiaal', () => {
    for (const id of buildingIds) {
      const e = entry(id);
      expect(e.kind).toBe('building');
      expect(e.teamMaterials).toContain('team_trim');
      const fp = e.footprint!;
      expect(fp.w % 2).toBe(1);
      expect(fp.h % 2).toBe(1);
      const [w, , d] = size(e);
      expect(w).toBeLessThanOrEqual(fp.w * 1.05);
      expect(w).toBeGreaterThanOrEqual(fp.w * 0.85);
      expect(d).toBeLessThanOrEqual(fp.h * 1.05);
      expect(d).toBeGreaterThanOrEqual(fp.h * 0.85);
      expect(e.bounds.min[1]).toBeCloseTo(0, 2);
    }
    expect(entry('dweller_building_robotfactory').footprint).toEqual({ w: 15, h: 13 });
  });

  it('de schuifdeur van de fabriek is 4 m hoog (een poppetje van 1,8 m past ruim), de hal heeft echte schaal', () => {
    const [w, h, d] = size(entry('dweller_building_robotfactory'));
    expect(w).toBeGreaterThan(14);
    expect(d).toBeGreaterThan(12);
    expect(h).toBeGreaterThan(CHARACTER_HEIGHT * 4);
    const openings = config.buildings.dweller_building_robotfactory!.parts.flatMap((p) =>
      p.type === 'box' && p.material === 'opening' ? [p.size] : [],
    );
    expect(Math.max(...openings.map((s) => s[1]))).toBeGreaterThanOrEqual(4);
    // Every door opening is wider than a poppetje (1,8 m is the height; the width of a robot is not the issue here).
    for (const s of openings) expect(Math.max(s[0], s[2])).toBeGreaterThan(CHARACTER_HEIGHT);
  });

  it('de fabriek is een loods met golfplaat, schoorsteen, laadperron en portaalkraan', () => {
    const parts = config.buildings.dweller_building_robotfactory!.parts;
    expect(parts.some((p) => p.type === 'corrugated' && p.material === 'rust_roof')).toBe(true);
    expect(parts.filter((p) => p.type === 'corrugated').length).toBeGreaterThanOrEqual(8);
    const chimney = parts.find((p) => p.type === 'cylinder' && p.height >= 8);
    expect(
      chimney && chimney.position[1] + (chimney.type === 'cylinder' ? chimney.height : 0),
    ).toBeGreaterThan(9);
    expect(parts.some((p) => p.type === 'prism' && p.material === 'concrete')).toBe(true); // dock ramp
    expect(
      parts.some((p) => p.type === 'box' && p.material === 'metal_dark' && p.size[1] > 6),
    ).toBe(true); // crane column
  });

  it('de afmetingen blijven binnen ongeveer 10 procent van de oude placeholders', () => {
    for (const [id, old] of Object.entries(PLACEHOLDER_SIZE)) {
      const now = size(entry(id));
      for (let i = 0; i < 3; i++) {
        expect(now[i]! / old[i]!).toBeGreaterThan(0.9);
        expect(now[i]! / old[i]!).toBeLessThan(1.1);
      }
    }
  });

  it('LOD0 heeft duidelijk meer detail dan de placeholders en LOD1 en LOD2 blijven onder het budget', () => {
    for (const [id, old] of Object.entries(PLACEHOLDER_LOD0_TRIANGLES)) {
      const e = entry(id);
      expect(e.lods[0].triangles).toBeGreaterThan(old * 1.5);
      const budgets = e.kind === 'rigid-unit' ? BUDGETS.rigidUnitMaxTris : BUDGETS.buildingMaxTris;
      e.lods.forEach((lod, level) => expect(lod.triangles).toBeLessThanOrEqual(budgets[level]!));
      expect(e.lods[1].triangles).toBeLessThan(e.lods[0].triangles);
      expect(e.lods[2].triangles).toBeLessThan(e.lods[1].triangles);
    }
  });

  it('het schema weigert rigid-velden die niet kloppen', () => {
    const drone = structuredClone(entry('dweller_robot_drone'));
    expect(assetEntrySchema.safeParse(drone).success).toBe(true);
    expect(assetEntrySchema.safeParse({ ...drone, rigid: undefined }).success).toBe(false);
    expect(assetEntrySchema.safeParse({ ...drone, teamMaterials: [] }).success).toBe(false);
    expect(assetEntrySchema.safeParse({ ...drone, hover: 0.5 }).success).toBe(false);
    expect(assetEntrySchema.safeParse({ ...drone, boneCount: 3 }).success).toBe(false);
    const guard = structuredClone(entry('dweller_robot_guard'));
    expect(assetEntrySchema.safeParse({ ...guard, footprint: { w: 3, h: 3 } }).success).toBe(false);
    const factory = structuredClone(entry('dweller_building_robotfactory'));
    expect(assetEntrySchema.safeParse({ ...factory, rigid: true }).success).toBe(false);
    expect(assetEntrySchema.safeParse({ ...factory, hover: 1 }).success).toBe(false);
  });
});

/** Surface kinds a robot or the factory must show, besides the team band: what the brief asks per part. */
const REQUIRED_KINDS: Record<string, SurfaceKind[]> = {
  dweller_robot_guard: ['paintedMetal', 'rustMetal', 'lens', 'leather'],
  dweller_robot_drone: ['paintedMetal', 'rustMetal', 'lens', 'leather'],
  dweller_robot_sentinel: ['paintedMetal', 'rustMetal', 'lens', 'leather'],
  dweller_robot_builder: ['paintedMetal', 'rustMetal', 'lens', 'leather'],
  dweller_building_robotfactory: ['paintedMetal', 'rustMetal', 'lens', 'concrete'],
};

describe('oppervlaksoort per onderdeel (materiaalnaam, zoals render hem leest)', () => {
  it('elk materiaal van de config heeft een bedoelde oppervlaksoort, geen terugval op hout', () => {
    const expected: Record<string, SurfaceKind> = {
      metal: 'paintedMetal',
      metal_dark: 'paintedMetal',
      metal_light: 'paintedMetal',
      metal_hazard: 'paintedMetal',
      team_trim: 'paintedMetal',
      rust_metal: 'rustMetal',
      rust_dark: 'rustMetal',
      rust_roof: 'rustMetal',
      rubber: 'leather',
      opening: 'leather',
      concrete: 'concrete',
      lens: 'lens',
      lens_red: 'lens',
      lens_amber: 'lens',
      lens_glass: 'lens',
    };
    expect(Object.keys(config.flatMaterials).sort()).toEqual(Object.keys(expected).sort());
    for (const [name, kind] of Object.entries(expected))
      expect(surfaceKindOfMaterial(name), name).toBe(kind);
  });

  for (const [id, kinds] of Object.entries(REQUIRED_KINDS))
    it(`${id}: gebruikt ${kinds.join(', ')} en een team-band`, () => {
      const e = built.entries.find((x) => x.id === id)!;
      expect(e.teamMaterials).toEqual(['team_trim']);
      const report = built.reports.find((r) => r.id === id)!;
      const used = new Set(report.details!.materials.map((name) => surfaceKindOfMaterial(name)));
      for (const kind of kinds) expect(used.has(kind), kind).toBe(true);
      expect(report.details!.materials).toContain('team_trim');
    });
});

describe('LOD-GLB in assets/dist', () => {
  it('elke LOD bestaat, heeft een team-materiaal, geen skin en de bounds van het manifest (LOD0)', async () => {
    await MeshoptDecoder.ready;
    const io = new NodeIO()
      .registerExtensions([EXTMeshoptCompression])
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    for (const id of [...unitIds, ...buildingIds]) {
      const e = entry(id);
      for (const lod of e.lods) {
        const doc = await io.readBinary(
          new Uint8Array(readFileSync(join(repo, 'assets/dist', lod.path))),
        );
        const root = doc.getRoot();
        expect(root.listSkins()).toHaveLength(0);
        expect(root.listMaterials().some((m) => /team/i.test(m.getName()))).toBe(true);
        if (lod.level === 0) {
          const { min, max } = getBounds(root.listScenes()[0]!);
          for (let i = 0; i < 3; i++) {
            expect(min[i]!).toBeCloseTo(e.bounds.min[i]!, 3);
            expect(max[i]!).toBeCloseTo(e.bounds.max[i]!, 3);
          }
        }
      }
    }
  });
});
