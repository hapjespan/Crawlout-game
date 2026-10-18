// Split from common.ts to stay under the 5,000-token file limit; common.ts re-exports the public surface.
// Holds: isEnemy, dist2, nearestOwnBuilding, nodeAllowed, componentAt, nodeCovered, +11 more.
import { type World, C, SLAVE_SLAVE, SLAVE_CAPTIVE, BSTATE_DONE } from '../ecs/world.js';
import { OWNER_NEUTRAL, MAX_PLAYERS } from '@crawlout/protocol';
import { NO_COMPONENT } from '../pathdist.js';
import type { SimMap } from '../config.js';
import { idiv } from '../math/int.js';
import { cellAt, distToRect2, inMap, visibleTo } from './common.part1.js';
import type { SimContext } from './common.part1.js';

/** Vijandige, levende entity met Health (unit of gebouw) voor unit i. */
export function isEnemy(w: World, i: number, t: number): boolean {
  if (!w.has(t, C.health) || w.hp[t]! <= 0) return false;
  // a slave or captive (data 0.21.0) is no target for shots: it is freed by touch (systems/slaves.ts)
  const st = w.slaveState[t]!;
  if (st === SLAVE_SLAVE || st === SLAVE_CAPTIVE) return false;
  const o = w.owner[t]!;
  const p = w.owner[i]!;
  // creep camps (sim 0.20.0): a bandit fights player units (systems/creeps.ts picks them), and is an enemy of every
  // player who sees it; any other neutral (a wanderer) is nobody's enemy
  if (p === OWNER_NEUTRAL)
    return w.creepCamp[i] !== 0 && o < MAX_PLAYERS && (w.mask[t]! & C.unit) !== 0;
  if (o === OWNER_NEUTRAL) return w.creepCamp[t] !== 0 && visibleTo(w, t, p);
  // fog of war (sim 0.17.0): only an enemy that the owner of i sees now is a target (shooting, chasing, acquiring)
  return o !== p && visibleTo(w, t, p);
}

/** Kwadraat van de afstand tussen de middelpunten van twee entities. */
export function dist2(w: World, i: number, j: number): number {
  const dx = w.x[j]! - w.x[i]!;
  const dy = w.y[j]! - w.y[i]!;
  return dx * dx + dy * dy;
}

/** Dichtstbijzijnde voltooide eigen gebouw met een van de provides-bits, of -1. Tiebreak laagste index. */
export function nearestOwnBuilding(
  ctx: SimContext,
  owner: number,
  x: number,
  y: number,
  providesMask: number,
): number {
  const w = ctx.world;
  const idx = ctx.index;
  idx.refresh(w);
  let best = -1;
  let bestD = 0;
  for (let k = 0; k < idx.buildingCount; k++) {
    const j = idx.buildings[k]!;
    if (w.owner[j] !== owner || w.bstate[j] !== BSTATE_DONE) continue;
    const bt = ctx.buildingType(w.typeId[j]!);
    if (bt === undefined || (bt.provides & providesMask) === 0) continue;
    const d = distToRect2(x, y, w.fx[j]!, w.fy[j]!, w.fw[j]!, w.fh[j]!);
    if (best < 0 || d < bestD) {
      best = j;
      bestD = d;
    }
  }
  return best;
}

/**
 * Of speler p van scrap-node `node` mag verzamelen: niet als de node binnen exclusiveRadius (data 0.20.0; was
 * claimRadius) ligt van een claimpunt van een andere speler, tenzij hij ook binnen de straal van een eigen punt ligt.
 */
export function nodeAllowed(ctx: SimContext, node: number, p: number): boolean {
  const w = ctx.world;
  const r = ctx.config.exclusiveRadius;
  const r2 = r * r;
  let blocked = false;
  for (const pt of ctx.claimPoints) {
    const o = w.owner[pt]!;
    if (o === OWNER_NEUTRAL) continue;
    const dx = w.x[node]! - w.x[pt]!;
    const dy = w.y[node]! - w.y[pt]!;
    if (dx * dx + dy * dy > r2) continue;
    if (o === p) return true;
    blocked = true;
  }
  return !blocked;
}

/** The walkable piece of terrain under (x, y) (TerrainDistances.component), NO_COMPONENT off the terrain. */
export function componentAt(ctx: SimContext, x: number, y: number): number {
  return inMap(ctx.map, x, y) ? ctx.terrainDist.component(cellAt(ctx.map, x, y)) : NO_COMPONENT;
}

/** Whether a building stands on the cell of scrap node `node` (then no gatherer reaches it). */
export function nodeCovered(ctx: SimContext, node: number): boolean {
  const w = ctx.world;
  return ctx.terrain.occ[cellAt(ctx.map, w.x[node]!, w.y[node]!)] !== 0;
}

/**
 * Whether a unit at (x, y) can walk to within reach of scrap node `node`: the node is not under a building and a
 * walkable cell of its own 3 x 3 block (each well within interactRange of it) lies in the same piece of terrain as the
 * unit. A unit that is itself off the terrain (never, but defensively) counts as reaching everything.
 */
export function nodeReachable(ctx: SimContext, x: number, y: number, node: number): boolean {
  if (nodeCovered(ctx, node)) return false;
  const a = componentAt(ctx, x, y);
  if (a === NO_COMPONENT) return true;
  const w = ctx.world;
  const map = ctx.map;
  const nx = w.x[node]! >> 8;
  const ny = w.y[node]! >> 8;
  for (let cy = ny - 1; cy <= ny + 1; cy++) {
    if (cy < 0 || cy >= map.h) continue;
    for (let cx = nx - 1; cx <= nx + 1; cx++) {
      if (cx >= 0 && cx < map.w && ctx.terrainDist.component(cy * map.w + cx) === a) return true;
    }
  }
  return false;
}

/**
 * Whether a unit at (x, y) can walk to building b: a free walkable cell on the ring around its footprint lies in the
 * unit's piece of terrain (a walkable cell next to the footprint is within interactRange of it).
 */
export function buildingReachable(ctx: SimContext, x: number, y: number, b: number): boolean {
  const a = componentAt(ctx, x, y);
  if (a === NO_COMPONENT) return true;
  const w = ctx.world;
  const map = ctx.map;
  return (
    scanRing(
      map,
      w.fx[b]!,
      w.fy[b]!,
      w.fw[b]!,
      w.fh[b]!,
      1,
      (cx, cy) =>
        ctx.terrain.walk[cy * map.w + cx] === 1 && ctx.terrainDist.component(cy * map.w + cx) === a,
    ) >= 0
  );
}

/**
 * Drop-off point for a gatherer at (x, y) of player `owner`: the nearest completed own depot (hq or workshop, `mask`)
 * it can walk to (buildingReachable), or -1. Tiebreak lowest index. Orders (walking there) and economy (delivering)
 * use the same choice, so a gatherer delivers at the depot it walks to.
 */
export function nearestReachableBuilding(
  ctx: SimContext,
  owner: number,
  x: number,
  y: number,
  providesMask: number,
): number {
  const w = ctx.world;
  const idx = ctx.index;
  idx.refresh(w);
  let best = -1;
  let bestD = 0;
  for (let k = 0; k < idx.buildingCount; k++) {
    const j = idx.buildings[k]!;
    if (w.owner[j] !== owner || w.bstate[j] !== BSTATE_DONE) continue;
    const bt = ctx.buildingType(w.typeId[j]!);
    if (bt === undefined || (bt.provides & providesMask) === 0) continue;
    const d = distToRect2(x, y, w.fx[j]!, w.fy[j]!, w.fw[j]!, w.fh[j]!);
    if ((best < 0 || d < bestD) && buildingReachable(ctx, x, y, j)) {
      best = j;
      bestD = d;
    }
  }
  return best;
}

/**
 * Dichtstbijzijnde scrap-node met voorraad waar speler p mag verzamelen (nodeAllowed) en waar een unit op (x, y) kan
 * komen (nodeReachable: niet onder een gebouw, in hetzelfde stuk terrein), of -1. Tiebreak laagste index.
 */
export function nearestNode(
  ctx: SimContext,
  p: number,
  x: number,
  y: number,
  reach: { readonly x: number; readonly y: number; readonly r: number } | null = null,
): number {
  const w = ctx.world;
  const idx = ctx.index;
  idx.refresh(w);
  let best = -1;
  let bestD = 0;
  if (reach !== null && reach.r < 0) return -1;
  for (let k = 0; k < idx.nodeCount; k++) {
    const j = idx.nodes[k]!;
    if (w.amount[j]! <= 0 || !nodeAllowed(ctx, j, p)) continue;
    // a slave only within the work radius of its cage (data 0.21.0, systems/slaves.ts workReach)
    if (reach !== null) {
      const rx = w.x[j]! - reach.x;
      const ry = w.y[j]! - reach.y;
      if (rx * rx + ry * ry > reach.r * reach.r) continue;
    }
    const dx = w.x[j]! - x;
    const dy = w.y[j]! - y;
    const d = dx * dx + dy * dy;
    if ((best < 0 || d < bestD) && nodeReachable(ctx, x, y, j)) {
      best = j;
      bestD = d;
    }
  }
  return best;
}

/**
 * Cellen op ring d (Chebyshev-afstand d >= 1) rond de rechthoek [fx, fx+fw) x [fy, fy+fh), rij voor rij, binnen
 * de map. Roept visit aan tot die true geeft; geeft dan die cel-index terug, anders -1.
 */
export function scanRing(
  map: SimMap,
  fx: number,
  fy: number,
  fw: number,
  fh: number,
  d: number,
  visit: (cx: number, cy: number) => boolean,
): number {
  const x0 = fx - d;
  const y0 = fy - d;
  const x1 = fx + fw - 1 + d;
  const y1 = fy + fh - 1 + d;
  for (let cy = y0; cy <= y1; cy++) {
    if (cy < 0 || cy >= map.h) continue;
    const edgeRow = cy === y0 || cy === y1;
    for (let cx = x0; cx <= x1; cx += edgeRow || cx === x1 ? 1 : x1 - x0) {
      if (cx < 0 || cx >= map.w) continue;
      if (visit(cx, cy)) return cy * map.w + cx;
    }
  }
  return -1;
}

/** Geometrie: een nieuwe unit naast een gebouw komt op een van de eerste zoveel vrije cellen eromheen (roteert per tick). */
export const SPAWN_SPREAD = 8;

/** Geometrie: zover (in ringen van 1 cel) zoekt de sim naar een vrije cel rond een gebouw. */
export const MAX_FREE_RING = 24;

/**
 * De vrije (begaanbare) cel rond een rechthoek die het dichtst bij (x, y) ligt, ring voor ring. Bij gelijke afstand de
 * cel het dichtst bij het midden van de map, dan rechts van de richting van (x, y) naar het midden (kruisproduct): gelijk
 * onder de 180-gradenspiegel (content-x: de scanvolgorde alleen was dat niet, en een gebouw dat op twee gespiegelde
 * groepjes plunderaars werd gezet, duwde ze verschillend weg). -1 als er geen is.
 */
export function nearestFreeCellAround(
  ctx: SimContext,
  fx: number,
  fy: number,
  fw: number,
  fh: number,
  x: number,
  y: number,
): number {
  const map = ctx.map;
  const mx = map.w << 7;
  const my = map.h << 7;
  for (let d = 1; d <= MAX_FREE_RING; d++) {
    let best = -1;
    let bestD = 0;
    let bestM = 0;
    let bestX = 0;
    scanRing(map, fx, fy, fw, fh, d, (cx, cy) => {
      const c = cy * map.w + cx;
      if (ctx.terrain.walk[c] !== 1) return false;
      const px = (cx << 8) + 128;
      const py = (cy << 8) + 128;
      const dx = px - x;
      const dy = py - y;
      const dd = dx * dx + dy * dy;
      const m = (px - mx) * (px - mx) + (py - my) * (py - my);
      const xr = (mx - x) * dy - (my - y) * dx;
      if (best < 0 || dd < bestD || (dd === bestD && (m < bestM || (m === bestM && xr > bestX)))) {
        best = c;
        bestD = dd;
        bestM = m;
        bestX = xr;
      }
      return false;
    });
    if (best >= 0) return best;
  }
  return -1;
}

/**
 * De k-de vrije cel rond een rechthoek: ring voor ring, en binnen een ring de cel het dichtst bij het midden van de map
 * eerst (dan rechts van de richting naar het midden, dan rij voor rij). Op een puntsymmetrische map krijgen beide
 * spelers zo elkaars spiegelbeeld (rij voor rij alleen is dat niet: de bovenste rij ligt voor de ene speler aan de kant
 * van het midden en voor de ander aan de rand).
 * -1 als er minder zijn.
 */
export function nthFreeCellAround(
  ctx: SimContext,
  fx: number,
  fy: number,
  fw: number,
  fh: number,
  k: number,
): number {
  const map = ctx.map;
  const mx2 = map.w - 1;
  const my2 = map.h - 1;
  // van het midden van de rechthoek naar het midden van de map, in halve cellen
  const rx = map.w - (2 * fx + fw);
  const ry = map.h - (2 * fy + fh);
  let left = k;
  const ring: number[] = [];
  const key: number[] = [];
  const side: number[] = [];
  for (let d = 1; d <= MAX_FREE_RING; d++) {
    ring.length = 0;
    key.length = 0;
    side.length = 0;
    scanRing(map, fx, fy, fw, fh, d, (cx, cy) => {
      if (ctx.terrain.walk[cy * map.w + cx] !== 1) return false;
      // afstand tot het midden van de map, in halve cellen (het midden kan op een celgrens liggen)
      const dx = 2 * cx - mx2;
      const dy = 2 * cy - my2;
      const v = dx * dx + dy * dy;
      // even ver: eerst rechts van de richting naar het midden (kruisproduct, gelijk onder de spiegel; fair-ronde)
      const x = rx * (2 * cy + 1 - (2 * fy + fh)) - ry * (2 * cx + 1 - (2 * fx + fw));
      let j = ring.length;
      ring.push(0);
      key.push(0);
      side.push(0);
      while (j > 0 && (key[j - 1]! > v || (key[j - 1] === v && side[j - 1]! < x))) {
        ring[j] = ring[j - 1]!;
        key[j] = key[j - 1]!;
        side[j] = side[j - 1]!;
        j--;
      }
      ring[j] = cy * map.w + cx;
      key[j] = v;
      side[j] = x;
      return false;
    });
    if (left < ring.length) return ring[left]!;
    left -= ring.length;
  }
  return -1;
}

/** Midden van cel-index c in eenheden. */
export function cellCenterOf(map: SimMap, c: number): { x: number; y: number } {
  const cy = idiv(c, map.w);
  return { x: ((c - cy * map.w) << 8) + 128, y: (cy << 8) + 128 };
}

/** Plaatst unit i op het midden van cel c. */
export function placeOnCell(ctx: SimContext, i: number, c: number): void {
  const p = cellCenterOf(ctx.map, c);
  ctx.world.x[i] = p.x;
  ctx.world.y[i] = p.y;
}
