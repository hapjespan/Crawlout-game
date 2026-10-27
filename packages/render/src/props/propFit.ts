// How big a decorative prop is drawn. Visual only: props are not in the sim.
//
// An asset from the manifest is drawn at its real size: the asset-cli scales every prop to a believable height next
// to a 1.8 m character (a 13 m oak, a 0.6 m grass patch, a 20 m cliff), so the fit is 1 and only the instance's
// scalePct from the map's props file changes it. Never shrink: a manifest prop is not fitted to a category height.
//
// The fit below is the fallback for an asset WITHOUT a manifest entry (a source GLB in its own units, or a
// placeholder): a target height per asset id, then per manifest category, then per kind (read from the id); an asset
// with none of them keeps its own size. A client can still force a height per id with `source.heights`.

import type { PropCategory } from './propCategory.js';

export type PropKind = 'tree' | 'rock' | 'bush' | 'grass' | 'reed' | 'other';

/**
 * Target height in meters at scalePct 100, per asset id (the source file name in lower case), for assets without a
 * manifest entry only: the old Gobkit art comes in at 8.5 m trees and 3.8 m grass in its own units.
 */
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

/**
 * Fallback target height per category (more precise than the kind), null: the asset keeps its own size. Only for
 * assets without a manifest entry; a manifest prop is drawn at its real size.
 */
export const PROP_CATEGORY_HEIGHT: Readonly<Record<PropCategory, number | null>> = {
  'tree-leafy': 5,
  'tree-bare': 5,
  grass: 0.45,
  plant: 0.7,
  rock: 1.3,
  crate: null,
  chest: null,
  barrel: null,
  structure: null,
  debris: null,
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

/**
 * Target height (m) of an asset without a manifest entry: `overrides`, then PROP_TARGET_HEIGHT, then the `category`
 * (when it has a height), then the kind read from the id; null keeps the asset's size.
 */
export function propTargetHeight(
  assetId: string,
  overrides?: Readonly<Record<string, number>>,
  category?: PropCategory | null,
): number | null {
  const own = overrides?.[assetId] ?? PROP_TARGET_HEIGHT[assetId];
  if (own !== undefined) return own;
  const byCategory = category ? PROP_CATEGORY_HEIGHT[category] : null;
  if (byCategory !== null) return byCategory;
  return PROP_KIND_HEIGHT[propKindOf(assetId)];
}

/**
 * Uniform scale that brings a mesh of `meshHeight` meters to its target height (1 without a target or height).
 * `fromManifest`: the mesh is a manifest asset, so it keeps its real size (1); only an explicit `overrides` entry
 * for the id still applies.
 */
export function propFitScale(
  assetId: string,
  meshHeight: number,
  overrides?: Readonly<Record<string, number>>,
  category?: PropCategory | null,
  fromManifest = false,
): number {
  const override = overrides?.[assetId];
  // A manifest prop keeps its real size unless the client names a height for this very id.
  if (fromManifest && override === undefined) return 1;
  const target = override ?? propTargetHeight(assetId, overrides, category);
  if (target === null || !(meshHeight > 1e-4)) return 1;
  return target / meshHeight;
}
