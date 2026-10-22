// What a decorative prop is, beyond its asset id: the manifest's optional `category` (written by the asset-cli for the
// DJMaesen packs) drives how the prop layer treats it: the target height fallback (propFit.ts), wind sway
// (propWind.ts), colour variation, blob shadows and the order in which props thin out with distance
// (propThinning.ts). An asset without a category gets one from its id.
import { propKindOf, type PropKind } from './propFit.js';

export const PROP_CATEGORIES = [
  'tree-leafy',
  'tree-bare',
  'grass',
  'plant',
  'rock',
  'crate',
  'chest',
  'barrel',
  'structure',
  'debris',
] as const;

export type PropCategory = (typeof PROP_CATEGORIES)[number];

/** A manifest value as a category, or null when it is absent or not one of PROP_CATEGORIES. */
export function parsePropCategory(value: unknown): PropCategory | null {
  return typeof value === 'string' && (PROP_CATEGORIES as readonly string[]).includes(value)
    ? (value as PropCategory)
    : null;
}

const KIND_CATEGORY: Readonly<Record<PropKind, PropCategory>> = {
  tree: 'tree-leafy',
  rock: 'rock',
  bush: 'plant',
  grass: 'grass',
  reed: 'plant',
  other: 'debris',
};

/** Category of a prop from its asset id alone (the manifest's category wins over this). */
export function propCategoryOf(assetId: string): PropCategory {
  const id = assetId.toLowerCase();
  const kind = propKindOf(id);
  if (kind === 'tree' && /bare|dead|leafless|dry/.test(id)) return 'tree-bare';
  if (kind !== 'other') return KIND_CATEGORY[kind];
  if (/crate|box/.test(id)) return 'crate';
  if (/chest/.test(id)) return 'chest';
  if (/barrel|keg/.test(id)) return 'barrel';
  if (/tower|wall|fence|hut|shack|structure/.test(id)) return 'structure';
  if (/plant|flower|fern|herb|cactus/.test(id)) return 'plant';
  return 'debris';
}

/** Trees (with or without leaves): the props a forest is made of. */
export function isTree(category: PropCategory): boolean {
  return category === 'tree-leafy' || category === 'tree-bare';
}

/** Whether a prop of this category gets a soft blob shadow: ground cover is too small and too many for one. */
export function hasBlobShadow(category: PropCategory): boolean {
  return category !== 'grass' && category !== 'plant' && category !== 'debris';
}

/**
 * Whether a prop of this category casts the sun's real shadow: trees and structures always, rocks, crates, chests and
 * barrels only with `smallProps` (high shadow quality); ground cover (grass, plants, debris) never, it is too small
 * and too many for the shadow pass.
 */
export function castsShadow(category: PropCategory, smallProps: boolean): boolean {
  if (isTree(category) || category === 'structure') return true;
  if (category === 'grass' || category === 'plant' || category === 'debris') return false;
  return smallProps;
}
