// Grass density mask: a small texture (one texel per GRASS_CELL_M of ground) built from the props of category grass
// and plant. The terrain material mixes the ground towards a soft green with it, so a meadow reads as one at RTS
// distance, where the 0.6 m grass patches themselves are subtle. It costs one texture sample per terrain pixel and
// no decals or instances; the patches keep their real scale.
import type { PropCategory } from '../props/propCategory.js';

/** Edge of one mask texel, meters. */
export const GRASS_CELL_M = 4;
/** What a prop adds to its cell, by category (grass patches carry the ground cover, plants count half). */
export const GRASS_WEIGHT: Readonly<Partial<Record<PropCategory, number>>> = {
  grass: 1,
  plant: 0.5,
};
/** Density = 1 - exp(-mean weight * GRASS_SATURATION) over the blurred neighbourhood: a lone patch stays faint, a meadow (a few per cell) saturates. */
export const GRASS_SATURATION = 1;

export interface GrassMaskProp {
  asset: string;
  /** World x and z in meters (RenderProp x and y). */
  x: number;
  y: number;
}

export interface GrassMask {
  /** Texels. */
  w: number;
  h: number;
  /** World rectangle the mask covers, meters. */
  minX: number;
  minZ: number;
  sizeX: number;
  sizeZ: number;
  /** One byte per texel (0 no grass, 255 full), row 0 at minZ. */
  data: Uint8Array;
}

/**
 * Density mask over `bounds` from the grass and plant props. Each prop is spread bilinearly over the four texels
 * around it (so a single patch does not jump from texel to texel), then the result is softened with a 3x3 blur.
 * Returns null when no prop contributes.
 */
export function buildGrassMask(
  props: readonly GrassMaskProp[],
  categoryOf: (asset: string) => PropCategory,
  bounds: { minX: number; minZ: number; maxX: number; maxZ: number },
  cell = GRASS_CELL_M,
): GrassMask | null {
  const sizeX = bounds.maxX - bounds.minX;
  const sizeZ = bounds.maxZ - bounds.minZ;
  if (!(sizeX > 0) || !(sizeZ > 0)) return null;
  const w = Math.max(2, Math.ceil(sizeX / cell));
  const h = Math.max(2, Math.ceil(sizeZ / cell));
  const weights = new Map<string, number>();
  const acc = new Float32Array(w * h);
  let any = false;
  for (const p of props) {
    let weight = weights.get(p.asset);
    if (weight === undefined) {
      weight = GRASS_WEIGHT[categoryOf(p.asset)] ?? 0;
      weights.set(p.asset, weight);
    }
    if (weight === 0) continue;
    // Texel centers sit at (i + 0.5) cells.
    const fx = ((p.x - bounds.minX) / sizeX) * w - 0.5;
    const fz = ((p.y - bounds.minZ) / sizeZ) * h - 0.5;
    const x0 = Math.floor(fx);
    const z0 = Math.floor(fz);
    const tx = fx - x0;
    const tz = fz - z0;
    for (let dz = 0; dz < 2; dz++)
      for (let dx = 0; dx < 2; dx++) {
        const x = Math.min(w - 1, Math.max(0, x0 + dx));
        const z = Math.min(h - 1, Math.max(0, z0 + dz));
        acc[z * w + x]! += weight * (dx ? tx : 1 - tx) * (dz ? tz : 1 - tz);
      }
    any = true;
  }
  if (!any) return null;
  const data = new Uint8Array(w * h);
  for (let z = 0; z < h; z++)
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let n = 0;
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const zz = z + dz;
          if (xx < 0 || zz < 0 || xx >= w || zz >= h) continue;
          sum += acc[zz * w + xx]!;
          n++;
        }
      data[z * w + x] = Math.round(255 * (1 - Math.exp((-sum / n) * GRASS_SATURATION)));
    }
  return { w, h, minX: bounds.minX, minZ: bounds.minZ, sizeX, sizeZ, data };
}
