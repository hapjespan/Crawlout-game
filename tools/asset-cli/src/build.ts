import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';
import { BUDGETS } from './budgets.js';
import { bakeAnimations } from './bake.js';
import { buildBuildings, loadVariantsConfig, type BuildingDetails } from './buildings.js';
import { EMPTY_CLIPMAP, parseClipmap, resolveClips, type Clipmap } from './clipmap.js';
import { conformDocument, type ConformInfo } from './conform.js';
import { animationIndex, findSockets, maxBoneCount } from './inspect.js';
import { buildLods, createIO, lodMaxTris } from './lods.js';
import { detectToktx } from './ktx2.js';
import {
  MANIFEST_VERSION,
  manifestSchema,
  type AssetEntry,
  type AssetManifest,
} from './manifest.js';
import { EMPTY_RIGMAP, parseRigmap, type Rigmap } from './rigmap.js';
import { validateAsset } from './validate.js';
import type { VariantsConfig } from './variants.js';

export interface BuildOptions {
  srcDir: string;
  distDir: string;
  /** Overschrijf de toktx-detectie (tests). `null` forceert PNG. */
  toktx?: string | null;
  /** Pad naar de clipmap; standaard `<srcDir>/clipmap.json`. Een ontbrekend bestand betekent: geen koppelingen. */
  clipmapPath?: string;
  /** Pad naar de rigmap; standaard `<srcDir>/rigmap.json`. Een ontbrekend bestand betekent: geen conform-stap. */
  rigmapPath?: string;
  /** Pad naar de gebouwenconfig; standaard `<srcDir>/buildings/variants.json`. Ontbreekt hij, dan zijn er geen gebouwen. */
  variantsPath?: string;
}

export interface AssetReport {
  id: string;
  source: string;
  errors: string[];
  warnings: string[];
  /** Wat de buis aan de bron veranderd heeft en wat eruit kwam; komt in validation-report.json. */
  details?: AssetDetails | BuildingDetails;
}

export interface AssetDetails {
  kind: 'character' | 'prop';
  sourceTriangles: number;
  lodTriangles: number[];
  sourceBones: number;
  bones: number;
  prunedBones: string[];
  channelsDropped: number;
  clipsKept: Record<string, string>;
  clipsDropped: string[];
  extraUvSetsRemoved: number;
  scale: number | null;
}

export interface BuildResult {
  ok: boolean;
  reports: AssetReport[];
  /** Waarschuwingen op buisniveau, bijvoorbeeld ontbrekende KTX2-tooling. */
  notices: string[];
  manifest: AssetManifest | null;
}

function listGlbs(dir: string): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const found: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...listGlbs(full));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.glb')) found.push(full);
  }
  return found.sort();
}

function toId(file: string): string {
  return basename(file)
    .replace(/\.glb$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Leest alle GLB's uit srcDir, valideert, bouwt LODs en schrijft distDir. Bij een schending wordt niets geschreven. */
export async function buildAssets(options: BuildOptions): Promise<BuildResult> {
  const { srcDir, distDir } = options;
  const notices: string[] = [];
  const toktx = options.toktx === undefined ? detectToktx() : options.toktx;
  if (!toktx)
    notices.push(
      'toktx niet gevonden op PATH: textures blijven PNG (geen KTX2). Installeer KTX-Software om KTX2 te krijgen.',
    );

  const clipmapSource = options.clipmapPath ?? join(srcDir, 'clipmap.json');
  const rigmapSource = options.rigmapPath ?? join(srcDir, 'rigmap.json');
  let clipmap: Clipmap = EMPTY_CLIPMAP;
  let rigmap: Rigmap = EMPTY_RIGMAP;
  for (const [source, load] of [
    [clipmapSource, (json: unknown) => (clipmap = parseClipmap(json))],
    [rigmapSource, (json: unknown) => (rigmap = parseRigmap(json))],
  ] as const) {
    if (!existsSync(source)) continue;
    try {
      load(JSON.parse(readFileSync(source, 'utf8')));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        reports: [
          {
            id: basename(source, '.json'),
            source: basename(source),
            errors: [`ongeldige ${basename(source)}: ${reason}`],
            warnings: [],
          },
        ],
        notices,
        manifest: null,
      };
    }
  }

  // Gebouwen (src/buildings.ts): de varianten komen uit variants.json; de bron-GLB's daarin zijn zelf geen asset.
  const variantsSource = options.variantsPath ?? join(srcDir, 'buildings', 'variants.json');
  let variants: VariantsConfig | null = null;
  if (existsSync(variantsSource)) {
    try {
      variants = loadVariantsConfig(variantsSource);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        reports: [
          {
            id: basename(variantsSource, '.json'),
            source: relative(srcDir, variantsSource).split(sep).join('/'),
            errors: [`ongeldige ${basename(variantsSource)}: ${reason}`],
            warnings: [],
          },
        ],
        notices,
        manifest: null,
      };
    }
  }
  const variantSources = new Set(
    Object.values(variants?.sources ?? {}).map((source) => source.file.split('\\').join('/')),
  );
  const files = listGlbs(srcDir).filter(
    (file) => !variantSources.has(relative(srcDir, file).split(sep).join('/')),
  );

  const io = createIO();
  const reports: AssetReport[] = [];
  const seen = new Map<string, string>();
  const validated: {
    id: string;
    buffer: Uint8Array;
    kind: 'character' | 'prop';
    conform: ConformInfo;
    sourceBones: number;
  }[] = [];

  for (const file of files) {
    const source = relative(srcDir, file).split(sep).join('/');
    const id = toId(file);
    const report: AssetReport = { id, source, errors: [], warnings: [] };
    reports.push(report);
    const clash = seen.get(id);
    if (clash) {
      report.errors.push(
        `id "${id}" is al in gebruik door ${clash}; hernoem een van beide bestanden.`,
      );
      continue;
    }
    seen.set(id, source);
    try {
      const document = await io.readBinary(new Uint8Array(readFileSync(file)));
      const sourceBones = maxBoneCount(document);
      const conform = await conformDocument(document, { assetId: id, rigmap, clipmap });
      const result = validateAsset(document, { clipmap, assetId: id });
      report.errors.push(...result.errors);
      report.warnings.push(...result.warnings);
      if (result.errors.length === 0)
        validated.push({
          id,
          buffer: await io.writeBinary(document),
          kind: result.kind,
          conform,
          sourceBones,
        });
    } catch (error) {
      report.errors.push(
        `kan GLB niet verwerken: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const buildings = variants
    ? await buildBuildings(variants, srcDir, relative(srcDir, variantsSource).split(sep).join('/'))
    : null;
  for (const report of buildings?.reports ?? []) {
    const clash = seen.get(report.id);
    if (clash)
      report.errors.push(`id "${report.id}" is al in gebruik door ${clash}; hernoem de variant.`);
    reports.push(report);
  }

  if (reports.some((r) => r.errors.length > 0))
    return { ok: false, reports, notices, manifest: null };

  const entries: AssetEntry[] = [...(buildings?.entries ?? [])];
  const outputs = new Map<string, Uint8Array | string>(buildings?.outputs);
  for (const asset of validated) {
    const lods = await buildLods(asset.buffer, asset.kind, { toktx });
    const sourceDoc = await io.readBinary(asset.buffer);
    const report = reports.find((r) => r.id === asset.id)!;
    const maxTris = lodMaxTris(asset.kind);
    const problems = lods.flatMap((lod) => {
      const found: string[] = [];
      if (lod.triangles > maxTris[lod.level] || lod.triangles === 0)
        found.push(
          `LOD${lod.level} heeft ${lod.triangles} driehoeken na simplificatie, budget ${maxTris[lod.level]}.`,
        );
      // Ondergrens van de brief, alleen waar de buis zelf gereduceerd heeft: een bron mag lichter zijn dan de band.
      const reduced =
        lod.level === 0 ? asset.conform.reduced : lod.triangles < (lods[0]?.triangles ?? 0);
      if (
        asset.kind === 'character' &&
        reduced &&
        lod.triangles < BUDGETS.characterMinTris[lod.level]
      ) {
        found.push(
          `LOD${lod.level} heeft ${lod.triangles} driehoeken na simplificatie, minimaal ${BUDGETS.characterMinTris[lod.level]} (brief).`,
        );
      }
      return found;
    });
    if (problems.length > 0) {
      report.errors.push(...problems);
      continue;
    }
    for (const lod of lods) outputs.set(`${asset.id}/lod${lod.level}.glb`, lod.glb);
    const validation = validateAsset(sourceDoc, { clipmap, assetId: asset.id });
    let baked: AssetEntry['baked'];
    if (asset.kind === 'character' && sourceDoc.getRoot().listAnimations().length > 0) {
      const names = sourceDoc
        .getRoot()
        .listAnimations()
        .map((a, i) => a.getName() || `animation_${i}`);
      const lod0Doc = await io.readBinary(lods[0]!.glb);
      const jointNames = (doc: typeof sourceDoc): string =>
        doc
          .getRoot()
          .listSkins()[0]
          ?.listJoints()
          .map((j) => j.getName())
          .join('|') ?? '';
      if (jointNames(lod0Doc) !== jointNames(sourceDoc)) {
        report.errors.push(
          'bone-volgorde van LOD0 wijkt af van de bron-GLB; de texture zou niet bij de mesh passen.',
        );
        continue;
      }
      const result = bakeAnimations({
        assetId: asset.id,
        document: sourceDoc,
        clips: resolveClips(names, clipmap, asset.id).found,
      });
      outputs.set(result.baked.path, result.data);
      baked = result.baked;
    }
    const boneCount = maxBoneCount(sourceDoc);
    report.details = {
      kind: asset.kind,
      sourceTriangles: asset.conform.trianglesBefore,
      lodTriangles: lods.map((lod) => lod.triangles),
      sourceBones: asset.sourceBones,
      bones: boneCount,
      prunedBones: asset.conform.bones?.pruned ?? [],
      channelsDropped: asset.conform.bones?.channelsDropped ?? 0,
      clipsKept: asset.conform.clipsKept,
      clipsDropped: asset.conform.clipsDropped,
      extraUvSetsRemoved: asset.conform.extraUvSetsRemoved,
      scale: asset.conform.scale ?? null,
    };
    entries.push({
      id: asset.id,
      kind: asset.kind,
      bounds: validation.bounds,
      lods: [0, 1, 2].map((level) => ({
        level,
        path: `${asset.id}/lod${level}.glb`,
        triangles: lods[level]?.triangles ?? 0,
      })) as AssetEntry['lods'],
      sockets: asset.kind === 'character' ? findSockets(sourceDoc) : {},
      animations: animationIndex(sourceDoc),
      boneCount,
      ...(baked ? { baked } : {}),
    });
  }

  if (reports.some((r) => r.errors.length > 0))
    return { ok: false, reports, notices, manifest: null };

  const manifest = manifestSchema.parse({
    version: MANIFEST_VERSION,
    assets: entries.sort((a, b) => a.id.localeCompare(b.id)),
  });
  // Validatierapport naast het manifest: deterministisch (geen tijdstempels), assets gesorteerd op id.
  const validationReport = {
    version: 1,
    ok: true,
    assets: [...reports]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((r) => ({
        id: r.id,
        source: r.source,
        errors: r.errors,
        warnings: r.warnings,
        ...r.details,
      })),
  };
  outputs.set('validation-report.json', `${JSON.stringify(validationReport, null, 2)}\n`);
  rmSync(distDir, { recursive: true, force: true });
  mkdirSync(distDir, { recursive: true });
  for (const [path, data] of outputs) {
    mkdirSync(join(distDir, path, '..'), { recursive: true });
    writeFileSync(join(distDir, path), data);
  }
  writeFileSync(join(distDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return { ok: true, reports, notices, manifest };
}
