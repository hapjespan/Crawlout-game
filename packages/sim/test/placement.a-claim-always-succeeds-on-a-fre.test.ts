// Split from placement.test.ts to stay under the 5,000-token file limit.
import { describe, it, expect } from 'vitest';
import { type Sim, type SimMap, createSim } from '../src/index.js';
import { createOpenMap, cellCenter, testPlayers } from '../src/testing.js';
import { REAL_CONFIG, BUILDER, cmd } from './helpers.js';
import {
  placementInput,
  placementReason,
  AS_CLAIM,
  PLACE_OK,
  claimSiteIn,
  AS_POINTS_NEAR,
  POINT_NODE,
  POINT_CLAIM,
  AS_NO_MARGIN,
  territoryMask,
  placementReasonAt,
  PLACE_TERRITORY,
  territoryOf,
} from '../src/systems/placement.js';
import { BT, HQ_CELL, baseSim, run } from './placement.helpers.js';

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
