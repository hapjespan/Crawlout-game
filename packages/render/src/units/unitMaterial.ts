// Instanced-skinning toon material (TSL). Review gate: architect review before merge (render-pipeline brief).
//
// Per instance the GPU only gets two vec4 attributes:
//   iPose: world x, y, z (meters) and yaw (radians)
//   iAnim: clip index, clip progress 0..1, team index (palette below), flags
// Everything else comes from two textures shared by all instances: the bone-matrix texture and the clip table
// (layout in bake.ts), plus the team palette as a uniform array (palette.ts; slot MAX_PLAYERS is neutral).
// The textures are float32, or half-float where the WebGL2 driver refuses float32 (gpu/dataTextures.ts).
// Vertex buffers stay at 7 of WebGPU's limit of 8: position, normal, color (rgb + team mask in alpha),
// skinIndex, skinWeight, iPose, iAnim. A textured asset adds uv (8, the limit): albedo = color * diffuse atlas, with
// the team mask from the color alpha or, for 'diffuseAlpha' assets, from the atlas alpha; uv = (-1, -1) marks a
// primitive without the atlas (reads white). Vertex skinning reads 4 influences, blends two adjacent frames, then
// rotates by yaw.
// Shading: 3-step toon ramp (soft band edges) plus a small sky fill, rimlight on the screen silhouette, team color
// through the team mask (vertex alpha or, per texel, the atlas alpha) relative to the albedo's mean under the mask.
// No PBR.
// Hero (typeId 1000 + heroId): the unit layer adds HERO_INSTANCE_FLAG to the flags in iAnim.w. A hero is drawn
// HERO_SCALE times bigger, and only a hero shows the hero parts of the placeholder (color alpha >= HERO_PART_ALPHA,
// humanoidGeometry.ts); for other instances those vertices collapse onto their bone and rasterize nothing.
import { MeshBasicNodeMaterial, Vector3, type Node, type Texture } from 'three/webgpu';
import {
  attribute,
  cameraPosition,
  clamp,
  cos,
  dot,
  float,
  floor,
  int,
  ivec2,
  length,
  max,
  min,
  mix,
  mod,
  normalize,
  pow,
  select,
  sin,
  smoothstep,
  texture,
  textureLoad,
  uniform,
  uniformArray,
  vec2,
  vec3,
  vec4,
  vertexStage,
} from 'three/tsl';
import { createDataTexture, type DataTexturePrecision } from '../gpu/dataTextures.js';
import { teamPalette } from '../palette.js';
import type { BakedAnimations } from './bake.js';
import { TEAM_PIVOT_DEFAULT } from './gltfUnitGeometry.js';
import { HERO_PART_ALPHA } from './humanoidGeometry.js';

/** Added to the instance flags (iAnim.w) of a hero; above the uint8 snapshot flags. */
export const HERO_INSTANCE_FLAG = 256;
/** A hero stands this much taller and wider than a regular unit of the same rig. */
export const HERO_SCALE = 1.15;

export interface ToonLighting {
  /** Direction towards the light, world space. */
  lightDir: Vector3;
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
}

export interface UnitMaterialBundle {
  material: MeshBasicNodeMaterial;
  textures: Texture[];
  lightDir: { value: Vector3 };
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
 * (`pivot`), raised to TEAM.contrast, clamped to TEAM.min..TEAM.max and times TEAM.gain. On average the mask
 * shows the team color (a little under full, as the former curve did on a mid base), and the texture's light and dark (folds, seams, a painted pattern) stay in it: the former 0.6 * l + 0.55
 * kept only about a third of the texture's contrast and flattened a textured jumpsuit into one even color. A flat
 * base (the fallback team material, l = pivot) shows the team color times TEAM.gain. Only the luminance counts, so a colored
 * base (a blue jumpsuit masked by hue) is not tinted twice.
 */
export const TEAM = { contrast: 1, min: 0.3, max: 1.6, gain: 0.85 } as const;

/** CPU form of the team shade factor (same constants), for tests and tuning. */
export function teamShade(luma: number, pivot: number): number {
  const f = Math.pow(Math.max(luma, 1e-4) / Math.max(pivot, 1e-4), TEAM.contrast);
  return Math.min(TEAM.max, Math.max(TEAM.min, f)) * TEAM.gain;
}

export function teamAlbedo(
  base: Node<'vec3'>,
  team: Node<'vec3'>,
  mask: Node<'float'>,
  pivot: Node<'float'> | number,
): Node<'vec3'> {
  const l = max(dot(base, vec3(...LUMA)), 1e-4);
  const f = clamp(pow(l.div(pivot), TEAM.contrast), TEAM.min, TEAM.max).mul(TEAM.gain);
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

export function createUnitMaterial(
  anims: BakedAnimations,
  lighting: ToonLighting,
  precision: DataTexturePrecision = 'float',
  albedoSource: UnitAlbedo = {},
): UnitMaterialBundle {
  const boneTex = createDataTexture(anims.data, anims.width, anims.height, precision);
  const clipTex = createDataTexture(anims.clipTable, anims.clips.length, 1, precision);
  const lightDir = uniform(lighting.lightDir.clone().normalize());

  const iPose = attribute('iPose', 'vec4');
  const iAnim = attribute('iAnim', 'vec4');
  const palette = uniformArray<'vec3'>(teamPalette(), 'vec3');
  const skinIndex = attribute('skinIndex', 'vec4');
  const skinWeight = attribute('skinWeight', 'vec4');
  const normal = attribute('normal', 'vec3');
  const vertexColor = attribute('color', 'vec4');
  const isHero = iAnim.w.greaterThanEqual(HERO_INSTANCE_FLAG);
  const heroPart = vertexColor.w.greaterThan(HERO_PART_ALPHA - 0.5);
  // Hero parts collapse to their bone's origin on regular units (zero-area triangles draw nothing).
  const position = select(heroPart.and(isHero.not()), vec3(0, 0, 0), attribute('position', 'vec3'));

  // Frame lookup in the clip table.
  const clip = textureLoad(clipTex, ivec2(int(iAnim.x), int(0)));
  const frames = clip.y;
  const looping = clip.z.greaterThan(0.5);
  const fpos = iAnim.y.mul(select(looping, frames, frames.sub(1)));
  const f0 = floor(fpos);
  const blend = fpos.sub(f0);
  const f1 = select(looping, mod(f0.add(1), frames), min(f0.add(1), frames.sub(1)));
  const row0 = int(clip.x.add(f0));
  const row1 = int(clip.x.add(f1));

  // Linear blend skinning over 4 influences; each matrix is 4 column texels, blended between two frames.
  let skinnedPos: Node<'vec3'> = vec3(0, 0, 0);
  let skinnedNrm: Node<'vec3'> = vec3(0, 0, 0);
  const comps = ['x', 'y', 'z', 'w'] as const;
  for (const k of comps) {
    const bone = int(skinIndex[k]).mul(4);
    const w = skinWeight[k];
    const col = (c: number) =>
      mix(
        textureLoad(boneTex, ivec2(bone.add(c), row0)),
        textureLoad(boneTex, ivec2(bone.add(c), row1)),
        blend,
      ).xyz;
    const c0 = col(0);
    const c1 = col(1);
    const c2 = col(2);
    const c3 = col(3);
    const p = c0.mul(position.x).add(c1.mul(position.y)).add(c2.mul(position.z)).add(c3);
    const n = c0.mul(normal.x).add(c1.mul(normal.y)).add(c2.mul(normal.z));
    skinnedPos = skinnedPos.add(p.mul(w));
    skinnedNrm = skinnedNrm.add(n.mul(w));
  }

  // Yaw around +Y: Ry(a) * v = (x cos a + z sin a, y, -x sin a + z cos a); 0 keeps the model facing +Z.
  const ca = cos(iPose.w);
  const sa = sin(iPose.w);
  const rotY = (v: Node<'vec3'>): Node<'vec3'> =>
    vec3(v.x.mul(ca).add(v.z.mul(sa)), v.y, v.z.mul(ca).sub(v.x.mul(sa)));
  const worldPos = rotY(skinnedPos.mul(select(isHero, float(HERO_SCALE), float(1)))).add(iPose.xyz);
  const worldNrm = vertexStage(rotY(skinnedNrm));
  const vWorldPos = vertexStage(worldPos);

  // Fragment: albedo with team tint, toon ramp, rim.
  let base: Node<'vec3'> = vertexColor.xyz;
  let mask: Node<'float'> = select(heroPart, vertexColor.w.sub(HERO_PART_ALPHA), vertexColor.w);
  if (albedoSource.map) {
    const uv = attribute('uv', 'vec2');
    const plain = uv.x.lessThan(-0.5); // NO_UV: primitive without the atlas
    const texel = select(plain, vec4(1, 1, 1, 0), texture(albedoSource.map, uv));
    base = base.mul(texel.xyz);
    if (albedoSource.maskFromMapAlpha) mask = max(mask, texel.w);
  }
  const gain = albedoSource.gain ?? 1;
  if (gain !== 1) base = base.mul(gain);
  const iTeam = palette.element(int(iAnim.z));
  const albedo = teamAlbedo(base, iTeam, mask, (albedoSource.teamPivot ?? TEAM_PIVOT_DEFAULT) * gain);
  const N = normalize(worldNrm);
  const shade = toonRamp(dot(N, lightDir));
  const V = normalize(cameraPosition.sub(vWorldPos));
  const rim = rimLight(N, V, lightDir, albedo);

  const material = new MeshBasicNodeMaterial();
  material.positionNode = worldPos;
  material.colorNode = vec4(albedo.mul(skyFill(N).add(shade)).add(rim), 1);
  material.name = 'crawlout-unit-toon';
  return { material, textures: [boneTex, clipTex], lightDir };
}
