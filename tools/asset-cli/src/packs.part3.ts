// Split from packs.ts to stay under the 5,000-token file limit; packs.ts re-exports the public surface.
// Holds: checkPropDocument, PackPropDetails, PacksResult, EMPTY_PACKS, findPacksDir, round6, +2 more.
import { Document } from '@gltf-transform/core';
import { getBounds } from '@gltf-transform/functions';
import type { AtlasInfo } from './textures.js';
import { type AssetEntry, manifestSchema } from './manifest.js';
import { join, resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { findNode, loadPackSource, resolveProp } from './packs.part1.js';
import type { PackProp, PacksConfig } from './packs.part1.js';
import { HEIGHT_TOLERANCE_M, buildLod, prepareProp } from './packs.part2.js';
import type { PropAlpha, PropLod } from './packs.part2.js';

/** Controleert de maat, grond, midden en het alfagedrag van een LOD0-document tegen de config. */
export function checkPropDocument(
  config: PacksConfig,
  id: string,
  prop: PackProp,
  lod0: Document,
  alpha: PropAlpha,
): string[] {
  const errors: string[] = [];
  const settings = resolveProp(config, prop);
  const scene = lod0.getRoot().listScenes()[0]!;
  const { min, max } = getBounds(scene);
  const height = max[1]! - min[1]!;
  const [lo, hi] = settings.heightRangeM;
  if (height < lo || height > hi)
    errors.push(
      `hoogte ${height.toFixed(2)} m valt buiten ${lo} tot ${hi} m voor ${prop.category}; stuur heightM of heightRangeM bij in packs.json`,
    );
  if (Math.abs(min[1]!) > HEIGHT_TOLERANCE_M)
    errors.push(`de voet staat op y=${min[1]!.toFixed(3)}, verwacht 0`);
  if (settings.centre === 'bounds') {
    const cx = (min[0]! + max[0]!) / 2;
    const cz = (min[2]! + max[2]!) / 2;
    if (Math.abs(cx) > 0.05 || Math.abs(cz) > 0.05)
      errors.push(`het midden staat op (${cx.toFixed(2)}, ${cz.toFixed(2)}), verwacht (0, 0)`);
  }
  const expected = prop.alpha ?? (prop.category === 'tree-leafy' ? 'mask' : undefined);
  if (expected === 'mask' && alpha.foliage === 'none')
    errors.push('alpha: "mask" verwacht, maar de bron heeft geen transparante textuur');
  if (expected === 'none' && alpha.foliage !== 'none')
    errors.push('alpha: "none" verwacht, maar de bron heeft een transparante textuur');
  if (prop.category === 'tree-leafy' && alpha.foliage === 'bare')
    errors.push(
      `categorie tree-leafy, maar de bladkaarten zijn ${alpha.hue} graden, verzadiging ${alpha.saturation}: dat is twijgwerk (tree-bare)`,
    );
  if (prop.category === 'tree-bare' && alpha.foliage === 'leafy')
    errors.push(
      `categorie tree-bare, maar de kaarten zijn ${alpha.hue} graden, verzadiging ${alpha.saturation}: dat is blad (tree-leafy)`,
    );
  const root = lod0.getRoot();
  const pbr = root
    .listExtensionsUsed()
    .map((e) => e.extensionName)
    .filter((name) => name.startsWith('KHR_materials_') && name !== 'KHR_materials_unlit');
  if (pbr.length > 0)
    errors.push(`PBR-extensies gevonden (${pbr.join(', ')}); de brief eist geen PBR`);
  if (root.listMaterials().length !== 1)
    errors.push(`${root.listMaterials().length} materialen, verwacht 1 (atlas)`);
  const material = root.listMaterials()[0];
  if (
    material &&
    alpha.foliage !== 'none' &&
    (material.getAlphaMode() !== 'MASK' || material.getAlphaCutoff() <= 0)
  )
    errors.push('alfa is niet als MASK met een alphaCutoff behouden');
  return errors;
}

// --- de buis ------------------------------------------------------------------------------------------------------

export interface PackPropDetails {
  kind: 'prop';
  pack: string;
  category: string;
  sourceTriangles: number;
  lodTriangles: number[];
  /** Hoogte van de bron in meter bij `unit` (zonder echte-maat-correctie), de uiteindelijke hoogte, en de totale schaal. */
  sourceHeightM: number;
  heightM: number;
  scale: number;
  atlas: { size: number; cells: AtlasInfo['cells'] };
  textures: { size: number; format: string; bytes: number }[];
  alpha: PropAlpha;
  materials: string[];
  preserved?: true;
}

export interface PacksResult {
  reports: {
    id: string;
    source: string;
    errors: string[];
    warnings: string[];
    details?: PackPropDetails;
  }[];
  entries: AssetEntry[];
  outputs: Map<string, Uint8Array>;
}

export const EMPTY_PACKS: PacksResult = { reports: [], entries: [], outputs: new Map() };

/** De map met de pack-GLB's: assets/src/packs, vanuit een worktree ook die van de hoofdcheckout (gitignored). */
export function findPacksDir(srcDir: string): string | null {
  const local = join(srcDir, 'packs');
  if (existsSync(local)) return local;
  try {
    const common = execFileSync('git', ['rev-parse', '--git-common-dir'], {
      cwd: srcDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const main = resolve(srcDir, common, '..');
    for (const candidate of [join(main, 'assets', 'src', 'packs')])
      if (existsSync(candidate)) return candidate;
  } catch {
    // geen git: alleen de lokale map telt
  }
  return null;
}

function round6(v: number[]): [number, number, number] {
  return [v[0]!, v[1]!, v[2]!].map((x) => Math.round(x * 1e6) / 1e6) as [number, number, number];
}

/** Uitvoer van props uit een bron die ontbreekt: de gecommitte bestanden in `previousDist` blijven staan. */
function preserveProps(
  ids: string[],
  sourceName: string,
  result: PacksResult,
  previousDist: string | undefined,
): void {
  let previous: ReturnType<typeof manifestSchema.safeParse> | null = null;
  if (previousDist && existsSync(join(previousDist, 'manifest.json'))) {
    try {
      previous = manifestSchema.safeParse(
        JSON.parse(readFileSync(join(previousDist, 'manifest.json'), 'utf8')),
      );
    } catch {
      previous = null;
    }
  }
  for (const id of ids) {
    const report: PacksResult['reports'][number] = {
      id,
      source: `packs/${sourceName}`,
      errors: [],
      warnings: [],
    };
    result.reports.push(report);
    const entry = previous?.success ? previous.data.assets.find((a) => a.id === id) : undefined;
    if (!entry || !previousDist) {
      report.errors.push(
        `bron van pack "${sourceName}" ontbreekt (assets/src/packs, staat niet in git) en er is geen eerdere uitvoer van "${id}" in assets/dist`,
      );
      continue;
    }
    const files = entry.lods.map((lod) => lod.path);
    const missing = files.filter((file) => !existsSync(join(previousDist, file)));
    if (missing.length > 0) {
      report.errors.push(
        `eerdere uitvoer van "${id}" is onvolledig (${missing.join(', ')} ontbreekt)`,
      );
      continue;
    }
    for (const file of new Set(files))
      result.outputs.set(file, new Uint8Array(readFileSync(join(previousDist, file))));
    result.entries.push(entry);
    report.warnings.push(
      `bron van pack "${sourceName}" ontbreekt; de bestaande uitvoer in assets/dist is behouden`,
    );
  }
}

/** Bouwt alle props uit `config`: splitsen, schalen, atlas, LOD's, controles. Fouten staan in het verslag per prop. */
export async function buildPacks(
  config: PacksConfig,
  options: { packsDir: string | null; previousDist?: string },
): Promise<PacksResult> {
  const result: PacksResult = { reports: [], entries: [], outputs: new Map() };
  for (const [sourceName, def] of Object.entries(config.sources)) {
    const file = options.packsDir ? join(options.packsDir, def.file) : null;
    const ids = Object.keys(def.props).sort();
    if (!file || !existsSync(file)) {
      preserveProps(ids, sourceName, result, options.previousDist);
      continue;
    }
    const source = await loadPackSource(file);
    const parent = findNode(source.document, def.split.parent);
    if (!parent) {
      for (const id of ids)
        result.reports.push({
          id,
          source: `packs/${def.file}`,
          errors: [`splitsknoop "${def.split.parent}" bestaat niet in ${def.file}`],
          warnings: [],
        });
      continue;
    }
    const children = new Map(
      parent.listChildren().map((child) => [child.getName(), child] as const),
    );
    const stray = [...children.keys()].filter(
      (name) => !(name in def.skip) && !Object.values(def.props).some((p) => p.node === name),
    );
    if (stray.length > 0)
      result.reports.push({
        id: sourceName,
        source: `packs/${def.file}`,
        errors: [`objecten zonder prop of skip in packs.json: ${stray.join(', ')}`],
        warnings: [],
      });
    for (const id of ids) {
      const prop = def.props[id]!;
      const report: PacksResult['reports'][number] = {
        id,
        source: `packs/${def.file}#${prop.node}`,
        errors: [],
        warnings: [],
      };
      result.reports.push(report);
      const node = children.get(prop.node);
      if (!node) {
        report.errors.push(
          `object "${prop.node}" bestaat niet onder "${def.split.parent}" in ${def.file}`,
        );
        continue;
      }
      try {
        const settings = resolveProp(config, prop);
        const prepared = await prepareProp(config, source, def.unit, node, prop);
        const lods: PropLod[] = [];
        for (const level of [0, 1, 2] as const)
          lods.push(await buildLod(config, prepared, level, settings.tris));
        report.errors.push(
          ...checkPropDocument(config, id, prop, lods[0]!.document, prepared.alpha),
        );
        for (const lod of lods)
          if (lod.triangles > settings.tris[lod.level] || lod.triangles === 0)
            report.errors.push(
              `LOD${lod.level} heeft ${lod.triangles} driehoeken, budget ${settings.tris[lod.level]}`,
            );
        const { min, max } = getBounds(lods[0]!.document.getRoot().listScenes()[0]!);
        report.details = {
          kind: 'prop',
          pack: sourceName,
          category: prop.category,
          sourceTriangles: prepared.sourceTriangles,
          lodTriangles: lods.map((l) => l.triangles),
          sourceHeightM: Math.round(prepared.sourceHeightM * 1000) / 1000,
          heightM: Math.round((max[1]! - min[1]!) * 1000) / 1000,
          scale: Math.round(prepared.scale * 1e6) / 1e6,
          atlas: { size: prepared.atlas.size, cells: prepared.atlas.cells },
          textures: lods.map((l) => ({
            size: l.textureSize,
            format: l.textureFormat,
            bytes: l.textureBytes,
          })),
          alpha: prepared.alpha,
          materials: prepared.materials,
        };
        if (report.errors.length > 0) continue;
        for (const lod of lods) result.outputs.set(`${id}/lod${lod.level}.glb`, lod.glb);
        result.entries.push({
          id,
          kind: 'prop',
          bounds: { min: round6(min), max: round6(max) },
          lods: lods.map((lod) => ({
            level: lod.level,
            path: `${id}/lod${lod.level}.glb`,
            triangles: lod.triangles,
          })) as AssetEntry['lods'],
          sockets: {},
          animations: [],
          boneCount: 0,
          teamMask: 'none',
          category: prop.category,
          ...(prepared.alpha.foliage !== 'none' ? { alpha: 'mask' as const } : {}),
          ...(prop.albedoGain !== undefined ? { albedoGain: prop.albedoGain } : {}),
        });
      } catch (error) {
        report.errors.push(
          `kan prop niet bouwen: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
  return result;
}
