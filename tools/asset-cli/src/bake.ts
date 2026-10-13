// SPRINT 2: animaties bakken naar bone-matrix textures (formaat af te stemmen met render-pipeline).
// Sprint 1 laat alleen deze interface achter; de buis roept hem niet aan.
import type { BakedAnimation } from './manifest.js';

export interface BakeInput {
  assetId: string;
  /** Pad naar de LOD0-GLB waaruit gebakken wordt. */
  glbPath: string;
  fps: number;
}

export interface BakeResult {
  baked: BakedAnimation;
  /** Bestanden (pad relatief aan assets/dist) die de bakker heeft geschreven. */
  files: string[];
}

export function bakeAnimations(input: BakeInput): Promise<BakeResult> {
  return Promise.reject(new Error(`bakeAnimations(${input.assetId}) is nog niet gebouwd (sprint 2).`));
}
