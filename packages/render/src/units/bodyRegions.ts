// Clothing regions of a mannequin character, by bone name. A character whose only material is the "main" one (the
// Quaternius mannequin; gltfUnitGeometry.ts TEAM_MATERIAL_FALLBACK) used to be team colored from head to toe: a
// saturated plastic doll. With regions the team color is an accent on the upper chest, back and shoulders (a vest and
// pauldrons, the part that reads from an RTS camera looking down) and the rest is dusty clothing: a khaki jacket,
// dark trousers, leather boots, skin on the head and hands. The regions follow the skin weights, so a seam between
// two regions blends over the vertices that share the bones.
import { linearOf, WASTELAND } from '../palette.js';

export type BodyRegion = 'team' | 'jacket' | 'belt' | 'trousers' | 'boots' | 'skin';

export const REGION_COLORS: Readonly<Record<Exclude<BodyRegion, 'team'>, number>> = {
  jacket: 0x786f52,
  belt: 0x4a3626,
  trousers: 0x4d4538,
  boots: WASTELAND.soot,
  skin: 0xa07258,
};

/** Mixamo bone names (the asset-cli conforms every character to them) to the region they clothe. */
const REGION_OF_BONE: Readonly<Record<string, BodyRegion>> = {
  Head: 'skin',
  Neck: 'skin',
  LeftHand: 'skin',
  RightHand: 'skin',
  Spine2: 'team',
  LeftShoulder: 'team',
  RightShoulder: 'team',
  Spine1: 'jacket',
  Spine: 'jacket',
  LeftArm: 'jacket',
  RightArm: 'jacket',
  LeftForeArm: 'jacket',
  RightForeArm: 'jacket',
  Hips: 'belt',
  LeftUpLeg: 'trousers',
  RightUpLeg: 'trousers',
  LeftLeg: 'trousers',
  RightLeg: 'trousers',
  LeftFoot: 'boots',
  RightFoot: 'boots',
};

/** Region of a bone, or null for a name that is not a body bone (then the asset keeps its own colors). */
export function regionOfBone(name: string): BodyRegion | null {
  return REGION_OF_BONE[name] ?? null;
}

/** True when the skeleton has the bones the regions need (a chest and shoulders to carry the team color). */
export function hasBodyRegions(boneNames: readonly string[]): boolean {
  return boneNames.includes('Spine2') && boneNames.includes('LeftShoulder');
}

export interface VertexRegion {
  /** Team mask 0..1 (the share of the vertex's skin weight on team bones). */
  team: number;
  /** Linear base color of the clothing under the vertex (the non-team regions, weighted). */
  color: [number, number, number];
}

const LINEAR = Object.fromEntries(
  Object.entries(REGION_COLORS).map(([k, hex]) => [k, linearOf(hex)]),
) as Record<Exclude<BodyRegion, 'team'>, [number, number, number]>;

/**
 * The region of one vertex from its (up to four) bone influences. `base` is the color the team region keeps under the
 * mask (TEAM_FALLBACK_BASE: a neutral light grey so the team color reads clean). Weights need not be normalized.
 */
export function vertexRegion(
  names: readonly (string | undefined)[],
  weights: readonly number[],
  base: number,
  out: VertexRegion = { team: 0, color: [0, 0, 0] },
): VertexRegion {
  let sum = 0;
  let team = 0;
  const color = out.color;
  color[0] = color[1] = color[2] = 0;
  for (let k = 0; k < names.length; k++) {
    const w = weights[k] ?? 0;
    if (w <= 0) continue;
    const region = (names[k] ? regionOfBone(names[k]!) : null) ?? 'jacket';
    sum += w;
    if (region === 'team') {
      team += w;
      color[0] += w * base;
      color[1] += w * base;
      color[2] += w * base;
    } else {
      const c = LINEAR[region];
      color[0] += w * c[0];
      color[1] += w * c[1];
      color[2] += w * c[2];
    }
  }
  if (sum <= 0) {
    out.team = 0;
    const c = LINEAR.jacket;
    color[0] = c[0];
    color[1] = c[1];
    color[2] = c[2];
    return out;
  }
  out.team = team / sum;
  color[0] /= sum;
  color[1] /= sum;
  color[2] /= sum;
  return out;
}
