// Clothing regions of a mannequin character, by bone name. A character whose only material is the "main" one (the
// Quaternius mannequin; gltfUnitGeometry.ts TEAM_MATERIAL_FALLBACK) used to be team colored from head to toe: a
// saturated plastic doll. With regions the team color is an accent on the upper chest, back and shoulders (a vest and
// pauldrons, the part that reads from an RTS camera looking down) and the rest is dusty clothing: a khaki jacket,
// dark trousers, leather boots, skin on the head and hands. The regions follow the skin weights, so a seam between
// two regions blends over the vertices that share the bones.
//
// The colors are a palette per body asset. The default is the Dweller clothing (REGION_COLORS); a manifest entry may
// carry its own `palette` (tools/asset-cli manifest.ts bodyPaletteSchema, from the rigmap `derive` entry of a faction
// body): the Raiders in patchwork leather and rust, the slaves in pale rags with a team band instead of a vest.
import type { BodyPalette as ManifestPalette } from '@crawlout/asset-cli/manifest';
import { linearOf, WASTELAND } from '../palette.js';

export type BodyRegion =
  'team' | 'jacket' | 'patchTop' | 'patchLeg' | 'belt' | 'trousers' | 'boots' | 'skin';
export type ClothRegion = Exclude<BodyRegion, 'team'>;

/**
 * Where the team color sits: the upper chest and shoulders (bone regions), or a band around the left upper arm (a
 * window along the arm, see teamBandMask: the bones alone would color the whole upper arm).
 */
export type TeamZone = 'chest' | 'band';

/** Dweller clothing (sRGB hex). The patch regions follow the jacket and the trousers. */
export const REGION_COLORS: Readonly<
  Record<'jacket' | 'belt' | 'trousers' | 'boots' | 'skin', number>
> = {
  jacket: 0x786f52,
  belt: 0x4a3626,
  trousers: 0x4d4538,
  boots: WASTELAND.soot,
  skin: 0xa07258,
};

/** A palette ready for vertex painting: linear colors per region, the team zone and the far-distance team strength. */
export interface ResolvedPalette {
  linear: Readonly<Record<ClothRegion, readonly [number, number, number]>>;
  teamZone: TeamZone;
  /** 0..1: how much of the whole upper body takes the team color from far away (unitMaterial.ts FAR_TEAM). */
  farTeam: number;
}

const hexOf = (css: string): number => Number.parseInt(css.slice(1), 16);

/** Resolves a manifest palette (or none: the Dwellers) into linear colors; a missing region keeps the default. */
export function resolveBodyPalette(spec?: ManifestPalette | null): ResolvedPalette {
  const pick = (region: keyof typeof REGION_COLORS): number =>
    spec?.[region] ? hexOf(spec[region]!) : REGION_COLORS[region];
  const jacket = pick('jacket');
  const trousers = pick('trousers');
  const colors: Record<ClothRegion, number> = {
    jacket,
    patchTop: spec?.patchTop ? hexOf(spec.patchTop) : jacket,
    patchLeg: spec?.patchLeg ? hexOf(spec.patchLeg) : trousers,
    belt: pick('belt'),
    trousers,
    boots: pick('boots'),
    skin: pick('skin'),
  };
  const linear = Object.fromEntries(
    Object.entries(colors).map(([k, hex]) => [k, linearOf(hex)]),
  ) as Record<ClothRegion, [number, number, number]>;
  return { linear, teamZone: spec?.teamZone ?? 'chest', farTeam: spec?.farTeam ?? 1 };
}

/** The Dweller palette: what a body without a manifest palette is painted with. */
export const DWELLER_PALETTE: ResolvedPalette = resolveBodyPalette();

/** Mixamo bone names (the asset-cli conforms every character to them) to the region they clothe. */
const REGION_OF_BONE: Readonly<Record<string, ClothRegion>> = {
  Head: 'skin',
  Neck: 'skin',
  LeftHand: 'skin',
  RightHand: 'skin',
  Spine2: 'jacket',
  LeftShoulder: 'jacket',
  RightShoulder: 'jacket',
  Spine1: 'jacket',
  Spine: 'jacket',
  LeftArm: 'patchTop',
  RightArm: 'jacket',
  LeftForeArm: 'patchTop',
  RightForeArm: 'jacket',
  Hips: 'belt',
  LeftUpLeg: 'trousers',
  RightUpLeg: 'patchLeg',
  LeftLeg: 'trousers',
  RightLeg: 'patchLeg',
  LeftFoot: 'boots',
  RightFoot: 'boots',
};

/** The bones that carry the team color per zone (the band zone has none: it is a window on a bone, teamBandMask). */
export const TEAM_BONES: Readonly<Record<TeamZone, readonly string[]>> = {
  chest: ['Spine2', 'LeftShoulder', 'RightShoulder'],
  band: [],
};

/** The bone the band goes around. */
export const BAND_BONE = 'LeftArm';
/** The band as a share of the bone's length from its start: full between BAND[1] and BAND[2], soft edges. */
export const BAND = [0.3, 0.4, 0.62, 0.72] as const;

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Team mask 0..1 of the band at `t`, the position along the arm bone from 0 (shoulder end) to 1 (elbow end). */
export function teamBandMask(t: number): number {
  return smooth(BAND[0], BAND[1], t) * (1 - smooth(BAND[2], BAND[3], t));
}

/** Region of a bone, or null for a name that is not a body bone (then the asset keeps its own colors). */
export function regionOfBone(name: string, zone: TeamZone = 'chest'): BodyRegion | null {
  if (TEAM_BONES[zone].includes(name)) return 'team';
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

/**
 * The region of one vertex from its (up to four) bone influences. `base` is the color the team region keeps under the
 * mask (TEAM_FALLBACK_BASE: a neutral light grey so the team color reads clean). Weights need not be normalized.
 */
export function vertexRegion(
  names: readonly (string | undefined)[],
  weights: readonly number[],
  base: number,
  out: VertexRegion = { team: 0, color: [0, 0, 0] },
  palette: ResolvedPalette = DWELLER_PALETTE,
): VertexRegion {
  let sum = 0;
  let team = 0;
  const color = out.color;
  color[0] = color[1] = color[2] = 0;
  for (let k = 0; k < names.length; k++) {
    const w = weights[k] ?? 0;
    if (w <= 0) continue;
    const region = (names[k] ? regionOfBone(names[k]!, palette.teamZone) : null) ?? 'jacket';
    sum += w;
    if (region === 'team') {
      team += w;
      color[0] += w * base;
      color[1] += w * base;
      color[2] += w * base;
    } else {
      const c = palette.linear[region];
      color[0] += w * c[0];
      color[1] += w * c[1];
      color[2] += w * c[2];
    }
  }
  if (sum <= 0) {
    out.team = 0;
    const c = palette.linear.jacket;
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
