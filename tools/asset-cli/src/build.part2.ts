// Split from build.ts to stay under the 5,000-token file limit; build.ts re-exports the public surface.
// Holds: buildAssets.
import { detectToktx } from './ktx2.js';
import { join, basename, relative, sep, resolve, dirname } from 'node:path';
import { type Clipmap, EMPTY_CLIPMAP, parseClipmap, resolveClips } from './clipmap.js';
import { type Rigmap, EMPTY_RIGMAP, parseRigmap } from './rigmap.js';
import { existsSync, readFileSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import type { VariantsConfig } from './variants.js';
import { loadVariantsConfig, hexToLinear, buildBuildings } from './buildings.js';
import { createIO, buildLods, lodMaxTris } from './lods.js';
import { type ConformInfo, autoRigFromConfig, conformDocument } from './conform.js';
import { type BodyPalette, type AssetEntry, manifestSchema, MANIFEST_VERSION } from './manifest.js';
import { maxBoneCount, findSockets, animationIndex } from './inspect.js';
import { validateAsset } from './validate.js';
import { type RobotsResult, buildRobots, loadRobotsConfig } from './robots.js';
import { splitJsonExists } from './splitJson.js';
import { buildDelivered, loadDeliveredConfig } from './delivered.js';
import { type PacksConfig, loadPacksConfig, buildPacks, findPacksDir } from './packs.js';
import { BUDGETS } from './budgets.js';
import { bakeAnimations } from './bake.js';
import { PRESERVED_DIST_ENTRIES, listGlbs, toId } from './build.part1.js';
import type { AssetReport, BuildOptions, BuildResult } from './build.part1.js';

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
  const validated: {
    id: string;
    sourceId: string;
    buffer: Uint8Array;
    kind: 'character' | 'prop';
    conform: ConformInfo;
    sourceBones: number;
    /** A derived (re-coloured) asset shares the baked animation texture of this asset id. */
    bakedFrom?: string;
    /** Clothing palette of a derived body (manifest `palette`). */
    palette?: BodyPalette;
  }[] = [];

  // Auto-rig entries name their own source (a static mesh, for example under delivered/); the key is the source id.
  const sources = [
    ...files.map((file) => ({ file, sourceId: toId(file) })),
    ...Object.entries(rigmap.assets)
      .filter(([, entry]) => entry.autoRig)
      .map(([key, entry]) => ({
        file: resolve(dirname(rigmapSource), entry.autoRig!.from),
        sourceId: key,
      })),
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
      const result = validateAsset(document, { clipmap, assetId: sourceId });
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
          if (derivedReport.errors.length === 0)
            validated.push({
              id: derived.id,
              sourceId,
              buffer: await io.writeBinary(recoloured),
              kind: result.kind,
              conform,
              sourceBones,
              bakedFrom: id,
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
    reports.push(report);
  }

  // Procedural models (src/robots.ts): the Dweller robots (robots.json), the Raiders (raiders.json), the Dweller gear (dwellers-gear.json) and the site ruins and restored sites (sites.json), each config
  // with rigid units, buildings and attachments from basic shapes.
  const robotConfigs = [
    options.robotsPath ?? join(srcDir, 'robots.json'),
    options.raidersPath ?? join(srcDir, 'raiders.json'),
    options.dwellersGearPath ?? join(srcDir, 'dwellers-gear.json'),
    options.sitesPath ?? join(srcDir, 'sites.json'),
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
  const bakedById = new Map<string, AssetEntry['baked']>();
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
    const validation = validateAsset(sourceDoc, { clipmap, assetId: asset.sourceId });
    let baked: AssetEntry['baked'];
    if (asset.bakedFrom) {
      baked = bakedById.get(asset.bakedFrom);
      if (!baked) {
        report.errors.push(`geen gebakken animaties van ${asset.bakedFrom} om te delen.`);
        continue;
      }
    } else if (asset.kind === 'character' && sourceDoc.getRoot().listAnimations().length > 0) {
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
        clips: resolveClips(names, clipmap, asset.sourceId).found,
      });
      outputs.set(result.baked.path, result.data);
      baked = result.baked;
      bakedById.set(asset.id, baked);
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
      ...(asset.conform.meshesRemoved ? { meshesRemoved: asset.conform.meshesRemoved } : {}),
      ...(asset.conform.fit ? { fit: asset.conform.fit } : {}),
      ...(asset.conform.retarget ? { retarget: asset.conform.retarget } : {}),
      ...(asset.conform.atlas ? { atlas: asset.conform.atlas } : {}),
      ...(asset.conform.teamMask ? { teamMask: asset.conform.teamMask } : {}),
      ...(asset.conform.normalsComputed ? { normalsComputed: asset.conform.normalsComputed } : {}),
      ...(asset.conform.autoRig ? { autoRig: asset.conform.autoRig } : {}),
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
      teamMask: asset.conform.teamMask ? 'diffuseAlpha' : 'materialName',
      ...(baked ? { baked } : {}),
      ...(asset.palette ? { palette: asset.palette } : {}),
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
  // Clear previous output, but keep what other commands own (`terrain` writes assets/dist/terrain).
  mkdirSync(distDir, { recursive: true });
  for (const entry of readdirSync(distDir)) {
    if (!PRESERVED_DIST_ENTRIES.has(entry))
      rmSync(join(distDir, entry), { recursive: true, force: true });
  }
  for (const [path, data] of outputs) {
    mkdirSync(join(distDir, path, '..'), { recursive: true });
    writeFileSync(join(distDir, path), data);
  }
  writeFileSync(join(distDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return { ok: true, reports, notices, manifest };
}
