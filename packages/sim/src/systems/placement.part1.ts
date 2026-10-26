// Split from placement.ts to stay under the 5,000-token file limit; placement.ts re-exports the public surface.
// Holds: PLACE_OK, PLACE_BLOCKED, PLACE_TERRAIN, PLACE_CROWDED, PLACE_DEPOT, PLACE_FEATURE, +23 more.
import type { SimBuildingType } from '../config.js';
import { PROVIDES_HQ, PROVIDES_WORKSHOP, PROVIDES_DEPOT, PROVIDES_CLAIM } from '../fromData.js';
import type { SimContext } from './common.js';
import { idiv } from '../math/int.js';
import { BSTATE_DONE } from '../ecs/world.js';

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

/** No cell of the footprint lies in the player's territory (data 0.20.0, territoryMask). */
export const PLACE_TERRITORY = 6;

/**
 * The building must stand within a distance range of an own headquarters and does not (data 0.21.0 buildings
 * placement, the Kooi at the edge of the Raider base; bevestigd in fase-0 sectie 23 besluit 3).
 */
export const PLACE_HQ_RANGE = 7;

/** Survival co-op (sim 0.27.0): outside the player's own build zone (systems/survival.ts survivalZoneReason). */
export const PLACE_ZONE = 8;

/** Name of each reason code, by code: for the client and its preview text. */
export const PLACEMENT_REASONS = [
  'ok',
  'blocked',
  'terrain',
  'crowded',
  'depot',
  'feature',
  'territory',
  'hqRange',
  // survival co-op (sim 0.27.0): outside the player's own build zone (systems/survival.ts PLACE_ZONE)
  'zone',
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
   * 0.20.0; sim.json placement buildRangeM 0, or a check that is not about one player). A claim building placed by
   * Claim (AS_CLAIM) does not need it: a claim post is how a player reaches a point outside his territory.
   */
  readonly territory?: ArrayLike<number> | null;
  /**
   * Distance rule of the building being placed (data 0.21.0, buildings placement; SimBuildingType.hqRange): the centre
   * of the footprint lies between min and max (sim units, inclusive) from the centre of one of the placing player's
   * headquarters, given as x, y pairs in sim units. null/absent: no such rule.
   */
  readonly hqRange?: {
    readonly hqs: ArrayLike<number>;
    readonly min: number;
    readonly max: number;
  } | null;
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
  const hr = inp.hqRange;
  if (hr != null && !inHqRange(hr.hqs, hr.min, hr.max, fx, fy, fw, fh)) return PLACE_HQ_RANGE;
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

/**
 * What building type bt is for the rule: AS_DEPOT for a drop-off building (provides hq, workshop or, data 0.21.0,
 * depot), else 0.
 */
export const placeAs = (bt: SimBuildingType): number =>
  (bt.provides & (PROVIDES_HQ | PROVIDES_WORKSHOP | PROVIDES_DEPOT)) !== 0 ? AS_DEPOT : 0;

/**
 * Whether the centre of the footprint (fx, fy, fw, fh) lies between min and max (inclusive, sim units) from one of the
 * headquarters centres in `hqs` (x, y pairs in sim units).
 */
export function inHqRange(
  hqs: ArrayLike<number>,
  min: number,
  max: number,
  fx: number,
  fy: number,
  fw: number,
  fh: number,
): boolean {
  const cx = (fx << 8) + (fw << 7);
  const cy = (fy << 8) + (fh << 7);
  for (let k = 0; k + 1 < hqs.length; k += 2) {
    const dx = cx - hqs[k]!;
    const dy = cy - hqs[k + 1]!;
    const d = dx * dx + dy * dy;
    if (d >= min * min && d <= max * max) return true;
  }
  return false;
}

/** Centres (x, y pairs, sim units) of player p's headquarters (any build state), for PlacementInput.hqRange. */
export function hqCentres(ctx: SimContext, p: number): number[] {
  const w = ctx.world;
  const idx = ctx.index;
  idx.refresh(w);
  const out: number[] = [];
  for (let k = 0; k < idx.buildingCount; k++) {
    const j = idx.buildings[k]!;
    if (w.owner[j] !== p) continue;
    const bt = ctx.buildingType(w.typeId[j]!);
    if (bt !== undefined && (bt.provides & PROVIDES_HQ) !== 0) out.push(w.x[j]!, w.y[j]!);
  }
  return out;
}

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
 * Territory (data 0.20.0; Martien: "je kan maar in een straal van 10 aansluitende tegels bouwen in je gebied, tenzij
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

/** Derived per world: the last territory mask per player and the sources it was built from (speed only). */
const territoryCache = new WeakMap<object, { src: number[][]; mask: Uint8Array[] }>();

/**
 * Player p's territory in the sim's world now (territoryMask): every own building is a source with
 * placement.buildRange, a finished own claim post (provides claim, not hq) one with claimBuildRange; a building site
 * counts too (what is placed is part of the base), a claim post only once it stands. null when buildRange is 0 (no
 * territory rule). Cached per source list, so the AI's site search and a Build share it; the mask depends on nothing else
 * (an owner change without alloc or free, a project part restored or reverted, must recompute it).
 */
export function territoryOf(ctx: SimContext, p: number): Uint8Array | null {
  const pl = ctx.config.placement;
  if (pl.buildRange <= 0) return null;
  const w = ctx.world;
  let c = territoryCache.get(w);
  if (c === undefined) {
    c = { src: [], mask: [] };
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
  const last = c.src[p];
  if (last !== undefined && last.length === src.length && last.every((v, k) => v === src[k]))
    return c.mask[p]!;
  const mask = territoryMask(ctx.map.w, ctx.map.h, ctx.map.passable, src, idiv(src.length, 5));
  c.src[p] = src;
  c.mask[p] = mask;
  return mask;
}
