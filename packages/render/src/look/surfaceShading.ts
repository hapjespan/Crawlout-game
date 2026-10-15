// The shader side of the shared surface recipe (surfaces.ts): a table of the kinds as uniform arrays, the albedo range
// fit, procedural weathering and the toon specular. propMaterial.ts (buildings, props, scrap, flags) and
// unitMaterial.ts compose these, so a surface that is not photographed (the flat parts of a building, a placeholder
// prop, a mannequin's coat) gets the same grime, edge wear, rust and rain streaks as the photographed ones carry in
// their texture, and the textured ones get the same dirt at the foot and dust on top.
//
// Everything is a function of a position (world space for things that stand still, bind-pose space for units, so
// the pattern never swims), the normal and the height above the object's ground. No texture, no extra vertex attribute.
import { Vector4, type Node } from 'three/webgpu';
import {
  abs,
  dot,
  exp,
  float,
  int,
  max,
  min,
  mix,
  mx_noise_float,
  normalize,
  pow,
  smoothstep,
  uniformArray,
  vec3,
} from 'three/tsl';
import { linearOf, WASTELAND } from '../palette.js';
import { FLAT_TINT_BLEND, LUMA_WEIGHTS, SOFT_KNEE, SURFACE_KINDS, SURFACES } from './surfaces.js';

/** The recipe of one surface kind (or of a per-fragment index) as shader nodes. */
export interface SurfaceNodes {
  tint: Node<'vec3'>;
  albedoMin: Node<'float'>;
  albedoMax: Node<'float'>;
  roughness: Node<'float'>;
  metalness: Node<'float'>;
  grime: Node<'float'>;
  rust: Node<'float'>;
  flatBlend: Node<'float'>;
  texturedBlend: Node<'float'>;
}

/**
 * The kinds as three vec4 uniform arrays (a WebGPU fragment stage has at most 12 uniform buffers and every uniform
 * array is one); `at(index)` picks one by a constant or a per-fragment int.
 */
export function createSurfaceTable(): { at(index: Node<'int'> | number): SurfaceNodes } {
  const recipes = SURFACE_KINDS.map((k) => SURFACES[k]);
  // (tint rgb, flatBlend), (albedo min, albedo max, roughness, metalness), (grime, rust, texturedBlend, 0)
  const a = uniformArray<'vec4'>(
    recipes.map((r) => new Vector4(...linearOf(r.tint), r.flatBlend ?? FLAT_TINT_BLEND)),
    'vec4',
  );
  const b = uniformArray<'vec4'>(
    recipes.map((r) => new Vector4(r.albedo[0], r.albedo[1], r.roughness, r.metalness)),
    'vec4',
  );
  const c = uniformArray<'vec4'>(
    recipes.map((r) => new Vector4(r.grime, r.rust, r.texturedBlend ?? 0, 0)),
    'vec4',
  );
  return {
    at(index) {
      const i = typeof index === 'number' ? int(index) : index;
      const ea = a.element(i);
      const eb = b.element(i);
      const ec = c.element(i);
      return {
        tint: ea.xyz,
        albedoMin: eb.x,
        albedoMax: eb.y,
        roughness: eb.z,
        metalness: eb.w,
        grime: ec.x,
        rust: ec.y,
        texturedBlend: ec.z,
        flatBlend: ea.w,
      };
    },
  };
}

const LUMA = vec3(...LUMA_WEIGHTS);

/** Soft limit of the albedo's luminance into [min, max] (CPU form: surfaces.ts fitLuma); hue and saturation stay. */
export function fitAlbedoNode(
  color: Node<'vec3'>,
  lo: Node<'float'>,
  hi: Node<'float'>,
): Node<'vec3'> {
  const l = max(dot(color, LUMA), 1e-4);
  const knee = hi.sub(lo).mul(SOFT_KNEE);
  const over = max(l.sub(hi.sub(knee)), 0);
  const up = l.sub(over).add(knee.mul(float(1).sub(exp(over.negate().div(knee)))));
  const under = max(lo.add(knee).sub(up), 0);
  const fitted = up.add(under).sub(knee.mul(float(1).sub(exp(under.negate().div(knee)))));
  return color.mul(fitted.div(l));
}

const DIRT = vec3(...linearOf(WASTELAND.dirt));
const DUST = vec3(...linearOf(WASTELAND.dust));
const RUST = vec3(...linearOf(WASTELAND.rust));

/** Perlin noise stretched to about -1..1 (the raw MaterialX noise stays within +-0.5 in practice). */
const noise = (p: Node<'vec3'>): Node<'float'> => mx_noise_float(p).mul(1.9).clamp(-1, 1);

export interface WeatherInputs {
  /** Linear albedo, before the team color. */
  albedo: Node<'vec3'>;
  /** Noise space in meters: world position for statics, bind-pose position for units. */
  pos: Node<'vec3'>;
  /** World normal, unit length. */
  normal: Node<'vec3'>;
  /** Meters above the object's ground. */
  height: Node<'float'>;
  surface: SurfaceNodes;
  /** 0..1: 1 weathers a procedural surface in full, a photographed one gets less (it carries its own). */
  amount: Node<'float'>;
  /** Team mask 0..1: grime and rust spare the team's color. */
  team: Node<'float'>;
}

/**
 * Procedural weathering of an albedo: grain and blotches (value noise at 11 cm, 60 cm and 3.5 m), dirt at the foot
 * (0 to 1.6 m), dust on upward faces, rain streaks down vertical faces, rust patches (along the streaks and low down)
 * on the metals, and flaked-off paint that shows lighter bare material. Strengths come from the surface's grime and
 * rust values, so rock and foliage barely change and a rusty barrel changes a lot.
 */
export function weather(i: WeatherInputs): Node<'vec3'> {
  const { pos: p, normal: n, height: h, surface: s } = i;
  const spare = float(1).sub(i.team.mul(0.5));
  const k = i.amount.mul(spare);
  // Flaked paint and rust are the surface's own: a photograph already has them, so they fade out faster than the rest.
  const kk = k.mul(k);
  const n1 = noise(p.mul(1.6)); // blotches, ~60 cm
  const n2 = noise(p.mul(9).add(7.3)); // grain, ~11 cm
  const n3 = noise(p.mul(0.28).add(3.1)); // patches, ~3.5 m
  const side = float(1).sub(abs(n.y));
  // Rain streaks: noise stretched along y, its horizontal axis the diagonal so x- and z-facing walls both vary.
  const streak = noise(vec3(p.x.add(p.z).mul(4.5), p.y.mul(0.3), p.z.sub(p.x).mul(0.4)).add(5.9));

  // Tonal variation: the flat colors of a procedural part read as paint and timber, not as a swatch.
  const grain = float(1).add(k.mul(n2.mul(0.22).add(n1.mul(0.34)).add(n3.mul(0.28))));
  let col = i.albedo.mul(grain);

  // Flaked paint: bare, lighter material where the noise peaks (more near the ground).
  const foot = float(1).sub(smoothstep(0, 1.6, h.add(n1.mul(0.35))));
  const chip = smoothstep(0.62, 0.74, n2.mul(0.55).add(n1.mul(0.45)).add(foot.mul(0.15)));
  col = mix(col, col.mul(1.45).add(0.015), chip.mul(kk).mul(0.8));

  // Rain streaks darken vertical faces.
  const streaks = smoothstep(0.05, 0.7, streak).mul(side);
  col = col.mul(float(1).sub(streaks.mul(s.grime).mul(k).mul(0.6)));

  // Rust: along the streaks, low down, in patches; painted metal shows it through the coat only here and there.
  const rustField = n1
    .mul(0.4)
    .add(n2.mul(0.15))
    .add(streak.mul(0.35))
    .add(foot.mul(0.25))
    .add(n3.mul(0.2));
  const rustMask = smoothstep(0.12, 0.5, rustField).mul(s.rust).mul(kk);
  col = mix(col, RUST.mul(n2.mul(0.2).add(0.9)), rustMask);

  // Dirt at the foot and dust on upward faces.
  col = mix(col, DIRT, foot.mul(s.grime).mul(k).mul(0.7));
  const top = smoothstep(0.6, 0.95, n.y);
  col = mix(col, DUST, top.mul(s.grime).mul(k).mul(n3.mul(0.1).add(0.22)));
  return col;
}

/**
 * Toon specular from the recipe's roughness and metalness: a stepped blinn-phong highlight that is nothing on rough
 * wood, cloth and rock and a small bright patch on painted metal. A metal also loses part of its diffuse (see
 * metalDiffuse) and tints the highlight with its albedo. `lit` 1 where the surface sees the light, 0 in shadow.
 */
export function toonSpecular(
  N: Node<'vec3'>,
  V: Node<'vec3'>,
  L: Node<'vec3'>,
  surface: SurfaceNodes,
  albedo: Node<'vec3'>,
  lit: Node<'float'> | number = 1,
): Node<'vec3'> {
  const H = normalize(L.add(V));
  const smooth = float(1).sub(surface.roughness);
  const gloss = smooth.mul(smooth);
  const shininess = mix(float(8), float(220), gloss);
  const band = smoothstep(0.3, 0.55, pow(max(dot(N, H), 0), shininess));
  const strength = gloss.mul(0.55).add(surface.metalness.mul(0.3));
  const tint = mix(vec3(1, 1, 1), min(albedo.mul(2.5), 1), surface.metalness);
  return tint.mul(band.mul(strength).mul(lit));
}

/** A metal has little diffuse: it reflects instead (the rest of the world is not in a toon shader). */
export function metalDiffuse(albedo: Node<'vec3'>, surface: SurfaceNodes): Node<'vec3'> {
  return albedo.mul(float(1).sub(surface.metalness.mul(0.5)));
}
