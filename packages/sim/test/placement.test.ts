import { describe, expect, it } from 'vitest';
import { EVENT_TYPE } from '@crawlout/protocol';
import type { CommandEnvelope } from '@crawlout/protocol';
import { createSim } from '../src/index.js';
import type { Sim, SimMap } from '../src/index.js';
import { ORDER_GATHER } from '../src/ecs/world.js';
import {
  AS_CLAIM,
  AS_DEPOT,
  PLACE_BLOCKED,
  PLACE_CROWDED,
  PLACE_DEPOT,
  PLACE_FEATURE,
  PLACE_OK,
  PLACE_TERRAIN,
  POINT_CLAIM,
  POINT_NODE,
  RECT_CLAIM,
  RECT_DEPOT,
  placementInput,
  placementReason,
  placementReasonAt,
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
    expect(REAL_CONFIG.placement).toEqual({ clearance: 256, depotClearance: 256 });
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
      placement: { clearance: 256, depotClearance: 512 },
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
