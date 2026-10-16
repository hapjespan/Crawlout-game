import { describe, expect, it } from 'vitest';
import {
  PLACEMENT_REASON,
  placementIssue,
  type PlacementEnv,
  type PlacementCheck,
} from '../src/game/placementRules.js';

const env = (over: Partial<PlacementEnv> = {}): PlacementEnv => ({
  gridW: 10,
  gridH: 10,
  passable: new Uint8Array(100).fill(1),
  water: null,
  buildings: [],
  scrap: 100,
  scrapCost: 50,
  ...over,
});
const rect = { x0: 2, y0: 2, w: 3, h: 3 };

describe('placementIssue', () => {
  it('is null on free ground with enough scrap', () => {
    expect(placementIssue(env(), rect)).toBeNull();
  });

  it('names the footprint leaving the map', () => {
    expect(placementIssue(env(), { ...rect, x0: 8 })).toBe(PLACEMENT_REASON.outside);
    expect(placementIssue(env(), { ...rect, y0: -1 })).toBe(PLACEMENT_REASON.outside);
  });

  it('names an overlapping building, also when only one cell touches', () => {
    const b = { x0: 4, y0: 4, w: 2, h: 2 };
    expect(placementIssue(env({ buildings: [b] }), rect)).toBe(PLACEMENT_REASON.building);
    expect(placementIssue(env({ buildings: [{ ...b, x0: 5 }] }), rect)).toBeNull();
  });

  it('tells water from steep or unwalkable ground', () => {
    const passable = new Uint8Array(100).fill(1);
    passable[3 * 10 + 3] = 0;
    expect(placementIssue(env({ passable }), rect)).toBe(PLACEMENT_REASON.terrain);
    const data = new Uint8Array(100);
    data[3 * 10 + 3] = 1;
    expect(placementIssue(env({ passable, water: { w: 10, h: 10, data } }), rect)).toBe(
      PLACEMENT_REASON.water,
    );
    data[3 * 10 + 3] = 2; // shallow is walkable and not water
    expect(placementIssue(env({ water: { w: 10, h: 10, data } }), rect)).toBeNull();
  });

  it('names too little scrap last', () => {
    expect(placementIssue(env({ scrap: 10 }), rect)).toBe(PLACEMENT_REASON.scrap);
    expect(placementIssue(env({ scrap: 10, buildings: [{ ...rect }] }), rect)).toBe(
      PLACEMENT_REASON.building,
    );
  });

  it('takes extra checks, for rules the sim adds later', () => {
    const access: PlacementCheck = () => PLACEMENT_REASON.blocksAccess;
    expect(placementIssue(env(), rect, [access])).toBe(PLACEMENT_REASON.blocksAccess);
  });
});
