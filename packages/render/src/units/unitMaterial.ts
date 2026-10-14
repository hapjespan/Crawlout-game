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
// Shading: 3-step toon ramp plus rimlight, team color through the team mask. No PBR.
// Hero (typeId 1000 + heroId): the unit layer adds HERO_INSTANCE_FLAG to the flags in iAnim.w. A hero is drawn
// HERO_SCALE times bigger, and only a hero shows the hero parts of the placeholder (color alpha >= HERO_PART_ALPHA,
// humanoidGeometry.ts); for other instances those vertices collapse onto their bone and rasterize nothing.
import { MeshBasicNodeMaterial, Vector3, type Node, type Texture } from 'three/webgpu';
import {
  attribute,
  cameraPosition,
  cos,
  dot,
  float,
  floor,
  int,
  ivec2,
  max,
  min,
  mix,
  mod,
  normalize,
  select,
  sin,
  smoothstep,
  texture,
  step,
  textureLoad,
  uniform,
  uniformArray,
  vec3,
  vec4,
  vertexStage,
} from 'three/tsl';
import { createDataTexture, type DataTexturePrecision } from '../gpu/dataTextures.js';
import { teamPalette } from '../palette.js';
import type { BakedAnimations } from './bake.js';
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
  /** Team mask from the atlas alpha instead of the vertex color alpha. */
  maskFromMapAlpha?: boolean;
}

export interface UnitMaterialBundle {
  material: MeshBasicNodeMaterial;
  textures: Texture[];
  lightDir: { value: Vector3 };
}

/** Shared 3-step toon ramp: half-lambert quantized to three bands. */
export function toonRamp(ndl: Node<'float'>): Node<'float'> {
  const h = ndl.mul(0.5).add(0.5);
  return float(0.52).add(step(0.42, h).mul(0.26)).add(step(0.7, h).mul(0.22));
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
  const iTeam = palette.element(int(iAnim.z));
  const albedo = mix(base, iTeam.mul(base.mul(0.6).add(0.55)), mask);
  const N = normalize(worldNrm);
  const shade = toonRamp(dot(N, lightDir));
  const V = normalize(cameraPosition.sub(vWorldPos));
  const rim = smoothstep(0.62, 0.8, float(1).sub(max(dot(N, V), 0))).mul(0.22);

  const material = new MeshBasicNodeMaterial();
  material.positionNode = worldPos;
  material.colorNode = vec4(albedo.mul(shade).add(vec3(rim, rim, rim.mul(0.9))), 1);
  material.name = 'crawlout-unit-toon';
  return { material, textures: [boneTex, clipTex], lightDir };
}
