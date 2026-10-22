// De Garde placeholders: derived bodies (power armour at 2,1 to 2,3 m), weapons, the Vertibird and seven buildings
// (fragments in assets/src/garde/). Real scale, footprint 1 tile = 1 m, budgets per LOD; dist is the build.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { BUDGETS } from '../src/budgets.js';
import { manifestSchema, type AssetEntry } from '../src/manifest.js';
import { expectGlbMatches } from './glbMatch.js';
import { buildRobots, loadRobotsConfig, type RobotsResult } from '../src/robots.js';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const json = (path: string): unknown => JSON.parse(readFileSync(join(repo, path), 'utf8'));
const config = loadRobotsConfig(join(repo, 'assets/src/garde.json'));
const manifest = manifestSchema.parse(json('assets/dist/manifest.json'));
const entry = (id: string): AssetEntry => manifest.assets.find((a) => a.id === id)!;
const size = (e: AssetEntry): [number, number, number] => [
  e.bounds.max[0] - e.bounds.min[0],
  e.bounds.max[1] - e.bounds.min[1],
  e.bounds.max[2] - e.bounds.min[2],
];
const footprints = json('data/buildings/04-garde.json') as {
  footprint: { w: number; h: number };
  visuals: { mesh: string };
}[];
const BODIES: Record<string, [number, number]> = {
  garde_body_initiate: [1.7, 1.9],
  garde_body_clerk: [1.7, 1.85],
  garde_body_power_armor: [2.1, 2.3],
  garde_body_power_armor_heavy: [2.2, 2.35],
};
const WEAPONS = [
  'garde_weapon_multitool',
  'garde_weapon_laser_pistol',
  'garde_weapon_laser_carbine',
  'garde_weapon_plasma_caster',
  'garde_weapon_vertibird_gun',
];

let built: RobotsResult;
beforeAll(async () => {
  built = await buildRobots(config, 'garde.json');
}, 300_000);

describe('garde procedural placeholders', () => {
  it('build without errors and match assets/dist', async () => {
    expect(built.reports.flatMap((r) => r.errors)).toEqual([]);
    for (const [path, data] of built.outputs)
      await expectGlbMatches(data, readFileSync(join(repo, 'assets/dist', path)), path);
  });

  it('derived bodies are characters in the real-scale band, power armour 2,1 to 2,3 m', () => {
    for (const [id, [lo, hi]] of Object.entries(BODIES)) {
      const e = entry(id);
      expect(e.kind, id).toBe('character');
      expect(size(e)[1], id).toBeGreaterThanOrEqual(lo);
      expect(size(e)[1], id).toBeLessThanOrEqual(hi);
    }
  });

  it('weapons are props in budget with three LODs', () => {
    for (const id of WEAPONS) {
      const e = entry(id);
      expect(
        e.lods.map((l) => l.level),
        id,
      ).toEqual([0, 1, 2]);
      e.lods.forEach((l, i) =>
        expect(l.triangles, `${id} LOD${i}`).toBeLessThanOrEqual(BUDGETS.propMaxTris[i]!),
      );
    }
  });

  it('the Vertibird is a big hovering rigid unit and every building follows its data footprint', () => {
    const v = entry('garde_body_vertibird');
    expect(v.kind).toBe('rigid-unit');
    expect(size(v)[2]).toBeGreaterThan(10);
    expect(v.bounds.min[1]).toBeCloseTo(2, 1);
    // data 0.44.0: 8 garde buildings, slaapzaal now has its own mesh (garde_building_dormitory) so all 8 are unique;
    // garde_building_dormitory is a delivered asset (dist-local, not in assets/dist/manifest.json) — skip its footprint check
    // data 0.41.0: 8 with the slaapzaal, which borrowed the barracks mesh until its own asset was delivered
    const DELIVERED_GARDE_MESHES = new Set(['garde_building_dormitory']);
    expect(footprints.length).toBe(8);
    const owners = footprints.filter(
      (b, i) => footprints.findIndex((o) => o.visuals.mesh === b.visuals.mesh) === i,
    );
    expect(owners.length).toBe(8);
    for (const b of owners) {
      if (DELIVERED_GARDE_MESHES.has(b.visuals.mesh)) continue; // delivered asset — footprint in delivered.json
      const e = entry(b.visuals.mesh);
      expect(e.kind, b.visuals.mesh).toBe('building');
      const [w, , d] = size(e);
      expect(w, b.visuals.mesh).toBeLessThanOrEqual(b.footprint.w * 1.05);
      expect(w, b.visuals.mesh).toBeGreaterThanOrEqual(b.footprint.w * 0.85);
      expect(d, b.visuals.mesh).toBeLessThanOrEqual(b.footprint.h * 1.05);
      expect(d, b.visuals.mesh).toBeGreaterThanOrEqual(b.footprint.h * 0.85);
    }
  });
});
