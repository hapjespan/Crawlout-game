import type { ClaimPointStatus } from '@crawlout/protocol';
import { describe, expect, it } from 'vitest';
import { ARC_MODE } from '../decals/decalLayer.js';
import { NEUTRAL_TEAM } from '../palette.js';
import { claimRingArc, claimRingArcs } from './claimRing.js';

const base: ClaimPointStatus = {
  pointId: 7,
  owner: 255,
  beacon: false,
  activity: 'none',
  by: 255,
  progressPermille: 0,
  frozen: false,
};

describe('claimRingArc', () => {
  it('draws no arc for an idle point', () => {
    expect(claimRingArc(base)).toBeNull();
    expect(claimRingArc({ ...base, frozen: true })).toBeNull();
  });

  it('fills a hero claim in the claimer colour', () => {
    const arc = claimRingArc({ ...base, activity: 'hero', by: 1, progressPermille: 250 });
    expect(arc).toEqual({ fraction: 0.25, color: 1, mode: ARC_MODE.solid });
  });

  it('draws nothing for a hero claim at zero', () => {
    expect(claimRingArc({ ...base, activity: 'hero', by: 0, progressPermille: 0 })).toBeNull();
  });

  it('pulses a contest in the attacker colour', () => {
    const arc = claimRingArc({
      ...base,
      owner: 0,
      beacon: true,
      activity: 'contest',
      by: 1,
      progressPermille: 500,
    });
    expect(arc).toEqual({ fraction: 0.5, color: 1, mode: ARC_MODE.pulse });
  });

  it('stripes a frozen hero claim or contest, even at zero', () => {
    expect(
      claimRingArc({ ...base, activity: 'hero', by: 0, progressPermille: 400, frozen: true })?.mode,
    ).toBe(ARC_MODE.frozen);
    expect(
      claimRingArc({ ...base, activity: 'contest', by: 1, progressPermille: 0, frozen: true })
        ?.mode,
    ).toBe(ARC_MODE.frozen);
  });

  it('clamps progress and maps unknown owners to the neutral slot', () => {
    const arc = claimRingArc({ ...base, activity: 'post', by: 200, progressPermille: 1500 });
    expect(arc).toEqual({ fraction: 1, color: NEUTRAL_TEAM, mode: ARC_MODE.solid });
  });

  it('indexes arcs by point id', () => {
    const m = claimRingArcs([
      base,
      { ...base, pointId: 9, activity: 'hero', by: 0, progressPermille: 100 },
    ]);
    expect([...m.keys()]).toEqual([9]);
  });
});
