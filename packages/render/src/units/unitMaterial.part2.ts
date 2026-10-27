// Split from unitMaterial.ts to stay under the 5,000-token file limit; unitMaterial.ts re-exports the public surface.
// Holds: createUnitMaterial.
import type { BakedAnimations } from './bake.js';
import { type DataTexturePrecision, createDataTexture } from '../gpu/dataTextures.js';
import {
  uniform,
  attribute,
  uniformArray,
  select,
  floor,
  vec3,
  textureLoad,
  ivec2,
  int,
  mod,
  min,
  mix,
  cos,
  sin,
  float,
  vertexStage,
  vec4,
  texture,
  max,
  normalize,
  smoothstep,
  length,
  cameraPosition,
} from 'three/tsl';
import { teamPalette } from '../palette.js';
import { HERO_PART_ALPHA } from './humanoidGeometry.js';
import { SUN_COLOR } from '../lighting/lightRig.js';
import {
  PBR,
  detailNormal,
  metalDiffuse,
  specularHighlight,
  unpackMetallicRoughness,
} from '../look/pbrDetail.js';
import { type Node, MeshBasicNodeMaterial } from 'three/webgpu';
import { TEAM_FALLBACK_BASE, TEAM_PIVOT_DEFAULT } from './gltfUnitGeometry.js';
import { groundOcclusion, sunGroundOcclusion } from '../look/groundAo.js';
import { weather, createSurfaceTable } from '../look/surfaceShading.js';
import { surfaceIndex } from '../look/surfaces.js';
import { worldGrade, TEAM_GRADE } from '../look/grade.js';
import {
  ATTACHMENT_LOD_STEP,
  FAR_TEAM,
  HERO_INSTANCE_FLAG,
  HERO_SCALE,
  TEAM_ALPHA,
  TEAM_SLOTS,
  UNIT_WEATHER,
  VARIATION,
  rimLight,
  skyFill,
  teamAlbedo,
  toonLight,
} from './unitMaterial.part1.js';
import type {
  ToonLighting,
  UnitAlbedo,
  UnitMaterialBundle,
  UnitMaterialOptions,
} from './unitMaterial.part1.js';

/**
 * One input of the shading dumped straight to the screen, for judging an asset's maps instead of guessing at them.
 * Set `globalThis.crawloutUnitDebug = 'mr'` before the material is built (the render-demo rebuilds on a reload, so:
 * set it, then reload). 'mr' is how the Klerk's coat turned out to be rendering as a conductor.
 */
export type UnitDebugChannel = 'normal' | 'mr' | 'albedo' | 'spec' | 'rim' | 'ao';

const DEBUG_CHANNELS = ['normal', 'mr', 'albedo', 'spec', 'rim', 'ao'] as const;

function debugChannel(): UnitDebugChannel | null {
  const v = (globalThis as { crawloutUnitDebug?: unknown }).crawloutUnitDebug;
  return DEBUG_CHANNELS.includes(v as UnitDebugChannel) ? (v as UnitDebugChannel) : null;
}

export function createUnitMaterial(
  anims: BakedAnimations,
  lighting: ToonLighting,
  precision: DataTexturePrecision = 'float',
  albedoSource: UnitAlbedo = {},
  variant: UnitMaterialOptions = {},
): UnitMaterialBundle {
  const boneTex =
    variant.shared?.boneTex ?? createDataTexture(anims.data, anims.width, anims.height, precision);
  const clipTex =
    variant.shared?.clipTex ?? createDataTexture(anims.clipTable, anims.clips.length, 1, precision);
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
  // Hero parts collapse to their bone's origin on regular units (zero-area triangles draw nothing); so do the
  // vertices of an attachment's other LOD (the color alpha of an attachment is its LOD, never a team mask).
  const position = variant.attachment
    ? select(
        floor(vertexColor.w.add(0.5)).equal(floor(iAnim.z.div(ATTACHMENT_LOD_STEP))),
        attribute('position', 'vec3'),
        vec3(0, 0, 0),
      )
    : select(heroPart.and(isHero.not()), vec3(0, 0, 0), attribute('position', 'vec3'));

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

  // Per-instance variation: iAnim.z carries the seed above the team slot; three 4-bit fields give a small static lean in
  // x and z and a height scale, so idle units do not stand like clones.
  const seed = floor(iAnim.z.div(TEAM_SLOTS));
  const field = (shift: number): Node<'float'> =>
    mod(floor(seed.div(shift)), 16)
      .div(7.5)
      .sub(1);
  const leanX = field(1).mul(VARIATION.lean);
  const leanZ = field(16).mul(VARIATION.lean);
  const heightScale = field(256).mul(VARIATION.height).add(1);
  const teamSlot = int(mod(iAnim.z, TEAM_SLOTS));

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

  // Static variation on the skinned pose: shear with height (feet stay put), then the height scale.
  skinnedPos = vec3(
    skinnedPos.x.add(skinnedPos.y.mul(leanX)),
    skinnedPos.y.mul(heightScale),
    skinnedPos.z.add(skinnedPos.y.mul(leanZ)),
  );

  // Yaw around +Y: Ry(a) * v = (x cos a + z sin a, y, -x sin a + z cos a); 0 keeps the model facing +Z.
  const ca = cos(iPose.w);
  const sa = sin(iPose.w);
  const rotY = (v: Node<'vec3'>): Node<'vec3'> =>
    vec3(v.x.mul(ca).add(v.z.mul(sa)), v.y, v.z.mul(ca).sub(v.x.mul(sa)));
  const worldPos = rotY(skinnedPos.mul(select(isHero, float(HERO_SCALE), float(1)))).add(iPose.xyz);
  const worldNrm = vertexStage(rotY(skinnedNrm));
  const vWorldPos = vertexStage(worldPos);
  /** Height (m) of this fragment above the unit's own ground plane: the weathering and the ground AO both read it. */
  const bodyHeight = vertexStage(skinnedPos.y);

  // Fragment: albedo with team tint, toon ramp, rim.
  let base: Node<'vec3'> = vertexColor.xyz;
  let mask: Node<'float'> = variant.attachment
    ? float(0)
    : select(heroPart, vertexColor.w.sub(HERO_PART_ALPHA), vertexColor.w);
  /** Tangent-space normal texel and (roughness, metalness) of this fragment; flat/default without the maps. */
  let normalTexel: Node<'vec3'> | null = null;
  let surface: { roughness: Node<'float'>; metalness: Node<'float'> } | null = null;
  let detailUv: Node<'vec2'> | null = null;
  if (albedoSource.layers) {
    // One layer per source material of the asset (gltfUnitGeometry.ts): uvl.z picks it, below zero means no texture.
    const uvl = attribute('uvl', 'vec3');
    const layer = int(max(uvl.z, 0).add(0.5));
    const plain = uvl.z.lessThan(-0.5);
    const texel = select(
      plain,
      vec4(1, 1, 1, 0),
      texture(albedoSource.layers, uvl.xy).depth(layer),
    );
    base = base.mul(texel.xyz);
    if (albedoSource.maskFromMapAlpha)
      mask = max(mask, smoothstep(TEAM_ALPHA.from, TEAM_ALPHA.to, texel.w));
    // Normal and metallicRoughness ride on the same layer index: the asset-cli gives a primitive's three maps the
    // same uv set and the same dimensions (unitAssetLoader.ts). A primitive without a texture reads flat/default.
    detailUv = uvl.xy;
    if (albedoSource.normalLayers)
      normalTexel = select(
        plain,
        vec3(0.5, 0.5, 1),
        texture(albedoSource.normalLayers, uvl.xy).depth(layer).xyz,
      );
    if (albedoSource.mrLayers)
      surface = unpackMetallicRoughness(
        select(plain, vec3(1, 1, 0), texture(albedoSource.mrLayers, uvl.xy).depth(layer).xyz),
      );
  } else if (albedoSource.map) {
    const uv = attribute('uv', 'vec2');
    const plain = uv.x.lessThan(-0.5); // NO_UV: primitive without the atlas
    const texel = select(plain, vec4(1, 1, 1, 0), texture(albedoSource.map, uv));
    base = base.mul(texel.xyz);
    if (albedoSource.maskFromMapAlpha)
      mask = max(mask, smoothstep(TEAM_ALPHA.from, TEAM_ALPHA.to, texel.w));
  }
  const gain = albedoSource.gain ?? 1;
  if (gain !== 1) base = base.mul(gain);
  const iTeam = palette.element(teamSlot);
  const N = normalize(worldNrm);
  // Team readability at RTS distance: the accent on the shoulders is a pixel or two from far away, so beyond FAR_TEAM
  // the whole upper body (chest to shoulders in the bind pose, not the head) takes the team color, on the neutral base.
  const far = smoothstep(FAR_TEAM[0], FAR_TEAM[1], length(cameraPosition.sub(vWorldPos)));
  const bindY = attribute('position', 'vec3').y;
  const upper = smoothstep(0.85, 0.98, bindY).mul(float(1).sub(smoothstep(1.52, 1.6, bindY)));
  const farStrength = variant.attachment ? 0 : (albedoSource.farTeam ?? 1);
  const wide = far.mul(vertexStage(upper)).mul(farStrength);
  base = mix(
    base,
    vec3(TEAM_FALLBACK_BASE, TEAM_FALLBACK_BASE, TEAM_FALLBACK_BASE),
    wide.mul(float(1).sub(mask)),
  );
  mask = max(mask, wide);
  // Weathering of the clothing in bind-pose space (the pattern sticks to the body), dust from the boots up.
  base = weather({
    albedo: base,
    pos: vertexStage(attribute('position', 'vec3')),
    normal: N,
    height: bodyHeight,
    surface: createSurfaceTable().at(surfaceIndex(variant.attachment ? 'rustMetal' : 'cloth')),
    amount: float(UNIT_WEATHER),
    team: mask,
  });
  const albedo = worldGrade(
    teamAlbedo(base, iTeam, mask, (albedoSource.teamPivot ?? TEAM_PIVOT_DEFAULT) * gain),
    mix(float(1), float(TEAM_GRADE), mask),
  );
  const sun = lighting.shadow ?? null;
  const V = normalize(cameraPosition.sub(vWorldPos));
  // Ground contact: the terrain blocks the lower sky, so everything near the soles loses most of its ambient. The
  // height is the skinned bind-space y, which is zero at the feet whatever the terrain does under them, so the
  // darkening walks with the legs. Ambient only; the sun's occlusion is the shadow map.
  const ao = groundOcclusion(bodyHeight);
  // The sun takes a share of the same occlusion, folded into its shadow factor (1 lit, 0 shadowed).
  const sunLight = sun ? sun.factor.mul(sunGroundOcclusion(ao)) : sunGroundOcclusion(ao);
  // Surface relief: the normal map bends the shading normal. The highlight and the rim take it whole; the toon
  // diffuse takes PBR.normalOnDiffuse of it, because the ramp's band edges turn a noisy map into speckle.
  const Ndetail =
    normalTexel && detailUv ? detailNormal(N, vWorldPos, detailUv, normalTexel) : N;
  const Nshade = normalTexel
    ? normalize(mix(N, Ndetail, float(PBR.normalOnDiffuse)))
    : N;
  const roughness = surface?.roughness ?? float(PBR.roughness[1]);
  const metalness = surface?.metalness ?? float(0);
  // A conductor has (almost) no diffuse: its buckles and scope go dark and win their brightness back from the
  // highlight and the sky reflection below, which is what makes metal read as metal next to leather and cloth.
  const diffuseAlbedo = surface ? metalDiffuse(albedo, metalness) : albedo;
  const shade = toonLight(Nshade, lightDir, sunLight, ao);
  // The rim is sky light too, so the ground occludes it: a bright edge around a boot would undo the contact.
  const rim = rimLight(Nshade, V, lightDir, diffuseAlbedo).mul(ao);
  const spec =
    surface || normalTexel
      ? specularHighlight({
          N: Ndetail,
          V,
          L: lightDir,
          roughness,
          metalness,
          albedo,
          sunColor: SUN_COLOR,
          shadow: sunLight,
          env: (dir) => skyFill(dir).mul(ao),
        })
      : null;

  const material = new MeshBasicNodeMaterial();
  material.positionNode = worldPos;
  const lit = diffuseAlbedo.mul(skyFill(Nshade).mul(ao).add(shade)).add(rim);
  let out = vec4(spec ? lit.add(spec) : lit, 1);
  switch (debugChannel()) {
    case 'normal':
      out = vec4(Ndetail.mul(0.5).add(0.5), 1);
      break;
    case 'mr':
      out = vec4(vec3(0, roughness, metalness), 1);
      break;
    case 'albedo':
      out = vec4(albedo, 1);
      break;
    case 'spec':
      if (spec) out = vec4(spec.mul(8), 1);
      break;
    case 'rim':
      out = vec4(rim.mul(4), 1);
      break;
    case 'ao':
      out = vec4(bodyHeight.div(2), ao, 0, 1);
      break;
    default:
      break;
  }
  // A shadow caster must not sample its own shadow map in the shadow pass (three's shadow pass reads colorNode.a),
  // so a unit that receives the shadow puts its color in fragmentNode.
  if (sun) {
    material.fragmentNode = out;
    material.receivedShadowPositionNode = sun.receivePosition(vWorldPos, N);
  } else material.colorNode = out;
  material.name = 'crawlout-unit-toon';
  return {
    material,
    // A shared texture belongs to the material that made it: only a material's own textures are its to dispose.
    textures: variant.shared ? [] : [boneTex, clipTex],
    lightDir,
    boneTex,
    clipTex,
  };
}
