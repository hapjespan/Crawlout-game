// Split from surfaceTex.ts to stay under the 5,000-token file limit; surfaceTex.ts re-exports the public surface.
// Holds: the per-kind surface recipe, the sampler and the three generated maps.
//
// What the three maps carry, and why in this order of importance:
//   normal  relief: panel grooves and rivets on painted steel, pitting on rust, plank seams and grain on wood, the
//           weave of canvas, the aggregate of concrete, shingle rows on a roof. This is the map that stops a box
//           reading as a box; the toon ramp already owns the light, so it is the only thing that can add form.
//   mr      G = roughness, B = metalness, both varying over the surface: paint chipped through to bare steel is
//           rougher *and* conductive, rust is rough and barely conductive, canvas is matte everywhere. Under the
//           stylized specular of look/pbrDetail.ts this is what separates metal from cloth at a glance.
//   base    a greyscale weathering multiplier (the colour itself stays in the glTF baseColorFactor, which comes from
//           the faction palettes in the configs), with rust bleeding into the chipped areas of steel. Deliberately
//           low-contrast: the palettes are the colour identity and render refits the luminance per surface kind.
import {
  clamp01,
  encodePng,
  fbm,
  gridDist,
  mix,
  smoothstep,
  streak,
  valueNoise,
  type SurfaceKind,
} from './surfaceTex.part1.js';

/** One texel of a surface: relief height (0..1), weathering multiplier, roughness, metalness and a rust mix. */
interface Texel {
  height: number;
  shade: number;
  rough: number;
  metal: number;
  /** How much of the rust colour bleeds into the albedo here (0..1). */
  rust: number;
}

/** Rust colour the albedo bleeds towards (sRGB 0..1), the WASTELAND.rust of the render palette. */
const RUST_RGB = [0x70 / 255, 0x4a / 255, 0x34 / 255] as const;

/**
 * How hard the height field bends the normal, per kind: a canvas weave is not a concrete slab. Tuned against the
 * 256 px tile of SURFACE_TILE_SIZE, so a feature has to be a few centimetres wide before it reaches the normal at
 * all; everything here is sized in metres over MPT below rather than in texels.
 */
const RELIEF: Readonly<Record<SurfaceKind, number>> = {
  wood: 3,
  paintedMetal: 4,
  rustMetal: 4,
  cloth: 2,
  leather: 2.4,
  skin: 1,
  rock: 5,
  foliage: 2.4,
  concrete: 3.4,
  roofing: 3.6,
  lens: 0,
};

/** Lattice cells across the tile; with UV_METERS_PER_TILE = 2 m one cell is 25 cm. */
const PERIOD = 8;

/** Metres per tile (uvmap.ts UV_METERS_PER_TILE), so a feature width below can be written in metres. */
const MPT = 2;

/** A feature `metres` wide, as a fraction of the tile. */
const m = (metres: number): number => metres / MPT;

function sample(kind: SurfaceKind, u: number, v: number): Texel {
  const n = (sx: number, sy: number, octaves: number, seed: number): number =>
    fbm(u * PERIOD * sx, v * PERIOD * sy, PERIOD, octaves, seed);
  switch (kind) {
    case 'wood': {
      // Planks 50 cm wide with a 1.5 cm gap between them, grain stretched along the plank, a knot here and there.
      const seam = 1 - smoothstep(m(0.008), m(0.025), gridDist(u, 4));
      const plank = Math.floor(u * 4);
      const grain = streak(u * PERIOD * 3, v * PERIOD * 3, PERIOD, 10, 11 + plank * 131);
      const knot = smoothstep(0.78, 0.95, n(1.5, 1.5, 3, 23));
      return {
        height: clamp01(0.5 + (grain - 0.5) * 0.5 - seam * 0.8 - knot * 0.25),
        shade: clamp01(0.6 + grain * 0.4 - seam * 0.45 - knot * 0.2),
        rough: 0.78 + grain * 0.14,
        metal: 0,
        rust: 0,
      };
    }
    case 'paintedMetal': {
      // Panels of 1 m with a 4 cm groove between them, 6 cm rivets every 33 cm along the groove, paint chipped
      // through to bare steel in patches, and a shallow dent field so a flat panel is never dead.
      const groove = 1 - smoothstep(m(0.015), m(0.045), Math.min(gridDist(u, 2), gridDist(v, 2)));
      const rivet =
        1 -
        smoothstep(
          m(0.025),
          m(0.055),
          Math.min(
            Math.hypot(gridDist(u, 6), gridDist(v, 2)),
            Math.hypot(gridDist(u, 2), gridDist(v, 6)),
          ),
        );
      // The chip threshold is deliberately high: at 0.5 the bare-steel patches covered half the panel and a hull
      // read as camouflage instead of as worn paint. This leaves roughly a fifth of it worn through.
      const chip = smoothstep(0.62, 0.78, n(3, 3, 4, 37));
      const dent = n(1, 1, 3, 71);
      const dirt = n(1, 1, 3, 59);
      return {
        height: clamp01(0.5 - groove * 0.45 + rivet * 0.5 + (dent - 0.5) * 0.2 - chip * 0.1),
        shade: clamp01(0.88 - chip * 0.2 - groove * 0.3 - (1 - dirt) * 0.16),
        rough: clamp01(0.42 + chip * 0.4 + (1 - dirt) * 0.1),
        metal: clamp01(0.2 + chip * 0.6),
        rust: chip * 0.8,
      };
    }
    case 'rustMetal': {
      // Flaked scale: broad blisters with deep pits where the scale has come off.
      const pit = n(4, 4, 4, 97);
      const blotch = n(1.5, 1.5, 3, 101);
      const flake = smoothstep(0.55, 0.8, n(2.5, 2.5, 3, 103));
      return {
        height: clamp01(0.5 + (pit - 0.5) * 0.8 - flake * 0.45),
        shade: clamp01(0.55 + blotch * 0.45 - flake * 0.14),
        rough: clamp01(0.74 + pit * 0.22),
        metal: clamp01(0.04 + (1 - blotch) * 0.22),
        rust: 0.55 + blotch * 0.3,
      };
    }
    case 'cloth': {
      // A coarse canvas weave (threads of about 1 cm) plus the slack folds of a tarp; matte, never a conductor.
      const weave = (Math.sin(u * Math.PI * 2 * 24) + Math.sin(v * Math.PI * 2 * 24)) * 0.25 + 0.5;
      const fold = n(1, 1, 3, 149);
      const dirt = n(4, 4, 2, 151);
      return {
        height: clamp01(0.5 + (weave - 0.5) * 0.5 + (fold - 0.5) * 0.6),
        shade: clamp01(0.68 + fold * 0.3 + (weave - 0.5) * 0.12 - (1 - dirt) * 0.1),
        rough: clamp01(0.92 + fold * 0.06),
        metal: 0,
        rust: 0,
      };
    }
    case 'leather': {
      // Pebble grain with deeper creases; this is also what render's ladder gives rubber, tracks and tyres.
      const cell = n(6, 6, 2, 181);
      const ridge = Math.abs(n(2.5, 2.5, 3, 191) * 2 - 1);
      const crease = smoothstep(0.62, 1, ridge);
      return {
        height: clamp01(0.5 + (cell - 0.5) * 0.6 - crease * 0.45),
        shade: clamp01(0.68 + cell * 0.32 - crease * 0.18),
        rough: clamp01(0.6 + cell * 0.2),
        metal: 0,
        rust: 0,
      };
    }
    case 'skin': {
      const pore = n(12, 12, 2, 211);
      return {
        height: clamp01(0.5 + (pore - 0.5) * 0.2),
        shade: clamp01(0.9 + pore * 0.1),
        rough: clamp01(0.48 + pore * 0.14),
        metal: 0,
        rust: 0,
      };
    }
    case 'rock': {
      const lump = n(2, 2, 5, 233);
      const crack = 1 - smoothstep(0, 0.12, Math.abs(n(1, 1, 3, 239) * 2 - 1));
      return {
        height: clamp01(0.5 + (lump - 0.5) * 1 - crack * 0.4),
        shade: clamp01(0.66 + lump * 0.34 - crack * 0.2),
        rough: clamp01(0.86 + (1 - lump) * 0.1),
        metal: 0,
        rust: 0,
      };
    }
    case 'foliage': {
      const leaf = n(5, 5, 3, 257);
      return {
        height: clamp01(0.5 + (leaf - 0.5) * 0.6),
        shade: clamp01(0.66 + leaf * 0.34),
        rough: clamp01(0.7 + leaf * 0.14),
        metal: 0,
        rust: 0,
      };
    }
    case 'concrete': {
      // Form-board seams every metre with the board joint sunk 3 cm, aggregate speckle, spalled patches.
      const seam = 1 - smoothstep(m(0.01), m(0.035), gridDist(v, 2));
      const agg = valueNoise(u * PERIOD * 8, v * PERIOD * 8, PERIOD * 8, 263);
      const grain = n(2.5, 2.5, 3, 269);
      const spall = smoothstep(0.66, 0.8, n(2, 2, 3, 271));
      return {
        height: clamp01(0.5 + (agg - 0.5) * 0.4 - seam * 0.5 - spall * 0.45),
        shade: clamp01(0.74 + grain * 0.26 - seam * 0.2 - spall * 0.16),
        rough: clamp01(0.86 + agg * 0.1),
        metal: 0,
        rust: 0.05,
      };
    }
    case 'roofing': {
      // Shingle rows of 33 cm, every other row offset by half a tab; the lower lip of a row catches the light.
      const row = Math.floor(v * 6);
      const lip = smoothstep(0, 0.2, v * 6 - row);
      const tab = 1 - smoothstep(m(0.008), m(0.03), gridDist(u + (row % 2) * 0.125, 4));
      const granule = valueNoise(u * PERIOD * 12, v * PERIOD * 12, PERIOD * 12, 281);
      return {
        height: clamp01(0.5 + (granule - 0.5) * 0.25 + (1 - lip) * 0.45 - tab * 0.4),
        shade: clamp01(0.66 + granule * 0.26 - (1 - lip) * 0.2 - tab * 0.1),
        rough: clamp01(0.88 + granule * 0.08),
        metal: 0,
        rust: 0,
      };
    }
    case 'lens':
      return { height: 0.5, shade: 1, rough: 0.35, metal: 0, rust: 0 };
  }
}

/** sRGB encode of a linear 0..1 value, to a byte. */
function toSrgbByte(linear: number): number {
  const v = clamp01(linear);
  const s = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(s * 255)));
}

const byte = (v: number): number => Math.max(0, Math.min(255, Math.round(clamp01(v) * 255)));

/** The three generated maps of one surface kind, as PNG bytes; all the same size, all tiling. */
export interface SurfaceMaps {
  /** Greyscale weathering multiplier on the base colour (sRGB), with rust bleed. */
  base: Uint8Array;
  /** Tangent-space normal map (linear, glTF +Y up). */
  normal: Uint8Array;
  /** glTF metallicRoughness: G = roughness, B = metalness. */
  mr: Uint8Array;
  size: number;
}

const CACHE = new Map<string, SurfaceMaps>();

/** The maps of a surface kind at `size` x `size`, generated once and reused (identical bytes, so dedup merges them). */
export function surfaceMaps(kind: SurfaceKind, size: number): SurfaceMaps {
  const key = `${kind}@${size}`;
  const hit = CACHE.get(key);
  if (hit) return hit;
  const count = size * size;
  const height = new Float32Array(count);
  const base = new Uint8Array(count * 3);
  const mr = new Uint8Array(count * 3);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const t = sample(kind, (x + 0.5) / size, (y + 0.5) / size);
      height[i] = t.height;
      const shade = t.shade;
      base[i * 3] = toSrgbByte(mix(shade, shade * RUST_RGB[0] * 1.8, t.rust));
      base[i * 3 + 1] = toSrgbByte(mix(shade, shade * RUST_RGB[1] * 1.8, t.rust));
      base[i * 3 + 2] = toSrgbByte(mix(shade, shade * RUST_RGB[2] * 1.8, t.rust));
      // R is unused by glTF for this map; filling it with the roughness instead of 255 keeps the texel near grey,
      // which costs a JPEG a fraction of what a saturated one does. The LOD step writes JPEG.
      mr[i * 3] = byte(t.rough);
      mr[i * 3 + 1] = byte(t.rough);
      mr[i * 3 + 2] = byte(t.metal);
    }
  const strength = RELIEF[kind];
  const normal = new Uint8Array(count * 3);
  const at = (x: number, y: number): number =>
    height[((y + size) % size) * size + ((x + size) % size)]!;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const len = Math.hypot(-dx, -dy, 1);
      normal[i * 3] = byte((-dx / len) * 0.5 + 0.5);
      normal[i * 3 + 1] = byte((-dy / len) * 0.5 + 0.5);
      normal[i * 3 + 2] = byte((1 / len) * 0.5 + 0.5);
    }
  const maps: SurfaceMaps = {
    base: encodePng(size, size, base),
    normal: encodePng(size, size, normal),
    mr: encodePng(size, size, mr),
    size,
  };
  CACHE.set(key, maps);
  return maps;
}
