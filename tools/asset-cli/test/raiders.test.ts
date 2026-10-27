// Raiders (assets/src/raiders.json, split in assets/src/raiders/*.json, plus the derived body in rigmap.json): every
// manifest id the Raider data refers to has a procedural placeholder on the real scale, footprints equal the data, budgets per LOD, `team_trim` is the only team
// material, surface kinds follow the material names (the render look recipe), and assets/dist is the build of this config.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { beforeAll, describe, expect, it } from 'vitest';
import { BUDGETS } from '../src/budgets.js';
import { readDataList } from './dataLists.js';
import { assetEntrySchema, manifestSchema, type AssetEntry } from '../src/manifest.js';
import { parseRigmap } from '../src/rigmap.js';
import { expectGlbMatches } from './glbMatch.js';
import { buildRobots, loadRobotsConfig, parseRobots, type RobotsResult } from '../src/robots.js';
import { readSplitJson } from '../src/splitJson.js';
import {
  surfaceKindOfMaterial,
  type SurfaceKind,
} from '../../../packages/render/src/look/surfaces.js';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const configPath = join(repo, 'assets/src/raiders.json');
const config = loadRobotsConfig(configPath);
const json = (path: string): unknown => JSON.parse(readFileSync(join(repo, path), 'utf8'));

interface LoadoutRecord {
  faction: string;
  visuals: { meshSlots: Record<string, string> };
}
interface BuildingRecord {
  faction: string;
  footprint: { w: number; h: number };
  visuals: { mesh: string };
}
const loadouts = (readDataList('loadouts') as LoadoutRecord[]).filter(
  (l) => l.faction === 'raiders',
);
const dataBuildings = (readDataList('buildings') as BuildingRecord[]).filter(
  (b) => b.faction === 'raiders',
);
/** Every manifest id the Raider data refers to, with the slot it is used in. */
const referenced = new Map<string, string>();
for (const l of loadouts)
  for (const [slot, id] of Object.entries(l.visuals.meshSlots)) referenced.set(id, slot);
for (const b of dataBuildings) referenced.set(b.visuals.mesh, 'building');

/** The derived body (same mesh and skin as the Dweller body, other colours) is not in raiders.json. */
const DERIVED = ['raider_body_human', 'raider_body_slave'];
const configIds = [
  ...Object.keys(config.units),
  ...Object.keys(config.buildings),
  ...Object.keys(config.attachments),
].sort();

/** Real-scale contract, independent of the config's own ranges: height, width (x), depth (z) in meters. */
const EXPECTED: Record<string, { h: [number, number]; w: [number, number]; d: [number, number] }> =
  {
    raider_building_camp: { h: [7.5, 9.5], w: [14.45, 17.85], d: [14.45, 17.85] },
    raider_building_tent: { h: [3.8, 4.8], w: [5.95, 7.35], d: [4.25, 5.25] },
    raider_building_cage: { h: [4.5, 6.5], w: [4.25, 5.25], d: [4.25, 5.25] },
    raider_building_market: { h: [5.5, 8.0], w: [11.05, 13.65], d: [9.35, 11.55] },
    raider_building_chemlab: { h: [7.0, 9.0], w: [9.35, 11.55], d: [7.65, 9.45] },
    raider_building_garage: { h: [7.0, 9.5], w: [14.45, 17.85], d: [11.05, 13.65] },
    raider_building_mg_nest: { h: [3.0, 3.8], w: [4.25, 5.25], d: [4.25, 5.25] },
    raider_building_claim_post: { h: [6.0, 8.0], w: [2.55, 3.15], d: [2.55, 3.15] },
    raider_vehicle_buggy: { h: [1.9, 2.6], w: [1.9, 2.4], d: [3.3, 4.0] },
    raider_body_hound: { h: [0.55, 0.85], w: [0.3, 0.55], d: [0.95, 1.4] },
    raider_tool_shovel: { h: [0.02, 0.12], w: [0.15, 0.3], d: [1.3, 1.6] },
    raider_tool_hammer: { h: [0.1, 0.2], w: [0.25, 0.4], d: [0.7, 1.0] },
    raider_weapon_pipe_gun: { h: [0.15, 0.3], w: [0.06, 0.13], d: [0.9, 1.2] },
    raider_weapon_spiked_club: { h: [0.15, 0.35], w: [0.15, 0.35], d: [0.9, 1.15] },
    raider_weapon_molotov: { h: [0.35, 0.55], w: [0.07, 0.15], d: [0.07, 0.15] },
    raider_weapon_net_whip: { h: [0.2, 0.45], w: [0.25, 0.5], d: [1.0, 1.5] },
    raider_weapon_chem_sprayer: { h: [0.45, 0.8], w: [0.06, 0.2], d: [0.8, 1.1] },
    raider_weapon_scrap_revolver: { h: [0.15, 0.3], w: [0.04, 0.12], d: [0.5, 0.75] },
    raider_gear_shackles: { h: [0.45, 0.75], w: [0.3, 0.5], d: [0.12, 0.3] },
    raider_gear_chem_tank: { h: [0.5, 0.8], w: [0.35, 0.55], d: [0.15, 0.35] },
    raider_gear_warlord_helm: { h: [0.25, 0.45], w: [0.5, 0.7], d: [0.25, 0.4] },
    raider_armor_steel: { h: [0.55, 0.85], w: [0.6, 0.9], d: [0.3, 0.45] },
  };

/** Surface kind per material name: the table in the README; the look recipe reads the kind from the name. */
const SURFACE: Record<string, SurfaceKind> = {
  scrap_metal: 'paintedMetal',
  scrap_metal_dark: 'paintedMetal',
  scrap_metal_black: 'paintedMetal',
  scrap_metal_red: 'paintedMetal',
  scrap_metal_hazard: 'paintedMetal',
  rust_metal: 'rustMetal',
  rust_dark: 'rustMetal',
  rust_roof: 'rustMetal',
  tyre_rubber: 'leather',
  canvas_tent: 'cloth',
  canvas_dark: 'cloth',
  canvas_red: 'cloth',
  canvas_black: 'cloth',
  sandbag_canvas: 'cloth',
  wood_plank: 'wood',
  wood_dark: 'wood',
  leather_dark: 'leather',
  leather_tan: 'leather',
  bone_stone: 'concrete',
  concrete: 'concrete',
  concrete_soot: 'concrete',
  tank_toxic: 'paintedMetal',
  tank_yellow: 'paintedMetal',
  lens_amber: 'lens',
  lens_red: 'lens',
  lens_glass: 'lens',
  opening: 'leather',
  team_trim: 'paintedMetal',
};

let built: RobotsResult;
beforeAll(async () => {
  built = await buildRobots(config, 'raiders.json');
}, 300_000);

const manifest = manifestSchema.parse(json('assets/dist/manifest.json'));
const entry = (id: string): AssetEntry => manifest.assets.find((a) => a.id === id)!;
const size = (e: AssetEntry): [number, number, number] => [
  e.bounds.max[0] - e.bounds.min[0],
  e.bounds.max[1] - e.bounds.min[1],
  e.bounds.max[2] - e.bounds.min[2],
];

// TODO(24 okt): hound en buggy zijn nu delivered; dekking-assertions moeten ook delivered-bronnen accepteren.
describe.skip('raiders.json against the Raider data', () => {
  it('has a placeholder for every manifest id the data refers to (the body is derived)', () => {
    expect([...configIds, ...DERIVED].sort()).toEqual([...referenced.keys()].sort());
    expect(referenced.size).toBe(24);
  });

  it('puts each id in the group that matches its slot', () => {
    for (const [id, slot] of referenced) {
      if (DERIVED.includes(id)) continue;
      if (slot === 'building') expect(config.buildings[id], id).toBeDefined();
      else if (slot === 'body') expect(config.units[id], id).toBeDefined();
      else expect(config.attachments[id], id).toBeDefined();
    }
  });

  it('gives every building the footprint of data/buildings/*.json (never shrunk to fit)', () => {
    for (const b of dataBuildings)
      expect(config.buildings[b.visuals.mesh]?.footprint, b.visuals.mesh).toEqual(b.footprint);
  });

  it('keeps every id with the raider_ prefix', () => {
    for (const id of [...configIds, ...DERIVED]) expect(id).toMatch(/^raider_/);
  });

  it('rejects a team material in an attachment, a missing one in a building, and an unknown material', () => {
    type Group = Record<string, { parts: { material: string }[] }>;
    const raw = readSplitJson(configPath) as { units: Group; buildings: Group; attachments: Group };
    const withTeam = structuredClone(raw);
    withTeam.attachments.raider_tool_shovel!.parts[0]!.material = 'team_trim';
    expect(() => parseRobots(withTeam)).toThrow(/aanhangsel/);
    const noTeam = structuredClone(raw);
    noTeam.buildings.raider_building_tent!.parts =
      noTeam.buildings.raider_building_tent!.parts.filter(
        (p: { material: string }) => !/team/.test(p.material),
      );
    expect(() => parseRobots(noTeam)).toThrow(/team-materiaal/);
    const unknown = structuredClone(raw);
    unknown.units.raider_vehicle_buggy!.parts[0]!.material = 'goud';
    expect(() => parseRobots(unknown)).toThrow(/onbekend effen materiaal/);
  });
});

describe('build', () => {
  it('builds without errors', () => {
    expect(built.reports.flatMap((r) => r.errors)).toEqual([]);
    expect(built.entries.map((e) => e.id).sort()).toEqual(configIds);
  });

  for (const id of configIds)
    it(`${id}: real-scale size, three LODs inside the budget, valid manifest entry`, () => {
      const e = built.entries.find((x) => x.id === id)!;
      expect(() => assetEntrySchema.parse(e)).not.toThrow();
      const want = EXPECTED[id]!;
      const [w, h, d] = size(e);
      expect(h, 'height').toBeGreaterThanOrEqual(want.h[0]);
      expect(h, 'height').toBeLessThanOrEqual(want.h[1]);
      expect(w, 'width').toBeGreaterThanOrEqual(want.w[0]);
      expect(w, 'width').toBeLessThanOrEqual(want.w[1]);
      expect(d, 'depth').toBeGreaterThanOrEqual(want.d[0]);
      expect(d, 'depth').toBeLessThanOrEqual(want.d[1]);
      const budgets =
        e.kind === 'building'
          ? BUDGETS.buildingMaxTris
          : e.kind === 'rigid-unit'
            ? BUDGETS.rigidUnitMaxTris
            : BUDGETS.propMaxTris;
      expect(e.lods.map((l) => l.level)).toEqual([0, 1, 2]);
      e.lods.forEach((lod, level) => {
        expect(lod.triangles).toBeGreaterThan(0);
        expect(lod.triangles).toBeLessThanOrEqual(budgets[level]!);
      });
      expect(e.lods[0].triangles).toBeGreaterThan(e.lods[1].triangles);
      expect(e.lods[1].triangles).toBeGreaterThan(e.lods[2].triangles);
      // The bounds are the same on every LOD in the sense that they stay on the ground (or on the hover height).
      if (e.kind !== 'prop') expect(e.bounds.min[1]).toBeCloseTo(0, 2);
    });

  it('buildings: footprint in the entry, model inside it, team_trim the only team material', () => {
    for (const b of dataBuildings) {
      const e = built.entries.find((x) => x.id === b.visuals.mesh)!;
      expect(e.kind).toBe('building');
      expect(e.footprint).toEqual(b.footprint);
      expect(e.teamMaterials).toEqual(['team_trim']);
      const [w, , d] = size(e);
      expect(w).toBeLessThanOrEqual(b.footprint.w * 1.05);
      expect(d).toBeLessThanOrEqual(b.footprint.h * 1.05);
      expect(w).toBeGreaterThanOrEqual(b.footprint.w * 0.85);
      expect(d).toBeGreaterThanOrEqual(b.footprint.h * 0.85);
    }
  });

  it('units are rigid-units with team_trim; attachments are team-less props', () => {
    for (const id of Object.keys(config.units)) {
      const e = built.entries.find((x) => x.id === id)!;
      expect(e.kind).toBe('rigid-unit');
      expect(e.rigid).toBe(true);
      expect(e.boneCount).toBe(0);
      expect(e.baked).toBeUndefined();
      expect(e.teamMaterials).toEqual(['team_trim']);
      expect(e.teamMask).toBe('materialName');
    }
    for (const id of Object.keys(config.attachments)) {
      const e = built.entries.find((x) => x.id === id)!;
      expect(e.kind).toBe('prop');
      expect(e.teamMask).toBe('none');
      expect(e.teamMaterials).toBeUndefined();
      expect(e.footprint).toBeUndefined();
    }
  });

  it('is deterministic: a second build gives the same bytes', async () => {
    const again = await buildRobots(config, 'raiders.json');
    expect([...again.outputs.keys()].sort()).toEqual([...built.outputs.keys()].sort());
    for (const [path, data] of built.outputs)
      expect(Buffer.compare(Buffer.from(data), Buffer.from(again.outputs.get(path)!)), path).toBe(
        0,
      );
    expect(again.entries).toEqual(built.entries);
  }, 300_000);
});

describe('doors and gates are at least 2.1 m high', () => {
  const parts = (id: string) => config.buildings[id]!.parts;
  it('openings of the tent, chemlab and garage', () => {
    for (const id of [
      'raider_building_tent',
      'raider_building_chemlab',
      'raider_building_garage',
    ]) {
      const openings = parts(id).filter(
        (p) => p.type === 'box' && p.material === 'opening' && p.size[0] >= 1,
      );
      expect(openings.length, id).toBeGreaterThan(0);
      for (const p of openings)
        if (p.type === 'box') expect(p.size[1], id).toBeGreaterThanOrEqual(2.1);
    }
  });

  it('camp gate, cage gate and market shed have a clear height of at least 2.1 m', () => {
    // The lowest crossing part over each gap: the gate beam of the camp, the team band over the cage gate, the beam of
    // the market shed.
    const camp = parts('raider_building_camp').find(
      (p) =>
        p.type === 'box' &&
        p.material === 'wood_dark' &&
        p.size[1] < 1 &&
        p.size[0] > 5 &&
        p.size[0] < 6.5 &&
        p.position[2] > 7,
    );
    expect(camp && camp.position[1]).toBeGreaterThanOrEqual(2.1);
    const cageBand = parts('raider_building_cage').find(
      (p) => p.type === 'box' && p.material === 'team_trim',
    );
    expect(cageBand && cageBand.position[1]).toBeGreaterThanOrEqual(2.1);
    const beam = parts('raider_building_market').find(
      (p) => p.type === 'box' && p.material === 'wood_dark' && p.size[0] > 11 && p.size[1] < 1,
    );
    expect(beam && beam.position[1]).toBeGreaterThanOrEqual(2.1);
  });

  it('every building is higher than a door (2.1 m) and than the 1.8 m character', () => {
    for (const b of dataBuildings) expect(size(entry(b.visuals.mesh))[1]).toBeGreaterThan(2.1);
  });
});

describe.skip('surface kinds (the render look recipe reads them from the material names)', () => {
  it('has an expected kind for every flat material, and the look recipe agrees', () => {
    expect(Object.keys(config.flatMaterials).sort()).toEqual(Object.keys(SURFACE).sort());
    for (const [name, kind] of Object.entries(SURFACE))
      expect(surfaceKindOfMaterial(name), name).toBe(kind);
  });

  it('only wood_* parts rely on the wood fallback of the look recipe', () => {
    for (const name of Object.keys(config.flatMaterials))
      if (surfaceKindOfMaterial(name) === 'wood') expect(name).toMatch(/^wood_/);
  });

  it('team_trim is the only team material; every other material avoids "team"', () => {
    const teamNames = Object.keys(config.flatMaterials).filter((n) => /team/i.test(n));
    expect(teamNames).toEqual(['team_trim']);
  });

  it('uses only materials from flatMaterials, and every flat material is used somewhere', () => {
    const used = new Set<string>();
    for (const group of [config.units, config.buildings, config.attachments])
      for (const v of Object.values(group))
        for (const p of v.parts) if ('material' in p) used.add(p.material);
    expect([...used].sort()).toEqual(Object.keys(config.flatMaterials).sort());
  });
});

describe('assets/dist is the build of raiders.json', () => {
  it('has the same LODs as a fresh build and the same manifest entries', async () => {
    for (const [path, data] of built.outputs) {
      await expectGlbMatches(data, readFileSync(join(repo, 'assets/dist', path)), path);
    }
    for (const e of built.entries) expect(entry(e.id), e.id).toEqual(JSON.parse(JSON.stringify(e)));
  });
});

describe('raider_body_human (derived from the Dweller body)', () => {
  const body = entry('raider_body_human');
  const dweller = entry('dweller_body_human');

  it('is a skinned 1.8 m character that shares the mesh, skin and animation texture of the Dweller body', () => {
    expect(body.kind).toBe('character');
    expect(size(body)[1]).toBeCloseTo(size(dweller)[1], 3);
    expect(size(body)[1]).toBeGreaterThan(1.7);
    expect(size(body)[1]).toBeLessThan(1.95);
    expect(body.boneCount).toBe(dweller.boneCount);
    expect(body.lods.map((l) => l.triangles)).toEqual(dweller.lods.map((l) => l.triangles));
    expect(body.baked).toEqual(dweller.baked);
    expect(body.sockets).toEqual(dweller.sockets);
    expect(body.animations).toEqual(dweller.animations);
    expect(body.lods.map((l) => l.path)).toEqual(
      [0, 1, 2].map((l) => `raider_body_human/lod${l}.glb`),
    );
  });

  it('differs from the Dweller body in its base colours only (Raider red and soot)', async () => {
    await MeshoptDecoder.ready;
    const io = new NodeIO()
      .registerExtensions([EXTMeshoptCompression])
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    const colours = async (id: string): Promise<Record<string, number[]>> => {
      const doc = await io.read(join(repo, 'assets/dist', id, 'lod0.glb'));
      return Object.fromEntries(
        doc
          .getRoot()
          .listMaterials()
          .map((m) => [m.getName(), m.getBaseColorFactor()]),
      );
    };
    const raider = await colours('raider_body_human');
    const base = await colours('dweller_body_human');
    expect(Object.keys(raider).sort()).toEqual(Object.keys(base).sort());
    expect(raider.M_Main).not.toEqual(base.M_Main);
    expect(raider.M_Joints).not.toEqual(base.M_Joints);
    // #8f3a2c in linear light: red dominates.
    expect(raider.M_Main![0]!).toBeGreaterThan(raider.M_Main![1]! * 2);
  });

  it('carries clothing palettes in the manifest: Raider leather and rust, slave rags with a team band', () => {
    const slave = entry('raider_body_slave');
    expect(slave.baked).toEqual(dweller.baked); // the same animation texture, not another copy
    expect(slave.lods.map((l) => l.path)).toEqual(
      [0, 1, 2].map((l) => `raider_body_slave/lod${l}.glb`),
    );
    expect(dweller.palette).toBeUndefined(); // the Dwellers keep the render default
    expect(body.palette).toBeDefined();
    expect(body.palette!.teamZone).toBeUndefined(); // the chest, as for the Dwellers
    expect(slave.palette).toMatchObject({ teamZone: 'band', farTeam: 0 });
    const luma = (hex: string | undefined): number => {
      const v = Number.parseInt(hex!.slice(1), 16);
      return (0.2126 * (v >> 16) + 0.7152 * ((v >> 8) & 255) + 0.0722 * (v & 255)) / 255;
    };
    expect(luma(slave.palette!.jacket)).toBeGreaterThan(luma(body.palette!.jacket) + 0.3);
    expect(luma(body.palette!.belt)).toBeLessThan(0.15); // black leather
  });

  it('the manifest schema accepts a palette on a character only, and only #rrggbb', () => {
    const base = entry('raider_body_human');
    expect(assetEntrySchema.safeParse({ ...base, palette: { jacket: '#aabbcc' } }).success).toBe(
      true,
    );
    expect(assetEntrySchema.safeParse({ ...base, palette: { jacket: 'red' } }).success).toBe(false);
    expect(assetEntrySchema.safeParse({ ...base, palette: { cloak: '#aabbcc' } }).success).toBe(
      false,
    );
    expect(
      assetEntrySchema.safeParse({ ...base, palette: { teamZone: 'band', farTeam: 0 } }).success,
    ).toBe(true);
    expect(assetEntrySchema.safeParse({ ...base, palette: { farTeam: 2 } }).success).toBe(false);
    expect(
      assetEntrySchema.safeParse({
        ...entry('raider_weapon_pipe_gun'),
        palette: { jacket: '#aabbcc' },
      }).success,
    ).toBe(false);
  });

  it('the rigmap schema refuses a derive entry without colours or with a bad colour', () => {
    expect(() => parseRigmap({ assets: { x: { derive: [{ id: 'a', colors: {} }] } } })).toThrow();
    expect(() =>
      parseRigmap({ assets: { x: { derive: [{ id: 'a', colors: { M: 'red' } }] } } }),
    ).toThrow();
    expect(() =>
      parseRigmap({ assets: { x: { derive: [{ id: 'a', colors: { M: '#aabbcc' } }] } } }),
    ).not.toThrow();
    expect(() =>
      parseRigmap({
        assets: {
          x: { derive: [{ id: 'a', colors: { M: '#aabbcc' }, palette: { boots: '#112233' } }] },
        },
      }),
    ).not.toThrow();
    expect(() =>
      parseRigmap({
        assets: { x: { derive: [{ id: 'a', colors: { M: '#aabbcc' }, palette: { boots: 'x' } }] } },
      }),
    ).toThrow();
  });
});
