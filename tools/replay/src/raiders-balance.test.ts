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
// Camp takeover and weaker Raider fighters (data 0.27.0, sim 0.22.0; voorstel, ter bevestiging door de architect en
// content; Martien 18 oktober: "die zijn zwakker dan bouwers. nu is de raider faction dus de moeilijk om te spelen"):
// the Raider AI takes its two low camps over in minute 2 (median 2.1, all 132) and its high camp later (all 66), the
// Dweller script against Raiders still clears none. The Raiders win 29 of 66 (44 percent; 12 as player 0, 17 as
// player 1), 29 on dominance at 23.1 to 28.3 minutes; the Dwellers 37 (27 by destruction); 23.1 to 37.4 minutes, none
// before minute 22. Seeds 200 to 232: the Raiders 28 of 66 (42 percent; 9 and 19), 23.5 to 34.9 minutes. The target
// band is now 35 to 50 percent for the Raiders (was 40 to 60): the harder faction. AI against AI tips sharply here:
// with the slave raid from minute 2 as before the Raiders won 80 percent once the camps on the roads were gone, with
// an outpost yielding one bandit instead of two 33 percent, with a surrender at 25 instead of 30 percent 18 percent
// (the _comment of data/creeps.json and ai/raiders-basic.json, packages/sim/CHANGELOG.md 0.22.0).
// Playtest H1 (sim 0.23.0, data 0.28.0; voorstel, ter bevestiging door de architect): a Move to a point inside a
// footprint no longer leaves units walking on the spot at its edge. The Raider garrison sends its fighters with a Move
// to the middle of the camp, so until now up to about 25 fighters stood frozen in the camp from the first call, with a
// Move order that does not fight back; the balance above rested on that. Fixed, the Raiders won 45 of 66. Data 0.28.0:
// claimFarFromS 1000 and dominancePush.fromS 1200 (were 600 and 900): the Raiders win 26 of 66 (39 percent; 12 as
// player 0, 14 as player 1), 25.6 to 35.8 minutes; seeds 200 to 232: 29 of 66 (44 percent), 25.9 to 37.7 minutes.
// One seed of each group is pinned here (winner and reason).
const EXPECTED = [
  { seed: 4, raider: 0, winner: 'raiders', reason: 'dominance' },
  { seed: 2, raider: 0, winner: 'dwellers', reason: 'destruction' },
  { seed: 9, raider: 0, winner: 'dwellers', reason: 'dominance' },
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

    it('the Raiders (the harder faction, data 0.27.0) win 35 to 50 percent, on both sides', () => {
      const s = raiderSummary(rows);
      expect(s.raiderWins, report()).toBeGreaterThanOrEqual(Math.ceil(s.matches * 0.35));
      expect(s.raiderWins, report()).toBeLessThanOrEqual(Math.floor(s.matches * 0.5));
      // per side: 10 to 20 of 33 (the fairness band of match-length.test.ts, 12 to 21, moved down with the target)
      for (const n of s.raiderWinsAs) {
        expect(n, report()).toBeGreaterThanOrEqual(10);
        expect(n, report()).toBeLessThanOrEqual(20);
      }
    });

    it('the Raider AI takes a camp over in the first minutes of every match, and its two low camps', () => {
      for (const { raider, r } of rows) {
        const mine = r.camps.filter((c) => c.clearedBy === raider);
        expect(mine.length, `seed ${r.seed} raider ${raider}`).toBeGreaterThanOrEqual(2);
        const first = Math.min(...mine.map((c) => c.minute!));
        expect(first, `seed ${r.seed} raider ${raider}`).toBeLessThan(4);
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
// Camp takeover (data 0.27.0, sim 0.22.0): both AIs take their camps over from minute 1 and raid for slaves from minute
// 6, so the mirror holds through the takeovers and ends at 7:20, where the two armies with their recruits meet (who
// strikes first in a fight on the mirror line); the takeovers themselves are mirror-equal.
describe('Raiders against Raiders: the mirror', () => {
  it(
    'player 1 plays the exact mirror image of player 0 through the camp takeovers, until the armies meet',
    { timeout: 60_000 },
    () => {
      const r = mirrorRun(1, { maxFrames: 9 * 1200, faction: 'raiders' });
      expect(r.breakFrame).not.toBeNull();
      expect(r.breakFrame!).toBeGreaterThan(6 * 1200);
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
