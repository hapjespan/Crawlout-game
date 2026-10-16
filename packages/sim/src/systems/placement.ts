import { BSTATE_DONE, C } from '../ecs/world.js';
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
/** No cell of the footprint lies in the player's territory (data 0.19.0, territoryMask). */
export const PLACE_TERRITORY = 6;
/** Name of each reason code, by code: for the client and its preview text. */
export const PLACEMENT_REASONS = [
  'ok',
  'blocked',
  'terrain',
  'crowded',
  'depot',
  'feature',
  'territory',
] as const;
export type PlacementReason = (typeof PLACEMENT_REASONS)[number];

/** What the new building is (bits of the `as` argument): a drop-off building, a claim building placed by Claim. */
export const AS_DEPOT = 1;
export const AS_CLAIM = 2;
/**
 * Relaxed rule, only for the fallbacks of a claim building (claimSiteIn): scrap nodes and claim points may lie in the
 * margin (never under the footprint). The terrain margin and the gap to other buildings still hold, so the ring
 * argument above still holds: a node is a point, not a blocked cell.
 */
export const AS_POINTS_NEAR = 4;
/**
 * Last resort of a claim building (claimSiteIn): no margin at all. The footprint lies in the map on walkable cells,
 * overlaps no building and covers no node or claim point; nothing more. A claim must never be impossible on a free
 * point, even when nodes, rocks or buildings crowd it.
 */
export const AS_NO_MARGIN = 8;
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
  /**
   * The placing player's territory (territoryMask, 1 per cell inside), or null/absent for no territory rule (data
   * 0.19.0; sim.json placement buildRangeM 0, or a check that is not about one player). A claim building placed by
   * Claim (AS_CLAIM) does not need it: a claim post is how a player reaches a point outside his territory.
   */
  readonly territory?: ArrayLike<number> | null;
}

/**
 * Reason code (PLACE_*) for a footprint of fw x fh cells with origin (fx, fy); `as` says what the new building is
 * (AS_DEPOT, AS_CLAIM, or 0). PLACE_OK when it may be placed. Reasons in order of severity: blocked, territory,
 * terrain, crowded, depot, feature.
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
  const c = (as & AS_NO_MARGIN) !== 0 ? 0 : marginCells(inp.clearance);
  const near = neighbourReason(inp, fx, fy, fw, fh, as);
  if (near === PLACE_BLOCKED) return PLACE_BLOCKED;
  const t = inp.territory;
  if (t != null && (as & AS_CLAIM) === 0 && !touchesTerritory(t, W, fx, fy, fw, fh))
    return PLACE_TERRITORY;
  if (c === 0) return near;
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
  const loose = (as & AS_NO_MARGIN) !== 0;
  const depot = (as & AS_DEPOT) !== 0;
  const c = loose ? 0 : marginCells(inp.clearance);
  const dc = loose ? 0 : marginCells(inp.depotClearance);
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
    // a claim building may stand next to a claim point, not on it; everything else keeps the margin (in the relaxed
    // claim fallbacks nodes too may lie next to it)
    const m =
      ((as & AS_CLAIM) !== 0 && pt[3 * k + 2] === POINT_CLAIM) || (as & AS_POINTS_NEAR) !== 0
        ? 0
        : c;
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

/** Whether any cell of the footprint fw x fh at (fx, fy) is inside the territory mask (map width W). */
export function touchesTerritory(
  t: ArrayLike<number>,
  W: number,
  fx: number,
  fy: number,
  fw: number,
  fh: number,
): boolean {
  for (let y = fy; y < fy + fh; y++) {
    for (let x = fx; x < fx + fw; x++) if (t[y * W + x] === 1) return true;
  }
  return false;
}

/**
 * Territory (data 0.19.0; Martien: "je kan maar in een straal van 10 aansluitende tegels bouwen in je gebied, tenzij
 * je tegen een blokkade in het terrein aan loopt"): 1 for every cell within `range` steps of a source footprint, the
 * steps going over walkable terrain only (8 neighbours, a diagonal step only past two walkable cells, so a cliff, rock
 * or water stops it and a thin diagonal wall is not crossed). Sources are five ints each: fx, fy, fw, fh and the range
 * in cells. A footprint cell is always inside. Pure: the sim and the client build the same mask.
 */
export function territoryMask(
  W: number,
  H: number,
  passable: ArrayLike<number>,
  sources: ArrayLike<number>,
  count: number,
): Uint8Array {
  const rem = new Int8Array(W * H).fill(-1);
  const buckets: number[][] = [];
  let maxR = 0;
  for (let k = 0; k < count; k++) {
    const r = sources[5 * k + 4]!;
    if (r > maxR) maxR = r;
    for (let b = buckets.length; b <= r; b++) buckets.push([]);
    const x0 = sources[5 * k]!;
    const y0 = sources[5 * k + 1]!;
    const x1 = x0 + sources[5 * k + 2]!;
    const y1 = y0 + sources[5 * k + 3]!;
    for (let y = y0 < 0 ? 0 : y0; y < y1 && y < H; y++) {
      for (let x = x0 < 0 ? 0 : x0; x < x1 && x < W; x++) {
        const c = y * W + x;
        if (rem[c]! < r) {
          rem[c] = r;
          buckets[r]!.push(c);
        }
      }
    }
  }
  const walk = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < W && y < H && passable[y * W + x] === 1;
  for (let r = maxR; r > 0; r--) {
    const list = buckets[r]!;
    for (let k = 0; k < list.length; k++) {
      const c = list[k]!;
      if (rem[c] !== r) continue;
      const cy = idiv(c, W);
      const cx = c - cy * W;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = cx + dx;
          const ny = cy + dy;
          if (!walk(nx, ny)) continue;
          if (dx !== 0 && dy !== 0 && (!walk(cx + dx, cy) || !walk(cx, cy + dy))) continue;
          const n = ny * W + nx;
          if (rem[n]! >= r - 1) continue;
          rem[n] = r - 1;
          buckets[r - 1]!.push(n);
        }
      }
    }
  }
  const out = new Uint8Array(W * H);
  for (let c = 0; c < W * H; c++) out[c] = rem[c]! >= 0 ? 1 : 0;
  return out;
}

/** Derived per world: the last territory mask per player and the world version it was built for (speed only). */
const territoryCache = new WeakMap<object, { version: number[]; mask: (Uint8Array | null)[] }>();

/**
 * Player p's territory in the sim's world now (territoryMask): every own building is a source with
 * placement.buildRange, a finished own claim post (provides claim, not hq) one with claimBuildRange; a building site
 * counts too (what is placed is part of the base), a claim post only once it stands. null when buildRange is 0 (no
 * territory rule). Cached per world version (alloc and free of entities), so the AI's site search and a Build share it.
 */
export function territoryOf(ctx: SimContext, p: number): Uint8Array | null {
  const pl = ctx.config.placement;
  if (pl.buildRange <= 0) return null;
  const w = ctx.world;
  let c = territoryCache.get(w);
  if (c === undefined) {
    c = { version: [], mask: [] };
    territoryCache.set(w, c);
  }
  const idx = ctx.index;
  idx.refresh(w);
  const src: number[] = [];
  const range = marginCells(pl.buildRange);
  const claimRange = marginCells(pl.claimBuildRange);
  for (let k = 0; k < idx.buildingCount; k++) {
    const j = idx.buildings[k]!;
    if (w.owner[j] !== p) continue;
    const bt = ctx.buildingType(w.typeId[j]!);
    const post =
      bt !== undefined && (bt.provides & PROVIDES_CLAIM) !== 0 && (bt.provides & PROVIDES_HQ) === 0;
    if (post && w.bstate[j] !== BSTATE_DONE) continue;
    src.push(w.fx[j]!, w.fy[j]!, w.fw[j]!, w.fh[j]!, post ? claimRange : range);
  }
  // the world version (alloc, free) plus the number of sources (a claim post that is finished)
  const key = w.structVersion * 65536 + src.length;
  if (c.version[p] === key && c.mask[p] !== undefined) return c.mask[p]!;
  const mask = territoryMask(ctx.map.w, ctx.map.h, ctx.map.passable, src, idiv(src.length, 5));
  c.version[p] = key;
  c.mask[p] = mask;
  return mask;
}

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
  return placementReason(
    placementInput(ctx, p),
    fx,
    fy,
    bt.footprintW,
    bt.footprintH,
    placeAs(bt) | claim,
  );
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
