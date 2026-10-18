// Split from placement.ts to stay under the 5,000-token file limit; placement.ts re-exports the public surface.
// Holds: placementInput, placementReasonAt, CLAIM_TIERS, ClaimSite, claimSiteIn, claimSiteTier, +1 more.
import type { SimContext } from './common.js';
import { PROVIDES_CLAIM } from '../fromData.js';
import { C } from '../ecs/world.js';
import { idiv } from '../math/int.js';
import type { SimBuildingType } from '../config.js';
import {
  AS_CLAIM,
  AS_DEPOT,
  AS_NO_MARGIN,
  AS_POINTS_NEAR,
  PLACE_OK,
  POINT_CLAIM,
  POINT_NODE,
  RECT_CLAIM,
  RECT_DEPOT,
  hqCentres,
  placeAs,
  placementReason,
  territoryOf,
} from './placement.part1.js';
import type { PlacementInput } from './placement.part1.js';
import { survivalZoneReason } from './survival.js';

/**
 * The placement input from the sim's world: every building (sites too), every scrap node and every claim point; with
 * `p`, player p's territory (territoryOf) for a building that player places.
 */
export function placementInput(ctx: SimContext, p = -1): PlacementInput {
  const w = ctx.world;
  const idx = ctx.index;
  idx.refresh(w);
  const rects: number[] = [];
  for (let k = 0; k < idx.buildingCount; k++) {
    const j = idx.buildings[k]!;
    const bt = ctx.buildingType(w.typeId[j]!);
    const flags =
      bt === undefined
        ? 0
        : ((placeAs(bt) & AS_DEPOT) !== 0 ? RECT_DEPOT : 0) |
          ((bt.provides & PROVIDES_CLAIM) !== 0 ? RECT_CLAIM : 0);
    rects.push(w.fx[j]!, w.fy[j]!, w.fw[j]!, w.fh[j]!, flags);
  }
  const points: number[] = [];
  for (let k = 0; k < idx.nodeCount; k++) {
    const j = idx.nodes[k]!;
    points.push(w.x[j]!, w.y[j]!, POINT_NODE);
  }
  for (const j of ctx.claimPoints) {
    if (w.has(j, C.claim)) points.push(w.x[j]!, w.y[j]!, POINT_CLAIM);
  }
  return {
    mapW: ctx.map.w,
    mapH: ctx.map.h,
    passable: ctx.map.passable,
    rects,
    rectCount: idiv(rects.length, 5),
    points,
    pointCount: idiv(points.length, 3),
    clearance: ctx.config.placement.clearance,
    depotClearance: ctx.config.placement.depotClearance,
    territory: p >= 0 ? territoryOf(ctx, p) : null,
  };
}

/**
 * Reason code for building type bt with its footprint origin at (fx, fy), in the sim's world now; `claim` for a claim
 * building placed by the Claim command (AS_CLAIM and its CLAIM_TIERS bits); `p` the player who places it (his
 * territory), -1 for no territory rule.
 */
export function placementReasonAt(
  ctx: SimContext,
  bt: SimBuildingType,
  fx: number,
  fy: number,
  claim = 0,
  p = -1,
): number {
  const inp = placementInput(ctx, p);
  const hr = bt.hqRange;
  const r = placementReason(
    hr === null || p < 0 ? inp : { ...inp, hqRange: { hqs: hqCentres(ctx, p), ...hr } },
    fx,
    fy,
    bt.footprintW,
    bt.footprintH,
    placeAs(bt) | claim,
  );
  // survival co-op (sim 0.27.0): only within the own build zone (claim buildings anywhere)
  return r !== PLACE_OK ? r : survivalZoneReason(ctx, bt, fx, fy, p);
}

/**
 * The three tiers of claimSiteIn, strictest first: the full rule with the claim exception, then nodes and claim points
 * next to the footprint, then no margin at all. A later tier is only tried when no spot within the radius passes the one
 * before, so a claim that found a spot before this fallback existed still lands on the same cell.
 */
export const CLAIM_TIERS: readonly number[] = [
  AS_CLAIM,
  AS_CLAIM | AS_POINTS_NEAR,
  AS_CLAIM | AS_NO_MARGIN,
];

/** Where a claim building lands (claimSiteIn). */
export interface ClaimSite {
  /** The Build point: the centre of the chosen cell, in sim units (the footprint origin is cell(x, y) - (w >> 1, h >> 1)). */
  readonly x: number;
  readonly y: number;
  /** Footprint origin in cells. */
  readonly fx: number;
  readonly fy: number;
  /** The `as` bits the spot passed with (one of CLAIM_TIERS, plus AS_DEPOT for a drop-off building): Build checks again with them. */
  readonly as: number;
}

/**
 * The spot for a claim building of fw x fh cells at claim point (px, py) in sim units, as the Claim command uses it; one
 * pure function, so the client's preview snaps to exactly this spot. Ring by ring around the cell of the point (the
 * point itself stays free), the first ring with a footprint within `radius` of the point (distance from the point to
 * the footprint) that passes the placement rule for a claim building; within a ring the spot nearest the point, then
 * nearest the middle of the map in half cells (both players build mirrored on a point symmetric map), then scan order.
 * When no spot within the radius passes, the same search runs with the relaxed rules of CLAIM_TIERS. null only when no
 * free walkable footprint is left within the radius at all. `as` is placeAs of the building (AS_DEPOT or 0).
 */
export function claimSiteIn(
  inp: PlacementInput,
  px: number,
  py: number,
  fw: number,
  fh: number,
  as: number,
  radius: number,
): ClaimSite | null {
  for (const tier of CLAIM_TIERS) {
    const at = claimSiteTier(inp, px, py, fw, fh, as | tier, radius);
    if (at !== null) return at;
  }
  return null;
}

function claimSiteTier(
  inp: PlacementInput,
  px: number,
  py: number,
  fw: number,
  fh: number,
  as: number,
  r: number,
): ClaimSite | null {
  const W = inp.mapW;
  const H = inp.mapH;
  const pcx = px >> 8;
  const pcy = py >> 8;
  const maxRing = (r >> 8) + (fw > fh ? fw : fh);
  for (let d = 1; d <= maxRing; d++) {
    let bestX = -1;
    let bestY = -1;
    let bestD = 0;
    let bestM = 0;
    // the ring of cells at Chebyshev distance d around the point's cell, row by row (the order of common.ts scanRing)
    const x0 = pcx - d;
    const y0 = pcy - d;
    const x1 = pcx + d;
    const y1 = pcy + d;
    for (let cy = y0; cy <= y1; cy++) {
      if (cy < 0 || cy >= H) continue;
      const edgeRow = cy === y0 || cy === y1;
      for (let cx = x0; cx <= x1; cx += edgeRow || cx === x1 ? 1 : x1 - x0) {
        if (cx < 0 || cx >= W) continue;
        const fx = cx - (fw >> 1);
        const fy = cy - (fh >> 1);
        if (rectDist2(px, py, fx, fy, fw, fh) > r * r) continue;
        if (placementReason(inp, fx, fy, fw, fh, as) !== PLACE_OK) continue;
        const dx = (cx << 8) + 128 - px;
        const dy = (cy << 8) + 128 - py;
        const dd = dx * dx + dy * dy;
        const mx = 2 * cx + 1 - W;
        const my = 2 * cy + 1 - H;
        const dm = mx * mx + my * my;
        if (bestX < 0 || dd < bestD || (dd === bestD && dm < bestM)) {
          bestX = cx;
          bestY = cy;
          bestD = dd;
          bestM = dm;
        }
      }
    }
    if (bestX >= 0)
      return {
        x: (bestX << 8) + 128,
        y: (bestY << 8) + 128,
        fx: bestX - (fw >> 1),
        fy: bestY - (fh >> 1),
        as,
      };
  }
  return null;
}

/** Squared distance from (x, y) to the footprint fw x fh at origin (fx, fy), in sim units (as common.ts distToRect2). */
function rectDist2(x: number, y: number, fx: number, fy: number, fw: number, fh: number): number {
  const x0 = fx << 8;
  const y0 = fy << 8;
  const x1 = (fx + fw) << 8;
  const y1 = (fy + fh) << 8;
  const dx = x < x0 ? x0 - x : x > x1 ? x - x1 : 0;
  const dy = y < y0 ? y0 - y : y > y1 ? y - y1 : 0;
  return dx * dx + dy * dy;
}
