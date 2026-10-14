// How big a decorative prop is drawn. Visual only: props are not in the sim. The kit art comes in at its own size
// (the Gobkit Nature Kit in meters has 8.5 m trees and 3.8 m grass), so render fits every prop to a believable
// height next to a 1.8 m character, then multiplies by the instance's scalePct from the map's props file.
//
// The fit is a target height per asset id, with a fallback per kind (read from the id); an asset with neither keeps
// its own size. Replacing an asset keeps the target, so a new tree mesh lands at the same height without code.

export type PropKind = 'tree' | 'rock' | 'bush' | 'grass' | 'reed' | 'other';

/** Target height in meters at scalePct 100, per asset id (manifest id, the source file name in lower case). */
export const PROP_TARGET_HEIGHT: Readonly<Record<string, number>> = {
  treehigh001: 6,
  treemed001: 4.6,
  treelow001: 3.6,
  bush001: 0.9,
  bush002: 1.05,
  rock001: 1.5,
  rock002: 1.25,
  rock003: 1.0,
  grass001: 0.45,
  reed001: 1.3,
};

/** Fallback target height per kind, for ids not in PROP_TARGET_HEIGHT. */
export const PROP_KIND_HEIGHT: Readonly<Record<PropKind, number | null>> = {
  tree: 5,
  rock: 1.3,
  bush: 1,
  grass: 0.45,
  reed: 1.3,
  other: null,
};

/** Kind of a prop from its asset id (tree, rock, bush, grass, reed), for the fit fallback and the placeholder shape. */
export function propKindOf(assetId: string): PropKind {
  const id = assetId.toLowerCase();
  if (/tree|pine|oak|birch|palm/.test(id)) return 'tree';
  if (/rock|stone|boulder|cliff/.test(id)) return 'rock';
  if (/bush|shrub|hedge/.test(id)) return 'bush';
  if (/reed|cattail/.test(id)) return 'reed';
  if (/grass|weed|tuft/.test(id)) return 'grass';
  return 'other';
}

/** Target height (m) of an asset: `overrides`, then PROP_TARGET_HEIGHT, then the kind; null keeps the asset's size. */
export function propTargetHeight(assetId: string, overrides?: Readonly<Record<string, number>>): number | null {
  const own = overrides?.[assetId] ?? PROP_TARGET_HEIGHT[assetId];
  if (own !== undefined) return own;
  return PROP_KIND_HEIGHT[propKindOf(assetId)];
}

/** Uniform scale that brings a mesh of `meshHeight` meters to its target height (1 without a target or height). */
export function propFitScale(assetId: string, meshHeight: number, overrides?: Readonly<Record<string, number>>): number {
  const target = propTargetHeight(assetId, overrides);
  if (target === null || !(meshHeight > 1e-4)) return 1;
  return target / meshHeight;
}
