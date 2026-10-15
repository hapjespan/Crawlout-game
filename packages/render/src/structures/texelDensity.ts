// Texel density of the building textures. The house kit's materials were made at very different scales: the same
// plank texture shows 620 texels per meter on one building and 125 on another, the roof shingles 43, the wall paint 270,
// while a prop crate sits at 140 and the terrain at 5 (plus its detail layer). Next to each other the house reads
// sharper than everything around it, or its roof coarser. The building geometry therefore rescales a material's uv
// (they tile) so its density lands inside DENSITY_BAND; a material already inside it is left alone.
// Pure helpers; buildingGeometry.ts applies them.

/** Texels per meter the building textures are held to: [min, max]. */
export const DENSITY_BAND = [100, 180] as const;

/** Largest uv scale change either way (a degenerate uv layout must not blow the texture up). */
const MAX_RESCALE = 4;

/** Texels per meter of a texture `texels` wide, over a surface of `worldArea` m2 that covers `uvArea` of the tile. */
export function texelsPerMeter(worldArea: number, uvArea: number, texels: number): number {
  if (!(worldArea > 0) || !(uvArea > 0) || !(texels > 0)) return 0;
  return texels / Math.sqrt(worldArea / uvArea);
}

/** The factor to multiply the uv by so `density` lands inside `band` (1 inside it, or when the density is unknown). */
export function uvScaleForDensity(
  density: number,
  band: readonly [number, number] = DENSITY_BAND,
): number {
  if (!(density > 0)) return 1;
  const target = density < band[0] ? band[0] : density > band[1] ? band[1] : density;
  return Math.min(MAX_RESCALE, Math.max(1 / MAX_RESCALE, target / density));
}
