// A claim building chosen from the build menu (the Claimpaal) near a claim point is a claim, not a plain Build: the sim
// places it with the Claim command, next to the point, with the claim exception and the relaxed fallbacks
// (@crawlout/sim/placement claimSiteIn, data 0.20.0). This module decides, for the placement preview, whether the
// cursor is at a claim point, where the sim will put the post (so the preview snaps to exactly that spot) and why not;
// and which command a click sends. Pure functions, no DOM.
import type { CommandPayload } from '@crawlout/protocol';
import { claimSiteIn, type PlacementInput } from '@crawlout/sim/placement';

/** A claim point as the client sees it (owner null = neutral). */
export interface ClaimPointView {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly owner: number | null;
}

/** An own unfinished claim building: Claim lets the builders help there (cells, centre in sim units). */
export interface OwnClaimSite {
  readonly x: number;
  readonly y: number;
  readonly fx: number;
  readonly fy: number;
  readonly fw: number;
  readonly fh: number;
}

export interface ClaimPlacementArgs {
  /** The same placement input the sim rule reads (every building, node and claim point). */
  readonly input: PlacementInput;
  /** Snapped centre of the footprint under the cursor, in sim units. */
  readonly cursor: { readonly x: number; readonly y: number };
  readonly footprint: { readonly w: number; readonly h: number };
  /** placeAs of the building (AS_DEPOT or 0). */
  readonly as: number;
  /** sim.json claimRadiusU. */
  readonly claimRadius: number;
  readonly points: readonly ClaimPointView[];
  readonly ownSites: readonly OwnClaimSite[];
  readonly me: number;
  /** This player's scrap and the price of the building. */
  readonly scrap: number;
  readonly scrapCost: number;
}

export interface ClaimPlacement {
  readonly pointId: number;
  /** Where the preview stands: the centre of the footprint the sim will use. */
  readonly x: number;
  readonly y: number;
  readonly valid: boolean;
  /** Dutch hint for the placement bar: why not, or a note on a valid claim (an enemy holds the point). */
  readonly reason: string | null;
}

export const CLAIM_REASON = {
  own: 'Dit claimpunt is al van jou',
  noSpot: 'Geen vrije plek bij dit claimpunt',
  scrap: 'Te weinig scrap',
  enemy: 'Punt van de tegenstander: het wordt pas van jou als zijn claimgebouw weg is',
} as const;

const dist2 = (ax: number, ay: number, bx: number, by: number): number =>
  (ax - bx) * (ax - bx) + (ay - by) * (ay - by);

/** Squared distance from (x, y) to a footprint in cells (as the sim's distToRect2). */
function rectDist2(x: number, y: number, s: OwnClaimSite): number {
  const x0 = s.fx << 8;
  const y0 = s.fy << 8;
  const x1 = (s.fx + s.fw) << 8;
  const y1 = (s.fy + s.fh) << 8;
  const dx = x < x0 ? x0 - x : x > x1 ? x - x1 : 0;
  const dy = y < y0 ? y0 - y : y > y1 ? y - y1 : 0;
  return dx * dx + dy * dy;
}

/**
 * The claim this placement would be, or null when the cursor is not within claimRadius of a claim point (then the
 * building is placed as a plain Build). Mirrors the sim's applyClaim: an own unfinished claim building within the radius
 * is helped; a point that is already yours is refused; otherwise the spot of claimSiteIn.
 */
export function claimPlacement(a: ClaimPlacementArgs): ClaimPlacement | null {
  const r2 = a.claimRadius * a.claimRadius;
  let point: ClaimPointView | undefined;
  for (const p of a.points) {
    const d = dist2(a.cursor.x, a.cursor.y, p.x, p.y);
    if (d <= r2 && (point === undefined || d < dist2(a.cursor.x, a.cursor.y, point.x, point.y)))
      point = p;
  }
  if (point === undefined) return null;
  const pt = point;
  const help = a.ownSites.find((s) => rectDist2(pt.x, pt.y, s) <= r2);
  if (help !== undefined)
    return { pointId: pt.id, x: help.x, y: help.y, valid: true, reason: null };
  const centre = (fx: number, fy: number) => ({
    x: (fx << 8) + (a.footprint.w << 7),
    y: (fy << 8) + (a.footprint.h << 7),
  });
  const site = claimSiteIn(a.input, pt.x, pt.y, a.footprint.w, a.footprint.h, a.as, a.claimRadius);
  const at = site === null ? { x: a.cursor.x, y: a.cursor.y } : centre(site.fx, site.fy);
  const refuse = (reason: string): ClaimPlacement => ({
    pointId: pt.id,
    ...at,
    valid: false,
    reason,
  });
  if (pt.owner === a.me) return refuse(CLAIM_REASON.own);
  if (site === null) return refuse(CLAIM_REASON.noSpot);
  if (a.scrap < a.scrapCost) return refuse(CLAIM_REASON.scrap);
  const enemy = pt.owner !== null && pt.owner !== a.me;
  return { pointId: pt.id, ...at, valid: true, reason: enemy ? CLAIM_REASON.enemy : null };
}

/** The command a click on a valid placement sends: Claim at a claim point, otherwise Build at the spot. */
export function placementCommand(
  at: { readonly x: number; readonly y: number; readonly claimPointId?: number },
  typeId: number,
  builders: readonly number[],
):
  | { readonly type: 'Claim'; readonly payload: CommandPayload<'Claim'> }
  | { readonly type: 'Build'; readonly payload: CommandPayload<'Build'> } {
  if (at.claimPointId !== undefined)
    return { type: 'Claim', payload: { ids: [...builders], pointId: at.claimPointId } };
  return {
    type: 'Build',
    payload: { ids: [...builders], typeId, x: Math.round(at.x), y: Math.round(at.y) },
  };
}
