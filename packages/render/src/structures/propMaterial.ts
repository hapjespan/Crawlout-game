// Instanced toon material for static structures (buildings, scrap heaps, claim flags). Same look as the units:
// 3-step toon ramp plus the sky fill and rimlight (shared with unitMaterial.ts, the rim a little weaker), team color
// through the team mask in the vertex color alpha, relative to the base's luminance (teamAlbedo). No PBR.
// iTint also carries the per-asset albedo gain (renderer option albedoGain).
//
// Per instance: iPos (x, y, z meters; yaw radians around +Y, 0 keeps +Z), iScale (x, y, z; team palette slot),
// iTint (rgb multiplier on the albedo; w unused). The optional sun shadow (shadows/sunShadow.ts) takes the direct sun
// away (toonLight: down to the darkest band); an optional wave animates team-masked vertices (claim flags).
// Decorative props (props/propLayer.ts) add a diffuse map sampled with uv (uv = (-1, -1) reads white, as on units).
// Surface (look/): every fragment has a surface kind (wood, painted metal, rust, rock, ...) that sets its albedo
// range, roughness and metalness (look/surfaces.ts). A flat (untextured) fragment, the water tower's steel or a
// placeholder prop, takes the kind's wasteland tint and is weathered procedurally (grain, flaked paint, rain streaks,
// rust, dirt at the foot, dust on top; look/surfaceShading.ts); a photographed one gets a lighter dose of the dirt and
// dust. The result goes through the shared world grade (look/grade.ts) and a toon specular from the recipe.
// Building assets (buildingAssets.ts) use a texture array instead: attribute uvl = (u, v, layer), layer -1 reads
// white, so one material serves every building whatever its number of materials. With `reveal`, a vertex above
// iTint.w (model space) is pulled down onto that height: a building site rises out of the ground as it is built.
// Foliage (props/propLayer.ts): `alphaMask` discards texels whose alpha is below the per-vertex cutoff `aCut` (leaf
// cards and grass blades, glTF alphaMode MASK) and draws the material two-sided, flipping the normal on back faces;
// an opaque material stays single-sided and has no discard. The same alpha test runs in the shadow pass
// (maskShadowNode), so a tree's shadow has leaves, not cards. `wind` sways vertices along the wind by the square of
// their height in the model, with iTint.w as the per-instance phase (props/propWind.ts); it lives in positionNode, which
// the shadow pass uses too, so the shadow sways with the tree.
import {
  DoubleSide,
  MeshBasicNodeMaterial,
  Vector2,
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
import { worldGrade, TEAM_GRADE } from '../look/grade.js';
import { surfaceIndex, type SurfaceKind } from '../look/surfaces.js';
import {
  createSurfaceTable,
  fitAlbedoNode,
  metalDiffuse,
  toonSpecular,
  weather,
} from '../look/surfaceShading.js';
import { teamPalette } from '../palette.js';
import { WIND_DIRECTION } from '../props/propWind.js';
import type { SunShadowTerm } from '../shadows/sunShadow.js';
import { rimLight, skyFill, teamAlbedo, toonLight } from '../units/unitMaterial.js';

export interface PropMaterialOptions {
  lightDir: Vector3;
  name: string;
  /** The sun's shadow (shadows/sunShadow.ts), received by this material. */
  shadow?: SunShadowTerm | null | undefined;
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
  /** Surface kind of the material (look/surfaces.ts): what a prop or placeholder is made of. Default wood. */
  surface?: SurfaceKind;
  /** Surface kind per layer of `layers` (by material name, surfaceKindOfMaterial); flat fragments carry theirs in uvl.x. */
  layerKinds?: readonly SurfaceKind[];
  /** 0..1: strength of the procedural weathering (look/surfaceShading.ts weather). Default 1, 0 for alpha-tested foliage. */
  weather?: number;
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

/** Weathering strength on a photographed fragment (it carries its own wear): dirt and dust only, softly. */
const TEXTURED_WEATHER = 0.3;

/** Rim on structures and props relative to units (unitMaterial.ts RIM): they should not compete with the units. */
const PROP_RIM = 0.7;

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
  const luma = vec3(0.2126, 0.7152, 0.0722);
  const baseKind = surfaceIndex(opts.surface ?? 'wood');
  const table = createSurfaceTable();
  let base: Node<'vec3'> = color.xyz.mul(iTint.xyz);
  let texelAlpha: Node<'float'> | null = null;
  // Team pivot (unitMaterial.ts teamAlbedo): the untextured base times the mean of its texture layer.
  let pivot: Node<'float'> = dot(base, luma);
  // 1 where the fragment has no texture (its surface is procedural), and the surface kind index there and elsewhere.
  let flat: Node<'float'> = float(1);
  let kindIndex: Node<'int'> = int(baseKind);
  if (opts.map) {
    const uv = attribute('uv', 'vec2');
    const plain = uv.x.lessThan(-0.5);
    const texel = select(plain, vec4(1, 1, 1, 1), texture(opts.map, uv));
    base = base.mul(texel.xyz);
    texelAlpha = texel.w;
    flat = select(plain, float(1), float(0));
  }
  if (opts.layers) {
    const uvl = attribute('uvl', 'vec3');
    const layer = int(max(uvl.z, 0).add(0.5));
    const plain = uvl.z.lessThan(-0.5);
    const texel = select(plain, vec4(1, 1, 1, 1), texture(opts.layers, uvl.xy).depth(layer));
    base = base.mul(texel.xyz);
    texelAlpha = texel.w;
    flat = select(plain, float(1), float(0));
    // Per layer: the mean luma (the team pivot) and, with layerKinds (buildings), the surface kind. One vec2 array, as
    // the fragment stage has few uniform buffers. A flat fragment of a building carries its kind in u
    // (buildingGeometry.ts); without layerKinds (props) the whole material is one kind.
    const count = Math.max(opts.layerLuma?.length ?? 0, opts.layerKinds?.length ?? 0);
    if (count > 0) {
      const perLayer = uniformArray<'vec2'>(
        Array.from(
          { length: count },
          (_, i) =>
            new Vector2(
              opts.layerLuma?.[i] ?? 1,
              opts.layerKinds?.[i] ? surfaceIndex(opts.layerKinds[i]!) : baseKind,
            ),
        ),
        'vec2',
      );
      const entry = perLayer.element(layer);
      if (opts.layerLuma && opts.layerLuma.length > 0)
        pivot = pivot.mul(select(plain, float(1), entry.x));
      if (opts.layerKinds && opts.layerKinds.length > 0)
        kindIndex = select(plain, int(uvl.x.add(0.5)), int(entry.y.add(0.5)));
    }
  }
  const surface = table.at(kindIndex);
  // The kind's range and tint come first (flat parts leave the authored swatch), then the weathering; the team pivot
  // follows the shift so the team color is not dimmed or lifted by it, only by the wear.
  const rawLuma = max(dot(base, luma), 1e-4);
  base = mix(base, surface.tint, flat.mul(surface.flatBlend));
  // A photographed kit color (the Gobkit's bright leaves) moves towards the kind's tint at its own luminance.
  const tintAtLuma = surface.tint.mul(rawLuma.div(max(dot(surface.tint, luma), 1e-4)));
  base = mix(base, tintAtLuma, float(1).sub(flat).mul(surface.texturedBlend));
  base = fitAlbedoNode(base, surface.albedoMin, surface.albedoMax);
  pivot = pivot.mul(max(dot(base, luma), 1e-4).div(rawLuma));
  const faceN = normalize(worldNrm);
  // Two-sided foliage: a back face is lit by its flipped normal.
  const N = opts.alphaMask ? faceN.mul(faceDirection) : faceN;
  const strength = opts.weather ?? (opts.alphaMask ? 0 : 1);
  if (strength > 0) {
    const height = position.y.mul(iScale.y);
    base = weather({
      albedo: base,
      pos: vWorldPos,
      normal: faceN,
      height,
      surface,
      amount: mix(float(TEXTURED_WEATHER), float(1), flat).mul(strength),
      team: color.w,
    });
  }
  let albedo = teamAlbedo(base, team, color.w, max(pivot, 1e-3));
  albedo = worldGrade(albedo, mix(float(1), float(TEAM_GRADE), color.w));
  albedo = metalDiffuse(albedo, surface);
  const shade = toonLight(N, light, opts.shadow?.factor);
  const V = normalize(cameraPosition.sub(vWorldPos));
  const rim = rimLight(N, V, light, albedo).mul(PROP_RIM);
  const spec = toonSpecular(N, V, light, surface, albedo, opts.shadow?.factor ?? 1);

  const m = new MeshBasicNodeMaterial();
  m.positionNode = worldPos;
  const out = vec4(albedo.mul(skyFill(N).add(shade)).add(rim).add(spec), 1);
  // A shadow caster must not sample its own shadow map in the shadow pass: three's shadow pass reads colorNode.a,
  // so a material that receives the shadow puts its color in fragmentNode instead.
  if (opts.alphaMask && texelAlpha) {
    const alpha = texelAlpha;
    const cutoff = attribute('aCut', 'float');
    m.fragmentNode = Fn(() => {
      Discard(alpha.lessThan(cutoff));
      return out;
    })();
    m.maskShadowNode = alpha.greaterThanEqual(cutoff);
    m.side = DoubleSide;
  } else if (opts.shadow) m.fragmentNode = out;
  else m.colorNode = out;
  if (opts.shadow) m.receivedShadowPositionNode = opts.shadow.receivePosition(vWorldPos, N);
  m.name = opts.name;
  return m;
}
