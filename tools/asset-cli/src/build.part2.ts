// Split from build.ts to stay under the 5,000-token file limit; build.ts re-exports the public surface.
// Holds: buildAssets, the front half of the build (configs lezen, bronnen valideren, de gegenereerde families
// bouwen). De LOD-stap en het schrijven van dist staan in build.part3.ts.
import { detectKtx2Encoder } from './ktx2.js';
import { join, basename, relative, sep, dirname } from 'node:path';
import { type Clipmap, EMPTY_CLIPMAP, parseClipmap } from './clipmap.js';
import { type Rigmap, EMPTY_RIGMAP, namedSources, parseRigmap } from './rigmap.js';
import { existsSync, readFileSync } from 'node:fs';
import type { VariantsConfig } from './variants.js';
import { loadVariantsConfig, hexToLinear, buildBuildings } from './buildings.js';
import { createIO } from './lods.js';
import { autoRigFromConfig, conformDocument } from './conform.js';
import { type AssetEntry, manifestSchema, MANIFEST_VERSION } from './manifest.js';
import { maxBoneCount } from './inspect.js';
import { validateAsset } from './validate.js';
import { scaleSkinnedDocument } from './deriveScale.js';
import { type RobotsResult, buildRobots, loadRobotsConfig } from './robots.js';
import { splitJsonExists } from './splitJson.js';
import { buildDelivered, loadDeliveredConfig } from './delivered.js';
import { type PacksConfig, loadPacksConfig, buildPacks, findPacksDir } from './packs.js';
import { buildSurfaceTiles } from './surfaceTiles.js';
import { listGlbs, toId } from './build.part1.js';
import type { AssetReport, BuildOptions, BuildResult } from './build.part1.js';
import { type ValidatedAsset, buildAssetLods, writeDist } from './build.part3.js';

/** Leest alle GLB's uit srcDir, valideert, bouwt LODs en schrijft distDir. Bij een schending wordt niets geschreven. */
export async function buildAssets(options: BuildOptions): Promise<BuildResult> {
  const { srcDir, distDir } = options;
  const notices: string[] = [];
  // KTX2 staat standaard uit, ook als er een encoder op PATH staat: de render-buis rastert elke textuur naar een
  // RGBA8 DataArrayTexture en kan een CompressedTexture niet lezen (ktx2.ts legt uit wat het zou kosten). `--ktx2`
  // zet hem aan voor een meting.
  const toktx = options.toktx === undefined ? null : (options.toktx ?? null);
  if (options.toktx === null && detectKtx2Encoder())
    notices.push(
      'KTX2-encoder gevonden maar niet gebruikt: de render-buis leest alleen ongecomprimeerde textures (zie ktx2.ts).',
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
  if (splitJsonExists(variantsSource)) {
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
  // assets/src/packs (de grote pack-bronnen, buiten git) loopt via packs.json, niet als losse props.
  const files = listGlbs(srcDir).filter((file) => {
    const relativePath = relative(srcDir, file).split(sep).join('/');
    return (
      !variantSources.has(relativePath) &&
      !relativePath.startsWith('packs/') &&
      !relativePath.startsWith('delivered/')
    );
  });

  const io = createIO();
  const reports: AssetReport[] = [];
  const seen = new Map<string, string>();
  const validated: ValidatedAsset[] = [];

  const sources = [
    ...files.map((file) => ({ file, sourceId: toId(file) })),
    ...namedSources(rigmap, dirname(rigmapSource)),
  ];
  for (const { file, sourceId } of sources) {
    const source = relative(srcDir, file).split(sep).join('/');
    if (options.onlyConfigured && !rigmap.assets[sourceId]) {
      notices.push(`${source} overgeslagen: geen entry in ${basename(rigmapSource)}.`);
      continue;
    }
    // Rigmap en clipmap gebruiken de bestandsnaam-id; `id` in de rigmap publiceert onder een andere id.
    const id = rigmap.assets[sourceId]?.id ?? sourceId;
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
      let document = await io.readBinary(new Uint8Array(readFileSync(file)));
      const autoRigConfig = rigmap.assets[sourceId]?.autoRig;
      const rigged = autoRigConfig
        ? await autoRigFromConfig(document, autoRigConfig, dirname(rigmapSource))
        : null;
      if (rigged) document = rigged.document;
      const sourceBones = maxBoneCount(document);
      const conform = await conformDocument(document, {
        assetId: sourceId,
        rigmap,
        clipmap,
        configDir: dirname(rigmapSource),
      });
      if (rigged) conform.autoRig = rigged.info;
      const height = rigmap.assets[sourceId]?.fit?.height ?? autoRigConfig?.height;
      const result = validateAsset(document, { clipmap, assetId: sourceId, height });
      report.errors.push(...result.errors);
      report.warnings.push(...result.warnings);
      if (result.errors.length === 0) {
        const buffer = await io.writeBinary(document);
        validated.push({ id, sourceId, buffer, kind: result.kind, conform, sourceBones });
        for (const derived of rigmap.assets[sourceId]?.derive ?? []) {
          const derivedReport: AssetReport = { id: derived.id, source, errors: [], warnings: [] };
          reports.push(derivedReport);
          const derivedClash = seen.get(derived.id);
          if (derivedClash) {
            derivedReport.errors.push(`id "${derived.id}" is al in gebruik door ${derivedClash}.`);
            continue;
          }
          seen.set(derived.id, source);
          const recoloured = await io.readBinary(buffer);
          const materials = new Map(
            recoloured
              .getRoot()
              .listMaterials()
              .map((m) => [m.getName(), m]),
          );
          for (const [name, color] of Object.entries(derived.colors)) {
            const material = materials.get(name);
            if (material) material.setBaseColorFactor([...hexToLinear(color), 1]);
            else derivedReport.errors.push(`derive: geen materiaal "${name}" in ${source}.`);
          }
          if (derived.scale !== undefined) scaleSkinnedDocument(recoloured, derived.scale);
          if (derivedReport.errors.length === 0)
            validated.push({
              id: derived.id,
              sourceId,
              buffer: await io.writeBinary(recoloured),
              kind: result.kind,
              conform,
              sourceBones,
              ...(derived.scale === undefined ? { bakedFrom: id } : {}),
              ...(derived.palette ? { palette: derived.palette } : {}),
            });
        }
      }
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
    else seen.set(report.id, report.source);
    reports.push(report);
  }

  // Procedural models (src/robots.ts): the Dweller robots (robots.json), the Raiders (raiders.json), the Dweller gear (dwellers-gear.json) and the site ruins and restored sites (sites.json), each config
  // with rigid units, buildings and attachments from basic shapes.
  const robotConfigs = [
    options.robotsPath ?? join(srcDir, 'robots.json'),
    options.raidersPath ?? join(srcDir, 'raiders.json'),
    options.dwellersGearPath ?? join(srcDir, 'dwellers-gear.json'),
    options.sitesPath ?? join(srcDir, 'sites.json'),
    options.survivalPath ?? join(srcDir, 'survival.json'),
    options.gardePath ?? join(srcDir, 'garde.json'),
  ].filter((path) => splitJsonExists(path));
  const robots: RobotsResult = { reports: [], entries: [], outputs: new Map() };
  for (const robotsSource of robotConfigs) {
    const source = relative(srcDir, robotsSource).split(sep).join('/');
    try {
      const built = await buildRobots(loadRobotsConfig(robotsSource), source);
      robots.reports.push(...built.reports);
      robots.entries.push(...built.entries);
      for (const [path, data] of built.outputs) robots.outputs.set(path, data);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        reports: [
          {
            id: basename(robotsSource, '.json'),
            source,
            errors: [`ongeldige ${basename(robotsSource)}: ${reason}`],
            warnings: [],
          },
        ],
        notices,
        manifest: null,
      };
    }
  }
  for (const report of robots.reports) {
    const clash = seen.get(report.id);
    if (clash)
      report.errors.push(`id "${report.id}" is al in gebruik door ${clash}; hernoem de robot.`);
    seen.set(report.id, report.source);
    reports.push(report);
  }

  // Delivered models (src/delivered.ts): GLB's processed as delivered, config assets/local/delivered.json (local pipeline).
  const deliveredSource = options.deliveredPath ?? join(srcDir, 'delivered.json');
  const delivered: RobotsResult = { reports: [], entries: [], outputs: new Map() };
  if (existsSync(deliveredSource)) {
    const source = relative(srcDir, deliveredSource).split(sep).join('/');
    try {
      const built = await buildDelivered(loadDeliveredConfig(deliveredSource), srcDir, source);
      delivered.reports.push(...built.reports);
      delivered.entries.push(...built.entries);
      for (const [path, data] of built.outputs) delivered.outputs.set(path, data);
      for (const report of delivered.reports) {
        const details = built.details.get(report.id);
        if (details) (report as AssetReport).details = details;
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        reports: [
          {
            id: basename(deliveredSource, '.json'),
            source,
            errors: [`ongeldige ${basename(deliveredSource)}: ${reason}`],
            warnings: [],
          },
        ],
        notices,
        manifest: null,
      };
    }
  }
  for (const report of delivered.reports) {
    const clash = seen.get(report.id);
    if (clash) report.errors.push(`id "${report.id}" is al in gebruik door ${clash}.`);
    seen.set(report.id, report.source);
    reports.push(report);
  }

  // Prop-packs (src/packs.ts): splitsen, echte schaal, atlas en LOD's volgens packs.json.
  const packsSource = options.packsPath ?? join(srcDir, 'packs.json');
  let packsConfig: PacksConfig | null = null;
  if (existsSync(packsSource)) {
    try {
      packsConfig = loadPacksConfig(packsSource);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        reports: [
          {
            id: basename(packsSource, '.json'),
            source: relative(srcDir, packsSource).split(sep).join('/'),
            errors: [`ongeldige ${basename(packsSource)}: ${reason}`],
            warnings: [],
          },
        ],
        notices,
        manifest: null,
      };
    }
  }
  const packs = packsConfig
    ? await buildPacks(packsConfig, {
        packsDir: options.packsDir === undefined ? findPacksDir(srcDir) : options.packsDir,
        previousDist: distDir,
      })
    : null;
  for (const report of packs?.reports ?? []) {
    const clash = seen.get(report.id);
    if (clash)
      report.errors.push(`id "${report.id}" is al in gebruik door ${clash}; hernoem het prop.`);
    seen.set(report.id, `packs/${report.id}`);
    reports.push(report);
  }

  if (reports.some((r) => r.errors.length > 0))
    return { ok: false, reports, notices, manifest: null };

  const entries: AssetEntry[] = [
    ...(buildings?.entries ?? []),
    ...robots.entries,
    ...delivered.entries,
    ...(packs?.entries ?? []),
  ];
  const outputs = new Map<string, Uint8Array | string>([
    ...(buildings?.outputs ?? []),
    ...robots.outputs,
    ...delivered.outputs,
    ...(packs?.outputs ?? []),
  ]);
  await buildAssetLods(validated, { io, clipmap, toktx, reports, entries, outputs });

  if (reports.some((r) => r.errors.length > 0))
    return { ok: false, reports, notices, manifest: null };

  // The shared surface tiles (src/surfaceTiles.ts): one file set next to manifest.json instead of a copy inside
  // every GLB whose materials carry `extras.surface`.
  const { outputs: tileFiles, surfaces } = await buildSurfaceTiles();
  for (const [path, data] of tileFiles) outputs.set(path, data);

  const manifest = manifestSchema.parse({
    version: MANIFEST_VERSION,
    assets: entries.sort((a, b) => a.id.localeCompare(b.id)),
    surfaces,
  });
  writeDist(distDir, outputs, reports, manifest);
  return { ok: true, reports, notices, manifest };
}
