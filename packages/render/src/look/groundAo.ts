// Ground contact occlusion: the one cue that says a figure stands on the terrain instead of hovering a hand's width
// above it. The ground blocks the lower half of the sky dome, so everything close to it loses most of its ambient
// light: boots go dark, calves half dark, knees are back to normal. Without it a unit keeps the same hemisphere fill
// from head to sole and reads as a cut-out pasted on the scene, however good its cast shadow is.
//
// It hits the ambient in full (the hemisphere fill, the sky fill, the sky reflection and the rim) and the direct sun
// at GROUND_AO.sunShare. The sun gets a share and not nothing, because on a lit unit the ambient is only two fifths
// of the light: occluding the ambient alone takes 17 % off a sunlit boot, which disappears under tone mapping. It
// does not get the full term either, since its real occluder is the shadow map (shadows/sunShadow.ts) and doubling
// that up turns a lit boot black.
//
// The curve is pow(h / height, falloff), not a smoothstep: a real contact darkens hardest in the first few
// centimeters and recovers quickly, where a smoothstep is flat at zero and spreads the dark band over the whole
// shin. Pure numbers and a TSL node, so tests and the shader read the same constants.
import { clamp, float, mix, pow } from 'three/tsl';
import type { Node } from 'three/webgpu';

export const GROUND_AO = {
  /** Share of the ambient a surface keeps where it touches the ground (0 would make a boot pure black). */
  floor: 0.15,
  /** Height (m) above the unit's own ground plane at which the ambient is back to full. */
  height: 0.5,
  /** Exponent of the recovery curve; below 1 the darkening is concentrated at the contact. */
  falloff: 0.5,
  /** How much of the occlusion the direct sun takes as well (0: ambient only, 1: the whole light). */
  sunShare: 0.5,
} as const;

/** CPU form (same constants): the ambient multiplier at `height` meters above the ground. */
export function groundOcclusionAt(height: number): number {
  const t = Math.min(1, Math.max(0, height / GROUND_AO.height));
  return GROUND_AO.floor + (1 - GROUND_AO.floor) * t ** GROUND_AO.falloff;
}

/**
 * Ambient multiplier for a fragment `height` meters above the ground the object stands on. For a skinned unit that
 * is the y of its skinned, bind-space position: the feet sit at 0 whatever the terrain does under them, so the
 * darkening follows the legs through the walk cycle without a single terrain lookup.
 */
export function groundOcclusion(height: Node<'float'>): Node<'float'> {
  const t = clamp(height.div(GROUND_AO.height), 0, 1);
  return float(GROUND_AO.floor).add(pow(t, GROUND_AO.falloff).mul(1 - GROUND_AO.floor));
}

/** CPU form of the share of the ground occlusion the direct sun takes. */
export function sunOcclusionAt(height: number): number {
  return 1 - (1 - groundOcclusionAt(height)) * GROUND_AO.sunShare;
}

/** The same occlusion weakened to GROUND_AO.sunShare, to multiply into the sun's shadow factor. */
export function sunGroundOcclusion(ao: Node<'float'>): Node<'float'> {
  return mix(float(1), ao, GROUND_AO.sunShare);
}
