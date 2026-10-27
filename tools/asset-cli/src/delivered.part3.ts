// Split from delivered.ts to stay under the 5,000-token file limit; delivered.ts re-exports the public surface.
// Holds: buildDelivered.
import type { RobotsResult } from './robots.js';
import { MeshoptSimplifier } from 'meshoptimizer';
import { join } from 'node:path';
import { expandParts } from './partExpand.js';
import type { VariantPart } from './variants.js';
import {
  placeShape,
  type BuildingLod,
  hexToLinear,
  finishBuildingLod,
  validateBuildingDocument,
} from './buildings.js';
import { MeshAccumulator } from './geometry.js';
import { BUDGETS } from './budgets.js';
import { getBounds } from '@gltf-transform/functions';
import { materialMaps } from './inspect.js';
import type { AssetEntry } from './manifest.js';
import { extract, slug } from './delivered.part1.js';
import type { DeliveredConfig, V3 } from './delivered.part1.js';
import {
  assembleDocument,
  deliveredLodTargets,
  oddCeil,
  placeModel,
  reduceGroups,
  regroundY,
  round6,
} from './delivered.part2.js';
import type { DeliveredDetails, OutGroup } from './delivered.part2.js';

/** Builds every asset of the config: 3 LODs, validation, manifest entries. Source files are relative to `srcDir`. */
export async function buildDelivered(
  config: DeliveredConfig,
  srcDir: string,
  configSource: string,
): Promise<RobotsResult & { details: Map<string, DeliveredDetails> }> {
  await MeshoptSimplifier.ready;
  const result: RobotsResult & { details: Map<string, DeliveredDetails> } = {
    reports: [],
    entries: [],
    outputs: new Map(),
    details: new Map(),
  };
  for (const id of Object.keys(config.assets).sort()) {
    const asset = config.assets[id]!;
    const ids = [id, ...(asset.alias ?? [])];
    const report: RobotsResult['reports'][number] = {
      id,
      source: configSource,
      errors: [],
      warnings: [],
    };
    result.reports.push(report);
    try {
      const file = join(srcDir, asset.file);
      const { parts, sourceTriangles, warnings } = await extract(file, asset);
      report.warnings.push(...warnings);
      const placed = placeModel(parts, asset, sourceTriangles, id);
      report.warnings.push(...placed.warnings);
      const extra = expandParts(asset.extraParts as VariantPart[]).map((part) => ({
        material: (part as { material: string }).material,
        mesh: placeShape(part as Exclude<VariantPart, { type: 'house' }>),
      }));
      const targets = deliveredLodTargets(asset.kind, asset.lod0Triangles);
      const atlasName = asset.atlasName ?? `${slug(asset.surface)}_${slug(id)}_atlas`;
      const lods: BuildingLod[] = [];
      let materials: string[] = [];
      for (const level of [0, 1, 2] as const) {
        const reduced = reduceGroups(
          placed.groups,
          extra,
          targets[level],
          targets[level] / targets[0],
          asset.simplify,
        );
        const extraGroups: OutGroup[] = [];
        for (const e of extra) {
          const flat = config.flatMaterials[e.material]!;
          const existing = extraGroups.find((g) => g.name === e.material);
          if (existing) {
            const acc = new MeshAccumulator();
            acc.add(existing.mesh);
            acc.add(e.mesh);
            existing.mesh = acc.build();
          } else
            extraGroups.push({
              name: e.material,
              mesh: e.mesh,
              color: hexToLinear(flat.color),
              texture: null,
            });
        }
        if (asset.kind !== 'prop') regroundY(reduced, extraGroups, asset.hover ?? 0);
        const document = await assembleDocument(
          id,
          [...reduced, ...extraGroups],
          asset.atlas,
          atlasName,
        );
        if (level === 0)
          materials = document
            .getRoot()
            .listMaterials()
            .map((m) => m.getName())
            .sort();
        const lod = await finishBuildingLod(document, level);
        report.errors.push(...validateBuildingDocument(lod.document, level, asset.kind !== 'prop'));
        const cap = asset.kind === 'building' ? BUDGETS.buildingMaxTris : BUDGETS.rigidUnitMaxTris;
        if (lod.triangles > cap[level])
          report.errors.push(
            `LOD${level} heeft ${lod.triangles} driehoeken, budget ${cap[level]}.`,
          );
        lods.push(lod);
      }
      const { min, max } = getBounds(lods[0]!.document.getRoot().listScenes()[0]!);
      const size: V3 = [max[0]! - min[0]!, max[1]! - min[1]!, max[2]! - min[2]!];
      if (asset.kind !== 'prop' && Math.abs(min[1]! - (asset.hover ?? 0)) > BUDGETS.hoverTolerance)
        report.errors.push(
          `de onderkant staat op y=${min[1]!.toFixed(3)}, verwacht ${asset.hover ?? 0}`,
        );
      let neededFootprint: DeliveredDetails['neededFootprint'];
      if (asset.kind === 'building') {
        neededFootprint = { w: oddCeil(size[0]), h: oddCeil(size[2]) };
        const fp = asset.footprint!;
        // Too big for the footprint, or so much smaller that the footprint reserves a strip of ground for nothing.
        // Both bounds follow `oddCeil`, which maps the metres onto the next odd cell count: a footprint of n cells
        // legitimately holds a model from just over n-2 up to n metres. The old test compared the longest side in
        // metres against the longest side in cells with a flat 15 procent, which flagged models that fit exactly and
        // then recommended the footprint they already had (the tent: 5,01 x 4,75 m in 7x5, "nodig: 7x5"), while a
        // model 0,23 m over its cells stayed silent.
        const over = size[0] > fp.w * 1.05 || size[2] > fp.h * 1.05;
        const under = size[0] <= fp.w - 2 || size[2] <= fp.h - 2;
        if (over || under)
          report.warnings.push(
            `echte maat ${size[0].toFixed(2)} x ${size[2].toFixed(2)} m past niet bij de footprint ${fp.w}x${fp.h} van de data (${over ? 'het model steekt erbuiten' : 'de footprint reserveert een strook grond voor niets'}); het model is niet gekrompen of opgerekt. Nodig: ${neededFootprint.w}x${neededFootprint.h}.`,
          );
      }
      if (report.errors.length > 0) continue;
      const teamMaterials = lods[0]!.document
        .getRoot()
        .listMaterials()
        .map((m) => m.getName())
        .filter((name) => /team/i.test(name))
        .sort();
      // Welke kaarten de LOD's halen, staat in het manifest zodat render weet dat er naast de basiskleur-array een
      // normal- en metallic-roughness-array te bouwen is (dezelfde laagindex).
      const maps = materialMaps(lods[0]!.document);
      const details: DeliveredDetails = {
        kind: asset.kind,
        sourceTriangles,
        lodTriangles: lods.map((l) => l.triangles),
        materials,
        ...(maps.length > 0 ? { maps } : {}),
        sizeM: round6(size),
        scale: Math.round(placed.scale * 1e6) / 1e6,
        ...(asset.hover !== undefined ? { hover: asset.hover } : {}),
        ...(neededFootprint ? { neededFootprint } : {}),
      };
      for (const outId of ids) {
        for (const lod of lods) result.outputs.set(`${outId}/lod${lod.level}.glb`, lod.glb);
        result.details.set(outId, details);
        result.entries.push({
          id: outId,
          kind: asset.kind,
          bounds: { min: round6(min), max: round6(max) },
          lods: lods.map((lod) => ({
            level: lod.level,
            path: `${outId}/lod${lod.level}.glb`,
            triangles: lod.triangles,
          })) as AssetEntry['lods'],
          sockets: {},
          animations: [],
          boneCount: 0,
          ...(maps.length > 0 ? { maps } : {}),
          ...(asset.kind === 'prop' ? { teamMask: 'none' as const } : { teamMaterials }),
          ...(asset.kind === 'rigid-unit'
            ? {
                rigid: true as const,
                teamMask: 'materialName' as const,
                ...(asset.hover !== undefined ? { hover: asset.hover } : {}),
              }
            : asset.kind === 'building'
              ? { footprint: asset.footprint! }
              : {}),
        });
        if (outId !== id)
          result.reports.push({
            id: outId,
            source: configSource,
            errors: [],
            warnings: [`alias van ${id}`],
          });
      }
    } catch (error) {
      report.errors.push(
        `kan model niet bouwen: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return result;
}
