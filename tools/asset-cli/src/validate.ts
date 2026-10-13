import type { Document } from '@gltf-transform/core';
import { BUDGETS } from './budgets.js';
import { boneNames, computeBounds, countTriangles, findSockets, hasSkin, maxBoneCount, missingMixamoBones, textureSizes, uvSetCount, animationIndex } from './inspect.js';
import type { AssetBounds } from './manifest.js';

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

/** Valideert een bron-GLB tegen de technische brief (spelfundament sectie 9). */
export function validateAsset(document: Document): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const kind: AssetKind = hasSkin(document) ? 'character' : 'prop';
  const triangles = countTriangles(document);
  const bounds = computeBounds(document);

  if (triangles === 0) errors.push('geen driehoeken gevonden in de mesh.');

  const lod0Max = kind === 'character' ? BUDGETS.characterMaxTris[0] : BUDGETS.propMaxTris0;
  if (triangles > lod0Max) errors.push(`${triangles} driehoeken in LOD0, maximaal ${lod0Max} (brief: 3000 tot 4000 voor karakters).`);

  for (const size of textureSizes(document)) {
    if (size.width > BUDGETS.maxTextureSize || size.height > BUDGETS.maxTextureSize) {
      errors.push(`textuur "${size.name}" is ${size.width}x${size.height}, maximaal ${BUDGETS.maxTextureSize}x${BUDGETS.maxTextureSize}.`);
    }
  }

  const uvSets = uvSetCount(document);
  if (uvSets > 1) errors.push(`${uvSets} UV-sets gevonden, de brief eist precies 1 (binnen 0 tot 1).`);

  if (kind === 'character') {
    const bones = maxBoneCount(document);
    if (bones > BUDGETS.maxBones) errors.push(`${bones} bones, maximaal ${BUDGETS.maxBones}.`);

    const missing = missingMixamoBones(boneNames(document));
    if (missing.length > 0) errors.push(`botnamen zijn niet Mixamo-conform; ontbrekend: ${missing.map((b) => `mixamorig:${b}`).join(', ')}.`);

    const height = bounds.max[1] - bounds.min[1];
    const target = BUDGETS.characterHeight;
    if (Math.abs(height - target) > target * BUDGETS.heightTolerance) {
      errors.push(`hoogte is ${height.toFixed(2)} m, verwacht ongeveer ${target} m (schaal: 1 unit is 1 meter, transformaties toegepast).`);
    }
    if (Math.abs(bounds.min[1]) > BUDGETS.feetTolerance) {
      errors.push(`voeten staan op y=${bounds.min[1].toFixed(2)}, verwacht rond 0 (oorsprong op de grond, Y omhoog).`);
    }

    const sockets = findSockets(document);
    for (const name of ['hand', 'back', 'head'] as const) {
      if (!sockets[name]) warnings.push(`geen socket-bone voor "${name}" gevonden; weggelaten uit het manifest.`);
    }
    const clips = new Set(animationIndex(document).map((a) => a.name.toLowerCase()));
    const missingClips = BUDGETS.requiredClips.filter((c) => !clips.has(c));
    if (missingClips.length > 0) warnings.push(`animatieclips ontbreken: ${missingClips.join(', ')}.`);
  }

  return { kind, triangles, bounds, errors, warnings };
}
