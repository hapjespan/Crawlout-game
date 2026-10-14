import { describe, expect, it } from 'vitest';
import { TICKS_PER_MINUTE, playMatch } from './balance.js';

// Potjelengte (Spelfundament 2.6: 25 tot 35 minuten, dus 30.000 tot 42.000 frames), balans speltest 14 oktober:
// scripted AI tegen scripted AI op Rustbelt over vijf seeds. De seeds verschillen via sim.rng (kritieke schoten van de
// held, de jitter op de golven van de AI). EXPECTED legt de uitkomst per seed vast: een andere uitkomst is een bewuste
// balanswijziging en hoort bij een nieuwe meting (pnpm --filter @crawlout/replay balance) en een regel in de CHANGELOG.

const EXPECTED = [
  { seed: 1, winner: 1, reason: 'destruction', frame: 34645 },
  { seed: 7, winner: 0, reason: 'destruction', frame: 34265 },
  { seed: 42, winner: 0, reason: 'destruction', frame: 33691 },
  { seed: 99, winner: 1, reason: 'destruction', frame: 34074 },
  { seed: 123, winner: 0, reason: 'destruction', frame: 34202 },
] as const;

describe('potjelengte: AI tegen AI op Rustbelt', () => {
  for (const e of EXPECTED) {
    it(
      `seed ${e.seed}: een winnaar tussen 25 en 35 minuten, scrap loopt niet op, de held levelt`,
      { timeout: 120_000 },
      () => {
        const r = playMatch(e.seed, { maxFrames: 45 * TICKS_PER_MINUTE });
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
});
