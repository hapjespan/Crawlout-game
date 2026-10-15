// Instanced toon material for static structures (buildings, scrap heaps, claim flags). Same look as the units:
// 3-step toon ramp plus rimlight (shared with unitMaterial.ts, a little weaker), team color through the team mask in
// the vertex color alpha. No PBR.
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
import { MeshBasicNodeMaterial, type Texture, type Vector3, type Node } from 'three/webgpu';
import {
  attribute,
  cameraPosition,
  cos,
  dot,
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
import { rimLight, teamAlbedo, toonRamp } from '../units/unitMaterial.js';

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
  /** Cut the model at iTint.w (model-space y), for buildings under construction. */
  reveal?: boolean;
  /** 0..1: pulls the albedo towards a warm grey of the same brightness (0 keeps the art's colors). Default 0. */
  grade?: number;
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
  const worldPos = rotY(local.mul(iScale.xyz)).add(iPos.xyz);
  const worldNrm = vertexStage(rotY(normal.div(iScale.xyz)));
  const vWorldPos = vertexStage(worldPos);

  const palette = uniformArray<'vec3'>(teamPalette(), 'vec3');
  const team = palette.element(int(iScale.w));
  let base: Node<'vec3'> = color.xyz.mul(iTint.xyz);
  if (opts.map) {
    const uv = attribute('uv', 'vec2');
    const texel = select(uv.x.lessThan(-0.5), vec4(1, 1, 1, 1), texture(opts.map, uv));
    base = base.mul(texel.xyz);
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
  }
  if (opts.grade) {
    const luma = dot(base, vec3(0.2126, 0.7152, 0.0722));
    base = mix(base, vec3(...GRADE_TONE).mul(luma), opts.grade);
  }
  const albedo = teamAlbedo(base, team, color.w);
  const N = normalize(worldNrm);
  let shade = toonRamp(dot(N, light));
  if (opts.shadow) shade = mix(float(SHADOW_BAND), shade, opts.shadow);
  const V = normalize(cameraPosition.sub(vWorldPos));
  const rim = rimLight(N, V, light, albedo).mul(PROP_RIM);

  const m = new MeshBasicNodeMaterial();
  m.positionNode = worldPos;
  const out = vec4(albedo.mul(shade).add(rim), 1);
  // A shadow caster must not sample its own shadow map in the shadow pass: three's shadow pass reads colorNode.a,
  // so a material that receives the shadow puts its color in fragmentNode instead.
  if (opts.shadow) m.fragmentNode = out;
  else m.colorNode = out;
  m.name = opts.name;
  return m;
}
