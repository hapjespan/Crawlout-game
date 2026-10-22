// The shared world grade: one saturation, warm tint and contrast applied to the albedo of every custom material
// (buildings, props, units, terrain), so a photographed plank, a procedural water tower and a unit's coat sit in the
// same dusty world. It works on the albedo, before the light: it has nothing to do with exposure or tone mapping
// (the renderer's lighting owns those) and survives any change to them.
//
// worldGrade() is the TSL form for any material (also from outside this package's materials: terrain, water, vfx),
// gradeRgb() the identical CPU form for tests and for baking a color. `strength` 0..1 scales the whole grade; the
// team color of a unit or a flag is graded at TEAM_GRADE only, so it stays the one saturated accent.
import { mix, vec3 } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { LUMA_WEIGHTS } from './surfaces.js';

export const GRADE = {
  /** 1 keeps the color's saturation, 0 is grey. Dusty, not grey: the team color and the rust still read. */
  saturation: 0.8,
  /** Rgb multiplier, luminance neutral (0.2126 * 1.05 + 0.7152 + 0.0722 * 0.9 = 1.0): warm, towards dust. */
  tint: [1.05, 1, 0.9] as const,
  /** Contrast around `pivot` (linear), above 1 pushes darks and lights apart. */
  contrast: 1.1,
  pivot: 0.16,
} as const;

/** Share of the grade on the team color (units' masked region, flags): it should stay readable. */
export const TEAM_GRADE = 0.35;

/** CPU form of worldGrade (same constants). */
export function gradeRgb(
  rgb: readonly [number, number, number],
  strength = 1,
): [number, number, number] {
  const l = LUMA_WEIGHTS[0] * rgb[0] + LUMA_WEIGHTS[1] * rgb[1] + LUMA_WEIGHTS[2] * rgb[2];
  const sat = 1 + (GRADE.saturation - 1) * strength;
  const contrast = 1 + (GRADE.contrast - 1) * strength;
  return [0, 1, 2].map((c) => {
    const saturated = l + (rgb[c]! - l) * sat;
    const tinted = saturated * (1 + (GRADE.tint[c]! - 1) * strength);
    return Math.max(0, GRADE.pivot + (tinted - GRADE.pivot) * contrast);
  }) as [number, number, number];
}

/** The world grade as a TSL node: `color` linear rgb, `strength` a number or a 0..1 node (default 1). */
export function worldGrade(
  color: Node<'vec3'>,
  strength: Node<'float'> | number = 1,
): Node<'vec3'> {
  const s = strength;
  const luma = color.dot(vec3(...LUMA_WEIGHTS));
  const sat = mix(1, GRADE.saturation, s);
  const contrast = mix(1, GRADE.contrast, s);
  const saturated = mix(vec3(luma, luma, luma), color, sat);
  const tinted = saturated.mul(mix(vec3(1, 1, 1), vec3(...GRADE.tint), s));
  return tinted.sub(GRADE.pivot).mul(contrast).add(GRADE.pivot).max(0);
}
