import { describe, expect, it } from 'vitest';
import { EVENT_TYPE } from '@crawlout/protocol';
import type { CommandEnvelope } from '@crawlout/protocol';
import { createSim } from '../src/index.js';
import type { Sim, SimMap } from '../src/index.js';
import { ORDER_GATHER } from '../src/ecs/world.js';
import {
  AS_CLAIM,
  AS_DEPOT,
  AS_NO_MARGIN,
  AS_POINTS_NEAR,
  claimSiteIn,
  PLACE_BLOCKED,
  PLACE_CROWDED,
  PLACE_DEPOT,
  PLACE_FEATURE,
  PLACE_OK,
  PLACE_TERRAIN,
  PLACE_TERRITORY,
  POINT_CLAIM,
  POINT_NODE,
  RECT_CLAIM,
  RECT_DEPOT,
  placementInput,
  placementReason,
  placementReasonAt,
  territoryMask,
  territoryOf,
} from '../src/systems/placement.js';
import { cellCenter, createOpenMap, testPlayers } from '../src/testing.js';
import { BUILDER, REAL_CONFIG, SCAV, bundle, cmd, typeByKey } from './helpers.js';

// The playtest bot of 16 October (data 0.18.0): after a house, workshop, lab, training facility and robot factory were
// placed close around the HQ, the scavengers at the node next to the HQ's south-west corner stood still for 500+ game
// seconds playing the walk animation, and scrap income stopped. Root cause: Build only checked that the footprint
// cells were free, so a building could cover a scrap node. Gatherers ordered to that node walked to the edge of the
// building (the flow field to a point on a building leads to its footprint), never came within interactRange of the
// node and kept "walking" on the spot. Fixed twice over: the placement rule (systems/placement.ts) refuses such a
// footprint and keeps a free ring around every building, so placing never cuts a route; and a gatherer whose node or
// depot it cannot reach (under a building, another piece of terrain) picks another one instead of freezing.

const BT = (key: string) => REAL_CONFIG.buildingTypes.find((b) => b.typeId === typeByKey(key))!;
const HQ_CELL = 40;
/** The node 4 cells west and 6 cells south of the HQ's south-west corner, as on Rustbelt (HQ 301,77; node 287,93). */
const NODE0 = { cx: HQ_CELL - 10 - 4, cy: HQ_CELL + 10 + 6 };
const NODE1 = { cx: 60, cy: 8 };

/** Open 128 x 128 map with the real footprints: player 0's HQ (21 x 21) centred on cell (40, 40). */
function baseSim(seed = 1, ai = false, config = REAL_CONFIG): Sim {
  const open = createOpenMap();
  const map: SimMap = {
    ...open,
    spawns: [cellCenter(HQ_CELL, HQ_CELL), cellCenter(103, 103)],
    scrapNodes: [
      { ...cellCenter(NODE0.cx, NODE0.cy), amount: 100000 },
      { ...cellCenter(NODE1.cx, NODE1.cy), amount: 100000 },
      { ...cellCenter(115, 80), amount: 100000 },
    ],
  };
  const players = testPlayers(2);
  return createSim({
    seed,
    players: ai ? [players[0]!, { ...players[1]!, ai: true }] : players,
    map,
    config,
  });
}

const own = (sim: Sim, p: number) =>
  sim
    .entityIds()
    .map((id) => sim.getUnit(id)!)
    .filter((u) => u.owner === p);
const nodeIds = (sim: Sim) =>
  sim
    .entityIds()
    .map((id) => sim.getUnit(id)!)
    .filter((u) => u.kind === 'scrapNode')
    .map((u) => u.id);
/** Footprint origin of building type `key` centred on cell (cx, cy), and the Build point. */
const centred = (key: string, cx: number, cy: number) => {
  const bt = BT(key);
  const c = cellCenter(cx, cy);
  return { fx: cx - (bt.footprintW >> 1), fy: cy - (bt.footprintH >> 1), x: c.x, y: c.y, bt };
};

/** A lab south of the HQ (two free cells from it) with the node 3 cells inside its top edge: out of reach from outside. */
const COVER = centred('lab', NODE0.cx - 2, NODE0.cy + 6);

function run(sim: Sim, frames: number, cmds: Map<number, CommandEnvelope[]> = new Map()): void {
  for (let n = 0; n < frames; n++) {
    sim.applyBundle(bundle(sim.frame, cmds.get(sim.frame) ?? []));
    sim.tick();
  }
}

/**
 * Gathers with the given scavengers for `seconds`, and reports the scrap delivered per minute and the longest time any
 * of them was "walking on the spot": moving, but within half a metre of where it was, for that many seconds.
 */
function gatherFor(sim: Sim, ids: number[], nodeId: number, seconds: number) {
  const scrap0 = sim.playerStatus(0).scrap;
  const perMinute: number[] = [];
  let lastScrap = scrap0;
  const since = new Map<number, { x: number; y: number; f: number }>();
  let frozen = 0;
  const f0 = sim.frame;
  const cmds = new Map([[f0, [cmd(f0, 0, 'Gather', { ids, nodeId })]]]);
  for (let n = 1; n <= seconds * 20; n++) {
    run(sim, 1, cmds);
    for (const id of ids) {
      const u = sim.getUnit(id)!;
      const h = since.get(id);
      if (!u.moving || !h || Math.hypot(u.x - h.x, u.y - h.y) > 128)
        since.set(id, { x: u.x, y: u.y, f: n });
      else frozen = Math.max(frozen, (n - h.f) / 20);
    }
    if (n % 1200 === 0) {
      const s = sim.playerStatus(0).scrap;
      perMinute.push(s - lastScrap);
      lastScrap = s;
    }
  }
  return { perMinute, frozen };
}

/** Labels of the 4-connected pieces of free walkable cells (terrain plus buildings), -1 for blocked cells. */
function freeLabels(sim: Sim): Int32Array {
  const { w, h } = sim.map;
  const walk = sim.terrain.walk;
  const label = new Int32Array(w * h).fill(-1);
  let next = 0;
  const q: number[] = [];
  for (let s = 0; s < w * h; s++) {
    if (walk[s] !== 1 || label[s] !== -1) continue;
    label[s] = next;
    q.length = 0;
    q.push(s);
    for (let k = 0; k < q.length; k++) {
      const c = q[k]!;
      const x = c % w;
      for (const d of [x + 1 < w ? 1 : 0, x > 0 ? -1 : 0, w, -w]) {
        const e = c + d;
        if (d === 0 || e < 0 || e >= w * h || walk[e] !== 1 || label[e] !== -1) continue;
        label[e] = next;
        q.push(e);
      }
    }
    next++;
  }
  return label;
}

/** Whether every two cells that are free in `after` are connected in `after` exactly when they were in `before`. */
function sameConnectivity(before: Int32Array, after: Int32Array): boolean {
  const fwd = new Map<number, number>();
  const back = new Map<number, number>();
  for (let c = 0; c < after.length; c++) {
    if (after[c] === -1) continue;
    const a = before[c]!;
    const b = after[c]!;
    if ((fwd.get(a) ?? b) !== b || (back.get(b) ?? a) !== a) return false;
    fwd.set(a, b);
    back.set(b, a);
  }
  return true;
}

describe('placement rule (data 0.18.0, systems/placement.ts)', () => {
  it('the data: a free ring of 1 m around every building, no wider aisle around a drop-off building (yet)', () => {
    expect(REAL_CONFIG.placement).toEqual({
      clearance: 256,
      depotClearance: 256,
      buildRange: 10 * 256,
      claimBuildRange: 5 * 256,
    });
  });

  it('reason codes: overlap, terrain in the margin, a building in the margin, the depot aisle, a node or claim point', () => {
    const passable = new Uint8Array(20 * 20).fill(1);
    passable[0] = 0; // rock in the corner
    const base = {
      mapW: 20,
      mapH: 20,
      passable,
      rects: [10, 10, 3, 3, 0, 2, 12, 2, 2, RECT_DEPOT, 6, 2, 1, 1, RECT_CLAIM],
      rectCount: 3,
      points: [
        cellCenter(16, 3).x,
        cellCenter(16, 3).y,
        POINT_NODE,
        ...[4, 18].map((c) => cellCenter(c, c)).flatMap((p) => [p.x, p.y, POINT_CLAIM]),
      ],
      pointCount: 3,
      clearance: 256,
      depotClearance: 512,
    };
    const at = (fx: number, fy: number, fw = 2, fh = 2, as = 0) =>
      placementReason(base, fx, fy, fw, fh, as);
    expect(at(19, 5)).toBe(PLACE_BLOCKED); // leaves the map
    expect(at(11, 11)).toBe(PLACE_BLOCKED); // overlaps the building at (10, 10)
    expect(at(1, 1)).toBe(PLACE_TERRAIN); // the rock at (0, 0) is in the margin
    expect(at(0, 5)).toBe(PLACE_TERRAIN); // the margin leaves the map
    expect(at(13, 10)).toBe(PLACE_CROWDED); // touches the building at (10, 10)
    expect(at(14, 11)).toBe(PLACE_OK); // one free cell between them
    expect(at(14, 11, 2, 2, AS_DEPOT)).toBe(PLACE_DEPOT); // a depot needs two
    expect(at(15, 11, 2, 2, AS_DEPOT)).toBe(PLACE_OK);
    expect(at(5, 12)).toBe(PLACE_DEPOT); // one free cell from the depot at (2, 12)
    expect(at(6, 12)).toBe(PLACE_OK);
    expect(at(14, 1)).toBe(PLACE_FEATURE); // the node at (16, 3) is in the margin
    expect(at(13, 1)).toBe(PLACE_OK);
    // a claim point at (18, 18): next to it only a claim building, on it nothing
    expect(at(16, 16)).toBe(PLACE_FEATURE);
    expect(at(16, 16, 2, 2, AS_CLAIM)).toBe(PLACE_OK);
    expect(at(17, 17, 2, 2, AS_CLAIM)).toBe(PLACE_FEATURE);
    // a claim building keeps the margin from a scrap node
    expect(at(14, 1, 2, 2, AS_CLAIM)).toBe(PLACE_FEATURE);
    // a claim building placed by Claim may touch another claim building (the post at (6, 2)), nothing else may
    expect(at(7, 2, 1, 1)).toBe(PLACE_CROWDED);
    expect(at(7, 2, 1, 1, AS_CLAIM)).toBe(PLACE_OK);
    expect(at(6, 3, 1, 1, AS_CLAIM)).toBe(PLACE_OK);
    expect(at(6, 2, 1, 1, AS_CLAIM)).toBe(PLACE_BLOCKED);
  });

  it('the playtest layout: a lab over the node next to the HQ is refused; abutting the HQ too; two cells away is fine', () => {
    // with an aisle of 2 m around drop-off buildings (sim.json depotClearanceM), to see that reason too
    const sim = baseSim(1, false, {
      ...REAL_CONFIG,
      placement: { ...REAL_CONFIG.placement, clearance: 256, depotClearance: 512 },
    });
    const builder = own(sim, 0).find((u) => u.typeId === BUILDER)!.id;
    sim.setScrap(0, 5000);
    // the lab (17 x 19) centred on the node itself, and next to the HQ's west side
    const bad = [
      { ...COVER, want: PLACE_FEATURE },
      { ...centred('lab', HQ_CELL - 10 - 9, HQ_CELL), want: PLACE_CROWDED }, // touching
      { ...centred('lab', HQ_CELL - 10 - 10, HQ_CELL), want: PLACE_DEPOT }, // one cell: inside the aisle
    ];
    for (const b of bad) {
      expect(placementReasonAt(sim, b.bt, b.fx, b.fy)).toBe(b.want);
      const f = sim.frame;
      const placed: number[] = [];
      sim.applyBundle(
        bundle(f, [cmd(f, 0, 'Build', { ids: [builder], typeId: b.bt.typeId, x: b.x, y: b.y })]),
      );
      sim.tick();
      for (let k = 0; k < sim.events.count; k++)
        if (sim.events.type[k] === EVENT_TYPE.buildingPlaced) placed.push(sim.events.a[k]!);
      expect(placed).toEqual([]);
      expect(sim.playerStatus(0).scrap).toBe(5000);
    }
    const good = centred('lab', HQ_CELL - 10 - 11, HQ_CELL - 6); // two free cells from the HQ, clear of the node
    expect(placementReasonAt(sim, good.bt, good.fx, good.fy)).toBe(PLACE_OK);
    const f = sim.frame;
    run(
      sim,
      1,
      new Map([
        [f, [cmd(f, 0, 'Build', { ids: [builder], typeId: good.bt.typeId, x: good.x, y: good.y })]],
      ]),
    );
    expect(sim.playerStatus(0).scrap).toBe(5000 - good.bt.scrapCost);
  });

  it('an HQ packed in as tightly as the rule allows: every placement keeps connectivity, the gatherers keep delivering', () => {
    const sim = baseSim();
    const hqRect = { x0: HQ_CELL - 10, y0: HQ_CELL - 10, x1: HQ_CELL + 11, y1: HQ_CELL + 11 };
    // the playtest's buildings and more houses, each at the legal spot nearest to the HQ (ring by ring, row by row)
    const keys = [
      'woning',
      'werkplaats',
      'lab',
      'trainingsfaciliteit',
      'robotfabriek',
      'woning',
      'woning',
      'woning',
      'woning',
      'woning',
    ];
    let placed = 0;
    for (const key of keys) {
      const bt = BT(key);
      let done = false;
      for (let d = 0; d < 30 && !done; d++) {
        for (let fy = hqRect.y0 - d - bt.footprintH; fy <= hqRect.y1 + d && !done; fy++) {
          for (let fx = hqRect.x0 - d - bt.footprintW; fx <= hqRect.x1 + d && !done; fx++) {
            if (placementReasonAt(sim, bt, fx, fy) !== PLACE_OK) continue;
            const before = freeLabels(sim);
            expect(sim.spawnBuilding(bt.typeId, 0, fx, fy)).not.toBe(0);
            expect(sameConnectivity(before, freeLabels(sim))).toBe(true);
            placed++;
            done = true;
          }
        }
      }
    }
    expect(placed).toBe(keys.length);
    // the node next to the HQ is still free and reachable from the HQ's ring
    const labels = freeLabels(sim);
    const ring = labels[(hqRect.y1 + 0) * sim.map.w + hqRect.x0 - 1]!;
    expect(ring).toBeGreaterThanOrEqual(0);
    expect(labels[(NODE0.cy + 1) * sim.map.w + NODE0.cx]).toBe(ring);
    const scavs = own(sim, 0)
      .filter((u) => u.typeId === SCAV)
      .map((u) => u.id);
    const r = gatherFor(sim, scavs, nodeIds(sim)[0]!, 360);
    expect(r.frozen).toBeLessThan(10);
    expect(Math.min(...r.perMinute)).toBeGreaterThan(0);
  });

  it('every legal placement keeps connectivity, on a map with rocks and in random order (the ring argument)', () => {
    const open = createOpenMap(96, 96);
    const passable = new Uint8Array(open.passable);
    let seed = 12345;
    const rnd = (n: number): number => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return (seed >>> 8) % n;
    };
    for (let k = 0; k < 60; k++) {
      const x = 2 + rnd(90);
      const y = 2 + rnd(90);
      for (let dy = 0; dy < 1 + rnd(4); dy++)
        for (let dx = 0; dx < 1 + rnd(6); dx++) passable[(y + dy) * 96 + x + dx] = 0;
    }
    // room for the two HQs (21 x 21) on the spawns
    for (let y = 0; y < 96; y++)
      for (let x = 0; x < 96; x++)
        if ((x < 26 && y < 26) || (x > 69 && y > 69))
          passable[y * 96 + x] = open.passable[y * 96 + x]!;
    const sim = createSim({
      seed: 1,
      players: testPlayers(2),
      map: { ...open, passable, spawns: [cellCenter(13, 13), cellCenter(82, 82)], scrapNodes: [] },
      config: {
        ...REAL_CONFIG,
        buildingTypes: REAL_CONFIG.buildingTypes.map((t) =>
          t.footprintW > 5 ? { ...t, footprintW: 3 + 2 * (t.typeId % 3), footprintH: 3 } : t,
        ),
      },
    });
    const types = sim.config.buildingTypes.filter((t) => t.footprintW <= 7);
    let placed = 0;
    for (let tries = 0; tries < 4000 && placed < 120; tries++) {
      const bt = types[rnd(types.length)]!;
      const fx = rnd(96);
      const fy = rnd(96);
      if (placementReasonAt(sim, bt, fx, fy) !== PLACE_OK) continue;
      const before = freeLabels(sim);
      expect(sim.spawnBuilding(bt.typeId, 0, fx, fy)).not.toBe(0);
      expect(sameConnectivity(before, freeLabels(sim))).toBe(true);
      placed++;
    }
    expect(placed).toBeGreaterThan(60);
  });

  it('a node under a building (a layout from before the rule): its gatherers go to a node they can reach', () => {
    const sim = baseSim();
    // bypasses the rule on purpose: Sim.spawnBuilding only checks free cells
    const lab = COVER;
    expect(sim.spawnBuilding(lab.bt.typeId, 0, lab.fx, lab.fy)).not.toBe(0);
    const scavs = own(sim, 0)
      .filter((u) => u.typeId === SCAV)
      .map((u) => u.id);
    const r = gatherFor(sim, scavs, nodeIds(sim)[0]!, 240);
    expect(r.frozen).toBeLessThan(10);
    // they gather at the other node, a longer walk, but scrap keeps coming in
    expect(r.perMinute.slice(1).every((s) => s > 0)).toBe(true);
    for (const id of scavs) {
      const u = sim.getUnit(id)!;
      expect(u.order).toBe(ORDER_GATHER);
      expect(u.orderTarget).toBe(nodeIds(sim)[1]);
    }
    // and placementInput sees the covered node as a feature: nothing more can be built there
    expect(placementInput(sim).pointCount).toBe(3 + sim.claimPoints.length);
  });
});

describe('new settlers gather on their own (data 0.18.0, sim.json autoGatherRadiusM)', () => {
  /** Frees two beds of player p (two of its scavengers go) and runs until a settler arrives; its unit view. */
  function nextSettler(sim: Sim, p: number) {
    for (const u of own(sim, p)
      .filter((v) => v.typeId === SCAV)
      .slice(0, 2))
      sim.destroyEntity(u.id);
    for (let n = 0; n < 2000; n++) {
      run(sim, 1);
      for (let k = 0; k < sim.events.count; k++) {
        if (sim.events.type[k] !== EVENT_TYPE.spawn) continue;
        const u = sim.getUnit(sim.events.a[k]!)!;
        if (u.owner === p && u.typeId === SCAV) return u;
      }
    }
    throw new Error('no settler');
  }

  it('a human player: the new scavenger walks to the nearest reachable node within the radius', () => {
    expect(REAL_CONFIG.autoGatherRadius).toBe(40 * 256);
    const sim = baseSim();
    const u = nextSettler(sim, 0);
    expect(u.order).toBe(ORDER_GATHER);
    expect(u.orderTarget).toBe(nodeIds(sim)[0]);
    run(sim, 20);
    expect(sim.getUnit(u.id)!.moving).toBe(true);
  });

  it('not for the scripted AI (it spreads its settlers over the nodes itself), not with radius 0, not beyond it', () => {
    expect(nextSettler(baseSim(1, true), 1).order).toBe(0);
    const config = (r: number) => ({ ...REAL_CONFIG, autoGatherRadius: r });
    const withConfig = (r: number): Sim => {
      const sim = baseSim();
      return createSim({
        seed: 1,
        players: sim.players,
        map: sim.map,
        config: config(r),
      });
    };
    expect(nextSettler(withConfig(0), 0).order).toBe(0);
    expect(nextSettler(withConfig(2 * 256), 0).order).toBe(0);
    expect(nextSettler(withConfig(40 * 256), 0).order).toBe(ORDER_GATHER);
  });
});

// Martien, 16 October: "ik kan palen niet claimen als ze te dicht bij scrap zitten". Claim looked for a spot next to
// the point with the full placement rule, so scrap nodes near the point (in the margin of every free cell) could leave
// no spot and the claim silently failed. Since data 0.20.0 claimSiteIn falls back to a rule where nodes may lie next to
// the footprint, then to no margin at all: a claim never fails on a point with a free walkable cell next to it.
describe('a claim always succeeds on a free point (data 0.20.0, placement.ts claimSiteIn)', () => {
  const PT = { cx: 64, cy: 64 };
  const paal = BT('claimpaal');

  /** Open 128 x 128 map, a claim point at (64, 64) and a scrap node on every cell with odd x + y within 9 cells of it. */
  function crowdedSim(): Sim {
    const open = createOpenMap();
    const scrapNodes: SimMap['scrapNodes'][number][] = [];
    for (let y = PT.cy - 9; y <= PT.cy + 9; y++)
      for (let x = PT.cx - 9; x <= PT.cx + 9; x++)
        if (((x + y) & 1) === 1) scrapNodes.push({ ...cellCenter(x, y), amount: 1000 });
    const map: SimMap = {
      ...open,
      spawns: [cellCenter(20, 20), cellCenter(107, 107)],
      scrapNodes,
      claimPoints: [{ ...cellCenter(PT.cx, PT.cy), kind: 1 }],
    };
    return createSim({ seed: 3, players: testPlayers(2), map, config: REAL_CONFIG });
  }
  const claimPointId = (sim: Sim): number =>
    sim
      .entityIds()
      .map((id) => sim.getUnit(id)!)
      .find((u) => u.kind === 'claimPoint')!.id;

  it('a node one cell from the point and one in the margin of every free cell: the post is still placed and claims', () => {
    const sim = crowdedSim();
    const inp = placementInput(sim);
    const r = REAL_CONFIG.claimRadius;
    const p = cellCenter(PT.cx, PT.cy);
    // the full rule finds nothing within the radius (the bug)
    for (let fy = PT.cy - 7; fy <= PT.cy + 7; fy++)
      for (let fx = PT.cx - 7; fx <= PT.cx + 7; fx++)
        expect(placementReason(inp, fx, fy, 1, 1, AS_CLAIM)).not.toBe(PLACE_OK);
    const site = claimSiteIn(inp, p.x, p.y, 1, 1, 0, r)!;
    expect(site.as).toBe(AS_CLAIM | AS_POINTS_NEAR);
    expect(Math.max(Math.abs(site.fx - PT.cx), Math.abs(site.fy - PT.cy))).toBe(1);

    sim.setScrap(0, 1000);
    const builder = sim.spawnUnit({ typeId: BUILDER, owner: 0, x: p.x - 14 * 256, y: p.y });
    const pt = claimPointId(sim);
    const f0 = sim.frame;
    run(sim, 1, new Map([[f0, [cmd(f0, 0, 'Claim', { ids: [builder], pointId: pt })]]]));
    const postId = sim
      .entityIds()
      .find((id) => sim.getUnit(id)!.typeId === paal.typeId && sim.getUnit(id)!.owner === 0);
    expect(postId).toBeDefined();
    const post = sim.getUnit(postId!)!;
    expect({ x: post.x, y: post.y }).toEqual({ x: site.x, y: site.y });
    expect(sim.playerStatus(0).scrap).toBe(1000 - paal.scrapCost);
    run(sim, paal.buildTicks + 600);
    expect(sim.getUnit(postId!)!.buildState).toBe(2);
    expect(sim.getUnit(pt)!.owner).toBe(0);
  });

  it('the strict spot first; with rock around, the last resort: a free walkable cell next to the point, never on a node', () => {
    const W = 32;
    const inp = (pass: Uint8Array, points: number[] = []) => ({
      mapW: W,
      mapH: W,
      passable: pass,
      rects: [],
      rectCount: 0,
      points,
      pointCount: points.length / 3,
      clearance: REAL_CONFIG.placement.clearance,
      depotClearance: REAL_CONFIG.placement.depotClearance,
    });
    const p = cellCenter(16, 16);
    const r = REAL_CONFIG.claimRadius;
    // open ground: the full rule, a cell next to the point
    const open = claimSiteIn(inp(new Uint8Array(W * W).fill(1)), p.x, p.y, 1, 1, 0, r)!;
    expect(open.as).toBe(AS_CLAIM);
    expect(Math.max(Math.abs(open.fx - 16), Math.abs(open.fy - 16))).toBe(1);
    // rock everywhere within 8 cells except the point and the two cells east of it, with a node on the farther one
    const rock = new Uint8Array(W * W).fill(1);
    for (let y = 8; y <= 24; y++) for (let x = 8; x <= 24; x++) rock[y * W + x] = 0;
    for (const x of [16, 17, 18]) rock[16 * W + x] = 1;
    const node = cellCenter(18, 16);
    const points = [node.x, node.y, POINT_NODE, p.x, p.y, POINT_CLAIM];
    const last = claimSiteIn(inp(rock, points), p.x, p.y, 1, 1, 0, r)!;
    expect(last).toMatchObject({ fx: 17, fy: 16, as: AS_CLAIM | AS_NO_MARGIN });
    // nothing walkable next to the point: no spot (the only way Claim fails on a point that is not yours)
    rock[16 * W + 17] = 0;
    rock[16 * W + 18] = 0;
    expect(claimSiteIn(inp(rock, points), p.x, p.y, 1, 1, 0, r)).toBeNull();
  });
});

// Martien, 16 October: "je kan maar in een straal van 10 aansluitende tegels bouwen in je gebied, tenzij je tegen een
// blokkade in het terrein aan loopt. dit geldt ook voor een beacon die je claimt met een toren, niet de held. die toren
// is dan een startpunt vanuit waar je door kan bouwen in een straal van 5 blokken." A tile is the sim's 1 m cell.
describe('territory (data 0.20.0, placement buildRangeM 10, claimBuildRangeM 5)', () => {
  const W = 128;
  const at = (mask: Uint8Array, x: number, y: number) => mask[y * W + x];

  it('ten steps over walkable ground from a building, five from a claim post; a cliff stops it', () => {
    const open = new Uint8Array(W * W).fill(1);
    // a building 21 x 21 at (30, 30) and a claim post 1 x 1 at (100, 64)
    const src = [30, 30, 21, 21, 10, 100, 64, 1, 1, 5];
    const m = territoryMask(W, W, open, src, 2);
    expect([at(m, 60, 40), at(m, 61, 40), at(m, 60, 60), at(m, 61, 61)]).toEqual([1, 0, 1, 0]);
    expect([at(m, 105, 64), at(m, 106, 64), at(m, 95, 69), at(m, 94, 69)]).toEqual([1, 0, 1, 0]);
    // a wall of rock at x = 55 (all rows): nothing behind it, even within ten steps
    const cliff = new Uint8Array(open);
    for (let y = 0; y < W; y++) cliff[y * W + 55] = 0;
    const c = territoryMask(W, W, cliff, src, 2);
    expect([at(c, 54, 40), at(c, 55, 40), at(c, 56, 40)]).toEqual([1, 0, 0]);
    // a diagonal wall one cell thick is not crossed corner to corner
    const diag = new Uint8Array(open);
    for (let k = 0; k < W; k++) diag[k * W + (W - 1 - k)] = 0; // x + y = 127
    const d = territoryMask(W, W, diag, [60, 60, 1, 1, 10], 1);
    expect([at(d, 63, 63), at(d, 64, 64)]).toEqual([1, 0]);
  });

  it('the rule: a footprint must touch the territory; a cliff in between refuses it; a normal base can grow', () => {
    const open = createOpenMap();
    const passable = new Uint8Array(open.passable);
    for (let y = 0; y < 128; y++) passable[y * 128 + 55] = 0; // rock east of the HQ (footprint 30..50)
    const sim = createSim({
      seed: 1,
      players: testPlayers(2),
      map: { ...open, passable, spawns: [cellCenter(HQ_CELL, HQ_CELL), cellCenter(103, 103)] },
      config: REAL_CONFIG,
    });
    const woning = BT('woning');
    const werkplaats = BT('werkplaats');
    // behind the rock: within ten cells of the HQ as the crow flies, but out of the territory
    expect(placementReasonAt(sim, woning, 57, 34, 0, 0)).toBe(PLACE_TERRITORY);
    expect(placementReasonAt(sim, woning, 57, 34)).toBe(PLACE_OK); // without a player: no territory rule
    // far away on open ground: out of the territory
    expect(placementReasonAt(sim, woning, 30, 80, 0, 0)).toBe(PLACE_TERRITORY);
    // next to the HQ: a house (13 x 19) and a workshop (21 x 19) fit, on the west and the south side
    const fits = (bt: typeof woning, fx: number, fy: number) =>
      placementReasonAt(sim, bt, fx, fy, 0, 0);
    expect(fits(woning, 30 - 2 - 13, 32)).toBe(PLACE_OK);
    expect(fits(werkplaats, 30, 51 + 2)).toBe(PLACE_OK);
    // a workshop placed there makes the territory grow: a house beyond it, out of reach of the HQ, now fits
    expect(fits(woning, 30, 53 + 19 + 2)).toBe(PLACE_TERRITORY);
    sim.spawnBuilding(werkplaats.typeId, 0, 30, 53, false);
    expect(fits(woning, 30, 53 + 19 + 2)).toBe(PLACE_OK);
  });

  it('a finished claim post adds five cells around it; a hero claim (no post) adds nothing', () => {
    const sim = baseSim(1, false);
    const paal = BT('claimpaal');
    const before = territoryOf(sim, 0)!;
    expect(at(before, 100, 64)).toBe(0);
    sim.spawnBuilding(paal.typeId, 0, 100, 64, false);
    expect(territoryOf(sim, 0)).toEqual(before); // a post under construction is no start point yet
    sim.spawnBuilding(paal.typeId, 0, 100, 90, true);
    const t = territoryOf(sim, 0)!;
    expect([at(t, 105, 90), at(t, 106, 90), at(t, 100, 85), at(t, 100, 84)]).toEqual([1, 0, 1, 0]);
    // a house (13 x 19) may touch the cells around the post, not stand beyond them
    const woning = BT('woning');
    expect(placementReasonAt(sim, woning, 95, 70, 0, 0)).toBe(PLACE_OK);
    expect(placementReasonAt(sim, woning, 107, 70, 0, 0)).toBe(PLACE_TERRITORY);
    // a claim point held by the hero (a beacon, no building) is no source
    const w = (
      sim as unknown as {
        world: { owner: Uint8Array; beacon: Uint8Array; resolve(id: number): number };
      }
    ).world;
    for (const id of sim.entityIds().filter((e) => sim.getUnit(e)!.kind === 'claimPoint')) {
      w.owner[w.resolve(id)] = 0;
      w.beacon[w.resolve(id)] = 1;
    }
    expect(territoryOf(sim, 0)).toEqual(t);
  });
});
