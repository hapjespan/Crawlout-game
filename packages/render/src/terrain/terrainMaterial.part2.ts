// Split from terrainMaterial.ts to stay under the 5,000-token file limit; terrainMaterial.ts re-exports the public surface.
// Holds: createTerrainMaterial.
import {
  uniform,
  uniformArray,
  texture,
  positionWorld,
  dot,
  vec3,
  fract,
  sin,
  vec2,
  floor,
  float,
  mix,
  max,
  normalWorld,
  clamp,
  attribute,
  abs,
  mod,
  pow,
  smoothstep,
  step,
  If,
  select,
  int,
  distance,
  cameraPosition,
  Fn,
  dFdx,
  dFdy,
  vec4,
} from 'three/tsl';
import { createGroundSplat } from './groundSplat.js';
import {
  Vector3,
  Color,
  Vector4,
  Vector2,
  type TextureNode,
  type Node,
  MeshBasicNodeMaterial,
} from 'three/webgpu';
import { MAX_ALBEDO_TILES, validateAlbedoLayout, ALBEDO_SEAMS } from './albedoLayout.js';
import { safeNormalNode } from './safeNormal.js';
import { worldGrade } from '../look/grade.js';
import { toonLight } from '../units/unitMaterial.js';
import {
  ALBEDO_CONTRAST,
  ALBEDO_DESATURATE,
  ALBEDO_TARGET_LUMA,
  ALBEDO_VERTEX_WEIGHT,
  ALBEDO_WARMTH,
  CLIFF_DETAIL,
  DEFAULT_ALBEDO_TILE,
  DEFAULT_GROUND_TINT,
  DEFAULT_ROCK_TINT,
  DETAIL_COOL,
  DETAIL_WARM,
  DUST,
  EDGE_DUST_COLOR,
  EDGE_DUST_FADE,
  EDGE_DUST_SHARE,
  EDGE_MACRO_BRIGHTNESS,
  EDGE_MACRO_WAVELENGTH,
  EDGE_WARP_AMPLITUDE,
  EDGE_WARP_RAMP,
  EDGE_WARP_WAVELENGTH,
  GRAIN,
  GRASS_TINT,
  GRASS_TINT_STRENGTH,
  GROUND_LUMA,
  GROUND_TILE_FINE,
  LUMA,
  ROCK_LUMA,
  ROCK_TILE,
  TERRAIN_GRADE,
  VERTEX_REF,
  VERTEX_WEIGHT,
  luma,
  normalizeTint,
  placeholderTexture,
} from './terrainMaterial.part1.js';
import type { TerrainMaterialBundle, TerrainMaterialOptions } from './terrainMaterial.part1.js';

export function createTerrainMaterial(opts: TerrainMaterialOptions): TerrainMaterialBundle {
  const light = uniform(opts.lightDir.clone().normalize());
  const splat = opts.detailLayer === false ? null : createGroundSplat();
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
  // Grass mask: world rectangle (min x, min z, 1 / size x, 1 / size z); strength 0 without a mask.
  const grassRect = uniform(new Vector4(0, 0, 1, 1));
  const grassOn = uniform(0);
  const grassPlaceholder = placeholderTexture();
  const grassSampler = texture(
    grassPlaceholder,
    positionWorld.xz.sub(grassRect.xy).mul(grassRect.zw),
  );

  // Ground map (groundMap.ts): world rectangle as for the grass mask; the placeholder reads as dry, open, flat ground.
  const groundRect = uniform(new Vector4(0, 0, 1, 1));
  const groundPlaceholder = placeholderTexture();
  const groundSampler = texture(
    groundPlaceholder,
    positionWorld.xz.sub(groundRect.xy).mul(groundRect.zw),
  );

  const placeholder = placeholderTexture();
  const samplers: TextureNode[] = [];
  /** A sample of the albedo with explicit gradients (also valid inside the layout's branches). */
  const sampleGrad = (uv: Node<'vec2'>, gx: Node<'vec2'>, gy: Node<'vec2'>): Node<'vec3'> => {
    const t = texture(placeholder, uv).grad(gx, gy);
    samplers.push(t);
    return t.xyz;
  };
  const lumaOf = (c: Node<'vec3'>): Node<'float'> => dot(c, vec3(...LUMA));

  /** Hash and smooth value noise in 0..1 (TSL, no texture): the warp and macro variation outside the map. */
  const hash21 = (p: Node<'vec2'>): Node<'float'> =>
    fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453));
  const vnoise = (p: Node<'vec2'>): Node<'float'> => {
    const i = floor(p);
    const f = fract(p);
    const u = f.mul(f).mul(float(3).sub(f.mul(2)));
    const a = hash21(i);
    const b = hash21(i.add(vec2(1, 0)));
    const c = hash21(i.add(vec2(0, 1)));
    const d = hash21(i.add(vec2(1, 1)));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  };
  /** Meters outside the layout's tile grid (0 inside): the skirt's distance from the map. */
  const outsideMeters = (): Node<'float'> => {
    const g = wp.xz.sub(layoutGrid.xy).mul(layoutGrid.z);
    const over = max(
      max(g.x.negate(), g.x.sub(layoutSize.x)),
      max(g.y.negate(), g.y.sub(layoutSize.y)),
    );
    return max(over, 0).div(layoutGrid.z);
  };

  // normalWorld is unit length where the geometry is sound; the safe form (safeNormal.ts) keeps a zero or NaN normal from spreading.
  const N = safeNormalNode(normalWorld);
  const wp = positionWorld;
  const slope = float(1).sub(N.y);
  const h01 = clamp(wp.y.sub(minY).mul(invRange), 0, 1);

  const vc = attribute('color', 'vec3');
  const vcRef = vec3(VERTEX_REF.r, VERTEX_REF.g, VERTEX_REF.b);
  const vcRatio = clamp(vc.div(vcRef), vec3(0.4, 0.4, 0.4), vec3(1.6, 1.6, 1.6));
  // Fine detail plane: rotated so it never lines up with the map's axes.
  const rot = (v: Node<'vec2'>): Node<'vec2'> =>
    vec2(v.x.mul(0.8).sub(v.y.mul(0.6)), v.x.mul(0.6).add(v.y.mul(0.8)));
  /** Mirrored world-space tiling of the albedo, with gradients passed in (the samples sit in branches). */
  const tiled = (uv: Node<'vec2'>, gx: Node<'vec2'>, gy: Node<'vec2'>): Node<'vec3'> =>
    sampleGrad(float(1).sub(abs(mod(uv, 2).sub(1))), gx, gy);

  /** Brightness variation of a triplanar albedo sample around its mean (rock detail). */
  const triplanarRatio = (dpx: Node<'vec3'>, dpy: Node<'vec3'>): Node<'float'> => {
    const w0 = pow(abs(N), vec3(4, 4, 4));
    const w = w0.div(w0.x.add(w0.y).add(w0.z));
    const p = wp.div(ROCK_TILE);
    const gx = dpx.div(ROCK_TILE);
    const gy = dpy.div(ROCK_TILE);
    const rockTex = tiled(p.zy, gx.zy, gy.zy)
      .mul(w.x)
      .add(tiled(p.xz, gx.xz, gy.xz).mul(w.y))
      .add(tiled(p.xy, gx.xy, gy.xy).mul(w.z));
    return clamp(lumaOf(rockTex).div(meanLuma), 0.4, 1.8);
  };

  /** Without a texture: the tints on fixed brightness, rock from about 30 degrees slope (the former look). */
  const tintAlbedo = (): Node<'vec3'> => {
    const rockMask = smoothstep(0.12, 0.29, slope);
    const rock = rockColor.mul(mix(float(0.86), float(1.1), h01));
    const heightTone = mix(vec3(1.1, 1.0, 0.86), vec3(0.86, 0.9, 0.97), h01);
    const ground = groundColor.mul(mix(vec3(1, 1, 1), vcRatio, VERTEX_WEIGHT)).mul(heightTone);
    const a = mix(ground, rock, rockMask);
    return mix(a, vec3(lumaOf(a), lumaOf(a), lumaOf(a)), 0.12);
  };

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
          select(kind.lessThan(2.5), float(1).sub(fu).sub(fv).mul(0.5), fu.sub(fv).mul(0.5)),
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
  const sourceAlbedo = (dpx: Node<'vec3'>, dpy: Node<'vec3'>): Node<'vec3'> => {
    // Outside the map the sample position is warped by smooth noise (zero at the edge), so the mirrored tiles do not
    // line up into a kaleidoscope; the explicit gradients below stay those of the unwarped position.
    const warpAmount = smoothstep(0, EDGE_WARP_RAMP, outsideMeters()).mul(EDGE_WARP_AMPLITUDE);
    const wq = wp.xz.div(EDGE_WARP_WAVELENGTH);
    const warp = vec2(
      vnoise(wq)
        .add(vnoise(wq.mul(2.3).add(vec2(5.2, 1.3))).mul(0.5))
        .sub(0.75),
      vnoise(wq.add(vec2(31.7, 8.9)))
        .add(vnoise(wq.mul(2.3).add(vec2(17.1, 43.4))).mul(0.5))
        .sub(0.75),
    ).mul(warpAmount.mul(1.3));
    const g = wp.xz.add(warp).sub(layoutGrid.xy).mul(layoutGrid.z);
    const gx = dpx.xz.mul(layoutGrid.z);
    const gy = dpy.xz.mul(layoutGrid.z);
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
  };

  /** With a texture: the albedo as the color, styled; cliff variation and grain only where they show. */
  const photoAlbedo = (dpx: Node<'vec3'>, dpy: Node<'vec3'>): Node<'vec3'> => {
    const raw = sourceAlbedo(dpx, dpy).mul(exposure);
    const rawLuma = max(lumaOf(raw), 1e-4);
    // Calmer than the photo: brightness pulled towards the mean, so units read against it.
    const calmLuma = mix(float(ALBEDO_TARGET_LUMA), rawLuma, ALBEDO_CONTRAST);
    const photo = mix(
      raw.mul(calmLuma.div(rawLuma)),
      vec3(calmLuma, calmLuma, calmLuma),
      ALBEDO_DESATURATE,
    )
      .mul(vec3(...ALBEDO_WARMTH))
      .mul(mix(vec3(1, 1, 1), vcRatio, ALBEDO_VERTEX_WEIGHT))
      .mul(mix(vec3(1.04, 1.0, 0.95), vec3(0.96, 0.98, 1.02), h01))
      .toVar();
    // Cliffs: the triplanar sample's variation along the wall (three samples, only on slopes).
    const steep = smoothstep(0.12, 0.29, slope);
    If(steep.greaterThan(0), () => {
      photo.mulAssign(mix(float(1), triplanarRatio(dpx, dpy), steep.mul(CLIFF_DETAIL)));
    });
    // Grain near the camera.
    // Ascending edges: smoothstep with edge0 > edge1 is undefined in WGSL/HLSL (NaN in far views on some drivers).
    const near = float(1).sub(smoothstep(25, 90, distance(cameraPosition, wp)));
    If(near.greaterThan(0), () => {
      const g2 = tiled(
        rot(wp.xz).div(GROUND_TILE_FINE).add(vec2(0.37, 0.71)),
        rot(dpx.xz).div(GROUND_TILE_FINE),
        rot(dpy.xz).div(GROUND_TILE_FINE),
      );
      const grainRatio = clamp(lumaOf(g2).div(meanLuma), 0.6, 1.4);
      photo.mulAssign(mix(float(1), grainRatio, near.mul(GRAIN)));
    });
    return photo;
  };

  const terrainAlbedo = Fn(() => {
    // Gradients of the world position first, in uniform control flow: every sample below sits in a branch.
    const dpx = dFdx(wp).toVar();
    const dpy = dFdy(wp).toVar();
    let grassed: Node<'vec3'>;
    if (splat) {
      // The layered ground (groundSplat.ts): the land chooses the layers, the vertex colours (ruins, marks) a little.
      const ground = splat.shade({
        wp,
        N,
        light,
        dpx,
        dpy,
        dist: distance(cameraPosition, wp),
        ground: groundSampler,
      });
      grassed = ground.albedo
        .mul(mix(vec3(1, 1, 1), vcRatio, ALBEDO_VERTEX_WEIGHT))
        .mul(float(1).add(ground.lightDelta));
    } else {
      const out = vec3(0, 0, 0).toVar();
      If(detail.greaterThan(0.5), () => {
        out.assign(photoAlbedo(dpx, dpy));
      }).Else(() => {
        out.assign(tintAlbedo());
      });
      // Grass: one plain sample of the density mask (outside the branches), the ground mixes towards a soft green.
      const grass = grassSampler.x.mul(grassOn).mul(GRASS_TINT_STRENGTH);
      grassed = mix(out, out.mul(vec3(...GRASS_TINT)), grass);
    }
    // Beyond the map: a macro brightness and hue variation, and the photo's detail fading to a generic dust colour.
    const outside = outsideMeters();
    const edge = smoothstep(0, EDGE_DUST_FADE[0], outside);
    const macro = vnoise(wp.xz.div(EDGE_MACRO_WAVELENGTH))
      .mul(0.65)
      .add(vnoise(wp.xz.div(EDGE_MACRO_WAVELENGTH * 0.37).add(vec2(9.1, 2.7))).mul(0.35));
    const macroTone = mix(vec3(...DETAIL_COOL), vec3(...DETAIL_WARM), macro);
    const varied = grassed.mul(mix(vec3(1, 1, 1), macroTone, edge.mul(0.8))).mul(
      float(1).add(
        macro
          .sub(0.5)
          .mul(2 * EDGE_MACRO_BRIGHTNESS)
          .mul(edge),
      ),
    );
    const dustShare = smoothstep(EDGE_DUST_FADE[0], EDGE_DUST_FADE[1], outside).mul(
      EDGE_DUST_SHARE,
    );
    const dustLuma = max(lumaOf(varied), 1e-4);
    // The dust keeps only a little of the photo's brightness pattern (what mirroring made symmetrical); the macro noise
    // above carries the variation instead.
    const dustColor = vec3(...EDGE_DUST_COLOR).mul(
      mix(float(1), clamp(dustLuma.div(ALBEDO_TARGET_LUMA), 0.6, 1.5), 0.35),
    );
    return mix(varied, dustColor, dustShare);
  });
  // The shared world grade (look/grade.ts) at half strength: the terrain already carries its own warm desaturation
  // (ALBEDO_WARMTH, ALBEDO_DESATURATE), the grade adds the contrast and the same dusty tint as buildings and units.
  const albedo = worldGrade(terrainAlbedo(), TERRAIN_GRADE);

  // The shared rig's light (toonLight): soft-edged toon ramp, hemisphere fill, warm sun, the sun's shadow.
  const shade = toonLight(N, light, opts.shadow?.factor);

  // Sky occlusion from the refined grid (terrainRefine.ts): the foot of a cliff and gullies sit a little darker.
  const occlusion = attribute('occlusion', 'float');

  const m = new MeshBasicNodeMaterial();
  const out = vec4(albedo.mul(shade).mul(occlusion), 1);
  // Receiving the building shadow: the color goes in fragmentNode (see propMaterial.ts).
  if (opts.shadow) {
    m.fragmentNode = out;
    m.receivedShadowPositionNode = opts.shadow.receivePosition(positionWorld, N);
  } else m.colorNode = out;
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
    setGrassMask(map, rect) {
      grassSampler.value = map ?? grassPlaceholder;
      grassOn.value = map && rect ? 1 : 0;
      if (rect) grassRect.value.set(rect.minX, rect.minZ, 1 / rect.sizeX, 1 / rect.sizeZ);
    },
    setGroundMap(map, rect) {
      groundSampler.value = map ?? groundPlaceholder;
      if (rect) groundRect.value.set(rect.minX, rect.minZ, 1 / rect.sizeX, 1 / rect.sizeZ);
    },
    setHeightRange(lo, hi) {
      minY.value = lo;
      invRange.value = 1 / Math.max(0.5, hi - lo);
    },
    dispose() {
      m.dispose();
      placeholder.dispose();
      grassPlaceholder.dispose();
      groundPlaceholder.dispose();
      splat?.dispose();
    },
  };
}
