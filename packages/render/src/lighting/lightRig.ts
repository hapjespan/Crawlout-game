// The light rig shared by every material (lighting guide): one key sun that casts the shadows, a hemispheric
// sky/ground fill folded into the toon ramp's dark band, one tone mapping pass, and a sky and fog of the same horizon
// colour. A warm, dusty wasteland afternoon: the sun about 40 degrees up, so a 1.8 m settler throws a ~2 m shadow
// that reads as a shape from the RTS camera without the stretched look of a sunset.
// Pure numbers and CPU helpers only (no TSL), so tests and the TSL side (unitMaterial.ts toonLight,
// lighting/atmosphere.ts) read the same constants.
import { ACESFilmicToneMapping, type ToneMapping, Vector3 } from 'three/webgpu';

/** Degrees above the horizon and compass heading (from +X towards +Z) of the sun. */
export const SUN_ELEVATION_DEG = 40;
/** The former light came from (-0.45, *, 0.35): the same heading, so the art keeps its lit side. */
export const SUN_AZIMUTH_DEG = (Math.atan2(0.35, -0.45) * 180) / Math.PI;

/** Unit vector towards the sun for an elevation and heading in degrees. */
export function sunDirection(
  elevationDeg: number,
  azimuthDeg: number,
  out = new Vector3(),
): Vector3 {
  const el = (elevationDeg * Math.PI) / 180;
  const az = (azimuthDeg * Math.PI) / 180;
  return out.set(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az));
}

/** Direction towards the sun, world space (shared by every toon material and the shadow camera). */
export const SUN_DIR = sunDirection(SUN_ELEVATION_DEG, SUN_AZIMUTH_DEG);

/**
 * Linear rgb multipliers of the toon ramp's two parts (unitMaterial.ts toonLight): the direct sun on top of the dark
 * band is warm, the dark band itself (what a shadowed surface keeps) is the hemisphere fill, a little cool from the
 * sky on surfaces that face up and a warm bounce from the ground on those that face down. Both average about 1, so
 * the albedo tuning of the assets stays where it was; the tint is what makes a shadow read as shadow, not as dirt.
 */
export const SUN_COLOR = [1.14, 1.0, 0.82] as const;
export const HEMI_SKY = [0.9, 0.98, 1.12] as const;
export const HEMI_GROUND = [1.06, 0.96, 0.84] as const;

/**
 * Sky gradient (linear rgb): the haze at the horizon, which is also the fog colour, and a pale dusty blue overhead.
 * Below the horizon the sky stays the fog colour, so whatever lies beyond the skirt dissolves into the same haze.
 */
export const SKY_HORIZON = [0.34, 0.29, 0.225] as const;
export const SKY_ZENITH = [0.2, 0.27, 0.36] as const;
export const FOG_COLOR = SKY_HORIZON;

/**
 * Tone mapping, applied once in the output pass for every material, background and fog alike. ACES gives the toon
 * bands a little more contrast (the shadows read) and rolls the hot spots off; the exposure keeps a lit ground at the
 * brightness the albedos were tuned for without it.
 */
export const TONE_MAPPING: ToneMapping = ACESFilmicToneMapping;
export const TONE_EXPOSURE = 0.92;

/**
 * Distance fog for the RTS camera. The camera distance changes tenfold between zooms, so the fog scales with it: it
 * starts at `start` times the distance to the target and reaches 63 % one `range` (times the distance) beyond that.
 * Close in the far edge of the view gets a touch of haze; zoomed out the far side of a large map softens.
 */
export const FOG = { start: 1.15, range: 2.4, max: 0.85 } as const;

/**
 * The map edge: the terrain and the skirt beyond it fade into the fog colour from `start` meters inside the bounds
 * to full fog `end` meters outside, whatever the zoom. The skirt continues the ground (terrain/terrainSkirt.ts), so the
 * fade is long: there is no border, the land just thins into the haze.
 */
export const EDGE_FOG = { start: 0, end: 420 } as const;
