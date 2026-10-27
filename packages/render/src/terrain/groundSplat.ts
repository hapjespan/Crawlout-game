// The terrain's ground colour from four material layers (turf, dirt, gravel, rock; groundLayers.ts), blended per
// pixel by the land itself (the ground map, groundMap.ts, and the slope) and by the layers' own heights, so grass
// thins out between pebbles and rock breaks through the turf at its high points instead of along a soft gradient.
//
//   sampling   each layer texture at two world scales (fine and coarse tile), every scale twice with its own rotation
//              and offset, the two blended by smooth noise and re-contrasted around the layer mean (the blend would
//              flatten it): no visible tile grid and no repeating wallpaper. All samples in uniform control flow.
//   weights    rock on steep ground and ridges, gravel as scree at the foot of slopes and in dry patches, turf where
//              the ground map has cover (less right at the waterline), dirt underneath everything; then the height
//              blend picks the layer whose relief stands highest within BLEND_DEPTH.
//   colour     each layer from a dark root to a light top by its relief, its hue by its tone channel; cavities darken,
//              wet ground near water is darker and a little cooler, and the macro channel varies hue and brightness
//              over tens of meters.
//   relief     the blended relief in meters bends the shading normal (screen-space derivatives, no extra samples) and
//              comes back as a small light delta on the smooth normal, so the toon ramp does not band on every pebble;
//              it fades out with distance where the derivatives would only shimmer.
import {
  abs,
  clamp,
  cross,
  dFdx,
  dFdy,
  dot,
  float,
  floor,
  fract,
  inverseSqrt,
  max,
  mix,
  normalize,
  pow,
  sign,
  sin,
  smoothstep,
  texture,
  uniform,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import { Vector4, type Node, type Texture } from 'three/webgpu';
import { createGroundLayerTextures } from './groundLayers.js';

/** World tile edges (m) of the fine and coarse layer samples. */
export const GROUND_FINE_TILE = 3.6;
export const GROUND_COARSE_TILE = 11.5;
/** Share of the coarse sample in each layer (turf, dirt, gravel, rock): rock plates are large, blades are small. */
export const GROUND_COARSE_SHARE = [0.25, 0.4, 0.3, 0.6] as const;
/** Tile (m) of the triplanar rock on walls, and strata bands per meter of height there. */
export const ROCK_WALL_TILE = 7;
export const STRATA_PER_M = 1.4;
/** Height blend: how far (0..1 relief) below the top layer another still shows. */
export const BLEND_DEPTH = 0.22;
/** Relief amplitude per layer, meters (turf, dirt, gravel, rock). */
export const RELIEF_M = [0.05, 0.02, 0.035, 0.12] as const;
/** Bump light gain, and the distances (m) over which it fades out. */
export const BUMP_GAIN = 0.9;
export const BUMP_FADE = [45, 170] as const;

/** Layer colours, linear rgb before light: dark (root, crack) to light (top). */
export const GROUND_PALETTE = {
  turfRoot: [0.05, 0.055, 0.025],
  turfGreen: [0.14, 0.16, 0.06],
  turfStraw: [0.27, 0.225, 0.115],
  dirtDark: [0.07, 0.05, 0.032],
  dirtLight: [0.22, 0.165, 0.105],
  gravelDark: [0.075, 0.068, 0.06],
  gravelLight: [0.26, 0.235, 0.2],
  rockDark: [0.065, 0.062, 0.058],
  rockLight: [0.25, 0.235, 0.21],
  lichen: [0.19, 0.19, 0.09],
} as const;

const v3 = (c: readonly number[]): Node<'vec3'> => vec3(c[0]!, c[1]!, c[2]!);

export interface GroundSplatInputs {
  wp: Node<'vec3'>;
  N: Node<'vec3'>;
  light: Node<'vec3'>;
  /** World-position derivatives (dFdx, dFdy), taken in uniform control flow. */
  dpx: Node<'vec3'>;
  dpy: Node<'vec3'>;
  /** Camera distance (m). */
  dist: Node<'float'>;
  /** The ground map sample (moisture, cover, ridge, macro). */
  ground: Node<'vec4'>;
}

export interface GroundSplat {
  /** Albedo (linear, before light) and the bump's light delta (add to the light factor). */
  shade(inputs: GroundSplatInputs): { albedo: Node<'vec3'>; lightDelta: Node<'float'> };
  textures: Texture[];
  dispose(): void;
}

export function createGroundSplat(): GroundSplat {
  const layers = createGroundLayerTextures();
  const mean = uniform(new Vector4(...layers.reliefMean));

  const hash21 = (p: Node<'vec2'>): Node<'float'> =>
    fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453));
  const vnoise = (p: Node<'vec2'>): Node<'float'> => {
    const i = floor(p);
    const f = fract(p);
    const u = f.mul(f).mul(float(3).sub(f.mul(2)));
    return mix(
      mix(hash21(i), hash21(i.add(vec2(1, 0))), u.x),
      mix(hash21(i.add(vec2(0, 1))), hash21(i.add(vec2(1, 1))), u.x),
      u.y,
    );
  };
  const rot = (p: Node<'vec2'>, a: number): Node<'vec2'> => {
    const c = Math.cos(a);
    const s = Math.sin(a);
    return vec2(p.x.mul(c).sub(p.y.mul(s)), p.x.mul(s).add(p.y.mul(c)));
  };

  /** One scale: two rotated, offset samples blended by noise, the relief re-contrasted around the layer means. */
  const scale = (
    xz: Node<'vec2'>,
    tile: number,
    a: number,
    b: number,
    seed: number,
  ): { relief: Node<'vec4'>; tone: Node<'vec4'> } => {
    const uvA = rot(xz, a)
      .div(tile)
      .add(vec2(0.13 * seed, 0.71 * seed));
    const uvB = rot(xz, b)
      .div(tile)
      .add(vec2(0.57 * seed + 0.31, 0.23 * seed + 0.89));
    const w = smoothstep(0.3, 0.7, vnoise(xz.div(tile * 0.9).add(vec2(seed * 7.3, seed * 3.1))));
    const reliefMix = mix(texture(layers.relief, uvA), texture(layers.relief, uvB), w);
    const k = inverseSqrt(w.mul(w).add(float(1).sub(w).mul(float(1).sub(w))));
    const relief = clamp(reliefMix.sub(mean).mul(k).add(mean), vec4(0), vec4(1));
    const tone = mix(texture(layers.tone, uvA), texture(layers.tone, uvB), w);
    return { relief, tone };
  };

  return {
    textures: [layers.relief, layers.tone],
    dispose() {
      layers.relief.dispose();
      layers.tone.dispose();
    },
    shade({ wp, N, light, dpx, dpy, dist, ground }) {
      const xz = wp.xz;
      const fine = scale(xz, GROUND_FINE_TILE, 0.0, 2.1, 1);
      const coarse = scale(xz, GROUND_COARSE_TILE, 0.9, 4.0, 2);
      const share = vec4(...GROUND_COARSE_SHARE);
      const flatH = mix(fine.relief, coarse.relief, share);
      // Rock on steep ground: a triplanar sample (no stretching down a wall) with strata along the contour lines.
      const slope = float(1).sub(N.y);
      const steep = smoothstep(0.08, 0.3, slope);
      const tw0 = pow(abs(N), vec3(4, 4, 4));
      const tw = tw0.div(tw0.x.add(tw0.y).add(tw0.z));
      const tp = wp.div(ROCK_WALL_TILE);
      const wallH = texture(layers.relief, tp.zy)
        .w.mul(tw.x)
        .add(texture(layers.relief, tp.xz.add(vec2(0.37, 0.61))).w.mul(tw.y))
        .add(texture(layers.relief, tp.xy.add(vec2(0.71, 0.13))).w.mul(tw.z));
      const strata = sin(wp.y.mul(STRATA_PER_M * Math.PI * 2).add(vnoise(xz.div(5)).mul(4)));
      const rockH = mix(flatH.w, clamp(wallH.add(strata.mul(0.12)), 0, 1), steep);
      const h = vec4(flatH.x, flatH.y, flatH.z, rockH);
      const tone = mix(fine.tone, coarse.tone, share);

      const moist = ground.x;
      const cover = ground.y;
      const ridge = ground.z;
      const macro = ground.w;

      // Base weights from the land.
      const rockW = smoothstep(0.1, 0.26, slope.add(smoothstep(0.62, 0.95, ridge).mul(0.1)));
      const open = float(1).sub(rockW);
      const scree = smoothstep(0.05, 0.13, slope).mul(open).mul(0.9);
      // Ragged edges: noise at a few meters and below breaks the ground map's smooth contours.
      const ragged = vnoise(xz.div(2.3))
        .sub(0.5)
        .mul(0.55)
        .add(
          vnoise(xz.div(0.8).add(vec2(17.3, 5.1)))
            .sub(0.5)
            .mul(0.3),
        );
      const dryPatch = float(1)
        .sub(cover)
        .mul(smoothstep(0.5, 0.78, macro))
        .mul(0.7);
      const gravelW = max(scree, dryPatch.mul(open));
      const shore = smoothstep(0.82, 0.97, moist);
      const turfW = clamp(cover.add(ragged), 0, 1)
        .mul(open)
        .mul(float(1).sub(shore.mul(0.85)));
      const dirtW = float(0.32);
      // Height blend: the layer whose relief stands highest wins, the others show within BLEND_DEPTH.
      const score = vec4(turfW, dirtW, gravelW, rockW.mul(1.4)).add(h.mul(0.55));
      const top = max(max(score.x, score.y), max(score.z, score.w));
      const raw = max(score.sub(top.sub(BLEND_DEPTH)), vec4(0));
      const weights = raw.div(max(dot(raw, vec4(1)), 1e-4));

      const P = GROUND_PALETTE;
      const turfTop = mix(
        v3(P.turfGreen),
        v3(P.turfStraw),
        clamp(tone.x.add(float(0.45).sub(moist.mul(0.7))), 0, 1),
      );
      const turf = mix(v3(P.turfRoot), turfTop, h.x);
      const dirt = mix(v3(P.dirtDark), v3(P.dirtLight), h.y.mul(0.65).add(tone.y.mul(0.35)));
      const gravel = mix(v3(P.gravelDark), v3(P.gravelLight), h.z).mul(
        mix(vec3(0.82, 0.86, 0.92), vec3(1.15, 1.08, 0.98), tone.z),
      );
      const rock = mix(mix(v3(P.rockDark), v3(P.rockLight), h.w), v3(P.lichen), tone.w.mul(0.55));
      const color = turf
        .mul(weights.x)
        .add(dirt.mul(weights.y))
        .add(gravel.mul(weights.z))
        .add(rock.mul(weights.w));

      // Cavities, wet ground, macro variation.
      const height01 = dot(weights, h);
      const cavity = mix(float(0.7), float(1.08), height01);
      const wet = smoothstep(0.4, 0.95, moist);
      const wetTone = mix(vec3(1, 1, 1), vec3(0.52, 0.56, 0.6), wet);
      const macroTone = mix(vec3(0.94, 0.99, 1.05), vec3(1.07, 1.0, 0.88), macro);
      const macroLight = float(1).add(macro.sub(0.5).mul(0.3));
      const albedo = color.mul(cavity).mul(wetTone).mul(macroTone).mul(macroLight);

      // Relief bump: surface gradient of the blended height (Mikkelsen), as a light delta.
      const heightM = dot(weights, h.mul(vec4(...RELIEF_M)));
      const dHx = dFdx(heightM);
      const dHy = dFdy(heightM);
      const r1 = cross(dpy, N);
      const r2 = cross(N, dpx);
      const det = dot(dpx, r1);
      const grad = r1.mul(dHx).add(r2.mul(dHy)).mul(sign(det));
      // The small N term keeps a vanishing footprint (det and grad both near zero) from normalising a zero vector.
      const bumped = normalize(N.mul(abs(det).add(1e-7)).sub(grad));
      const fade = float(1).sub(smoothstep(BUMP_FADE[0], BUMP_FADE[1], dist));
      const lightDelta = dot(bumped.sub(N), light).mul(BUMP_GAIN).mul(fade);
      return { albedo, lightDelta };
    },
  };
}
