// Terrain material (TSL): rock on steep slopes, dust and ground on the flat, variation with height, a world-space
// detail texture, toon-ramp light. No PBR. Built for readability at RTS distance: the ground stays in a narrow band of
// mid values with little saturation, so units (team color plus rim) and buildings (real shadow) stand out against it.
//
//   slope   = 1 - N.y from the (smooth) terrain normal; rock from about 30 degrees, full at about 45 (the map makes a
//             cell a cliff above 32 degrees), with the detail texture's brightness breaking up the boundary.
//   rock    = rockTint, scaled to a fixed brightness, times the detail texture (triplanar: x/y/z projections weighted
//             by the normal, so walls are not smeared), darker at the foot of a cliff and lighter on top.
//   ground  = groundTint warmed to dust, times the map's vertex colors relative to its sand color (ruins and cliff
//             cells stay a little darker, marks a little tinted), times the detail texture on the xz plane at two
//             scales; lowland warmer, plateau greyer, and rock showing through in dark patches on high flat ground.
//   detail  = the albedo of terrain.json (Rock Terrain 4 seen from above) tiled in world space with mirrored repeat:
//             the map is a point-mirrored crop, so its own uv's would not line up; mirrored tiling (over the inner 84
//             percent, the rim of the crop is stretched fill) has no seams.
//             Only its brightness relative to its mean (rockTint) is used, the hue comes from the tints.
//   light   = the 3-step toon ramp of the units with softened band edges (terrain normals vary smoothly; hard steps
//             would shimmer), times the building shadow.
import {
  Color,
  DataTexture,
  LinearFilter,
  MeshBasicNodeMaterial,
  RGBAFormat,
  SRGBColorSpace,
  type Node,
  type Texture,
  type TextureNode,
  Vector3,
} from 'three/webgpu';
import {
  abs,
  attribute,
  clamp,
  dFdx,
  dFdy,
  dot,
  float,
  max,
  mix,
  mod,
  normalize,
  normalWorld,
  positionWorld,
  pow,
  smoothstep,
  texture,
  uniform,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';

export interface TerrainMaterialOptions {
  lightDir: Vector3;
  /** Shadow factor node, 1 lit and 0 shadowed (shadows/sunShadow.ts). */
  shadow?: Node<'float'> | undefined;
}

/** Target brightness (linear luminance) of rock and ground before light; the tints only give the hue. */
export const ROCK_LUMA = 0.12;
export const GROUND_LUMA = 0.175;
/** Hue of dust on top of the (neutral) ground tint. */
const DUST = [1.24, 1.0, 0.72] as const;
/** The greybox's sand color (packages/map TILE_RGB ground), in linear rgb: vertex colors count relative to it. */
const VERTEX_REF = new Color().setRGB(150 / 255, 128 / 255, 94 / 255, 'srgb');
/** Share of the vertex colors in the ground. */
const VERTEX_WEIGHT = 0.45;
/** Detail texture tile sizes, meters. */
const ROCK_TILE = 13;
const GROUND_TILE = 29;
const GROUND_TILE_FINE = 7.7;
const LUMA = [0.2126, 0.7152, 0.0722] as const;
/** Part of the albedo that is tiled (uv INNER_MIN .. INNER_MIN + INNER_SPAN). */
const INNER_MIN = 0.08;
const INNER_SPAN = 0.84;

/** Defaults when terrain.json is not loaded: the tints of Rock Terrain 4. */
export const DEFAULT_ROCK_TINT = '#454340';
export const DEFAULT_GROUND_TINT = '#2b2b2b';

function luma(c: Color): number {
  return c.r * LUMA[0] + c.g * LUMA[1] + c.b * LUMA[2];
}

/** A tint scaled to a luminance (linear), keeping its hue. */
export function normalizeTint(hex: string, targetLuma: number): Color {
  const c = new Color(hex);
  const l = Math.max(1e-4, luma(c));
  return c.multiplyScalar(targetLuma / l);
}

export interface TerrainMaterialBundle {
  material: MeshBasicNodeMaterial;
  /** Swaps the detail texture (null: none, the tints alone). The bundle does not own it. */
  setAlbedo(map: Texture | null): void;
  /** Tints as sRGB hex strings (#rrggbb), e.g. rockTint and groundTint of terrain.json. */
  setTints(rockTint: string, groundTint: string): void;
  /** Height range of the terrain, meters: drives the lowland-to-plateau variation. */
  setHeightRange(min: number, max: number): void;
  dispose(): void;
}

function placeholderTexture(): DataTexture {
  const t = new DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1, RGBAFormat);
  t.colorSpace = SRGBColorSpace;
  // Filterable like the real albedo, so the shader keeps its sampler when the texture is swapped in.
  t.minFilter = t.magFilter = LinearFilter;
  t.needsUpdate = true;
  return t;
}

export function createTerrainMaterial(opts: TerrainMaterialOptions): TerrainMaterialBundle {
  const light = uniform(opts.lightDir.clone().normalize());
  const rockColor = uniform(new Vector3(1, 1, 1));
  const groundColor = uniform(new Vector3(1, 1, 1));
  const meanLuma = uniform(luma(new Color(DEFAULT_ROCK_TINT)));
  const detail = uniform(0); // 0 without a texture
  const minY = uniform(0);
  const invRange = uniform(1);

  const placeholder = placeholderTexture();
  const samplers: TextureNode[] = [];
  // Mirrored tiling over the inner part of the albedo only (its outer rim holds the stretched fill of the crop), done
  // by hand with explicit gradients so the fold is seamless and the mip level follows the unfolded uv.
  const sample = (uv: Node<'vec2'>): Node<'vec3'> => {
    const folded = float(1).sub(abs(mod(uv, 2).sub(1)));
    const t = texture(placeholder, folded.mul(INNER_SPAN).add(INNER_MIN)).grad(
      dFdx(uv).mul(INNER_SPAN),
      dFdy(uv).mul(INNER_SPAN),
    );
    samplers.push(t);
    return t.xyz;
  };
  const lumaOf = (c: Node<'vec3'>): Node<'float'> => dot(c, vec3(...LUMA));

  const N = normalize(normalWorld);
  const wp = positionWorld;
  const slope = float(1).sub(N.y);
  const h01 = clamp(wp.y.sub(minY).mul(invRange), 0, 1);

  // Ground detail: xz at two scales, the fine one rotated so the two never line up.
  const g1 = sample(wp.xz.div(GROUND_TILE));
  const fine = vec2(wp.x.mul(0.8).sub(wp.z.mul(0.6)), wp.x.mul(0.6).add(wp.z.mul(0.8)));
  const g2 = sample(fine.div(GROUND_TILE_FINE).add(vec2(0.37, 0.71)));
  const groundRatio = clamp(lumaOf(g1.mul(0.6).add(g2.mul(0.4))).div(meanLuma), 0.55, 1.5);

  // Rock detail: triplanar.
  const w0 = pow(abs(N), vec3(4, 4, 4));
  const w = w0.div(w0.x.add(w0.y).add(w0.z));
  const p = wp.div(ROCK_TILE);
  const rockTex = sample(p.zy).mul(w.x).add(sample(p.xz).mul(w.y)).add(sample(p.xy).mul(w.z));
  const rockRatio = clamp(lumaOf(rockTex).div(meanLuma), 0.4, 1.8);

  let rockMask: Node<'float'> = smoothstep(
    0.12,
    0.29,
    slope.add(groundRatio.sub(1).mul(0.07).mul(detail)),
  );
  const patches = smoothstep(0.55, 0.9, h01)
    .mul(smoothstep(0.9, 0.7, groundRatio))
    .mul(0.4)
    .mul(detail);
  rockMask = max(rockMask, patches);

  const rock = rockColor
    .mul(mix(float(1), rockRatio, detail))
    .mul(mix(float(0.86), float(1.1), h01));

  const vc = attribute('color', 'vec3');
  const vcRef = vec3(VERTEX_REF.r, VERTEX_REF.g, VERTEX_REF.b);
  const vcRatio = clamp(vc.div(vcRef), vec3(0.4, 0.4, 0.4), vec3(1.6, 1.6, 1.6));
  const heightTone = mix(vec3(1.1, 1.0, 0.86), vec3(0.86, 0.9, 0.97), h01);
  const ground = groundColor
    .mul(mix(vec3(1, 1, 1), vcRatio, VERTEX_WEIGHT))
    .mul(heightTone)
    .mul(mix(float(1), groundRatio, detail.mul(0.45)));

  let albedo: Node<'vec3'> = mix(ground, rock, rockMask);
  albedo = mix(albedo, vec3(lumaOf(albedo), lumaOf(albedo), lumaOf(albedo)), 0.12);

  // Soft-edged toon ramp: the bands of unitMaterial.ts toonRamp, each edge spread over a little light.
  const hl = dot(N, light).mul(0.5).add(0.5);
  let shade: Node<'float'> = float(0.52)
    .add(smoothstep(0.39, 0.45, hl).mul(0.26))
    .add(smoothstep(0.67, 0.73, hl).mul(0.22));
  if (opts.shadow) shade = mix(float(0.52), shade, opts.shadow);

  // Sky occlusion from the refined grid (terrainRefine.ts): the foot of a cliff and gullies sit a little darker.
  const occlusion = attribute('occlusion', 'float');

  const m = new MeshBasicNodeMaterial();
  const out = vec4(albedo.mul(shade).mul(occlusion), 1);
  // Receiving the building shadow: the color goes in fragmentNode (see propMaterial.ts).
  if (opts.shadow) m.fragmentNode = out;
  else m.colorNode = out;
  m.name = 'crawlout-terrain-toon';

  const setTints = (rockTint: string, groundTint: string): void => {
    const r = normalizeTint(rockTint, ROCK_LUMA);
    rockColor.value.set(r.r, r.g, r.b);
    meanLuma.value = Math.max(1e-4, luma(new Color(rockTint)));
    const g = normalizeTint(groundTint, 1);
    g.r *= DUST[0];
    g.g *= DUST[1];
    g.b *= DUST[2];
    g.multiplyScalar(GROUND_LUMA / Math.max(1e-4, luma(g)));
    groundColor.value.set(g.r, g.g, g.b);
  };
  setTints(DEFAULT_ROCK_TINT, DEFAULT_GROUND_TINT);

  return {
    material: m,
    setAlbedo(map) {
      for (const s of samplers) s.value = map ?? placeholder;
      detail.value = map ? 1 : 0;
    },
    setTints,
    setHeightRange(lo, hi) {
      minY.value = lo;
      invRange.value = 1 / Math.max(0.5, hi - lo);
    },
    dispose() {
      m.dispose();
      placeholder.dispose();
    },
  };
}
