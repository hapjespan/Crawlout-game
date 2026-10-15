// Robots (assets/src/robots.json): maten per id op echte schaal (poppetje 1,8 m), team-materiaal, de manifest-velden voor
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
  dweller_building_robotfactory: { height: [8.5, 10.5] },
  dweller_building_turret_laser: { height: [2.8, 3.2] },
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
  it('heeft de vijf verwachte ids', () => {
    expect([...unitIds, ...buildingIds].sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it('weigert een config zonder team-materiaal, met een bronhuis of een onbekend materiaal', () => {
    const raw = JSON.parse(readFileSync(configPath, 'utf8'));
    const noTeam = structuredClone(raw);
    noTeam.units.dweller_robot_guard.parts = noTeam.units.dweller_robot_guard.parts.filter(
      (p: { material: string }) => !/team/.test(p.material),
    );
    expect(() => parseRobots(noTeam)).toThrow(/team-materiaal/);
    const unknown = structuredClone(raw);
    unknown.units.dweller_robot_guard.parts[0].material = 'goud';
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

  it('guard en sentinel staan op de grond, zonder hover', () => {
    for (const id of ['dweller_robot_guard', 'dweller_robot_sentinel']) {
      expect(entry(id).bounds.min[1]).toBeCloseTo(0, 2);
      expect(entry(id).hover).toBeUndefined();
    }
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
    expect(entry('dweller_building_turret_laser').footprint).toEqual({ w: 3, h: 3 });
  });

  it('de schuifdeur van de fabriek is hoog genoeg voor een poppetje, de hal heeft echte schaal', () => {
    const [w, h, d] = size(entry('dweller_building_robotfactory'));
    expect(w).toBeGreaterThan(14);
    expect(d).toBeGreaterThan(12);
    expect(h).toBeGreaterThan(CHARACTER_HEIGHT * 4);
    const door = config.buildings.dweller_building_robotfactory!.parts.find(
      (p) => p.type === 'box' && p.material === 'opening',
    );
    expect(door && door.type === 'box' && door.size[1]).toBeGreaterThanOrEqual(2.1);
  });

  it('de lasertoren heeft een andere tint dan de gewone turret', () => {
    const laser = config.buildings.dweller_building_turret_laser!.colors!.metal!;
    const plain = config.flatMaterials.metal!.color;
    expect(laser).not.toBe(plain);
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
    const building = structuredClone(entry('dweller_building_turret_laser'));
    expect(assetEntrySchema.safeParse({ ...building, rigid: true }).success).toBe(false);
    expect(assetEntrySchema.safeParse({ ...building, hover: 1 }).success).toBe(false);
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
