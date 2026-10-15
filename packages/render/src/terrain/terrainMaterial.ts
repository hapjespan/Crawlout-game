// Terrain material (TSL): the albedo of terrain.json as the real color of the ground, toon-ramp light. No PBR.
// Built for readability at RTS distance: the photo color is lifted to a fixed mean brightness, a little desaturated
// and warmed towards the wasteland palette, so units (team color plus rim) and buildings (real shadow) still stand
// out against it.
//
//   albedo  = the albedo of terrain.json (Rock Terrain 4 seen from above, aligned with its heightfield), sampled with
//             its own uv per world point through the map's layout (albedoLayout.ts): the tile, its orientation, the
//             point-mirrored middle tile with its blended seam and the blended tile borders, exactly as packages/map
//             built the heights. So rock lies on the cliffs and gravel in the gullies the heights came from. Up to
//             four tiles near a corner and two samples on a mirror seam, only where their weight is not zero
//             (branches; explicit gradients from the unfolded tile coordinates, so the mip level stays right).
//   style   = times ALBEDO_TARGET_LUMA / the albedo's mean luminance (rockTint), its contrast to ALBEDO_CONTRAST,
//             ALBEDO_DESATURATE towards grey,
//             ALBEDO_WARMTH; the map's vertex colors a little (ruins), lowland slightly warmer, plateau cooler.
//   cliffs  = the top view smears down a steep wall: there a triplanar sample of the same albedo (world space, 13 m)
//             adds its brightness variation along the wall.
//   grain   = a fine rotated sample (7.7 m) adds texture near the camera (fades out from 25 to 90 m), where the
//             albedo (16 px per meter at 2048) is magnified.
//   no texture: the tints of terrain.json on fixed brightness, rock from about 30 degrees slope (the former look).
//   light   = the 3-step toon ramp of the units with softened band edges (terrain normals vary smoothly; hard steps
//             would shimmer), times the building shadow and the sky occlusion of the refined grid.
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
  Vector2,
  Vector3,
  Vector4,
} from 'three/webgpu';
import {
  abs,
  attribute,
  cameraPosition,
  clamp,
  dFdx,
  dFdy,
  distance,
  dot,
  float,
  floor,
  Fn,
  If,
  int,
  max,
  mix,
  mod,
  normalize,
  normalWorld,
  positionWorld,
  pow,
  select,
  smoothstep,
  step,
  texture,
  uniform,
  uniformArray,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import {
  ALBEDO_SEAMS,
  MAX_ALBEDO_TILES,
  validateAlbedoLayout,
  type TerrainAlbedoLayout,
} from './albedoLayout.js';

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
/** Mean brightness (linear luminance) the albedo is lifted to: the former ground level, a little lower for contrast. */
export const ALBEDO_TARGET_LUMA = 0.15;
/** Share of the albedo's brightness contrast that stays (the rest is pulled to ALBEDO_TARGET_LUMA). */
export const ALBEDO_CONTRAST = 0.8;
/** Share of the way to grey: the photo's moss and lichen stay, but quieter than in the source. */
export const ALBEDO_DESATURATE = 0.3;
/** Warm grade on the albedo (rgb), towards the wasteland palette of props and buildings. */
const ALBEDO_WARMTH = [1.07, 1.0, 0.88] as const;
/** Share of the map's vertex colors (relative to the sand) on top of the albedo: ruins and marks still read. */
const ALBEDO_VERTEX_WEIGHT = 0.2;
/** Strength of the triplanar variation on cliffs and of the fine grain near the camera. */
const CLIFF_DETAIL = 0.75;
const GRAIN = 0.3;
/** Default tile size (m) before terrain.json says otherwise: Rock Terrain 4 at 1 m per cell. */
export const DEFAULT_ALBEDO_TILE = 128;

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
  /** Swaps the albedo (null: none, the tints alone). The bundle does not own it. */
  setAlbedo(map: Texture | null): void;
  /** Where each world point samples the albedo (albedoLayout.ts). Throws AlbedoLayoutError on an invalid layout. */
  setLayout(layout: TerrainAlbedoLayout): void;
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
  const exposure = uniform(ALBEDO_TARGET_LUMA / luma(new Color(DEFAULT_ROCK_TINT)));
  // Layout: grid origin x, z, 1 / tile size, blend half width in tiles; size: cols, rows; per tile: orientation,
  // seam kind (-1 none), seam half width in tiles.
  const layoutGrid = uniform(new Vector4(0, 0, 1 / DEFAULT_ALBEDO_TILE, 0));
  const layoutSize = uniform(new Vector2(1, 1));
  const tileParams = uniformArray<'vec4'>(
    Array.from({ length: MAX_ALBEDO_TILES }, () => new Vector4(0, -1, 0.1, 0)),
    'vec4',
  );
  const minY = uniform(0);
  const invRange = uniform(1);

  const placeholder = placeholderTexture();
  const samplers: TextureNode[] = [];
  /** A sample of the albedo with explicit gradients (also valid inside the layout's branches). */
  const sampleGrad = (
    uv: Node<'vec2'>,
    gx: Node<'vec2'>,
    gy: Node<'vec2'>,
  ): Node<'vec3'> => {
    const t = texture(placeholder, uv).grad(gx, gy);
    samplers.push(t);
    return t.xyz;
  };
  // World-space detail: mirrored tiling of the albedo (no seams), mip level from the unfolded uv.
  const sample = (uv: Node<'vec2'>): Node<'vec3'> =>
    sampleGrad(float(1).sub(abs(mod(uv, 2).sub(1))), dFdx(uv), dFdy(uv));
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

  // With a texture: the albedo itself through the map's layout (albedoLayout.ts albedoUv is the CPU form).
  const tileOf = (
    index: Node<'int'>,
    u: Node<'float'>,
    v: Node<'float'>,
    gx: Node<'vec2'>,
    gy: Node<'vec2'>,
  ): Node<'vec3'> => {
    const p = tileParams.element(index);
    const o = p.x;
    const fu = abs(mod(u.add(1), 2).sub(1));
    const fv = abs(mod(v.add(1), 2).sub(1));
    const swap = step(3.5, o);
    const flipA = mod(o, 2);
    const flipB = mod(floor(o.mul(0.5)), 2);
    // Texture v runs up (flipY): row 0 of the albedo, the smallest source z, sits at v = 1.
    const uvOf = (a0: Node<'float'>, b0: Node<'float'>): Node<'vec2'> => {
      const a = mix(a0, b0, swap);
      const b = mix(b0, a0, swap);
      return vec2(mix(a, float(1).sub(a), flipA), float(1).sub(mix(b, float(1).sub(b), flipB)));
    };
    const ga = mix(gx, gx.yx, swap);
    const gb = mix(gy, gy.yx, swap);
    const color = vec3(sampleGrad(uvOf(fu, fv), ga, gb)).toVar();
    If(p.y.greaterThan(-0.5), () => {
      const kind = p.y;
      const dist = select(
        kind.lessThan(0.5),
        float(0.5).sub(fv),
        select(
          kind.lessThan(1.5),
          float(0.5).sub(fu),
          select(
            kind.lessThan(2.5),
            float(1).sub(fu).sub(fv).mul(0.5),
            fu.sub(fv).mul(0.5),
          ),
        ),
      );
      const keep = smoothstep(0, 1, dist.add(p.z).div(p.z.mul(2)));
      If(keep.lessThan(1), () => {
        const mirrored = sampleGrad(uvOf(float(1).sub(fu), float(1).sub(fv)), ga, gb);
        color.assign(mix(mirrored, color, keep));
      });
    });
    return color;
  };
  const sourceAlbedo = Fn(() => {
    const g = wp.xz.sub(layoutGrid.xy).mul(layoutGrid.z);
    // Gradients before any branch (derivatives need uniform control flow).
    const gx = dFdx(g);
    const gy = dFdy(g);
    const last = layoutSize.sub(1);
    const t = clamp(floor(g), vec2(0, 0), last);
    const l = g.sub(t);
    const side = step(0.5, l).mul(2).sub(1);
    const next = t.add(side);
    const inside = step(0, next).mul(step(next, last));
    const W = max(layoutGrid.w, 1e-6);
    const border = float(0.5).sub(abs(l.sub(0.5)));
    const w = smoothstep(0, 1, W.sub(border).div(W.mul(2)))
      .mul(inside)
      .mul(step(1e-5, layoutGrid.w));
    const acc = vec3(0, 0, 0).toVar();
    const tap = (dx: Node<'float'>, dz: Node<'float'>, weight: Node<'float'>): void => {
      If(weight.greaterThan(0), () => {
        const index = int(t.y.add(dz).mul(layoutSize.x).add(t.x).add(dx));
        acc.addAssign(tileOf(index, l.x.sub(dx), l.y.sub(dz), gx, gy).mul(weight));
      });
    };
    const zero = float(0);
    tap(zero, zero, float(1).sub(w.x).mul(float(1).sub(w.y)));
    tap(side.x, zero, w.x.mul(float(1).sub(w.y)));
    tap(zero, side.y, float(1).sub(w.x).mul(w.y));
    tap(side.x, side.y, w.x.mul(w.y));
    return acc;
  });
  let photo: Node<'vec3'> = sourceAlbedo().mul(exposure);
  const photoLuma = max(lumaOf(photo), 1e-4);
  // Calmer than the photo: brightness pulled towards the mean, so units read against it.
  const calmLuma = mix(float(ALBEDO_TARGET_LUMA), photoLuma, ALBEDO_CONTRAST);
  photo = photo.mul(calmLuma.div(photoLuma));
  photo = mix(photo, vec3(calmLuma, calmLuma, calmLuma), ALBEDO_DESATURATE).mul(
    vec3(...ALBEDO_WARMTH),
  );
  // Cliffs: the triplanar sample's variation along the wall; grain near the camera.
  const steep = smoothstep(0.12, 0.29, slope);
  photo = photo.mul(mix(float(1), rockRatio, steep.mul(CLIFF_DETAIL)));
  const grainRatio = clamp(lumaOf(g2).div(meanLuma), 0.6, 1.4);
  const near = smoothstep(90, 25, distance(cameraPosition, wp));
  photo = photo
    .mul(mix(float(1), grainRatio, near.mul(GRAIN)))
    .mul(mix(vec3(1, 1, 1), vcRatio, ALBEDO_VERTEX_WEIGHT))
    .mul(mix(vec3(1.04, 1.0, 0.95), vec3(0.96, 0.98, 1.02), h01));
  albedo = mix(albedo, photo, detail);

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
    exposure.value = ALBEDO_TARGET_LUMA / meanLuma.value;
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
    setLayout(layout) {
      validateAlbedoLayout(layout);
      layoutGrid.value.set(
        layout.originX ?? 0,
        layout.originZ ?? 0,
        1 / layout.tileSize,
        (layout.blendHalfWidth ?? 0) / layout.tileSize,
      );
      layoutSize.value.set(layout.cols, layout.rows);
      const params = tileParams.array as Vector4[];
      layout.tiles.forEach((tile, i) => {
        const m = tile.pointMirror;
        params[i]!.set(
          tile.orientation,
          m ? ALBEDO_SEAMS.indexOf(m.seam) : -1,
          m ? m.halfWidth / layout.tileSize : 0.1,
          0,
        );
      });
    },
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
