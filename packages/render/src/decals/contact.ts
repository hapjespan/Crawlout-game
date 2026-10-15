// Contact decals: what makes a building or a large prop sit in the ground instead of on it. A dark soft edge hugging the
// footprint (ambient occlusion where the wall meets the ground) plus a dusty, trodden ring around it that is a little
// darker and warmer than the terrain. Drawn by DecalLayer (shape `contact`) in the same single draw call as the other
// decals. Pure sizing here; the look is in decalLayer.ts.
import { DECAL_COLOR, DECAL_SHAPE, type DecalStyle } from './decalLayer.js';
import type { PropCategory } from '../props/propCategory.js';

export interface ContactDecal {
  /** Margin (m) the decal reaches beyond the footprint. */
  margin: number;
  style: DecalStyle;
}

const CONTACT_BASE: DecalStyle = {
  shape: DECAL_SHAPE.contact,
  shadow: 0.75,
  ring: 0,
  ringWidth: 0,
  fill: 0.62,
  grid: 0,
  color: DECAL_COLOR.dirt,
};
/** A building under construction: churned earth, a wider and stronger ring than a finished one. */
const CONTACT_SITE: DecalStyle = { ...CONTACT_BASE, shadow: 0.5, fill: 0.8 };
const CONTACT_PROP: DecalStyle = { ...CONTACT_BASE, shadow: 0.5, fill: 0.42 };

/** Margin of a building's contact decal: grows a little with the footprint, between 1.3 and 2.6 m. */
export function buildingContactMargin(w: number, h: number): number {
  return Math.min(2.6, Math.max(1.3, 0.9 + 0.2 * Math.min(w, h)));
}

/** Contact decal of a building footprint of w x h cells; `underConstruction` gives the site its trodden ring. */
export function buildingContact(w: number, h: number, underConstruction: boolean): ContactDecal {
  const margin = buildingContactMargin(w, h) * (underConstruction ? 1.25 : 1);
  return { margin, style: underConstruction ? CONTACT_SITE : CONTACT_BASE };
}

/** Prop categories that stand on the ground with a hard footprint (trees keep their blob, ground cover gets nothing). */
const CONTACT_PROPS: ReadonlySet<PropCategory> = new Set<PropCategory>([
  'rock',
  'crate',
  'chest',
  'barrel',
  'structure',
]);
/** Props smaller than this (footprint radius in meters, after fit and scale) get no contact decal: the blob suffices. */
export const PROP_CONTACT_MIN_RADIUS = 0.6;

/** Contact decal under a prop of this category and footprint radius (m), or null when it is not large enough. */
export function propContact(category: PropCategory, radius: number): ContactDecal | null {
  if (!CONTACT_PROPS.has(category) || !(radius >= PROP_CONTACT_MIN_RADIUS)) return null;
  return { margin: Math.min(1.8, 0.35 + 0.35 * radius), style: CONTACT_PROP };
}
