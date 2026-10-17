import { MAX_ENTITIES } from '@crawlout/protocol';
import type { SimConfig, SimMap } from './config.js';
import type { World } from './ecs/world.js';
import { C } from './ecs/world.js';
import { idiv } from './math/int.js';
import { isqrt } from './math/sqrt.js';

// Fog of war (phase 2, data 0.21.0): classic fog per player on a vision grid of cells of config.visionCell units
// (sim.json vision.cellM, 2 m by default). A cell is unexplored, explored (seen before) or visible (now).
//
// Every own unit (not a corpse) and every own building, sites included, reveals a disc of its sight radius around the
// vision cell of its centre: units SimUnitType.sight, the hero SimHero.sight, a building SimBuildingType.sight plus half
// its larger footprint side. A cell is visible to a player while at least one of his discs covers it (count > 0).
// Plain radius, no line of sight: the sim knows only passability, not height, so a cliff and a lake would block alike,
// and a shadow cast per stamp would make every stamp several times dearer (see packages/sim/CHANGELOG.md 0.17.0).
//
// State and derived data:
//  - explored: per player a bitset over the grid, state (serialize and hash, state.ts). A cell becomes explored the
//    moment it becomes visible and stays so.
//  - count, the stamp per entity, World.visTo: derived. update() runs as the last system of a tick (after cleanup, before
//    the hash), so after every tick the stamps match the end-of-tick world and rebuild() after deserialize gives the same
//    counts. Everything in the next tick (commands, AI, orders, combat) reads that end-of-tick visibility.
//  - World.spotted (state): per entity the players that ever saw it (the ghosts of a reloaded client, AI memory later).
//
// Incremental: a disc is only re-stamped when its centre changes vision cell, its radius or its owner changes, or the
// entity is gone. Integers only, iteration on ascending entity index, no order-dependent result (counts commute).

export const NO_CELL = -1;

/** Fog state of one cell for one player (also FOG_* in @crawlout/protocol). */
export const FOG_UNEXPLORED = 0;
export const FOG_EXPLORED = 1;
export const FOG_VISIBLE = 2;

export class Vision {
  /** log2 of the vision cell in units (8 = 1 m, 9 = 2 m, 10 = 4 m). */
  readonly shift: number;
  /** Cells of 1 m per vision cell, as a shift (shift - 8). */
  readonly cellShift: number;
  readonly gw: number;
  readonly gh: number;
  readonly cells: number;
  /** Bytes of one player's explored bitset. */
  readonly bytes: number;
  readonly players: number;
  /** State: explored bitset per player (player p at p * bytes), bit k of byte c >> 3 is cell c (c & 7 = k). */
  readonly explored: Uint8Array;
  /** Derived: number of discs of player p covering cell c at p * cells + c. */
  readonly count: Uint16Array;
  /** Derived: stamped vision cell per entity index (NO_CELL = none), its radius in cells and its owner. */
  readonly stCell = new Int32Array(MAX_ENTITIES).fill(NO_CELL);
  readonly stR = new Uint8Array(MAX_ENTITIES);
  readonly stOwner = new Uint8Array(MAX_ENTITIES);
  /** Radius in vision cells per typeId (units, heroes, buildings with their footprint); 0 elsewhere. */
  private readonly radiusOfType = new Uint8Array(0x10000);
  /** Whether a typeId gives sight at all (radius 0 still reveals its own cell). */
  private readonly seesOfType = new Uint8Array(0x10000);
  /** Half-widths of a disc per radius: half[r][dy] = largest dx with dx^2 + dy^2 <= r^2 + r. */
  private readonly half: Int32Array[] = [];

  constructor(map: SimMap, config: SimConfig, players: number) {
    const cell = config.visionCell;
    this.shift = cell === 256 ? 8 : cell === 512 ? 9 : 10;
    this.cellShift = this.shift - 8;
    const k = this.cellShift;
    this.gw = (map.w + (1 << k) - 1) >> k;
    this.gh = (map.h + (1 << k) - 1) >> k;
    this.cells = this.gw * this.gh;
    this.bytes = (this.cells + 7) >> 3;
    this.players = players;
    this.explored = new Uint8Array(players * this.bytes);
    this.count = new Uint16Array(players * this.cells);
    const toCells = (u: number): number => {
      const r = idiv(u + (cell >> 1), cell);
      return r > 255 ? 255 : r;
    };
    for (const u of config.unitTypes) {
      this.radiusOfType[u.typeId] = toCells(u.sight);
      this.seesOfType[u.typeId] = 1;
    }
    for (const h of config.heroes) {
      this.radiusOfType[h.typeId] = toCells(h.sight);
      this.seesOfType[h.typeId] = 1;
    }
    for (const b of config.buildingTypes) {
      const side = b.footprintW > b.footprintH ? b.footprintW : b.footprintH;
      this.radiusOfType[b.typeId] = toCells(b.sight + side * 128);
      this.seesOfType[b.typeId] = 1;
    }
  }

  /** Vision cell of a point in units (clamped to the grid). */
  cellOf(x: number, y: number): number {
    let cx = x >> this.shift;
    let cy = y >> this.shift;
    if (cx < 0) cx = 0;
    else if (cx >= this.gw) cx = this.gw - 1;
    if (cy < 0) cy = 0;
    else if (cy >= this.gh) cy = this.gh - 1;
    return cy * this.gw + cx;
  }

  /** Whether player p sees vision cell c now. */
  visibleCell(p: number, c: number): boolean {
    return this.count[p * this.cells + c]! > 0;
  }

  /** Whether player p has ever seen vision cell c. */
  exploredCell(p: number, c: number): boolean {
    return ((this.explored[p * this.bytes + (c >> 3)]! >> (c & 7)) & 1) !== 0;
  }

  /** Whether player p sees the point (x, y) in units now. */
  visibleAt(p: number, x: number, y: number): boolean {
    return this.visibleCell(p, this.cellOf(x, y));
  }

  /** Whether player p sees any vision cell of the footprint (fx, fy, fw, fh) in cells of 1 m. */
  visibleRect(p: number, fx: number, fy: number, fw: number, fh: number): boolean {
    const k = this.cellShift;
    let x0 = fx >> k;
    let y0 = fy >> k;
    let x1 = (fx + fw - 1) >> k;
    let y1 = (fy + fh - 1) >> k;
    if (x0 < 0) x0 = 0;
    if (y0 < 0) y0 = 0;
    if (x1 >= this.gw) x1 = this.gw - 1;
    if (y1 >= this.gh) y1 = this.gh - 1;
    const base = p * this.cells;
    for (let y = y0; y <= y1; y++) {
      const row = base + y * this.gw;
      for (let x = x0; x <= x1; x++) if (this.count[row + x]! > 0) return true;
    }
    return false;
  }

  /** Fog state of cell c for player p: FOG_VISIBLE, FOG_EXPLORED or FOG_UNEXPLORED. */
  fogAt(p: number, c: number): number {
    if (this.visibleCell(p, c)) return FOG_VISIBLE;
    return this.exploredCell(p, c) ? FOG_EXPLORED : FOG_UNEXPLORED;
  }

  /**
   * The end-of-tick pass (the last system before the hash; also after start() and the test helpers): re-stamp every
   * disc whose centre cell, radius or owner changed or whose entity is gone, then refresh World.visTo and World.spotted.
   */
  update(w: World): void {
    const players = this.players;
    for (let i = 0; i < w.highWater; i++) {
      let want = NO_CELL;
      let r = 0;
      let o = 0;
      if (w.alive[i] === 1) {
        const m = w.mask[i]!;
        const t = w.typeId[i]!;
        if ((m & C.corpse) === 0 && (m & (C.unit | C.building)) !== 0 && this.seesOfType[t] === 1) {
          o = w.owner[i]!;
          if (o < players) {
            want = this.cellOf(w.x[i]!, w.y[i]!);
            r = this.radiusOfType[t]!;
          }
        }
      }
      const have = this.stCell[i]!;
      if (have === want && (want === NO_CELL || (this.stR[i] === r && this.stOwner[i] === o)))
        continue;
      if (have !== NO_CELL) this.stamp(this.stOwner[i]!, have, this.stR[i]!, -1);
      if (want !== NO_CELL) this.stamp(o, want, r, 1);
      this.stCell[i] = want;
      this.stR[i] = r;
      this.stOwner[i] = o;
    }
    this.refreshVisTo(w);
  }

  /** After deserialize: derived counts and stamps from scratch (explored is state and already loaded). */
  rebuild(w: World): void {
    this.count.fill(0);
    this.stCell.fill(NO_CELL);
    this.stR.fill(0);
    this.stOwner.fill(0);
    this.update(w);
  }

  /** World.visTo for every live entity: its owner always, plus every player who sees its cell or footprint now. */
  private refreshVisTo(w: World): void {
    const players = this.players;
    for (let i = 0; i < w.highWater; i++) {
      if (w.alive[i] !== 1) {
        w.visTo[i] = 0;
        continue;
      }
      const o = w.owner[i]!;
      let bits = o < players ? 1 << o : 0;
      const building = (w.mask[i]! & C.building) !== 0;
      const c = building ? NO_CELL : this.cellOf(w.x[i]!, w.y[i]!);
      for (let p = 0; p < players; p++) {
        if (p === o) continue;
        const seen = building
          ? this.visibleRect(p, w.fx[i]!, w.fy[i]!, w.fw[i]!, w.fh[i]!)
          : this.count[p * this.cells + c]! > 0;
        if (seen) bits |= 1 << p;
      }
      w.visTo[i] = bits;
      w.spotted[i] = w.spotted[i]! | bits;
    }
  }

  /** Adds d (+1 or -1) to every cell of player p's disc of radius r around cell c; explored on 0 -> 1. */
  private stamp(p: number, c: number, r: number, d: number): void {
    const gw = this.gw;
    const cy = idiv(c, gw);
    const cx = c - cy * gw;
    const hw = this.halfWidths(r);
    const base = p * this.cells;
    const ex = p * this.bytes;
    const cnt = this.count;
    for (let dy = -r; dy <= r; dy++) {
      const y = cy + dy;
      if (y < 0 || y >= this.gh) continue;
      const h = hw[dy < 0 ? -dy : dy]!;
      const x0 = cx - h < 0 ? 0 : cx - h;
      const x1 = cx + h >= gw ? gw - 1 : cx + h;
      const row = y * gw;
      if (d > 0) {
        for (let x = x0; x <= x1; x++) {
          const g = row + x;
          const n = cnt[base + g]!;
          cnt[base + g] = n + 1;
          if (n === 0)
            this.explored[ex + (g >> 3)] = this.explored[ex + (g >> 3)]! | (1 << (g & 7));
        }
      } else for (let x = x0; x <= x1; x++) cnt[base + row + x] = cnt[base + row + x]! - 1;
    }
  }

  private halfWidths(r: number): Int32Array {
    let hw = this.half[r];
    if (hw === undefined) {
      hw = new Int32Array(r + 1);
      for (let dy = 0; dy <= r; dy++) hw[dy] = isqrt(r * r + r - dy * dy);
      this.half[r] = hw;
    }
    return hw;
  }
}
