import { C } from '../ecs/world.js';
import { PROVIDES_CLAIM, PROVIDES_HQ, PROVIDES_WORKSHOP } from '../fromData.js';
import { idiv } from '../math/int.js';
import type { SimBuildingType } from '../config.js';
import type { SimContext } from './common.js';

// Building placement rule (data 0.18.0, sim.json `placement`; playtest bot 16 October). One rule for every building a
// player or the scripted AI places (Build, Claim):
//
//  1. the footprint lies in the map on walkable terrain and overlaps no building;
//  2. a margin of `clearance` cells around it is walkable terrain inside the map, with no other building in it
//     (Chebyshev gap between footprints) and no scrap node or claim point in it or under the footprint. One exception:
//     a claim building placed by the Claim command (AS_CLAIM) belongs next to its point, so it only may not cover a
//     claim point, and it may touch another claim building (both players claim the middle in the same tick, on mirrored
//     cells next to the point; the one that thinks second must not be pushed away by the first);
//  3. no other building lies within `depotClearance` cells of a drop-off building (provides hq or workshop), in either
//     direction: the aisle around a depot stays free for the gatherers walking to and from it.
//
// Why rule 2 keeps the base walkable: with a margin of at least one cell, the ring of cells around the new footprint is
// walkable and free, and that ring is a closed 4-connected path. Any walkable route that crossed the footprint can go
// round it along the ring instead, so a new building never disconnects two walkable cells; a headquarters, a depot or a
// node that was reachable stays reachable, whatever the players build (validateEnv requires clearance >= 1 cell). A
// node under a footprint (the stall the playtest bot found: gatherers walked against the edge of a building that stood
// on their node for 500 s) is excluded by the same rule.
//
// The check is a pure function of plain arrays (`placementReason`), so the client can show the same answer, and the
// reason, in its placement preview; `placementReasonAt` feeds it from the sim's own world.

export const PLACE_OK = 0;
/** The footprint leaves the map, covers unwalkable terrain or overlaps a building. */
export const PLACE_BLOCKED = 1;
/** The margin around the footprint leaves the map or covers unwalkable terrain (water, rock, forest). */
export const PLACE_TERRAIN = 2;
/** Another building stands within the margin. */
export const PLACE_CROWDED = 3;
/** Too close to a drop-off building (or, for a depot, another building in its aisle). */
export const PLACE_DEPOT = 4;
/** A scrap node or claim point lies under the footprint or within the margin. */
export const PLACE_FEATURE = 5;
/** Name of each reason code, by code: for the client and its preview text. */
export const PLACEMENT_REASONS = [
  'ok',
  'blocked',
  'terrain',
  'crowded',
  'depot',
  'feature',
] as const;
export type PlacementReason = (typeof PLACEMENT_REASONS)[number];

/** What the new building is (bits of the `as` argument): a drop-off building, a claim building placed by Claim. */
export const AS_DEPOT = 1;
export const AS_CLAIM = 2;
/** Flags of a building in PlacementInput.rects: a drop-off building, a claim building (provides claim). */
export const RECT_DEPOT = 1;
export const RECT_CLAIM = 2;
/** Kind of a point in PlacementInput.points. */
export const POINT_NODE = 0;
export const POINT_CLAIM = 1;

/** A placement margin in sim units as whole cells, rounded up. */
export const marginCells = (u: number): number => (u + 255) >> 8;

/** Everything the rule reads, as plain arrays: the sim and the client fill it from their own view of the world. */
export interface PlacementInput {
  readonly mapW: number;
  readonly mapH: number;
  /** Terrain walkability per cell (1 = walkable), without buildings. */
  readonly passable: ArrayLike<number>;
  /** Every building (any owner, sites too), five ints each: fx, fy, fw, fh (cells) and flags (RECT_DEPOT, RECT_CLAIM). */
  readonly rects: ArrayLike<number>;
  readonly rectCount: number;
  /** Scrap nodes and claim points, three ints each: x, y in sim units and POINT_NODE or POINT_CLAIM. */
  readonly points: ArrayLike<number>;
  readonly pointCount: number;
  /** sim.json placement, in sim units (SimPlacementTuning; GameData.sim.placement clearanceU and depotClearanceU). */
  readonly clearance: number;
  readonly depotClearance: number;
}

/**
 * Reason code (PLACE_*) for a footprint of fw x fh cells with origin (fx, fy); `as` says what the new building is
 * (AS_DEPOT, AS_CLAIM, or 0). PLACE_OK when it may be placed. Reasons in order of severity: blocked, terrain, crowded,
 * depot, feature.
 */
export function placementReason(
  inp: PlacementInput,
  fx: number,
  fy: number,
  fw: number,
  fh: number,
  as: number,
): number {
  const W = inp.mapW;
  const H = inp.mapH;
  const pass = inp.passable;
  if (fx < 0 || fy < 0 || fx + fw > W || fy + fh > H) return PLACE_BLOCKED;
  for (let y = fy; y < fy + fh; y++) {
    for (let x = fx; x < fx + fw; x++) if (pass[y * W + x] !== 1) return PLACE_BLOCKED;
  }
  const c = marginCells(inp.clearance);
  const near = neighbourReason(inp, fx, fy, fw, fh, as);
  if (near === PLACE_BLOCKED) return PLACE_BLOCKED;
  const x0 = fx - c;
  const y0 = fy - c;
  const x1 = fx + fw + c;
  const y1 = fy + fh + c;
  if (x0 < 0 || y0 < 0 || x1 > W || y1 > H) return PLACE_TERRAIN;
  for (let y = y0; y < y1; y++) {
    const inner = y >= fy && y < fy + fh;
    for (let x = x0; x < x1; x += inner && x === fx - 1 ? fw + 1 : 1) {
      if (pass[y * W + x] !== 1) return PLACE_TERRAIN;
    }
  }
  return near;
}

/**
 * The neighbour part of the rule (other buildings, depots, nodes and claim points), without the terrain cells: the AI's
 * site search tests those itself with a summed-area table. PLACE_BLOCKED for an overlap.
 */
export function neighbourReason(
  inp: PlacementInput,
  fx: number,
  fy: number,
  fw: number,
  fh: number,
  as: number,
): number {
  const depot = (as & AS_DEPOT) !== 0;
  const c = marginCells(inp.clearance);
  const dc = marginCells(inp.depotClearance);
  const r = inp.rects;
  let reason = PLACE_OK;
  for (let k = 0; k < inp.rectCount; k++) {
    const bx = r[5 * k]!;
    const by = r[5 * k + 1]!;
    const bw = r[5 * k + 2]!;
    const bh = r[5 * k + 3]!;
    // free cells between the two footprints along each axis (negative: the projections overlap)
    const gx = bx - (fx + fw) > fx - (bx + bw) ? bx - (fx + fw) : fx - (bx + bw);
    const gy = by - (fy + fh) > fy - (by + bh) ? by - (fy + fh) : fy - (by + bh);
    const gap = gx > gy ? gx : gy;
    if (gap < 0) return PLACE_BLOCKED;
    const flags = r[5 * k + 4]!;
    const need = (as & AS_CLAIM) !== 0 && (flags & RECT_CLAIM) !== 0 ? 0 : c;
    if (gap < need) {
      if (reason === PLACE_OK || reason > PLACE_CROWDED) reason = PLACE_CROWDED;
    } else if (gap < dc && (depot || (flags & RECT_DEPOT) !== 0) && reason === PLACE_OK)
      reason = PLACE_DEPOT;
  }
  if (reason !== PLACE_OK) return reason;
  const pt = inp.points;
  for (let k = 0; k < inp.pointCount; k++) {
    const x = pt[3 * k]!;
    const y = pt[3 * k + 1]!;
    // a claim building may stand next to a claim point, not on it; everything else keeps the margin
    const m = (as & AS_CLAIM) !== 0 && pt[3 * k + 2] === POINT_CLAIM ? 0 : c;
    if (
      x >= (fx - m) << 8 &&
      x <= (fx + fw + m) << 8 &&
      y >= (fy - m) << 8 &&
      y <= (fy + fh + m) << 8
    )
      return PLACE_FEATURE;
  }
  return PLACE_OK;
}

/** What building type bt is for the rule: AS_DEPOT for a drop-off building (provides hq or workshop), else 0. */
export const placeAs = (bt: SimBuildingType): number =>
  (bt.provides & (PROVIDES_HQ | PROVIDES_WORKSHOP)) !== 0 ? AS_DEPOT : 0;

/** The placement input from the sim's world: every building (sites too), every scrap node and every claim point. */
export function placementInput(ctx: SimContext): PlacementInput {
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
  };
}

/**
 * Reason code for building type bt with its footprint origin at (fx, fy), in the sim's world now; `claim` for a claim
 * building placed by the Claim command (AS_CLAIM).
 */
export function placementReasonAt(
  ctx: SimContext,
  bt: SimBuildingType,
  fx: number,
  fy: number,
  claim = false,
): number {
  const as = placeAs(bt) | (claim ? AS_CLAIM : 0);
  return placementReason(placementInput(ctx), fx, fy, bt.footprintW, bt.footprintH, as);
}
