// Why a building cannot go here. The client mirrors the sim's Build checks (footprintFree: inside the map and every
// footprint cell walkable; the walk grid already holds the cells of other buildings; canPlaceType and scrap) so the
// placement bar can name the reason of a red preview. The list is extensible: a new sim rule (for instance a rule that
// a building may not block access) is one more PlacementCheck in PLACEMENT_CHECKS. A check only reports what the sim
// would also reject, so the preview never contradicts the sim.

/** A footprint in whole cells: origin (top left) and size. */
export interface CellRect {
  x0: number;
  y0: number;
  w: number;
  h: number;
}

export interface PlacementEnv {
  gridW: number;
  gridH: number;
  /** Static terrain passability, 1 = walkable. */
  passable: ArrayLike<number>;
  /** Water mask (1 water, 2 shallow); null when the map has none. */
  water: { w: number; h: number; data: ArrayLike<number> } | null;
  /** Footprints of every building (own, enemy or neutral) on the map. */
  buildings: readonly CellRect[];
  scrap: number;
  scrapCost: number;
}

/** A check returns the Dutch reason, or null when it has nothing against this spot. */
export type PlacementCheck = (env: PlacementEnv, rect: CellRect) => string | null;

export const PLACEMENT_REASON = {
  outside: 'Buiten het bouwvlak',
  building: 'Overlapt een gebouw',
  water: 'Water: hier kun je niet bouwen',
  terrain: 'Te steil of onbegaanbaar terrein',
  scrap: 'Te weinig scrap',
  blocksAccess: 'Zou de toegang blokkeren',
} as const;

const cells = (r: CellRect, visit: (x: number, y: number) => boolean): boolean => {
  for (let y = r.y0; y < r.y0 + r.h; y++)
    for (let x = r.x0; x < r.x0 + r.w; x++) if (visit(x, y)) return true;
  return false;
};

const outside: PlacementCheck = (env, r) =>
  r.x0 < 0 || r.y0 < 0 || r.x0 + r.w > env.gridW || r.y0 + r.h > env.gridH
    ? PLACEMENT_REASON.outside
    : null;

const overlapsBuilding: PlacementCheck = (env, r) =>
  env.buildings.some(
    (b) => r.x0 < b.x0 + b.w && b.x0 < r.x0 + r.w && r.y0 < b.y0 + b.h && b.y0 < r.y0 + r.h,
  )
    ? PLACEMENT_REASON.building
    : null;

const waterCell: PlacementCheck = (env, r) =>
  env.water !== null &&
  cells(r, (x, y) => {
    const w = env.water!;
    return x < w.w && y < w.h && w.data[y * w.w + x] === 1;
  })
    ? PLACEMENT_REASON.water
    : null;

const unwalkable: PlacementCheck = (env, r) =>
  cells(r, (x, y) => env.passable[y * env.gridW + x] !== 1) ? PLACEMENT_REASON.terrain : null;

const tooExpensive: PlacementCheck = (env) =>
  env.scrap < env.scrapCost ? PLACEMENT_REASON.scrap : null;

/** In priority order: the first check that objects names the reason. Add new sim rules here. */
export const PLACEMENT_CHECKS: PlacementCheck[] = [
  outside,
  overlapsBuilding,
  waterCell,
  unwalkable,
  tooExpensive,
];

/** The reason this footprint cannot be placed, or null when it can. */
export function placementIssue(
  env: PlacementEnv,
  rect: CellRect,
  checks: readonly PlacementCheck[] = PLACEMENT_CHECKS,
): string | null {
  for (const check of checks) {
    const reason = check(env, rect);
    if (reason !== null) return reason;
  }
  return null;
}
