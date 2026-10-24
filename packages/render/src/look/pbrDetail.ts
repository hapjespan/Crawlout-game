// Surface relief and material response for the stylized look: the normal map bends the shading normal, the
// metallicRoughness map decides how wide and how bright the highlight is and whether the surface is a conductor.
// Shared by the unit material (and ready for the building and prop materials), kept apart from the toon ramp in
// units/unitMaterial.part1.ts: the ramp says how the light falls off, this says what the surface is made of.
//
// Without these maps leather, cloth and painted steel get exactly the same response and a model reads as flat
// coloured paper however good its albedo is. That is what "cheap" looks like.
//
// Tangents: the LOD GLBs of the asset-cli carry POSITION, NORMAL, JOINTS_0, WEIGHTS_0 and TEXCOORD_0 and no TANGENT,
// and the mesh is skinned, so a bind-pose tangent would have to be skinned along with the normal anyway. detailNormal
// therefore builds the frame per fragment from the screen-space derivatives of the world position and the uv
// (Mikkelsen, "Normal Mapping Without Precomputed Tangents"), the very same construction three uses in
// nodes/accessors/TangentUtils.js when a geometry has no tangent attribute, only in world space instead of view
// space. Handedness and the glTF +Y convention come out identical, so a standard glTF normal map needs no flip.
import {
  clamp,
  cross,
  dot,
  exp2,
  float,
  inverseSqrt,
  max,
  mix,
  normalize,
  reflect,
  vec3,
} from 'three/tsl';
import type { Node } from 'three/webgpu';

/** Tunables of the surface response; every one of them is a look decision, not a physical constant. */
export const PBR = {
  /** Strength of the normal map on the x and y of the tangent-space normal (1 = as authored). */
  normalScale: 1,
  /**
   * How much of the normal map reaches the toon diffuse ramp. The ramp has hard band edges, so a full-strength
   * normal map scatters them into speckle on a noisy map; the highlight and the rim always get the full normal.
   */
  normalOnDiffuse: 0.85,
  /**
   * Brightness of the direct (sun) highlight. Well above a physical 1: the lobe below is not energy-normalized, and
   * at 1 the sheen on the Klerk's coat (albedo sRGB 44, 25, 14) was invisible next to its own dark diffuse, which is
   * precisely the cue that says "leather" instead of "black paper".
   */
  specular: 3,
  /** Brightness of the sky/ground reflection; this is what makes a metal part read as metal instead of dark paint. */
  envSpecular: 6,
  /** Tightest highlight: 2^(1 + 10 * (1 - roughness)), so roughness 0 would be 2048 lobes wide. */
  shininess: [1, 11] as const,
  /** Roughness is clamped into this band: 0 aliases into fireflies, 1 kills the sheen of worn leather. */
  roughness: [0.08, 0.98] as const,
  /** How much of the diffuse a full conductor loses (1 would make unlit metal pure black). */
  metalDiffuseKill: 0.85,
  /** Reflectance of a dielectric at normal incidence (the usual 4 %). */
  dielectricF0: 0.04,
} as const;

/**
 * The shading normal with the tangent-space normal map applied, in world space. `packed` is the raw 0..1 texel of a
 * linear normal map; a flat (0.5, 0.5, 1) texel returns `Ngeo` unchanged, which is what a material without a normal
 * map gets from the array's fallback layer.
 */
export function detailNormal(
  Ngeo: Node<'vec3'>,
  worldPos: Node<'vec3'>,
  uv: Node<'vec2'>,
  packed: Node<'vec3'>,
  scale: Node<'float'> | number = PBR.normalScale,
): Node<'vec3'> {
  const q0 = worldPos.dFdx();
  const q1 = worldPos.dFdy();
  const st0 = uv.dFdx();
  const st1 = uv.dFdy();
  const q1perp = cross(q1, Ngeo);
  const q0perp = cross(Ngeo, q0);
  const T = q1perp.mul(st0.x).add(q0perp.mul(st1.x));
  const B = q1perp.mul(st0.y).add(q0perp.mul(st1.y));
  // A degenerate frame (a triangle with no uv area, or the very first derivative of a quad on a silhouette) must not
  // produce a NaN: clamp the determinant away from zero and the frame collapses onto the geometric normal.
  const invMax = inverseSqrt(max(max(dot(T, T), dot(B, B)), 1e-12));
  const n = packed.mul(2).sub(1);
  const tangentSpace = vec3(n.x.mul(scale), n.y.mul(scale), n.z);
  return normalize(
    T.mul(invMax)
      .mul(tangentSpace.x)
      .add(B.mul(invMax).mul(tangentSpace.y))
      .add(Ngeo.mul(tangentSpace.z)),
  );
}

/** glTF packs roughness in G and metalness in B of the metallicRoughness texture; the clamp is PBR.roughness. */
export function unpackMetallicRoughness(texel: Node<'vec3'>): {
  roughness: Node<'float'>;
  metalness: Node<'float'>;
} {
  return {
    roughness: clamp(texel.y, PBR.roughness[0], PBR.roughness[1]),
    metalness: clamp(texel.z, 0, 1),
  };
}

export interface SpecularInput {
  /** Shading normal (world, unit). */
  N: Node<'vec3'>;
  /** Towards the camera (world, unit). */
  V: Node<'vec3'>;
  /** Towards the sun (world, unit). */
  L: Node<'vec3'>;
  roughness: Node<'float'>;
  metalness: Node<'float'>;
  /** Linear albedo; a conductor tints its reflection with it. */
  albedo: Node<'vec3'>;
  /** Colour of the direct light. */
  sunColor: Node<'vec3'> | readonly [number, number, number];
  /** 1 lit, 0 in the sun's shadow. */
  shadow?: Node<'float'> | null;
  /** Ambient colour arriving from a world direction (the material's hemisphere fill); without it no reflection. */
  env?: ((dir: Node<'vec3'>) => Node<'vec3'>) | null;
}

/**
 * Highlight and reflection. Deliberately not energy-conserving GGX: a normalized lobe on a near-mirror buckle peaks
 * in the tens and turns into a firefly on a 1500-tri unit in motion. This is a Blinn lobe whose width follows the
 * roughness and whose peak is bounded by the Fresnel colour, so a rough coat gets a wide dim sheen and a buckle a
 * tight bright one, and neither can blow out.
 */
export function specularHighlight(input: SpecularInput): Node<'vec3'> {
  const { N, V, L, roughness, metalness, albedo } = input;
  const H = normalize(L.add(V));
  const nh = max(dot(N, H), 0);
  const ndl = max(dot(N, L), 0);
  const voh = max(dot(V, H), 0);
  const f0 = mix(vec3(PBR.dielectricF0, PBR.dielectricF0, PBR.dielectricF0), albedo, metalness);
  const fresnel = f0.add(
    vec3(1, 1, 1).sub(f0).mul(float(1).sub(voh).pow(5)),
  ) as unknown as Node<'vec3'>;
  const shininess = exp2(mix(float(PBR.shininess[1]), float(PBR.shininess[0]), roughness));
  const lobe = nh.pow(shininess).mul(ndl);
  const sun = Array.isArray(input.sunColor)
    ? vec3(...(input.sunColor as readonly [number, number, number]))
    : (input.sunColor as Node<'vec3'>);
  const lit = input.shadow ? lobe.mul(input.shadow) : lobe;
  let out = sun.mul(fresnel).mul(lit).mul(PBR.specular);
  if (input.env) {
    // A smooth surface mirrors the sky, a rough one barely does. This term is what separates painted steel from a
    // dark grey coat under the same sun, and it survives the shadow (an ambient reflection is not blocked by it).
    const R = reflect(V.mul(-1), N);
    out = out.add(
      input.env(R).mul(fresnel).mul(float(1).sub(roughness).pow(2)).mul(PBR.envSpecular),
    );
  }
  return out;
}

/** A conductor has no diffuse lobe; PBR.metalDiffuseKill keeps a sliver so stylized metal does not go black. */
export function metalDiffuse(albedo: Node<'vec3'>, metalness: Node<'float'>): Node<'vec3'> {
  return albedo.mul(float(1).sub(metalness.mul(PBR.metalDiffuseKill)));
}
