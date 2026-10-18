import { beforeAll, describe, expect, it } from 'vitest';
import { FAIRNESS_SEEDS, TICKS_PER_MINUTE } from './balance.js';
import type { MatchResult } from './balance.js';
import { playMatchesParallel, summarize } from './fairness.js';
import { mirrorRun } from './mirror.js';
import { formatRaiderSummary, raiderSummary } from './raiders.js';

// Raiders against Dwellers (sim 0.19.0, data 0.24.0): the scripted Raider AI (ai/raiders-basic.json) against the
// scripted Dweller AI with its script against Raiders (ai/dwellers-vs-raiders.json) on Rustbelt XL over the 33 seeds of
// the fairness measurement, every seed on both sides (66 matches, about 50 s with parallel processes). The design
// triangle (Spelfundament 4): the Raiders beat the Dwellers early, the Dwellers win late; matches of 25 to 35 minutes
// (Spelfundament 2.6). AI against AI is close to deterministic per seed (the only chance is the jitter of waves and far
// claims, crits and ties) and shifts in groups, so a different outcome is a balance change and belongs with a new
// measurement on both seed sets (pnpm --filter @crawlout/replay exec node --import tsx src/raiders-report.ts, and the
// same with the seeds 200 to 232) and a line in the CHANGELOG.

// Measured (data 0.24.0, sim 0.19.0): the Raiders win 35 of 66 (as player 0 15, as player 1 20), all on dominance at
// 24.5 to 25.3 minutes; the Dwellers win 31 (29 by destruction at 28.2 to 32.4, 2 by dominance), 16 of them after minute
// 30. All 66 between 24.5 and 32.4 minutes, no destruction before minute 15. Seeds 200 to 232: the Raiders 28 of 66,
// all 66 between 24.5 and 34.7, the Dwellers win all 20 after minute 30. Was (data 0.23.0): 15 Raider destructions at
// 10 to 11 minutes, 11 Raider dominance wins at 15.5, the Dwellers all 36 matches of 25 to 40 minutes.
// Creep camps (data 0.25.0, sim 0.20.0; voorstel): the Raider AI clears its three camps (from minute 10, median minute
// 10.6, all 198), the Dweller script against Raiders clears none on purpose (ai/dwellers-vs-raiders.json: with the camp
// rule of dwellers-basic the loot and hero xp gave the Dwellers all 66 matches). The Raiders win 31 of 66 (16 as player
// 0, 15 as player 1), 26 on dominance; 23.5 to 41.7 minutes, 63 of 66 between 22 and 38, none decided before minute 22.
// Seeds 200 to 232: the Raiders 30 of 66, 23.7 to 38.2 minutes. The pinned seeds are measured again.
// Sim 0.22.0, data 0.27.0 (playtest H1; voorstel, ter bevestiging door de architect): a Move to a point inside a footprint
// no longer leaves units walking on the spot at its edge. The Raider garrison sends its fighters with a Move to the middle
// of the camp, so until now about 25 fighters stood frozen in the camp from the first call (mostly after minute 22),
// with a Move order that does not fight back; the balance above rested on that. Fixed, the Raiders won 63 of 66. Data
// 0.27.0 keeps 14 fighters home from the start instead (ai/raiders-basic.json garrison.minFighters, was 3): the Raiders
// win 32 of 66 (as player 0 17, as player 1 15), 30 of them on dominance before minute 30; the Dwellers 34, 32 by
// destruction; 22.7 to 36.3 minutes, all 66 between 22 and 38. Seeds 200 to 232: the Raiders 35 of 66, 22.7 to 38.5.
// One seed of each group is pinned here (winner and reason).
const EXPECTED = [
  { seed: 2, raider: 0, winner: 'raiders', reason: 'dominance' },
  { seed: 9, raider: 1, winner: 'dwellers', reason: 'destruction' },
  { seed: 20, raider: 0, winner: 'dwellers', reason: 'dominance' },
  { seed: 4, raider: 1, winner: 'raiders', reason: 'dominance' },
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
    const report = (): string => formatRaiderSummary(raiderSummary(rows)).join('\n');

    it('every match ends with a winner within 45 minutes', () => {
      for (const { r } of rows) {
        expect(r.winner).not.toBeNull();
        expect(r.frame).toBeLessThan(45 * TICKS_PER_MINUTE);
      }
    });

    it('each faction wins 40 to 60 percent, and the Raiders win on both sides', () => {
      const s = raiderSummary(rows);
      expect(s.raiderWins, report()).toBeGreaterThanOrEqual(Math.ceil(s.matches * 0.4));
      expect(s.raiderWins, report()).toBeLessThanOrEqual(Math.floor(s.matches * 0.6));
      // per side as the fairness band of match-length.test.ts: 12 to 21 of 33
      for (const n of s.raiderWinsAs) {
        expect(n, report()).toBeGreaterThanOrEqual(12);
        expect(n, report()).toBeLessThanOrEqual(21);
      }
    });

    it('match length: mostly 22 to 38 minutes, hardly a destruction before minute 15', () => {
      const s = raiderSummary(rows);
      expect(s.inTarget, report()).toBeGreaterThanOrEqual(Math.ceil(s.matches * 0.8));
      expect(s.destructionBefore15, report()).toBeLessThanOrEqual(Math.floor(s.matches * 0.1));
    });

    it('the design triangle: the Raiders win early (on dominance), the Dwellers late', () => {
      const s = raiderSummary(rows);
      // decided before minute 22: a clear majority for the Raiders (when there are such matches)
      expect(s.before22Raiders * 3, report()).toBeGreaterThanOrEqual(s.before22 * 2);
      // decided after minute 30: a clear majority for the Dwellers, and there are such matches
      expect(s.after30, report()).toBeGreaterThanOrEqual(5);
      expect(s.after30Dwellers * 3, report()).toBeGreaterThanOrEqual(s.after30 * 2);
      expect(s.meanRaiderWin, report()).toBeLessThan(s.meanDwellerWin);
      // dominance is the Raiders' natural route (Spelfundament 4)
      const raiderDominance = s.buckets.reduce((a, b) => a + b.raiders.dominance, 0);
      expect(raiderDominance * 2, report()).toBeGreaterThan(s.raiderWins);
    });

    it('the Raiders catch slaves and the Dwellers free some of them', () => {
      const s = raiderSummary(rows);
      expect(s.captured, report()).toBeGreaterThan(s.matches);
      expect(s.freed, report()).toBeGreaterThan(0);
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

// Raiders against Raiders (data 0.24.0, sim 0.19.0): before, player 0 won 5 of 6 (92 of 99 over the seeds 1 to 99):
// two Slavers that caught each other in the same tick were split by entity index, player 0's always first. Now sim.rng
// picks (systems/slaves.ts captureTick, fase-0 section 19 decision 3): 53 against 46 over the seeds 1 to 99.
describe('Raiders against Raiders: the mirror', () => {
  it(
    'player 1 plays the exact mirror image of player 0 until the two Slavers catch each other (a sim.rng tie)',
    { timeout: 60_000 },
    () => {
      const r = mirrorRun(1, { maxFrames: 8 * 1200, faction: 'raiders' });
      expect(r.breakFrame).not.toBeNull();
      expect(r.breakFrame!).toBeGreaterThan(5 * 1200);
      // the first difference is the catch itself: a captive (slave state 1) on one side only
      expect(r.diffs.some((d) => / sl1\//.test(d))).toBe(true);
      expect(r.buildOrder[0].length).toBeGreaterThanOrEqual(8);
      expect(r.buildOrder[1]).toEqual(r.buildOrder[0]);
    },
  );
});

describe.skipIf(process.env.REPLAY_FAST === '1')('Raiders against Raiders: fairness', () => {
  it(
    'over the 33 seeds each player wins 12 to 21 matches, every match with a winner',
    { timeout: 300_000 },
    async () => {
      const results = await playMatchesParallel(FAIRNESS_SEEDS, undefined, ['raiders', 'raiders']);
      for (const r of results) {
        expect(r.winner).not.toBeNull();
        expect(r.frame).toBeLessThan(45 * TICKS_PER_MINUTE);
        for (const p of r.players) expect(p.income).toBeGreaterThan(0);
      }
      const s = summarize(results);
      for (const w of s.wins) {
        expect(w).toBeGreaterThanOrEqual(12);
        expect(w).toBeLessThanOrEqual(21);
      }
    },
  );
});
