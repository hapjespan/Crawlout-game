// Split from terrainMaterial.ts to stay under the 5,000-token file limit; terrainMaterial.ts re-exports the public surface.
// Holds: TerrainMaterialOptions, ROCK_LUMA, GROUND_LUMA, DUST, VERTEX_REF, VERTEX_WEIGHT, +45 more.
import {
  Vector3,
  Color,
  MeshBasicNodeMaterial,
  type Texture,
  DataTexture,
  RGBAFormat,
  SRGBColorSpace,
  LinearFilter,
} from 'three/webgpu';
import type { SunShadowTerm } from '../shadows/sunShadow.js';
import type { TerrainAlbedoLayout } from './albedoLayout.js';

export interface TerrainMaterialOptions {
  lightDir: Vector3;
  /** The sun's shadow (shadows/sunShadow.ts), received by the terrain. */
  shadow?: SunShadowTerm | null | undefined;
  /** Close-up detail layer (generated tiling texture, detailTexture.ts). Default true; false is the cheaper path. */
  detailLayer?: boolean;
}

/** Target brightness (linear luminance) of rock and ground before light; the tints only give the hue. */
export const ROCK_LUMA = 0.12;

export const GROUND_LUMA = 0.175;

/** Hue of dust on top of the (neutral) ground tint. */
export const DUST = [1.24, 1.0, 0.72] as const;

/** The greybox's sand color (packages/map TILE_RGB ground), in linear rgb: vertex colors count relative to it. */
export const VERTEX_REF = new Color().setRGB(150 / 255, 128 / 255, 94 / 255, 'srgb');

/** Share of the vertex colors in the ground. */
export const VERTEX_WEIGHT = 0.45;

/** Detail texture tile sizes, meters. */
export const ROCK_TILE = 13;

export const GROUND_TILE_FINE = 7.7;

export const LUMA = [0.2126, 0.7152, 0.0722] as const;

/** Mean brightness (linear luminance) the albedo is lifted to: the former ground level, a little lower for contrast. */
export const ALBEDO_TARGET_LUMA = 0.15;

/** Share of the albedo's brightness contrast that stays (the rest is pulled to ALBEDO_TARGET_LUMA). */
export const ALBEDO_CONTRAST = 0.8;

/** Share of the way to grey: the photo's moss and lichen stay, but quieter than in the source. */
export const ALBEDO_DESATURATE = 0.3;

/** Strength of the shared world grade on the terrain albedo (look/grade.ts), 0..1. */
export const TERRAIN_GRADE = 0.5;

/** Warm grade on the albedo (rgb), towards the wasteland palette of props and buildings. */
export const ALBEDO_WARMTH = [1.07, 1.0, 0.88] as const;

/** Share of the map's vertex colors (relative to the sand) on top of the albedo: ruins and marks still read. */
export const ALBEDO_VERTEX_WEIGHT = 0.2;

/** Strength of the triplanar variation on cliffs and of the fine grain near the camera. */
export const CLIFF_DETAIL = 0.75;

export const GRAIN = 0.3;

/** Multiplier on the ground color where the grass mask is full (greener, a little darker), and how far it goes there. */
export const GRASS_TINT = [0.78, 1.12, 0.66] as const;

export const GRASS_TINT_STRENGTH = 0.85;

/** Detail layer: tile edges of the generated texture (m) at its two scales, rotated against the map's axes. */
export const DETAIL_FINE_TILE = 3.4;

export const DETAIL_COARSE_TILE = 15;

/** Macro variation: the same tile stretched over tens of meters, two scales. */
export const DETAIL_MACRO_TILE_A = 151;

export const DETAIL_MACRO_TILE_B = 47;

/** Distances (m) over which the fine detail fades out (full below the first) and the coarse detail. */
export const DETAIL_FINE_FADE = [30, 100] as const;

export const DETAIL_COARSE_FADE = [70, 260] as const;

/** Grit brightness per unit of the texture's R deviation, on rock (steep) and on dust (flat). */
export const DETAIL_GRIT_ROCK = 1.2;

export const DETAIL_GRIT_DUST = 0.9;

/** Share of the texture's relief that bends the shading normal, on rock and on dust, and how strongly the bend lights. */
export const DETAIL_NORMAL_ROCK = 1.5;

export const DETAIL_NORMAL_DUST = 0.8;

export const DETAIL_LIGHT_GAIN = 0.4;

/** Macro: brightness spread, and how far the warm/cool hue shift goes. */
export const DETAIL_MACRO_BRIGHTNESS = 0.3;

export const DETAIL_MACRO_HUE = 0.55;

/** Colours the macro value mixes between (multipliers on the albedo): dry warm dust and cooler grey stone. */
export const DETAIL_WARM = [1.07, 1.0, 0.86] as const;

export const DETAIL_COOL = [0.93, 0.98, 1.05] as const;

/** Dust drifts into the flat: its multiplier on the albedo, and the share of flat ground it covers at most. */
export const DETAIL_DUST = [1.16, 1.09, 0.92] as const;

export const DETAIL_DUST_SHARE = 0.55;

/** Beyond the map edge (m outside): the warp of the albedo's sample position grows over WARP_RAMP to WARP_AMPLITUDE meters at wavelength WARP_WAVELENGTH. */
export const EDGE_WARP_RAMP = 70;

export const EDGE_WARP_AMPLITUDE = 54;

export const EDGE_WARP_WAVELENGTH = 300;

/** The photo's detail fades to a generic dust colour between these distances outside the map (m), by at most EDGE_DUST_SHARE. */
export const EDGE_DUST_FADE = [10, 170] as const;

export const EDGE_DUST_SHARE = 0.8;

/** Generic dust colour (linear rgb, before light) the far skirt tends to, and the macro brightness variation outside. */
export const EDGE_DUST_COLOR = [0.205, 0.172, 0.123] as const;

export const EDGE_MACRO_WAVELENGTH = 85;

export const EDGE_MACRO_BRIGHTNESS = 0.42;

/** Default tile size (m) before terrain.json says otherwise: Rock Terrain 4 at 1 m per cell. */
export const DEFAULT_ALBEDO_TILE = 128;

/** Defaults when terrain.json is not loaded: the tints of Rock Terrain 4. */
export const DEFAULT_ROCK_TINT = '#454340';

export const DEFAULT_GROUND_TINT = '#2b2b2b';

export function luma(c: Color): number {
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
  /** Grass density mask (grassMask.ts) that tints the ground green under grass; null for none. The caller keeps the texture. */
  setGrassMask(
    map: Texture | null,
    rect?: { minX: number; minZ: number; sizeX: number; sizeZ: number },
  ): void;
  /** Height range of the terrain, meters: drives the lowland-to-plateau variation. */
  setHeightRange(min: number, max: number): void;
  dispose(): void;
}

export function placeholderTexture(): DataTexture {
  const t = new DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1, RGBAFormat);
  t.colorSpace = SRGBColorSpace;
  // Filterable like the real albedo, so the shader keeps its sampler when the texture is swapped in.
  t.minFilter = t.magFilter = LinearFilter;
  t.needsUpdate = true;
  return t;
}
