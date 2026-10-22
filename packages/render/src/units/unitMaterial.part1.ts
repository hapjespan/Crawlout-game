// Split from unitMaterial.ts to stay under the 5,000-token file limit; unitMaterial.ts re-exports the public surface.
// Holds: HERO_INSTANCE_FLAG, HERO_SCALE, TEAM_SLOTS, ATTACHMENT_LOD_STEP, VARIATION, UNIT_WEATHER, +21 more.
import { Vector3, type Texture, MeshBasicNodeMaterial, type Node } from 'three/webgpu';
import type { SunShadowTerm } from '../shadows/sunShadow.js';
import { float, smoothstep, dot, clamp, mix, vec3, vec2, length, normalize, max } from 'three/tsl';
import { HEMI_GROUND, HEMI_SKY, SUN_COLOR } from '../lighting/lightRig.js';

/** Added to the instance flags (iAnim.w) of a hero; above the uint8 snapshot flags. */
export const HERO_INSTANCE_FLAG = 256;

/** A hero stands this much taller and wider than a regular unit of the same rig. */
export const HERO_SCALE = 1.15;

/** iAnim.z = team slot + TEAM_SLOTS * variation seed (animVariation.ts, 12 bits); the team slot is below TEAM_SLOTS. */
export const TEAM_SLOTS = 16;

/**
 * An attachment instance carries the unit's LOD in iAnim.z above the variation seed (12 bits above the team slot):
 * z = team slot + TEAM_SLOTS * seed + ATTACHMENT_LOD_STEP * lod. The attachment geometry holds the prop's LODs
 * together, each vertex's LOD in its color alpha; the vertices of the other LOD collapse (attachmentGeometry.ts).
 */
export const ATTACHMENT_LOD_STEP = TEAM_SLOTS * 4096;

/** Static per-instance variation: lean (shear of the body over its height, +-) and height scale (+-). */
export const VARIATION = { lean: 0.03, height: 0.03 } as const;

/** Strength of the clothing weathering (look/surfaceShading.ts weather): units are small, so lighter than a wall. */
export const UNIT_WEATHER = 0.6;

/** Camera distance (m) over which a unit's team accent widens to its whole upper body (full at the far end). */
export const FAR_TEAM = [28, 75] as const;

export interface ToonLighting {
  /** Direction towards the light, world space. */
  lightDir: Vector3;
  /** The sun's shadow: units receive it (they also cast it, see unitLayer.ts). */
  shadow?: SunShadowTerm | null;
}

export interface UnitAlbedo {
  /** Diffuse atlas, sampled with the uv attribute. */
  map?: Texture | null;
  /** Team mask from the atlas alpha (per texel) on top of the vertex color alpha. */
  maskFromMapAlpha?: boolean;
  /** Mean luminance of the albedo under the team mask (gltfUnitGeometry.ts teamPivot); see teamAlbedo. */
  teamPivot?: number;
  /** Brightness factor on the albedo (renderer option albedoGain, per asset). Default 1. */
  gain?: number;
  /** 0..1, default 1: how much of the upper body takes the team color from far away (a palette's `farTeam`). */
  farTeam?: number;
}

/** What a material variant shares or changes relative to a body material (see createUnitMaterial). */
export interface UnitMaterialOptions {
  /**
   * Bone and clip textures of another material of the same rig: an attachment follows the body's animation by
   * sampling the very same textures, so nothing is uploaded twice. Without it the material makes its own.
   */
  shared?: { boneTex: Texture; clipTex: Texture };
  /**
   * A weapon, tool or gear piece skinned to one bone (attachmentGeometry.ts): never team colored, no far-distance team
   * widening (its bind-pose height means nothing for it) and the weathering of worn metal instead of cloth.
   */
  attachment?: boolean;
}

export interface UnitMaterialBundle {
  material: MeshBasicNodeMaterial;
  /** Textures this material owns (its bone and clip textures unless they were shared in). */
  textures: Texture[];
  lightDir: { value: Vector3 };
  /** The bone-matrix and clip-table textures it samples, for an attachment material to share. */
  boneTex: Texture;
  clipTex: Texture;
}

/**
 * The 3-step toon ramp: half-lambert in three bands (0.52, 0.78, 1.0), band edges at 0.42 and 0.7. Each edge is spread
 * over +-TOON_EDGE_SOFT of half-lambert (as the terrain does): a hard step follows the interpolated normal across
 * every triangle, so on a 1500-tri unit the band border stair-steps along the edges and the model looks faceted.
 */
export const TOON_BANDS = {
  dark: 0.52,
  mid: 0.26,
  light: 0.22,
  midAt: 0.42,
  lightAt: 0.7,
} as const;

export const TOON_EDGE_SOFT = 0.03;

/** Shared 3-step toon ramp (see TOON_BANDS). */
export function toonRamp(ndl: Node<'float'>): Node<'float'> {
  const h = ndl.mul(0.5).add(0.5);
  const b = TOON_BANDS;
  const s = TOON_EDGE_SOFT;
  return float(b.dark)
    .add(smoothstep(b.midAt - s, b.midAt + s, h).mul(b.mid))
    .add(smoothstep(b.lightAt - s, b.lightAt + s, h).mul(b.light));
}

/**
 * The light of the shared rig (lighting/lightRig.ts) on the toon ramp: the dark band is the hemisphere fill (cool from
 * the sky, warm from the ground), what the ramp adds above it is the warm direct sun, and only that part is taken
 * away by the sun's shadow (1 lit, 0 shadowed). A surface in shadow keeps exactly the dark band, as a surface turned
 * away from the sun does, so a cast shadow and a self-shadowed side read the same.
 */
export function toonLight(
  N: Node<'vec3'>,
  L: Node<'vec3'>,
  shadowFactor?: Node<'float'> | null,
): Node<'vec3'> {
  const b = TOON_BANDS;
  // The ramp's steps above the dark band, rescaled so dark + direct still reaches 1 on a fully lit face.
  const direct = toonRamp(dot(N, L))
    .sub(b.dark)
    .mul((1 - AMBIENT_BAND) / (1 - b.dark));
  const sun = shadowFactor ? direct.mul(shadowFactor) : direct;
  const up = clamp(N.y.mul(0.5).add(0.5), 0, 1);
  const hemi = mix(vec3(...HEMI_GROUND), vec3(...HEMI_SKY), up);
  return hemi.mul(AMBIENT_BAND).add(vec3(...SUN_COLOR).mul(sun));
}

/**
 * The dark band of toonLight: what a surface in shadow or turned from the sun keeps. Lower than TOON_BANDS.dark (the
 * old ramp's floor, tuned when nothing cast a shadow): a cast shadow has to read as a shape on the bright, mottled
 * ground, about 2.5 : 1 against full sun, a hazy afternoon rather than a desert noon.
 */
export const AMBIENT_BAND = 0.4;

/**
 * Rimlight. The silhouette test runs on the horizontal parts of N and V: the RTS camera looks down 50 to 74 degrees,
 * so in 3D the N.V of a wall that faces the camera is at most cos(pitch) (0.28 to 0.64) and every side surface of a
 * unit or building lit up as rim (the white sheen over coats and walls). In the ground plane a surface facing the
 * camera reads 1 at any pitch and only the screen-space silhouette (beyond ~75 degrees) gets the rim. Surfaces that
 * face mostly up or down (|N.xz| small) get none.
 * The rim adds RIM.floor + RIM.albedo * albedo instead of a fixed white: a dark coat gets a thin light edge, not a
 * white band (0.22 linear on a 0.03 albedo was seven times the lit color). Full on the lit side, RIM.shadeSide on the
 * side away from the light.
 */
export const RIM = {
  from: 0.72,
  to: 0.92,
  /** |N.xz| range over which a surface counts as a side (0: faces straight up or down). */
  sideFrom: 0.25,
  sideTo: 0.6,
  floor: 0.035,
  albedo: 0.45,
  shadeSide: 0.4,
} as const;

function smoothstepCpu(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** CPU form of the silhouette term in rimLight (same constants), for tests and tuning. N and V unit length. */
export function silhouetteEdge(n: readonly number[], v: readonly number[]): number {
  const nLen = Math.hypot(n[0]!, n[2]!);
  const vLen = Math.max(1e-6, Math.hypot(v[0]!, v[2]!));
  const facing = (n[0]! * v[0]! + n[2]! * v[2]!) / vLen / Math.max(nLen, 1e-4);
  return (
    smoothstepCpu(RIM.from, RIM.to, 1 - facing) * smoothstepCpu(RIM.sideFrom, RIM.sideTo, nLen)
  );
}

export function rimLight(
  N: Node<'vec3'>,
  V: Node<'vec3'>,
  L: Node<'vec3'>,
  albedo: Node<'vec3'>,
): Node<'vec3'> {
  const nh = vec2(N.x, N.z);
  const nLen = length(nh);
  const vh = normalize(vec2(V.x, V.z));
  const facing = dot(nh, vh).div(max(nLen, 1e-4));
  const edge = smoothstep(RIM.from, RIM.to, float(1).sub(facing)).mul(
    smoothstep(RIM.sideFrom, RIM.sideTo, nLen),
  );
  const lit = mix(
    float(RIM.shadeSide),
    float(1),
    smoothstep(0.35, 0.65, dot(N, L).mul(0.5).add(0.5)),
  );
  return albedo.mul(RIM.albedo).add(RIM.floor).mul(edge.mul(lit));
}

/** Luminance weights (linear Rec. 709). */
const LUMA = [0.2126, 0.7152, 0.0722] as const;

/**
 * Team color under the mask: the team color times the albedo's luminance relative to the mean under the mask
 * (`pivot`) (linear, so no pow), clamped to TEAM.min..TEAM.max and times TEAM.gain. On average the mask
 * shows the team color (a little under full, as the former curve did on a mid base), and the texture's light and dark (folds, seams, a painted pattern) stay in it: the former 0.6 * l + 0.55
 * kept only about a third of the texture's contrast and flattened a textured jumpsuit into one even color. A flat
 * base (the fallback team material, l = pivot) shows the team color times TEAM.gain. Only the luminance counts, so a colored
 * base (a blue jumpsuit masked by hue) is not tinted twice.
 */
export const TEAM = { min: 0.3, max: 1.6, gain: 0.85 } as const;

/** CPU form of the team shade factor (same constants), for tests and tuning. */
export function teamShade(luma: number, pivot: number): number {
  const f = Math.max(luma, 1e-4) / Math.max(pivot, 1e-4);
  return Math.min(TEAM.max, Math.max(TEAM.min, f)) * TEAM.gain;
}

export function teamAlbedo(
  base: Node<'vec3'>,
  team: Node<'vec3'>,
  mask: Node<'float'>,
  pivot: Node<'float'> | number,
): Node<'vec3'> {
  const l = max(dot(base, vec3(...LUMA)), 1e-4);
  const f = clamp(l.div(pivot), TEAM.min, TEAM.max).mul(TEAM.gain);
  return mix(base, team.mul(f), mask);
}

/**
 * Sky fill: a small hemispheric term added to the toon light, cool from the sky on surfaces that face up and a warm
 * bounce from the ground on those that face down; a wall gets half of each. Walls, coats and a building's shadow side
 * no longer sit at the flat darkest band and come loose from the ground. In the shader, no extra light or draw call.
 * Subtle on purpose: it is a multiplier on the albedo, so a dark, muddy coat stays dark and muddy.
 */
export const SKY_FILL = {
  sky: [0.085, 0.1, 0.12],
  ground: [0.06, 0.045, 0.03],
} as const;

/** CPU form: the fill per rgb channel for a normal's y. */
export function skyFillAt(ny: number): [number, number, number] {
  const up = Math.min(1, Math.max(0, ny * 0.5 + 0.5));
  return [0, 1, 2].map((c) => SKY_FILL.sky[c]! * up + SKY_FILL.ground[c]! * (1 - up)) as [
    number,
    number,
    number,
  ];
}

export function skyFill(N: Node<'vec3'>): Node<'vec3'> {
  const up = clamp(N.y.mul(0.5).add(0.5), 0, 1);
  return mix(vec3(...SKY_FILL.ground), vec3(...SKY_FILL.sky), up);
}
