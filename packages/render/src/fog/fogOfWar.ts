// Fog of war in every material, in the scene's fog node (lighting/atmosphere.ts): no extra draw call, no extra pass.
//
// scene.fogNode runs at the end of each node material's output, in world space, so one texture sample at the fragment's
// world xz (the field of fogField.ts, one texel per vision cell, bilinearly filtered) darkens terrain, water, skirt,
// props, buildings, units and decals alike, and the shared look and grade stay what they were: this only works on the
// finished color.
//   seen now        the color as it is
//   explored        desaturated, cooler and dimmer
//   unexplored      near-black with a soft grain and a trace of the relief (so cliffs and the map edge still read)
// The atmosphere's haze is mixed in afterwards, mostly kept out of the unexplored so that stays dark.
// Materials of map knowledge (claim points, scrap heaps, decals: the sim always sends them) take the explored look
// where the map is unexplored (markMapKnowledge).
//
// fogLook() is the CPU form of the same look, for tests.
import {
  DataTexture,
  LinearFilter,
  RGBAFormat,
  UnsignedByteType,
  ClampToEdgeWrapping,
  Vector2,
  type Material,
  type Node,
  type Texture,
} from 'three/webgpu';
import {
  dot,
  Fn,
  float,
  max,
  mix,
  output,
  positionWorld,
  smoothstep,
  texture,
  uniform,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import { UNITS_PER_METER, type FogMask } from '@crawlout/protocol';
import { LUMA_WEIGHTS } from '../look/surfaces.js';
import { FogField } from './fogField.js';

export const FOG_LOOK = {
  /** 1 would be grey: how much of the color an explored but unseen place loses. */
  exploredDesaturation: 0.72,
  exploredBrightness: 0.5,
  /** Slight cold tint of the remembered ground. */
  exploredTint: [0.92, 0.97, 1.06] as const,
  /** The unexplored: base color (linear), grain multiplier range, and the share of the lit luminance that shows through. */
  unexploredColor: [0.006, 0.007, 0.011] as const,
  unexploredGrain: [0.45, 1.7] as const,
  unexploredRelief: 0.04,
  /** Share of the atmosphere haze that stays over the unexplored. */
  unexploredHaze: 0.12,
} as const;

type Rgb = readonly [number, number, number];

/**
 * CPU form of the look: the output color `rgb` of a fragment where the field says `visible` and `explored` (0..1) with
 * grain `grain` (0..1); `known` for a map-knowledge material. Returns the color before the haze.
 */
export function fogLook(
  rgb: Rgb,
  visible: number,
  explored: number,
  grain: number,
  known = false,
): [number, number, number] {
  const luma = LUMA_WEIGHTS[0] * rgb[0] + LUMA_WEIGHTS[1] * rgb[1] + LUMA_WEIGHTS[2] * rgb[2];
  const L = FOG_LOOK;
  const e = known ? 1 : Math.max(explored, visible);
  const g = L.unexploredGrain[0] + (L.unexploredGrain[1] - L.unexploredGrain[0]) * grain;
  return [0, 1, 2].map((c) => {
    const exploredColor =
      (rgb[c]! + (luma - rgb[c]!) * L.exploredDesaturation) *
      L.exploredTint[c]! *
      L.exploredBrightness;
    const seen = exploredColor + (rgb[c]! - exploredColor) * visible;
    const dark = L.unexploredColor[c]! * g + luma * L.unexploredRelief;
    return dark + (seen - dark) * e;
  }) as [number, number, number];
}

const MAP_KNOWLEDGE = 'fogMapKnowledge';

/**
 * A material that keeps the explored look where the map is unexplored (claim points, scrap heaps, decal rings): the sim
 * always tells the player where they are. Call before the material is first rendered.
 */
export function markMapKnowledge<T extends Material>(material: T): T {
  material.userData[MAP_KNOWLEDGE] = true;
  // The shader differs from an unmarked material with the same graph, so it must not share its program.
  const base = material.customProgramCacheKey.bind(material);
  material.customProgramCacheKey = () => `${base()}|${MAP_KNOWLEDGE}`;
  return material;
}

export interface FogOfWar {
  /** The scene's fog node: the fog of war, then the haze of `hazeColor` by `hazeFactor`. */
  fogNode(hazeColor: Node<'vec3'>, hazeFactor: Node<'float'>): Node;
  /** A fog mask from the sim (protocol FogMask); null switches the fog of war off (everything seen). */
  setMask(mask: FogMask | null): void;
  /** Per frame: fades the field towards the latest mask and uploads it when it changed. */
  update(dtSeconds: number): void;
  /** Whether a mask is applied. */
  readonly active: boolean;
  dispose(): void;
}

export function createFogOfWar(): FogOfWar {
  const field = new FogField();
  const placeholder = new DataTexture(new Uint8Array([0, 0, 128, 255]), 1, 1, RGBAFormat);
  // The sampler is made from the first texture bound: the placeholder must filter and clamp like the real field.
  placeholder.minFilter = placeholder.magFilter = LinearFilter;
  placeholder.wrapS = placeholder.wrapT = ClampToEdgeWrapping;
  placeholder.needsUpdate = true;
  const enabled = uniform(0);
  const invExtent = uniform(new Vector2(1, 1));
  const uv = vec2(positionWorld.x, positionWorld.z).mul(invExtent);
  const sampled = texture(placeholder, uv);
  let fieldTexture: Texture | null = null;
  let generation = 0;

  const fogNode = (hazeColor: Node<'vec3'>, hazeFactor: Node<'float'>): Node =>
    Fn((builder: { material?: Material }) => {
      const known = builder.material?.userData[MAP_KNOWLEDGE] === true;
      const L = FOG_LOOK;
      const rgb = output.rgb;
      const luma = dot(rgb, vec3(...LUMA_WEIGHTS));
      // smoothstep rounds the bilinear ramp: no staircase along a diagonal edge
      const visible = mix(float(1), smoothstep(0, 1, sampled.r), enabled);
      const explored = known
        ? float(1)
        : max(mix(float(1), smoothstep(0, 1, sampled.g), enabled), visible);
      const exploredColor = mix(rgb, vec3(luma, luma, luma), L.exploredDesaturation)
        .mul(vec3(...L.exploredTint))
        .mul(L.exploredBrightness);
      const seen = mix(exploredColor, rgb, visible);
      const grain = mix(float(L.unexploredGrain[0]), float(L.unexploredGrain[1]), sampled.b);
      const dark = vec3(...L.unexploredColor)
        .mul(grain)
        .add(luma.mul(L.unexploredRelief));
      const shaded = mix(dark, seen, explored);
      const haze = hazeFactor.mul(mix(float(L.unexploredHaze), float(1), explored));
      return vec4(mix(shaded, hazeColor, haze), output.a);
    })();

  return {
    fogNode,
    setMask(mask) {
      if (!mask) {
        enabled.value = 0;
        return;
      }
      field.setMask(mask);
      if (field.generation !== generation) {
        generation = field.generation;
        fieldTexture?.dispose();
        const t = new DataTexture(
          field.data,
          field.width,
          field.height,
          RGBAFormat,
          UnsignedByteType,
        );
        t.minFilter = t.magFilter = LinearFilter;
        t.wrapS = t.wrapT = ClampToEdgeWrapping;
        t.generateMipmaps = false;
        t.needsUpdate = true;
        fieldTexture = t;
        sampled.value = t;
        const cellM = field.cellUnits / UNITS_PER_METER;
        invExtent.value.set(1 / (field.width * cellM), 1 / (field.height * cellM));
      }
      enabled.value = 1;
    },
    update(dt) {
      if (enabled.value === 0) return;
      if (field.step(dt) && fieldTexture) fieldTexture.needsUpdate = true;
    },
    get active() {
      return enabled.value !== 0;
    },
    dispose() {
      fieldTexture?.dispose();
      placeholder.dispose();
    },
  };
}
