import type { Document } from '@gltf-transform/core';
import { BUDGETS } from './budgets.js';
import {
  boneNames,
  computeBounds,
  facingZ,
  countTriangles,
  findSockets,
  hasSkin,
  maxBoneCount,
  missingMixamoBones,
  textureSizes,
  uvSetCount,
  animationIndex,
} from './inspect.js';
import { EMPTY_CLIPMAP, resolveClips, type Clipmap } from './clipmap.js';
import type { AssetBounds } from './manifest.js';

/** Zolen die minder dan dit achter de enkel uitsteken tellen niet als bewijs van een verkeerde richting. */
const FACING_TOLERANCE = 0.02;

export type AssetKind = 'character' | 'prop';

export interface ValidationResult {
  kind: AssetKind;
  triangles: number;
  bounds: AssetBounds;
  /** Schendingen van de brief; elk een leesbare reden. Leeg = geslaagd. */
  errors: string[];
  /** Afwijkingen die de build niet blokkeren. */
  warnings: string[];
}

/**
 * Valideert een bron-GLB tegen de technische brief (spelfundament sectie 9).
 *
 * `height`: de hoogte waar de config het karakter op gezet heeft (rigmap `fit.height`). Zonder die opgave geldt de 1,8 m
 * van de brief. Een karakter dat van zichzelf groter is (het krachtpantser van 2,25 m) wordt zo op zijn eigen maat
 * gecontroleerd in plaats van afgekeurd; de bron die wel op 1,8 m hoort te staan, blijft afgekeurd worden.
 */
export function validateAsset(
  document: Document,
  options: { clipmap?: Clipmap; assetId?: string; height?: number | undefined } = {},
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const kind: AssetKind = hasSkin(document) ? 'character' : 'prop';
  const triangles = countTriangles(document);
  const bounds = computeBounds(document);

  if (triangles === 0) errors.push('geen driehoeken gevonden in de mesh.');

  const lod0Max = kind === 'character' ? BUDGETS.characterMaxTris[0] : BUDGETS.propMaxTris[0];
  if (triangles > lod0Max)
    errors.push(
      `${triangles} driehoeken in LOD0, maximaal ${lod0Max} (brief: 3000 tot 4000 voor karakters; props: zie budgets.ts).`,
    );

  for (const size of textureSizes(document)) {
    if (size.width > BUDGETS.maxTextureSize || size.height > BUDGETS.maxTextureSize) {
      errors.push(
        `textuur "${size.name}" is ${size.width}x${size.height}, maximaal ${BUDGETS.maxTextureSize}x${BUDGETS.maxTextureSize}.`,
      );
    }
  }

  const uvSets = uvSetCount(document);
  if (uvSets > 1)
    errors.push(`${uvSets} UV-sets gevonden, de brief eist precies 1 (binnen 0 tot 1).`);

  if (kind === 'character') {
    const bones = maxBoneCount(document);
    if (bones > BUDGETS.maxBones) errors.push(`${bones} bones, maximaal ${BUDGETS.maxBones}.`);

    const missing = missingMixamoBones(boneNames(document));
    if (missing.length > 0)
      errors.push(
        `botnamen zijn niet Mixamo-conform; ontbrekend: ${missing.map((b) => `mixamorig:${b}`).join(', ')}.`,
      );

    const height = bounds.max[1] - bounds.min[1];
    const target = options.height ?? BUDGETS.characterHeight;
    if (Math.abs(height - target) > target * BUDGETS.heightTolerance) {
      errors.push(
        `hoogte is ${height.toFixed(2)} m, verwacht ongeveer ${target} m (schaal: 1 unit is 1 meter, transformaties toegepast).`,
      );
    }
    if (Math.abs(bounds.min[1]) > BUDGETS.feetTolerance) {
      errors.push(
        `voeten staan op y=${bounds.min[1].toFixed(2)}, verwacht rond 0 (oorsprong op de grond, Y omhoog).`,
      );
    }

    const facing = facingZ(document);
    if (facing !== null && facing < -FACING_TOLERANCE) {
      errors.push(
        `het model lijkt naar -Z te kijken (voeten wijzen ${facing.toFixed(2)} m achter de enkel); de brief eist gezicht naar +Z.`,
      );
    }

    const sockets = findSockets(document);
    for (const name of ['hand', 'back', 'head'] as const) {
      if (!sockets[name])
        warnings.push(`geen socket-bone voor "${name}" gevonden; weggelaten uit het manifest.`);
    }
    const skins = document.getRoot().listSkins();
    if (skins.length > 1)
      errors.push(
        `${skins.length} skins gevonden; de bakker en render verwachten precies 1 skelet per karakter.`,
      );
    const jointCount = skins[0]?.listJoints().length ?? 0;
    for (const prim of document
      .getRoot()
      .listMeshes()
      .flatMap((m) => m.listPrimitives())) {
      const joints = prim.getAttribute('JOINTS_0');
      if (!joints) continue;
      let max = 0;
      const el: number[] = [0, 0, 0, 0];
      for (let i = 0; i < joints.getCount(); i++)
        for (const j of joints.getElement(i, el)) max = Math.max(max, j);
      if (max >= jointCount) {
        errors.push(
          `skinIndex ${max} wijst buiten de ${jointCount} joints van de skin; mesh en bone-volgorde zijn inconsistent.`,
        );
        break;
      }
    }

    const animations = animationIndex(document);
    if (animations.length === 0) {
      warnings.push('geen animatieclips; er wordt geen bone-matrix-texture gebakken.');
    } else {
      errors.push(
        ...resolveClips(
          animations.map((a) => a.name),
          options.clipmap ?? EMPTY_CLIPMAP,
          options.assetId,
        ).errors,
      );
    }
  }

  return { kind, triangles, bounds, errors, warnings };
}
