// Surface kinds and their material recipe: one table for buildings, props and units, so a plank of the house, a
// scrap-metal part of the water tower and a unit's coat are all described in the same terms (albedo range, roughness,
// metalness, how fast they weather). The numbers follow the reflectance values of physicallybased.info for the real
// materials, then moved into the dusty wasteland palette (palette.ts WASTELAND): `tint` is the typical weathered
// color (sRGB), `albedo` the allowed range of linear luminance (a fresh white paint at 0.8 or coal at 0.02 does not
// occur in this world), `roughness` and `metalness` drive the toon specular in propMaterial.ts.
// Pure data and helpers; the shader side is surfaceShading.ts. The sim never sees any of it.
import type { PropCategory } from '../props/propCategory.js';

export const SURFACE_KINDS = [
  'wood',
  'paintedMetal',
  'rustMetal',
  'cloth',
  'leather',
  'skin',
  'rock',
  'foliage',
  'concrete',
  'roofing',
  'lens',
] as const;

export type SurfaceKind = (typeof SURFACE_KINDS)[number];

export interface SurfaceRecipe {
  /** Typical weathered color (sRGB hex). */
  tint: number;
  /** Allowed linear luminance of the albedo: [min, max]. */
  albedo: readonly [number, number];
  roughness: number;
  /** Specular tint and darkening of the diffuse: 0 dielectric, 1 bare metal. */
  metalness: number;
  /** How much grime (dirt at the foot, streaks, dust on top) the surface carries, 0..1. */
  grime: number;
  /** How much rust shows through (and how much a chipped coat reveals), 0..1. */
  rust: number;
  /** How far a flat (untextured) fragment moves from its authored color to `tint`, 0..1. Default FLAT_TINT_BLEND. */
  flatBlend?: number;
  /** How far a photographed fragment moves to the tint (luminance kept), 0..1. Default 0: the texture stays. */
  texturedBlend?: number;
}

/** How far a flat fragment moves to its kind's tint unless the recipe says otherwise. */
export const FLAT_TINT_BLEND = 0.55;

export const SURFACES: Readonly<Record<SurfaceKind, SurfaceRecipe>> = {
  // Weathered grey-brown timber (dry oak and pine, 0.15 to 0.25 reflectance).
  wood: {
    tint: 0x7a6c58,
    albedo: [0.06, 0.3],
    roughness: 0.82,
    metalness: 0,
    grime: 0.8,
    rust: 0.05,
  },
  // Faded paint over steel: dielectric coat, worn through in patches.
  paintedMetal: {
    tint: 0x6d7468,
    albedo: [0.06, 0.34],
    roughness: 0.55,
    metalness: 0.25,
    grime: 0.7,
    rust: 0.45,
  },
  // Oxidized iron (hematite and goethite, 0.07 to 0.12 reflectance).
  rustMetal: {
    tint: 0x704a36,
    albedo: [0.04, 0.18],
    roughness: 0.85,
    metalness: 0.1,
    grime: 0.6,
    rust: 1,
  },
  // Dusty canvas and cotton.
  cloth: {
    tint: 0x8a8068,
    albedo: [0.07, 0.4],
    roughness: 0.95,
    metalness: 0,
    grime: 0.9,
    rust: 0,
  },
  leather: {
    tint: 0x4a3626,
    albedo: [0.025, 0.12],
    roughness: 0.7,
    metalness: 0,
    grime: 0.6,
    rust: 0,
  },
  // Human skin, sun-browned (0.2 to 0.45 reflectance across the common tones).
  skin: {
    tint: 0xb98466,
    albedo: [0.16, 0.45],
    roughness: 0.55,
    metalness: 0,
    grime: 0.5,
    rust: 0,
  },
  // Dry granite and sandstone.
  rock: {
    tint: 0x7a736a,
    albedo: [0.08, 0.38],
    roughness: 0.9,
    metalness: 0,
    grime: 0.5,
    rust: 0,
    texturedBlend: 0.2,
  },
  // Dry leaves and grass (a leaf reflects 0.05 to 0.2 in the visible), olive rather than green.
  foliage: {
    tint: 0x5f6a3a,
    albedo: [0.04, 0.22],
    roughness: 0.75,
    metalness: 0,
    grime: 0.3,
    rust: 0,
    texturedBlend: 0.4,
  },
  // Weathered concrete (0.3 to 0.4 when new, darker with age).
  concrete: {
    tint: 0x8d887e,
    albedo: [0.14, 0.42],
    roughness: 0.9,
    metalness: 0,
    grime: 0.85,
    rust: 0.1,
  },
  // Old asphalt shingle and tar paper.
  roofing: {
    tint: 0x4d4540,
    albedo: [0.035, 0.16],
    roughness: 0.9,
    metalness: 0,
    grime: 0.8,
    rust: 0,
  },
  // Sensor lenses and gun barrels' glow: a plain bright color, glossy, never weathered.
  lens: {
    tint: 0x3a6670,
    albedo: [0.02, 0.7],
    roughness: 0.4,
    metalness: 0,
    grime: 0,
    rust: 0,
    flatBlend: 0,
  },
};

/** Index of a kind in SURFACE_KINDS (the value geometry and shader tables use). */
export function surfaceIndex(kind: SurfaceKind): number {
  return SURFACE_KINDS.indexOf(kind);
}

/** The kind at an index, wood for anything out of range (a flat vertex of an older geometry carries 0). */
export function surfaceOfIndex(index: number): SurfaceKind {
  return SURFACE_KINDS[Math.round(index)] ?? 'wood';
}

/**
 * Surface kind of a glTF material name. The asset-cli names materials after what they are (frame_wood, plank_grey,
 * wall_paint, roof, metal, team_trim, wall_proxy). Unknown names are wood, the most common building material.
 */
export function surfaceKindOfMaterial(name: string): SurfaceKind {
  const n = name.toLowerCase();
  if (/lens|visor|glass/.test(n)) return 'lens';
  if (/rust|corrod/.test(n)) return 'rustMetal';
  if (/rubber|track|tyre|tire|opening/.test(n)) return 'leather';
  if (/metal|steel|iron|pipe|tank|pole|mast|sheet|tin/.test(n)) return 'paintedMetal';
  if (/roof|shingle|tar/.test(n)) return 'roofing';
  if (/concrete|slab|cement|brick|stone/.test(n)) return 'concrete';
  if (/team_trim|trim/.test(n)) return 'paintedMetal'; // a building's painted band
  if (/team|cloth|fabric|canvas|flag|banner|tarp/.test(n)) return 'cloth';
  if (/leather/.test(n)) return 'leather';
  if (/skin|flesh/.test(n)) return 'skin';
  if (/rock|cliff/.test(n)) return 'rock';
  if (/leaf|grass|foliage|bush/.test(n)) return 'foliage';
  return 'wood';
}

const CATEGORY_KIND: Readonly<Record<PropCategory, SurfaceKind>> = {
  'tree-leafy': 'foliage',
  'tree-bare': 'wood',
  grass: 'foliage',
  plant: 'foliage',
  rock: 'rock',
  crate: 'wood',
  chest: 'wood',
  barrel: 'rustMetal',
  structure: 'wood',
  debris: 'wood',
};

/** Surface kind of a decorative prop from its category. */
export function surfaceKindOfCategory(category: PropCategory): SurfaceKind {
  return CATEGORY_KIND[category];
}

/** Luminance weights (linear Rec. 709). */
export const LUMA_WEIGHTS = [0.2126, 0.7152, 0.0722] as const;

export function lumaOf(r: number, g: number, b: number): number {
  return LUMA_WEIGHTS[0] * r + LUMA_WEIGHTS[1] * g + LUMA_WEIGHTS[2] * b;
}

/**
 * Soft limit of a luminance into the albedo range of a kind: inside the range it is unchanged, beyond an end it is
 * compressed towards it (a smooth knee over SOFT_KNEE of the range, no hard clip, so a texture keeps its structure).
 */
export const SOFT_KNEE = 0.25;

export function fitLuma(luma: number, kind: SurfaceKind): number {
  const [lo, hi] = SURFACES[kind].albedo;
  const knee = (hi - lo) * SOFT_KNEE;
  if (luma > hi - knee) {
    const over = luma - (hi - knee);
    return hi - knee + knee * (1 - Math.exp(-over / knee));
  }
  if (luma < lo + knee) {
    const under = lo + knee - luma;
    return lo + knee - knee * (1 - Math.exp(-under / knee));
  }
  return luma;
}

/** A color scaled so its luminance lands in the kind's range (hue and saturation stay). */
export function fitAlbedo(
  rgb: readonly [number, number, number],
  kind: SurfaceKind,
): [number, number, number] {
  const l = lumaOf(rgb[0], rgb[1], rgb[2]);
  if (l < 1e-5) return [rgb[0], rgb[1], rgb[2]];
  const k = fitLuma(l, kind) / l;
  return [rgb[0] * k, rgb[1] * k, rgb[2] * k];
}
