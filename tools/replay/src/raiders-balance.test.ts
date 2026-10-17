import { beforeAll, describe, expect, it } from 'vitest';
import { FAIRNESS_SEEDS, TICKS_PER_MINUTE } from './balance.js';
import type { MatchResult } from './balance.js';
import { playMatchesParallel } from './fairness.js';
import { raiderSummary } from './raiders.js';

// Raiders against Dwellers (sim 0.18.0, data 0.23.0): the scripted Raider AI against the scripted Dweller AI on
// Rustbelt XL over the 33 seeds of the fairness measurement, every seed on both sides (66 matches, about 35 s with
// parallel processes). The design triangle (Spelfundament 4): the Raiders beat the Dwellers early (before the turrets),
// the Dwellers win late. Measured (packages/sim/CHANGELOG.md 0.18.0): see the comment at EXPECTED and the CHANGELOG.
// AI against AI is close to deterministic per seed (the only chance is the jitter of waves and far claims, crits and
// ties), and the matches fall in three groups: an early Raider push that razes the Dweller headquarters (about minute
// 10), a Raider dominance win (about minute 15), and a Dweller win after minute 25. A different outcome is a balance
// change and belongs with a new measurement (pnpm --filter @crawlout/replay exec node --import tsx src/raiders-report.ts)
// and a line in the CHANGELOG.

// Measured (data 0.23.0, sim 0.18.0): the Raiders win 27 of 66 (15 by destruction at 10.2 to 10.7 minutes, 12 by
// dominance: 11 at 15.4 to 15.5, one at 40.7), the Dwellers 39 (32 by destruction at 25.2 to 28.7, 7 by dominance at
// 23.3 to 43.9); all 15 matches decided before minute 12 go to the Raiders, 36 of 66 end between 25 and 40 minutes.
// One seed of each group is pinned here (winner and reason).
const EXPECTED = [
  { seed: 2, raider: 0, winner: 'raiders', reason: 'destruction' },
  { seed: 99, raider: 0, winner: 'raiders', reason: 'dominance' },
  { seed: 1, raider: 0, winner: 'dwellers', reason: 'destruction' },
  { seed: 5, raider: 0, winner: 'dwellers', reason: 'dominance' },
] as const;

describe.skipIf(process.env.REPLAY_FAST === '1')(
  'Raiders against Dwellers: AI against AI on Rustbelt XL, both sides',
  () => {
    let rows: { raider: number; r: MatchResult }[] = [];
    beforeAll(async () => {
      const [a, b] = await Promise.all([
        playMatchesParallel(FAIRNESS_SEEDS, undefined, ['raiders', 'dwellers']),
        playMatchesParallel(FAIRNESS_SEEDS, undefined, ['dwellers', 'raiders']),
      ]);
      rows = [...a.map((r) => ({ raider: 0, r })), ...b.map((r) => ({ raider: 1, r }))];
    }, 600_000);

    it('every match ends with a winner within 45 minutes', () => {
      for (const { r } of rows) {
        expect(r.winner).not.toBeNull();
        expect(r.frame).toBeLessThan(45 * TICKS_PER_MINUTE);
      }
    });

    it('both factions win: each at least a quarter of the matches', () => {
      const s = raiderSummary(rows);
      expect(s.raiderWins).toBeGreaterThanOrEqual(Math.ceil(s.matches / 4));
      expect(s.dwellerWins).toBeGreaterThanOrEqual(Math.ceil(s.matches / 4));
    });

    it('the design triangle: the early decisions go to the Raiders, the long matches mostly to the Dwellers', () => {
      const s = raiderSummary(rows);
      expect(s.early).toBeGreaterThanOrEqual(5);
      expect(s.earlyRaiders).toBeGreaterThanOrEqual(Math.ceil((s.early * 7) / 10));
      expect(s.inWindow).toBeGreaterThanOrEqual(Math.ceil(s.matches / 2));
      expect(s.windowDwellers).toBeGreaterThan(s.windowRaiders);
      // the Raiders win earlier on average than the Dwellers
      const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
      const raider = rows.filter((x) => x.r.winner === x.raider).map((x) => x.r.minutes);
      const dweller = rows.filter((x) => x.r.winner === 1 - x.raider).map((x) => x.r.minutes);
      expect(mean(raider)).toBeLessThan(mean(dweller));
    });

    for (const e of EXPECTED) {
      it(`seed ${e.seed} with the Raiders as player ${e.raider}: the ${e.winner} win (${e.reason})`, () => {
        const row = rows.find((x) => x.r.seed === e.seed && x.raider === e.raider)!;
        expect(row.r.winner === e.raider ? 'raiders' : 'dwellers').toBe(e.winner);
        expect(row.r.reason).toBe(e.reason);
      });
    }
  },
);

describe.skipIf(process.env.REPLAY_FAST === '1')('Raiders against Raiders: smoke', () => {
  it(
    'four matches of the Raider AI against itself end with a winner',
    { timeout: 300_000 },
    async () => {
      const results = await playMatchesParallel([1, 2, 3, 4], undefined, ['raiders', 'raiders']);
      for (const r of results) {
        expect(r.winner).not.toBeNull();
        expect(r.frame).toBeLessThan(45 * TICKS_PER_MINUTE);
        for (const p of r.players) expect(p.income).toBeGreaterThan(0);
      }
    },
  );
});
