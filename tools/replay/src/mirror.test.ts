import { describe, expect, it } from 'vitest';
import { mirrorRun, mirrorSwap } from './mirror.js';

// Spiegeltest (fair-ronde): op de puntsymmetrische Rustbelt XL horen twee scripted AI's zonder toeval (geen golf-jitter,
// geen kritieke schoten) elkaars exacte spiegelbeeld te spelen: dezelfde gebouwen op gespiegelde plekken in hetzelfde
// frame, units op gespiegelde posities, dezelfde economie. Dat houdt stand tot het eerste moment waarop de spiegel per
// definitie breekt: beide AI's bouwen hun claimpaal bij het midden in dezelfde tick af, en het punt gaat via sim.rng
// naar een van de twee. Een breuk eerder dan dat is een volgorde- of tiebreakfout in de sim (zie mirror.ts).

describe('spiegel: AI tegen AI op Rustbelt XL zonder toeval', () => {
  it(
    'speler 1 speelt het exacte spiegelbeeld van speler 0 tot de gelijke stand bij het midden',
    { timeout: 60_000 },
    () => {
      const r = mirrorRun(1, { maxFrames: 20 * 1200 });
      // vóór de fair-ronde brak de spiegel in frame 72 (een unit precies op een celgrens)
      expect(r.breakFrame).not.toBeNull();
      expect(r.breakFrame!).toBeGreaterThan(18 * 1200);
      expect(r.diffs[0]).toMatch(/claimpunt @191,191/);
      // de eerste vijftien gebouwen: zelfde type, zelfde frame
      expect(r.buildOrder[0].length).toBeGreaterThanOrEqual(15);
      expect(r.buildOrder[1]).toEqual(r.buildOrder[0]);
    },
  );

  // Twee volledige potjes (ongeveer 15 s): in de snelle lus overgeslagen.
  it.skipIf(process.env.REPLAY_FAST === '1')(
    'verwisselproef: wie het midden krijgt, verandert alleen de rollen, niet de uitkomst',
    { timeout: 120_000 },
    () => {
      // seed 1: speler 0 krijgt het midden bij de gelijke stand, seed 2: speler 1. Het claimpunt in het midden ligt een
      // halve cel naast het symmetriepunt (de map plaatst punten op celmiddens), dus de potjes zijn daarna niet meer
      // exact elkaars spiegelbeeld; de uitkomst wel: de winnaar is verwisseld, bijna in hetzelfde frame.
      const r = mirrorSwap(1, 2);
      expect(r.winners).toEqual([1, 0]);
      expect(Math.abs(r.frames[0] - r.frames[1])).toBeLessThan(1200);
    },
  );
});
