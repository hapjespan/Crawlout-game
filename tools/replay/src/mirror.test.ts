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
      // data 0.20.0: de gelijke stand bij het midden valt nu op 20:43 (frame 24.878), was rond 18:45
      const r = mirrorRun(1, { maxFrames: 22 * 1200 });
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
    'verwisselproef: exact verwisseld tot de herbouw van de palen bij het midden, de winnaar verwisselt',
    { timeout: 120_000 },
    () => {
      // seed 7: speler 0 krijgt het midden bij de gelijke stand, seed 2: speler 1. Het claimpunt in het midden ligt een
      // halve cel naast het symmetriepunt (de map plaatst punten op celmiddens), dus de potjes zijn daarna niet meer
      // exact elkaars spiegelbeeld; de uitkomst wel: de winnaar is verwisseld, bijna in hetzelfde frame.
      // Data 0.17.0: seed 1 (was het paar 1 en 2) heeft rond minuut 22 een tweede gelijke stand bij het midden, die
      // sim.rng opnieuw beslist; dan is de verwisseling per definitie weg (beide potjes worden gelijk). Seed 7 niet.
      // Data 0.20.0 (claimronde): zonder toeval vallen bij het midden steeds beide palen tegelijk en volgen meer gelijke
      // standen (24.940, 27.667, 29.260, ...); seed 2 wint pas de eerste twee voor speler 1 en de derde voor speler 0,
      // dus seed 7 tegen 9 (alle standen naar 0, alle naar 1). Na een herbouw staan de twee palen naast het excentrische
      // punt op de cel die in scanvolgorde eerst komt voor wie het eerst claimt, dus niet gespiegeld; zonder omlopen
      // kostte dat een eenheid die er recht achter moest minuten (36.778 tegen 47.767).
      // Met het omlopen van een unit die tegen een gebouw staat (sim 0.16.0, movement.ts) houdt de verwisseling weer:
      // winnaars 0 en 1 in frame 36.466 en 36.521.
      // Fog of war (sim 0.17.0, data 0.21.0): the two games are each other's exact swap from the centre tie (20:43) until
      // the claim posts at the eccentric centre point are rebuilt on non-mirrored cells (frame 31.118, the known
      // asymmetry above); the winner still swaps (1 and 0), but the outcome no longer: player 1 destroys player 0 in
      // frame 42.843 when the ties go to player 0, player 0 wins on dominance in frame 50.876 when they go to player 1.
      // Without chance there are only these two games (seeds 1 to 24 all end in one of them). The AI now answers only
      // threats it sees, so the one-cell difference of the rebuilt posts (and their sight) grows into a different game.
      // Fairness over the 33 seeds with chance is 17 against 16 (match-length.test.ts).
      const r = mirrorSwap(7, 9);
      expect(r.winners).toEqual([1, 0]);
      expect(r.breakFrame).not.toBeNull();
      expect(r.breakFrame!).toBeGreaterThan(25 * 1200);
      expect(r.diffs[0]).toMatch(/gebouw t1024 @192,191/);
    },
  );
});
