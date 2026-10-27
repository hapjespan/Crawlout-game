// Split from build.part2.ts to stay under the 5,000-token file limit; only build.part2.ts calls into this file.
// The back half of the asset build: everything that happens once a source GLB has survived validation. buildAssetLods
// turns each validated asset into three LOD GLBs, a baked animation texture and a manifest entry; writeDist clears the
// dist dir of what this command owns and writes the files, the validation report and the manifest.
import { join } from 'node:path';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import type { NodeIO } from '@gltf-transform/core';
import { type Clipmap, resolveClips } from './clipmap.js';
import type { ConformInfo } from './conform.js';
import { buildLods, lodMaxTris } from './lods.js';
import { type AssetEntry, type AssetManifest, type BodyPalette } from './manifest.js';
import { maxBoneCount, findSockets, animationIndex, materialMaps } from './inspect.js';
import { validateAsset } from './validate.js';
import { BUDGETS } from './budgets.js';
import { bakeAnimations } from './bake.js';
import { PRESERVED_DIST_ENTRIES } from './build.part1.js';
import type { AssetReport } from './build.part1.js';

/** A source GLB that passed validation and is ready to be cut into LODs. */
export interface ValidatedAsset {
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
}

/**
 * Bouwt per gevalideerde bron de drie LOD's, bakt de animaties en zet er een manifest-entry bij. Een asset die zijn
 * driehoeksbudget overschrijdt krijgt een fout in zijn rapport en levert geen entry; de rest loopt door.
 */
export async function buildAssetLods(
  validated: readonly ValidatedAsset[],
  context: {
    io: NodeIO;
    clipmap: Clipmap;
    /** Pad naar de KTX2-encoder, of null (standaard: zie de uitleg in ktx2.ts). */
    toktx: string | null;
    reports: AssetReport[];
    entries: AssetEntry[];
    outputs: Map<string, Uint8Array | string>;
  },
): Promise<void> {
  const { io, clipmap, toktx, reports, entries, outputs } = context;
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
    const maps = materialMaps(sourceDoc);
    report.details = {
      ...(maps.length > 0 ? { maps } : {}),
      kind: asset.kind,
      sourceTriangles: asset.conform.trianglesBefore,
      lodTriangles: lods.map((lod) => lod.triangles),
      lodTextureBytes: lods.map((lod) => lod.textures.bytesAfter),
      lodTextureSizes: lods.map((lod) => lod.textures.maxSize),
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
      ...(asset.conform.teamTrim ? { teamTrim: asset.conform.teamTrim } : {}),
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
      ...(maps.length > 0 ? { maps } : {}),
      ...(baked ? { baked } : {}),
      ...(asset.palette ? { palette: asset.palette } : {}),
    });
  }
}

/** Schrijft de uitvoer naar distDir: eerst leegmaken wat deze opdracht bezit, dan de bestanden en het manifest. */
export function writeDist(
  distDir: string,
  outputs: Map<string, Uint8Array | string>,
  reports: readonly AssetReport[],
  manifest: AssetManifest,
): void {
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
}
