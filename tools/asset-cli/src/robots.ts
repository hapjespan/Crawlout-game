// Dweller-robots (assets/src/robots.json): rigide units en twee extra gebouwen, nette placeholders uit basisvormen (box,
// cylinder, cone) op echte schaal (poppetje 1,8 m), op dezelfde manier gebouwd als de gebouw-varianten (src/buildings.ts).
// Een rigide unit (kind 'rigid-unit') heeft geen skelet en geen animaties: beweging is een transform van het hele model.
// Alle vormgetallen staan in robots.json; deze module valideert en schrijft de LOD-GLB's en de manifestregels.
import { readFileSync } from 'node:fs';
import { getBounds } from '@gltf-transform/functions';
import { BUDGETS } from './budgets.js';
import {
  checkBuildingDocument,
  finishBuildingLod,
  generateBuilding,
  validateBuildingDocument,
  type BuildingLod,
} from './buildings.js';
import type { AssetEntry } from './manifest.js';
import {
  variantSchema,
  flatMaterialSchema,
  type VariantDef,
  type VariantsConfig,
} from './variants.js';
import { z } from 'zod';

export const ROBOTS_VERSION = 1 as const;

const range = z.tuple([z.number().positive(), z.number().positive()]);

export const robotUnitSchema = variantSchema.omit({ footprint: true }).extend({
  /** Redelijke hoogte van het model in meters (min, max); de maat-check naast een poppetje van 1,8 m. */
  heightM: range,
  /** Redelijke breedte (x) en diepte (z) in meters (min, max). */
  widthM: range,
  depthM: range,
  /** Zweefhoogte in meters: de onderkant van het model staat zo hoog boven de grond (gebakken in het model). */
  hover: z.number().positive().optional(),
});

export const robotBuildingSchema = variantSchema.extend({
  /** Redelijke hoogte van het gebouw in meters (min, max). */
  heightM: range,
});

export const robotsSchema = z
  .object({
    version: z.literal(ROBOTS_VERSION),
    flatMaterials: z.record(flatMaterialSchema),
    units: z.record(robotUnitSchema),
    buildings: z.record(robotBuildingSchema),
  })
  .superRefine((config, ctx) => {
    const issue = (message: string, path: (string | number)[]): void =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, message, path });
    const groups: [string, Record<string, Pick<VariantDef, 'parts' | 'colors'>>][] = [
      ['units', config.units],
      ['buildings', config.buildings],
    ];
    for (const [group, entries] of groups)
      for (const [id, variant] of Object.entries(entries)) {
        variant.parts.forEach((part, index) => {
          if (part.type === 'house')
            issue('robots gebruiken geen bronhuis', [group, id, 'parts', index]);
          else if (!(part.material in config.flatMaterials))
            issue(`onbekend effen materiaal "${part.material}"`, [group, id, 'parts', index]);
        });
        for (const name of Object.keys(variant.colors ?? {}))
          if (!(name in config.flatMaterials))
            issue(`kleur voor onbekend effen materiaal "${name}"`, [group, id, 'colors', name]);
        if (!variant.parts.some((p) => 'material' in p && /team/i.test(p.material)))
          issue('geen team-materiaal in de onderdelen (naam bevat "team")', [group, id, 'parts']);
      }
    for (const id of Object.keys(config.units))
      if (id in config.buildings) issue(`id "${id}" staat bij units en buildings`, ['units', id]);
  });

export type RobotsConfig = z.infer<typeof robotsSchema>;

export function parseRobots(json: unknown): RobotsConfig {
  const parsed = robotsSchema.safeParse(json);
  if (parsed.success) return parsed.data;
  throw new Error(
    parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; '),
  );
}

export function loadRobotsConfig(path: string): RobotsConfig {
  return parseRobots(JSON.parse(readFileSync(path, 'utf8')));
}

/** De config als gebouwengenerator-config (zonder bronnen); units krijgen een nietszeggende footprint, die niet gebruikt wordt. */
function asVariants(config: RobotsConfig): VariantsConfig {
  const variants: VariantsConfig['variants'] = {};
  for (const [id, unit] of Object.entries(config.units))
    variants[id] = { ...unit, footprint: { w: 1, h: 1 } };
  for (const [id, building] of Object.entries(config.buildings)) variants[id] = building;
  return {
    version: 1,
    sources: {},
    sourceMaterials: {},
    flatMaterials: config.flatMaterials,
    variants,
  };
}

type Vec3 = [number, number, number];

function sizeOf(min: number[], max: number[]): Vec3 {
  return [max[0]! - min[0]!, max[1]! - min[1]!, max[2]! - min[2]!];
}

/** Maatcontrole van een rigide unit op een LOD: hoogte, breedte, diepte, voet (of zweefhoogte), midden, geen skin. */
export function checkRobotUnit(
  lod: BuildingLod,
  unit: RobotsConfig['units'][string],
  level: 0 | 1 | 2,
): string[] {
  const label = `LOD${level}`;
  const errors: string[] = [];
  const scene = lod.document.getRoot().listScenes()[0];
  if (!scene) return [`${label}: geen scene`];
  const { min, max } = getBounds(scene);
  const [w, h, d] = sizeOf(min, max);
  const within = (name: string, value: number, [lo, hi]: [number, number]): void => {
    // De verre LODs mogen detail (antenne, loop) verliezen: 10 procent marge onder het bereik.
    const slack = level === 0 ? 1 : 0.9;
    if (value < lo * slack || value > hi)
      errors.push(`${label}: ${name} is ${value.toFixed(2)} m, verwacht ${lo} tot ${hi} m`);
  };
  within('hoogte', h, unit.heightM);
  within('breedte (x)', w, unit.widthM);
  within('diepte (z)', d, unit.depthM);
  const wantedMin = unit.hover ?? 0;
  if (Math.abs(min[1]! - wantedMin) > BUDGETS.hoverTolerance)
    errors.push(
      `${label}: de onderkant staat op y=${min[1]!.toFixed(3)}, verwacht ${unit.hover === undefined ? '0 (op de grond)' : `${wantedMin} (zweefhoogte)`}`,
    );
  const cx = (min[0]! + max[0]!) / 2;
  const cz = (min[2]! + max[2]!) / 2;
  if (Math.abs(cx) > w * 0.1 || Math.abs(cz) > d * 0.2)
    errors.push(
      `${label}: het midden staat op (${cx.toFixed(2)}, ${cz.toFixed(2)}), verwacht (0, 0)`,
    );
  if (lod.triangles > BUDGETS.rigidUnitMaxTris[level])
    errors.push(
      `${label} heeft ${lod.triangles} driehoeken, budget ${BUDGETS.rigidUnitMaxTris[level]}.`,
    );
  return errors;
}

export interface RobotDetails {
  kind: 'rigid-unit' | 'building';
  lodTriangles: number[];
  materials: string[];
  /** Maat van LOD0 in meters (b x h x d), voor het verslag. */
  sizeM: Vec3;
  hover?: number;
}

export interface RobotsResult {
  reports: {
    id: string;
    source: string;
    errors: string[];
    warnings: string[];
    details?: RobotDetails;
  }[];
  entries: AssetEntry[];
  outputs: Map<string, Uint8Array>;
}

const round6 = (v: number[]): Vec3 =>
  [v[0]!, v[1]!, v[2]!].map((x) => Math.round(x * 1e6) / 1e6) as Vec3;

/** Bouwt alle robots uit `config`: 3 LODs per id, validatie, manifestregels. Fouten staan in het verslag. */
export async function buildRobots(
  config: RobotsConfig,
  configSource: string,
): Promise<RobotsResult> {
  const result: RobotsResult = { reports: [], entries: [], outputs: new Map() };
  const variants = asVariants(config);
  const ids = [...Object.keys(config.units), ...Object.keys(config.buildings)].sort();
  for (const id of ids) {
    const unit = config.units[id];
    const building = config.buildings[id];
    const report: RobotsResult['reports'][number] = {
      id,
      source: configSource,
      errors: [],
      warnings: [],
    };
    result.reports.push(report);
    try {
      const lods: BuildingLod[] = [];
      let materials: string[] = [];
      for (const level of [0, 1, 2] as const) {
        const generated = await generateBuilding(variants, id, level, new Map());
        materials = generated.materials;
        const lod = await finishBuildingLod(generated.document, level);
        if (unit) {
          report.errors.push(...checkRobotUnit(lod, unit, level));
        } else {
          report.errors.push(
            ...checkBuildingDocument(generated.document, building!.footprint, level),
          );
          if (lod.triangles > BUDGETS.buildingMaxTris[level])
            report.errors.push(
              `LOD${level} heeft ${lod.triangles} driehoeken, budget ${BUDGETS.buildingMaxTris[level]}.`,
            );
        }
        report.errors.push(...validateBuildingDocument(lod.document, level));
        lods.push(lod);
      }
      if (building) {
        const bounds = getBounds(lods[0]!.document.getRoot().listScenes()[0]!);
        const h = bounds.max[1]! - bounds.min[1]!;
        if (h < building.heightM[0] || h > building.heightM[1])
          report.errors.push(
            `hoogte ${h.toFixed(2)} m, verwacht ${building.heightM[0]} tot ${building.heightM[1]} m`,
          );
      }
      if (report.errors.length > 0) continue;
      const lod0 = lods[0]!;
      const { min, max } = getBounds(lod0.document.getRoot().listScenes()[0]!);
      for (const lod of lods) result.outputs.set(`${id}/lod${lod.level}.glb`, lod.glb);
      const teamMaterials = lod0.document
        .getRoot()
        .listMaterials()
        .map((m) => m.getName())
        .filter((name) => /team/i.test(name))
        .sort();
      report.details = {
        kind: unit ? 'rigid-unit' : 'building',
        lodTriangles: lods.map((l) => l.triangles),
        materials,
        sizeM: round6(sizeOf(min, max)),
        ...(unit?.hover !== undefined ? { hover: unit.hover } : {}),
      };
      result.entries.push({
        id,
        kind: unit ? 'rigid-unit' : 'building',
        bounds: { min: round6(min), max: round6(max) },
        lods: lods.map((lod) => ({
          level: lod.level,
          path: `${id}/lod${lod.level}.glb`,
          triangles: lod.triangles,
        })) as AssetEntry['lods'],
        sockets: {},
        animations: [],
        boneCount: 0,
        teamMaterials,
        ...(unit
          ? {
              rigid: true as const,
              teamMask: 'materialName' as const,
              ...(unit.hover !== undefined ? { hover: unit.hover } : {}),
            }
          : { footprint: building!.footprint }),
      });
    } catch (error) {
      report.errors.push(
        `kan robot niet bouwen: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return result;
}
