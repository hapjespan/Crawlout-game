// Split from buildings.ts to stay under the 5,000-token file limit; buildings.ts re-exports the public surface.
// Holds: generateBuilding, BuildingLod, finishBuildingLod, checkBuildingDocument, validateBuildingDocument, BuildingsResult, +4 more.
import {
  type VariantsConfig,
  type VariantPart,
  type HousePart,
  parseVariants,
} from './variants.js';
import { MeshoptSimplifier, MeshoptEncoder } from 'meshoptimizer';
import { expandParts } from './partExpand.js';
import {
  triangleCount,
  MeshAccumulator,
  type Mesh,
  simplifyMesh,
  dropSmallComponents,
} from './geometry.js';
import { BUDGETS } from './budgets.js';
import { Document } from '@gltf-transform/core';
import { textureCompress, dedup, prune, reorder, getBounds } from '@gltf-transform/functions';
import { EXTMeshoptCompression } from '@gltf-transform/extensions';
import { createIO } from './lods.js';
import { countTriangles, textureSizes } from './inspect.js';
import type { AssetEntry } from './manifest.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  assemble,
  buildingLodTargets,
  loadSourceHouse,
  placeHouse,
  placeShape,
  selectSource,
} from './buildings.part1.js';
import type { GeneratedBuilding, SourceHouse } from './buildings.part1.js';

/** Bouwt het document van een gebouw op een LOD, op basis van de config en de ingeladen bronnen. */
export async function generateBuilding(
  config: VariantsConfig,
  id: string,
  level: 0 | 1 | 2,
  sources: Map<string, SourceHouse>,
): Promise<GeneratedBuilding> {
  const variant = config.variants[id];
  if (!variant) throw new Error(`geen variant "${id}" in variants.json`);
  await MeshoptSimplifier.ready;
  const names = new Map(
    Object.entries(config.sourceMaterials).map(([source, m]) => [source, m.name]),
  );
  const target = buildingLodTargets(variant.lod0Triangles)[level];

  // Vormen blijven heel; het budget voor het huis is wat overblijft. Elk huisonderdeel krijgt een deel naar gewicht.
  const active = expandParts(variant.parts).filter(
    (p) => (p.minLod ?? 0) <= level && (p.maxLod ?? 2) >= level,
  );
  const shapes = active.filter((p): p is Exclude<VariantPart, HousePart> => p.type !== 'house');
  const shapeTriangles = shapes.reduce((sum, p) => sum + triangleCount(placeShape(p)), 0);
  const houses = active.filter((p): p is HousePart => p.type === 'house');
  const houseBudget = Math.max(houses.length * 12, target - shapeTriangles);
  const weights = houses.map((p) => p.weight ?? 1);
  const totalWeight = weights.reduce((a, b) => a + b, 0);

  const accumulators = new Map<string, MeshAccumulator>();
  const accumulate = (material: string, mesh: Mesh): void => {
    let acc = accumulators.get(material);
    if (!acc) accumulators.set(material, (acc = new MeshAccumulator()));
    acc.add(mesh);
  };
  let sourceTriangles = 0;
  let houseIndex = 0;
  for (const part of active) {
    if (part.type === 'house') {
      const source = sources.get(part.source);
      if (!source) throw new Error(`bron "${part.source}" is niet geladen`);
      const selected = selectSource(source, part);
      if (selected.length === 0)
        throw new Error(`onderdeel met select ${JSON.stringify(part.select)} is leeg`);
      sourceTriangles += selected.reduce((sum, m) => sum + triangleCount(m.mesh), 0);
      // Verdeel het aandeel van dit onderdeel over zijn materiaalmeshes (kleine meshes houden naar verhouding meer).
      const share = (houseBudget * weights[houseIndex++]!) / totalWeight;
      const exponent = BUDGETS.buildingBudgetExponent;
      const parts = selected.map((m) => triangleCount(m.mesh) ** exponent);
      const partTotal = parts.reduce((a, b) => a + b, 0);
      const simplified = selected.map((m, i) => ({
        material: m.material,
        mesh: simplifyMesh(
          dropSmallComponents(
            m.mesh,
            BUDGETS.buildingMinComponentArea[level],
            BUDGETS.buildingWeldDistance,
          ),
          Math.max(4, (share * parts[i]!) / partTotal),
          BUDGETS.buildingSimplify,
        ),
      }));
      for (const m of placeHouse(simplified, part, names, source.meshes, source.metersPerUnit))
        accumulate(m.material, m.mesh);
    } else {
      accumulate(part.material, placeShape(part));
    }
  }

  return { ...assemble(config, variant, id, accumulators, sources), sourceTriangles };
}

export interface BuildingLod {
  level: 0 | 1 | 2;
  glb: Uint8Array;
  triangles: number;
  document: Document;
}

/** Textures op de maat van deze LOD (JPEG: de bronnen hebben geen alfa), meshopt-compressie, deduplicatie. */
export async function finishBuildingLod(
  document: Document,
  level: 0 | 1 | 2,
): Promise<BuildingLod> {
  const size = BUDGETS.buildingTextureSizes[level];
  await MeshoptEncoder.ready;
  await document.transform(
    textureCompress({ resize: [size, size], targetFormat: 'jpeg' }),
    dedup(),
    prune({ keepSolidTextures: true }),
    reorder({ encoder: MeshoptEncoder }),
  );
  document
    .createExtension(EXTMeshoptCompression)
    .setRequired(true)
    .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  const glb = await createIO().writeBinary(document);
  return { level, glb, triangles: countTriangles(document), document };
}

/**
 * Controleert footprint, midden en grond van een gebouw-document tegen w x h: het model staat binnen de footprint
 * (hooguit 5 procent erbuiten), vult minstens `buildingFootprintMinFill` van w en h, het midden ligt bij de oorsprong
 * en de grond op y = 0. Er is geen grondplaat die de footprint vult.
 */
export function checkBuildingDocument(
  document: Document,
  footprint: { w: number; h: number },
  level: 0 | 1 | 2,
): string[] {
  const errors: string[] = [];
  const label = `LOD${level}`;
  const scene = document.getRoot().listScenes()[0];
  if (!scene) return [`${label}: geen scene`];
  const { min, max } = getBounds(scene);
  const [sx, sy, sz] = [max[0]! - min[0]!, max[1]! - min[1]!, max[2]! - min[2]!];
  const tol = BUDGETS.buildingFootprintTolerance;
  const fill = BUDGETS.buildingFootprintMinFill[level];
  const dims = [
    { name: 'breedte (x)', size: sx, cells: footprint.w },
    { name: 'diepte (z)', size: sz, cells: footprint.h },
  ];
  for (const d of dims) {
    if (d.size > d.cells * (1 + tol))
      errors.push(
        `${label}: ${d.name} is ${d.size.toFixed(2)} m, footprint ${d.cells} m (hooguit ${tol * 100} procent erbuiten)`,
      );
    else if (d.size < d.cells * fill)
      errors.push(
        `${label}: ${d.name} is ${d.size.toFixed(2)} m, footprint ${d.cells} m (het model vult minstens ${fill * 100} procent)`,
      );
  }
  const cx = (min[0]! + max[0]!) / 2;
  const cz = (min[2]! + max[2]!) / 2;
  const ctol = BUDGETS.buildingCentreTolerance;
  if (Math.abs(cx) > footprint.w * ctol || Math.abs(cz) > footprint.h * ctol)
    errors.push(
      `${label}: het midden staat op (${cx.toFixed(2)}, ${cz.toFixed(2)}), verwacht (0, 0)`,
    );
  if (Math.abs(min[1]!) > BUDGETS.buildingGroundTolerance)
    errors.push(`${label}: de grond staat op y=${min[1]!.toFixed(3)}, verwacht 0`);
  if (sy <= 0) errors.push(`${label}: geen hoogte`);
  return errors;
}

/**
 * Algemene regels voor een gebouw-document: geen PBR, een team-materiaal, textuurmaat, UV, tris. Een handheld of
 * ander aanhangsel (robots.ts, `attachments`) heeft geen team-materiaal nodig: `requireTeam: false`.
 */
export function validateBuildingDocument(
  document: Document,
  level: 0 | 1 | 2,
  requireTeam = true,
): string[] {
  const errors: string[] = [];
  const label = `LOD${level}`;
  const root = document.getRoot();
  const pbr = root
    .listExtensionsUsed()
    .map((e) => e.extensionName)
    .filter((name) => name.startsWith('KHR_materials_') && name !== 'KHR_materials_unlit');
  if (pbr.length > 0)
    errors.push(`${label}: PBR-extensies gevonden (${pbr.join(', ')}); de brief eist geen PBR.`);
  for (const material of root.listMaterials()) {
    const extra = [
      material.getNormalTexture() && 'normaal',
      material.getOcclusionTexture() && 'occlusie',
      material.getEmissiveTexture() && 'emissive',
      material.getMetallicRoughnessTexture() && 'metallic-roughness',
    ].filter(Boolean);
    if (extra.length > 0)
      errors.push(
        `${label}: materiaal "${material.getName()}" heeft ${extra.join(', ')}-textuur; alleen diffuse is toegestaan.`,
      );
  }
  if (requireTeam && !root.listMaterials().some((m) => /team/i.test(m.getName())))
    errors.push(`${label}: geen team-materiaal (naam bevat "team").`);
  for (const size of textureSizes(document))
    if (size.width > BUDGETS.buildingMaxTextureSize || size.height > BUDGETS.buildingMaxTextureSize)
      errors.push(
        `${label}: textuur "${size.name}" is ${size.width}x${size.height}, maximaal ${BUDGETS.buildingMaxTextureSize}.`,
      );
  const tris = countTriangles(document);
  if (tris === 0) errors.push(`${label}: geen driehoeken.`);
  if (root.listSkins().length > 0) errors.push(`${label}: een gebouw heeft geen skin.`);
  return errors;
}

export interface BuildingsResult {
  /** Verslag per gebouw (id, bron, fouten en waarschuwingen). */
  reports: {
    id: string;
    source: string;
    errors: string[];
    warnings: string[];
    details?: BuildingDetails;
  }[];
  entries: AssetEntry[];
  /** Pad (relatief aan dist) naar bytes. */
  outputs: Map<string, Uint8Array>;
  /** Bronbestanden (relatief aan srcDir, met forward slashes) die geen eigen asset zijn. */
  sourceFiles: Set<string>;
}

export interface BuildingDetails {
  kind: 'building';
  sourceTriangles: number;
  lodTriangles: number[];
  materials: string[];
  textureSizes: number[];
}

export const EMPTY_BUILDINGS: BuildingsResult = {
  reports: [],
  entries: [],
  outputs: new Map(),
  sourceFiles: new Set(),
};

/** Leest variants.json (als hij bestaat) en geeft de bronbestanden terug die geen eigen asset zijn. */
export function loadVariantsConfig(path: string): VariantsConfig {
  return parseVariants(JSON.parse(readFileSync(path, 'utf8')));
}

/** Bouwt alle varianten uit `config`: validatie per LOD, GLB's, manifestregels. Fouten staan in het verslag. */
export async function buildBuildings(
  config: VariantsConfig,
  srcDir: string,
  configSource: string,
): Promise<BuildingsResult> {
  const result: BuildingsResult = {
    reports: [],
    entries: [],
    outputs: new Map(),
    sourceFiles: new Set(Object.values(config.sources).map((s) => s.file.split('\\').join('/'))),
  };
  const sources = new Map<string, SourceHouse>();
  for (const [key, source] of Object.entries(config.sources))
    sources.set(
      key,
      await loadSourceHouse(join(srcDir, source.file), {
        metersPerUnit: source.metersPerUnit,
        keep: source.keep,
      }),
    );

  for (const id of Object.keys(config.variants).sort()) {
    const variant = config.variants[id]!;
    const report: BuildingsResult['reports'][number] = {
      id,
      source: configSource,
      errors: [],
      warnings: [],
    };
    result.reports.push(report);
    try {
      if (variant.lod0Triangles > BUDGETS.buildingMaxTris[0])
        report.errors.push(
          `lod0Triangles ${variant.lod0Triangles} is boven het budget ${BUDGETS.buildingMaxTris[0]}.`,
        );
      const lods: BuildingLod[] = [];
      let sourceTriangles = 0;
      let materials: string[] = [];
      for (const level of [0, 1, 2] as const) {
        const generated = await generateBuilding(config, id, level, sources);
        sourceTriangles = generated.sourceTriangles;
        materials = generated.materials;
        report.errors.push(...checkBuildingDocument(generated.document, variant.footprint, level));
        const lod = await finishBuildingLod(generated.document, level);
        if (lod.triangles > BUDGETS.buildingMaxTris[level])
          report.errors.push(
            `LOD${level} heeft ${lod.triangles} driehoeken, budget ${BUDGETS.buildingMaxTris[level]}.`,
          );
        report.errors.push(...validateBuildingDocument(lod.document, level));
        lods.push(lod);
      }
      if (report.errors.length > 0) continue;
      const lod0 = lods[0]!;
      const scene = lod0.document.getRoot().listScenes()[0]!;
      const { min, max } = getBounds(scene);
      const round = (v: number[]): [number, number, number] =>
        [v[0]!, v[1]!, v[2]!].map((x) => Math.round(x * 1e6) / 1e6) as [number, number, number];
      for (const lod of lods) result.outputs.set(`${id}/lod${lod.level}.glb`, lod.glb);
      const teamMaterials = lod0.document
        .getRoot()
        .listMaterials()
        .map((m) => m.getName())
        .filter((name) => /team/i.test(name))
        .sort();
      report.details = {
        kind: 'building',
        sourceTriangles,
        lodTriangles: lods.map((l) => l.triangles),
        materials,
        textureSizes: BUDGETS.buildingTextureSizes.slice(),
      };
      result.entries.push({
        id,
        kind: 'building',
        bounds: { min: round(min), max: round(max) },
        lods: lods.map((lod) => ({
          level: lod.level,
          path: `${id}/lod${lod.level}.glb`,
          triangles: lod.triangles,
        })) as AssetEntry['lods'],
        sockets: {},
        animations: [],
        boneCount: 0,
        footprint: variant.footprint,
        teamMaterials,
        ...(variant.albedoGain !== undefined ? { albedoGain: variant.albedoGain } : {}),
      });
    } catch (error) {
      report.errors.push(
        `kan gebouw niet bouwen: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return result;
}
