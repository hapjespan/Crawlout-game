import { describe, expect, it } from 'vitest';
import { playMatchesParallel } from './fairness.js';
import type { MatchResult } from './balance.js';

// The Garde, round A (sim 0.32.0, data 0.38.0; docs/garde.md): a smoke check, NOT a balance test. The scripted Garde AI
// (ai/garde-basic.json) against the Raider AI and the Dweller AI on Rustbelt XL, a few seeds and both sides: every
// match has a winner within 45 minutes. The outcomes are reported, not asserted (balance follows in its own round).
const MATCHUPS: readonly { factions: readonly string[]; seeds: readonly number[] }[] = [
  { factions: ['garde', 'raiders'], seeds: [1, 2, 3] },
  { factions: ['raiders', 'garde'], seeds: [4] },
  { factions: ['garde', 'dwellers'], seeds: [1, 2, 3] },
  { factions: ['dwellers', 'garde'], seeds: [4] },
];

describe('Garde AI smoke check (not balance)', () => {
  it('every match has a winner within 45 minutes', { timeout: 900_000 }, async () => {
    const all: { factions: readonly string[]; r: MatchResult }[] = [];
    await Promise.all(
      MATCHUPS.map(async (m) => {
        const rs = await playMatchesParallel(m.seeds, 4, m.factions);
        for (const r of rs) all.push({ factions: m.factions, r });
      }),
    );
    const lines = all.map(
      ({ factions, r }) =>
        `${factions.join(' v ')} seed ${r.seed}: ${r.winner === null ? 'none' : factions[r.winner]} by ${r.reason} at ${r.minutes.toFixed(1)} min`,
    );
    console.log(lines.join('\n'));
    for (const { r } of all) {
      expect(r.winner, `seed ${r.seed}`).not.toBeNull();
      expect(r.minutes, `seed ${r.seed}`).toBeLessThanOrEqual(45);
    }
  });
});
