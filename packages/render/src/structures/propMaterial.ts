// Instanced toon material for static structures (buildings, scrap heaps, claim flags). Same look as the units:
// 3-step toon ramp plus the sky fill and rimlight (shared with unitMaterial.ts, the rim a little weaker), team color
// through the team mask in the vertex color alpha, relative to the base's luminance (teamAlbedo). No PBR.
// iTint also carries the per-asset albedo gain (renderer option albedoGain).
//
// Per instance: iPos (x, y, z meters; yaw radians around +Y, 0 keeps +Z), iScale (x, y, z; team palette slot),
// iTint (rgb multiplier on the albedo; w unused). An optional shadow factor (1 lit, 0 shadowed) drops the light to
// the darkest band; an optional wave animates team-masked vertices (claim flags).
// Decorative props (props/propLayer.ts) add a diffuse map sampled with uv (uv = (-1, -1) reads white, as on units)
// and an optional grade that pulls the art's colors towards the wasteland palette, so lush kit colors sit under the
// same toon ramp as everything else.
// Building assets (buildingAssets.ts) use a texture array instead: attribute uvl = (u, v, layer), layer -1 reads
// white, so one material serves every building whatever its number of materials. With `reveal`, a vertex above
// iTint.w (model space) is pulled down onto that height: a building site rises out of the ground as it is built.
// Foliage (props/propLayer.ts): `alphaMask` discards texels whose alpha is below the per-vertex cutoff `aCut` (leaf
// cards and grass blades, glTF alphaMode MASK) and draws the material two-sided, flipping the normal on back faces;
// an opaque material stays single-sided and has no discard. `wind` sways vertices along the wind by the square of
// their height in the model, with iTint.w as the per-instance phase (props/propWind.ts).
import {
  DoubleSide,
  MeshBasicNodeMaterial,
  type Texture,
  type Vector3,
  type Node,
} from 'three/webgpu';
import {
  Discard,
  Fn,
  attribute,
  cameraPosition,
  cos,
  dot,
  faceDirection,
  float,
  int,
  max,
  min,
  mix,
  normalize,
  select,
  sin,
  texture,
  uniform,
  uniformArray,
  vec3,
  vec4,
  vertexStage,
} from 'three/tsl';
import { teamPalette } from '../palette.js';
import { WIND_DIRECTION } from '../props/propWind.js';
import { rimLight, skyFill, teamAlbedo, toonRamp } from '../units/unitMaterial.js';

export interface PropMaterialOptions {
  lightDir: Vector3;
  name: string;
  /** Shadow factor node (1 lit, 0 in shadow), e.g. three's shadow(light). */
  shadow?: Node<'float'> | undefined;
  /** Seconds (a uniform the renderer advances), drives the flag wave. */
  time?: Node<'float'>;
  /** Diffuse map, sampled with the uv attribute; albedo = vertex color * map. */
  map?: Texture | null;
  /** Diffuse texture array, sampled with the uvl attribute (u, v, layer; layer < 0 reads white). */
  layers?: Texture | null;
  /** Mean linear luminance per layer of `layers` (textureArray.ts): the team pivot of a textured team material. */
  layerLuma?: readonly number[];
  /** Cut the model at iTint.w (model-space y), for buildings under construction. */
  reveal?: boolean;
  /** 0..1: pulls the albedo towards a warm grey of the same brightness (0 keeps the art's colors). Default 0. */
  grade?: number;
  /**
   * Alpha test against the per-vertex `aCut` attribute (the geometry needs it, see propGeometry.ts) and two-sided
   * drawing. Needs `map` or `layers`: the alpha comes from the texture. Default false: opaque, single-sided.
   */
  alphaMask?: boolean;
  /** Light wind sway (propWind.ts); iTint.w of each instance is its phase. */
  wind?: PropWindOptions;
}

export interface PropWindOptions {
  /** Height of the model in meters before the instance scale (sway grows with the square of height / this). */
  height: number;
  /** Sway at the top as a share of the instance's height. */
  amplitude: number;
  /** Radians per second. */
  speed: number;
  /** Seconds (a uniform the renderer advances). */
  time: Node<'float'>;
  /** 0..1 uniform that scales the sway: 0 holds the foliage still (the renderer's wind option). */
  strength: Node<'float'>;
  /** Unit vector the wind blows towards on the ground (x, z). Default WIND_DIRECTION. */
  direction?: readonly [number, number];
}

/** Warm grey the grade pulls towards (linear rgb, multiplied by the albedo's luminance). */
const GRADE_TONE = [1.08, 1.0, 0.82] as const;

/** Rim on structures and props relative to units (unitMaterial.ts RIM): they should not compete with the units. */
const PROP_RIM = 0.7;

/** The darkest toon band, what a surface in shadow gets. */
const SHADOW_BAND = 0.52;

export function createPropMaterial(opts: PropMaterialOptions): MeshBasicNodeMaterial {
  const iPos = attribute('iPos', 'vec4');
  const iScale = attribute('iScale', 'vec4');
  const iTint = attribute('iTint', 'vec4');
  const position = attribute('position', 'vec3');
  const normal = attribute('normal', 'vec3');
  const color = attribute('color', 'vec4');
  const light = uniform(opts.lightDir.clone().normalize());

  let local: Node<'vec3'> = position;
  if (opts.reveal) local = vec3(position.x, min(position.y, iTint.w), position.z);
  if (opts.time) {
    // Flag wave: team-masked vertices sway along z, more towards the free end.
    const t = opts.time;
    const along = max(position.x.sub(0.06), 0);
    const sway = sin(t.mul(5.2).sub(along.mul(4.5)))
      .mul(along)
      .mul(0.14)
      .mul(color.w);
    local = position.add(vec3(0, 0, sway));
  }

  const ca = cos(iPos.w);
  const sa = sin(iPos.w);
  const rotY = (v: Node<'vec3'>): Node<'vec3'> =>
    vec3(v.x.mul(ca).add(v.z.mul(sa)), v.y, v.z.mul(ca).sub(v.x.mul(sa)));
  let worldPos = rotY(local.mul(iScale.xyz)).add(iPos.xyz);
  if (opts.wind) {
    const w = opts.wind;
    const [dx, dz] = w.direction ?? WIND_DIRECTION;
    const up = max(min(position.y.div(uniform(w.height)), 1), 0);
    const bend = up.mul(up);
    // A wave travelling over the ground plus the instance's own phase, a second harmonic and a weaker cross-wind sway.
    const t = w.time
      .mul(w.speed)
      .add(iTint.w)
      .add(iPos.x.mul(dx).add(iPos.z.mul(dz)).mul(0.35));
    const along = sin(t).add(sin(t.mul(2.3).add(1.7)).mul(0.35));
    const across = sin(t.mul(0.7).add(iTint.w.mul(1.3))).mul(0.4);
    const amount = bend
      .mul(w.amplitude * w.height)
      .mul(iScale.y)
      .mul(w.strength);
    worldPos = worldPos.add(
      vec3(along.mul(dx).sub(across.mul(dz)), 0, along.mul(dz).add(across.mul(dx))).mul(amount),
    );
  }
  const worldNrm = vertexStage(rotY(normal.div(iScale.xyz)));
  const vWorldPos = vertexStage(worldPos);

  const palette = uniformArray<'vec3'>(teamPalette(), 'vec3');
  const team = palette.element(int(iScale.w));
  let base: Node<'vec3'> = color.xyz.mul(iTint.xyz);
  let texelAlpha: Node<'float'> | null = null;
  // Team pivot (unitMaterial.ts teamAlbedo): the untextured base times the mean of its texture layer.
  let pivot: Node<'float'> = dot(base, vec3(0.2126, 0.7152, 0.0722));
  if (opts.map) {
    const uv = attribute('uv', 'vec2');
    const texel = select(uv.x.lessThan(-0.5), vec4(1, 1, 1, 1), texture(opts.map, uv));
    base = base.mul(texel.xyz);
    texelAlpha = texel.w;
  }
  if (opts.layers) {
    const uvl = attribute('uvl', 'vec3');
    const layer = int(max(uvl.z, 0).add(0.5));
    const texel = select(
      uvl.z.lessThan(-0.5),
      vec4(1, 1, 1, 1),
      texture(opts.layers, uvl.xy).depth(layer),
    );
    base = base.mul(texel.xyz);
    texelAlpha = texel.w;
    if (opts.layerLuma && opts.layerLuma.length > 0) {
      const means = uniformArray<'float'>([...opts.layerLuma], 'float');
      pivot = pivot.mul(select(uvl.z.lessThan(-0.5), float(1), means.element(layer)));
    }
  }
  if (opts.grade) {
    const luma = dot(base, vec3(0.2126, 0.7152, 0.0722));
    base = mix(base, vec3(...GRADE_TONE).mul(luma), opts.grade);
  }
  const albedo = teamAlbedo(base, team, color.w, max(pivot, 1e-3));
  const faceN = normalize(worldNrm);
  // Two-sided foliage: a back face is lit by its flipped normal.
  const N = opts.alphaMask ? faceN.mul(faceDirection) : faceN;
  let shade = toonRamp(dot(N, light));
  if (opts.shadow) shade = mix(float(SHADOW_BAND), shade, opts.shadow);
  const V = normalize(cameraPosition.sub(vWorldPos));
  const rim = rimLight(N, V, light, albedo).mul(PROP_RIM);

  const m = new MeshBasicNodeMaterial();
  m.positionNode = worldPos;
  const out = vec4(albedo.mul(skyFill(N).add(shade)).add(rim), 1);
  // A shadow caster must not sample its own shadow map in the shadow pass: three's shadow pass reads colorNode.a,
  // so a material that receives the shadow puts its color in fragmentNode instead.
  if (opts.alphaMask && texelAlpha) {
    const alpha = texelAlpha;
    const cutoff = attribute('aCut', 'float');
    m.fragmentNode = Fn(() => {
      Discard(alpha.lessThan(cutoff));
      return out;
    })();
    m.side = DoubleSide;
  } else if (opts.shadow) m.fragmentNode = out;
  else m.colorNode = out;
  m.name = opts.name;
  return m;
}
