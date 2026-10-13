import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';
import { BUDGETS } from './budgets.js';
import { animationIndex, findSockets, maxBoneCount } from './inspect.js';
import { buildLods, createIO, lodTargets } from './lods.js';
import { detectToktx } from './ktx2.js';
import { MANIFEST_VERSION, manifestSchema, type AssetEntry, type AssetManifest } from './manifest.js';
import { validateAsset } from './validate.js';

export interface BuildOptions {
  srcDir: string;
  distDir: string;
  /** Overschrijf de toktx-detectie (tests). `null` forceert PNG. */
  toktx?: string | null;
}

export interface AssetReport {
  id: string;
  source: string;
  errors: string[];
  warnings: string[];
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
  return basename(file).replace(/\.glb$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/** Leest alle GLB's uit srcDir, valideert, bouwt LODs en schrijft distDir. Bij een schending wordt niets geschreven. */
export async function buildAssets(options: BuildOptions): Promise<BuildResult> {
  const { srcDir, distDir } = options;
  const files = listGlbs(srcDir);
  const notices: string[] = [];
  const toktx = options.toktx === undefined ? detectToktx() : options.toktx;
  if (!toktx) notices.push('toktx niet gevonden op PATH: textures blijven PNG (geen KTX2). Installeer KTX-Software om KTX2 te krijgen.');

  const io = createIO();
  const reports: AssetReport[] = [];
  const seen = new Map<string, string>();
  const validated: { id: string; file: string; buffer: Uint8Array; kind: 'character' | 'prop' }[] = [];

  for (const file of files) {
    const source = relative(srcDir, file).split(sep).join('/');
    const id = toId(file);
    const report: AssetReport = { id, source, errors: [], warnings: [] };
    reports.push(report);
    const clash = seen.get(id);
    if (clash) {
      report.errors.push(`id "${id}" is al in gebruik door ${clash}; hernoem een van beide bestanden.`);
      continue;
    }
    seen.set(id, source);
    const buffer = new Uint8Array(readFileSync(file));
    try {
      const document = await io.readBinary(buffer);
      const result = validateAsset(document);
      report.errors.push(...result.errors);
      report.warnings.push(...result.warnings);
      if (result.errors.length === 0) validated.push({ id, file, buffer, kind: result.kind });
    } catch (error) {
      report.errors.push(`kan GLB niet lezen: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (reports.some((r) => r.errors.length > 0)) return { ok: false, reports, notices, manifest: null };

  const entries: AssetEntry[] = [];
  const outputs = new Map<string, Uint8Array>();
  for (const asset of validated) {
    const lods = await buildLods(asset.buffer, asset.kind, { toktx });
    const sourceDoc = await io.readBinary(asset.buffer);
    const report = reports.find((r) => r.id === asset.id);
    const maxTris = asset.kind === 'character' ? BUDGETS.characterMaxTris : lodTargets('prop', lods[0]?.triangles ?? 0);
    const tooHeavy = lods.filter((lod) => lod.triangles > (maxTris[lod.level] ?? 0) || lod.triangles === 0);
    if (tooHeavy.length > 0) {
      report?.errors.push(...tooHeavy.map((lod) => `LOD${lod.level} heeft ${lod.triangles} driehoeken na simplificatie, budget ${maxTris[lod.level]}.`));
      continue;
    }
    for (const lod of lods) outputs.set(`${asset.id}/lod${lod.level}.glb`, lod.glb);
    const validation = validateAsset(sourceDoc);
    entries.push({
      id: asset.id,
      kind: asset.kind,
      bounds: validation.bounds,
      lods: [0, 1, 2].map((level) => ({ level, path: `${asset.id}/lod${level}.glb`, triangles: lods[level]?.triangles ?? 0 })) as AssetEntry['lods'],
      sockets: asset.kind === 'character' ? findSockets(sourceDoc) : {},
      animations: animationIndex(sourceDoc),
      boneCount: maxBoneCount(sourceDoc),
    });
  }

  if (reports.some((r) => r.errors.length > 0)) return { ok: false, reports, notices, manifest: null };

  const manifest = manifestSchema.parse({ version: MANIFEST_VERSION, assets: entries.sort((a, b) => a.id.localeCompare(b.id)) });
  rmSync(distDir, { recursive: true, force: true });
  mkdirSync(distDir, { recursive: true });
  for (const [path, data] of outputs) {
    mkdirSync(join(distDir, path, '..'), { recursive: true });
    writeFileSync(join(distDir, path), data);
  }
  writeFileSync(join(distDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return { ok: true, reports, notices, manifest };
}
