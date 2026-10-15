import { describe, expect, it } from 'vitest';
import { TICKS_PER_MINUTE, playMatch } from './balance.js';
import type { MatchResult } from './balance.js';

// Potjelengte (Spelfundament 2.6: 25 tot 35 minuten, dus 30.000 tot 42.000 frames) en de twee winroutes van de slice
// (Spelfundament 12): scripted AI tegen scripted AI op Rustbelt XL (384 x 384 m, data 0.12.0) over vijf seeds. De seeds
// verschillen via sim.rng (kritieke schoten van de held, de jitter op de golven en op het moment dat de AI naar het
// midden gaat). EXPECTED legt de uitkomst per seed vast: een andere uitkomst is een bewuste balanswijziging en hoort bij
// een nieuwe meting (pnpm --filter @crawlout/replay balance) en een regel in de CHANGELOG. Beide winroutes moeten
// voorkomen: minstens één seed eindigt op vernietiging en minstens één op dominantie.

// Data 0.12.0 (xl-int, de grote map): opnieuw vastgelegd op dezelfde seeds als 0.11.0. Gemeten over de seeds 1 tot 30,
// 42, 99 en 123: alle 33 tussen 25,7 en 28,3 minuten, 19 op dominantie en 14 op vernietiging; speler 1 wint 28 van de 33
// (de AI-spiegel is niet volledig symmetrisch, zie packages/sim/CHANGELOG.md 0.9.0). Elk potje duurt hier 3 tot 4 s.
const EXPECTED = [
  { seed: 1, winner: 0, reason: 'destruction', frame: 31805 },
  { seed: 5, winner: 1, reason: 'dominance', frame: 30895 },
  { seed: 7, winner: 1, reason: 'destruction', frame: 32944 },
  { seed: 42, winner: 1, reason: 'destruction', frame: 32666 },
  { seed: 99, winner: 1, reason: 'dominance', frame: 32074 },
] as const;

// REPLAY_FAST=1 slaat deze vijf potjes (ongeveer 40 s) over in de snelle lus van een werkstroom; CI en een gewone
// `pnpm test` draaien ze altijd (fase-0 sectie 17, besluit 5).
describe.skipIf(process.env.REPLAY_FAST === '1')('potjelengte: AI tegen AI op Rustbelt XL', () => {
  const results: MatchResult[] = [];
  for (const e of EXPECTED) {
    it(
      `seed ${e.seed}: een winnaar tussen 25 en 35 minuten, scrap loopt niet op, de held levelt`,
      { timeout: 120_000 },
      () => {
        const r = playMatch(e.seed, { maxFrames: 45 * TICKS_PER_MINUTE });
        results.push(r);
        expect({ seed: r.seed, winner: r.winner, reason: r.reason, frame: r.frame }).toEqual(e);
        expect(r.frame).toBeGreaterThanOrEqual(25 * TICKS_PER_MINUTE);
        expect(r.frame).toBeLessThan(35 * TICKS_PER_MINUTE);
        for (const p of r.players) {
          // ongebruikte scrap loopt niet op: de AI geeft zijn inkomen uit
          expect(p.peakScrap).toBeLessThan(600);
          expect(p.spent).toBeGreaterThan(p.income - 300);
        }
        // de held van de winnaar haalt minstens level 3, die van de verliezer minstens level 2
        expect(r.players[r.winner!]!.heroLevel).toBeGreaterThanOrEqual(3);
        for (const p of r.players) expect(p.heroLevel).toBeGreaterThanOrEqual(2);
      },
    );
  }

  it('beide winroutes komen voor (Spelfundament 12): vernietiging en dominantie', () => {
    expect(results.map((r) => r.seed)).toEqual(EXPECTED.map((e) => e.seed));
    const reasons = new Set(results.map((r) => r.reason));
    expect(reasons.has('destruction')).toBe(true);
    expect(reasons.has('dominance')).toBe(true);
    // dominantie beslist een deel van de potjes, niet allemaal (doel: een of twee van de vijf)
    const dominance = results.filter((r) => r.reason === 'dominance').length;
    expect(dominance).toBeGreaterThanOrEqual(1);
    expect(dominance).toBeLessThanOrEqual(2);
  });
});
