import { describe, expect, it } from 'vitest';
import { POINT_CLAIM, POINT_NODE, type PlacementInput } from '@crawlout/sim/placement';
import {
  CLAIM_REASON,
  claimPlacement,
  placementCommand,
  type ClaimPlacementArgs,
} from '../src/game/claimPlacement.js';

// Martien, 16 October: "ik kan palen niet claimen als ze te dicht bij scrap zitten". The Claimpaal from the build menu
// went out as a Build at the cursor, on or next to the claim point, and the placement rule refused it ("Staat op een
// scrapbron of claimpunt"). Now a claim building near a claim point is a Claim: the preview snaps to the sim's spot.

const W = 64;
const cell = (cx: number, cy: number) => ({ x: (cx << 8) + 128, y: (cy << 8) + 128 });
const PT = cell(32, 32);
const NODE = cell(33, 32); // one cell from the point
const R = 6 * 256;

function args(patch: Partial<ClaimPlacementArgs> = {}): ClaimPlacementArgs {
  const input: PlacementInput = {
    mapW: W,
    mapH: W,
    passable: new Uint8Array(W * W).fill(1),
    rects: [],
    rectCount: 0,
    points: [NODE.x, NODE.y, POINT_NODE, PT.x, PT.y, POINT_CLAIM],
    pointCount: 2,
    clearance: 256,
    depotClearance: 256,
  };
  return {
    input,
    cursor: PT,
    footprint: { w: 1, h: 1 },
    as: 0,
    claimRadius: R,
    points: [{ id: 77, x: PT.x, y: PT.y, owner: null }],
    ownSites: [],
    me: 0,
    scrap: 500,
    scrapCost: 50,
    ...patch,
  };
}

describe('build menu: a claim post at a claim point is a Claim (data 0.20.0)', () => {
  it('hovering the point with a node one cell away: green, snapped next to the point, a click sends Claim', () => {
    const c = claimPlacement(args())!;
    expect(c).toMatchObject({ pointId: 77, valid: true, reason: null });
    const fx = c.x >> 8;
    const fy = c.y >> 8;
    expect(Math.max(Math.abs(fx - 32), Math.abs(fy - 32))).toBeGreaterThanOrEqual(1);
    expect(Math.hypot(c.x - PT.x, c.y - PT.y)).toBeLessThanOrEqual(R);
    expect({ fx, fy }).not.toEqual({ fx: 33, fy: 32 }); // never on the node
    expect(placementCommand({ ...c, claimPointId: c.pointId }, 1234, [5, 6])).toEqual({
      type: 'Claim',
      payload: { ids: [5, 6], pointId: 77 },
    });
    // elsewhere the same option is a plain Build at the spot
    expect(claimPlacement(args({ cursor: cell(50, 50) }))).toBeNull();
    expect(placementCommand({ x: 100.4, y: 200.6 }, 1234, [5])).toEqual({
      type: 'Build',
      payload: { ids: [5], typeId: 1234, x: 100, y: 201 },
    });
  });

  it('says why only when it cannot: already yours, no scrap; an enemy point is valid with a note', () => {
    const own = claimPlacement(args({ points: [{ id: 77, x: PT.x, y: PT.y, owner: 0 }] }))!;
    expect(own).toMatchObject({ valid: false, reason: CLAIM_REASON.own });
    expect(claimPlacement(args({ scrap: 10 }))).toMatchObject({
      valid: false,
      reason: CLAIM_REASON.scrap,
    });
    const enemy = claimPlacement(args({ points: [{ id: 77, x: PT.x, y: PT.y, owner: 1 }] }))!;
    expect(enemy).toMatchObject({ valid: true, reason: CLAIM_REASON.enemy });
  });

  it('an own claim post under construction at the point: the builders help there', () => {
    const site = { ...cell(31, 32), fx: 31, fy: 32, fw: 1, fh: 1 };
    expect(claimPlacement(args({ ownSites: [site] }))).toMatchObject({
      x: site.x,
      y: site.y,
      valid: true,
    });
  });
});
