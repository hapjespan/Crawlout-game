import { beforeAll, describe, expect, it } from 'vitest';
import { FAIRNESS_SEEDS, TICKS_PER_MINUTE } from './balance.js';
import type { MatchResult } from './balance.js';
import { playMatchesParallel, summarize } from './fairness.js';

// Potjelengte (Spelfundament 2.6: 25 tot 35 minuten, dus 30.000 tot 42.000 frames), de twee winroutes van de slice
// (Spelfundament 12) en eerlijkheid: scripted AI tegen scripted AI op Rustbelt XL (384 x 384 m, data 0.14.0). De seeds
// verschillen via sim.rng (kritieke schoten van de held, de jitter op de golven en op het moment dat de AI naar het
// midden gaat, een gelijke stand bij een claimpunt). EXPECTED legt de uitkomst van vijf seeds vast: een andere uitkomst
// is een bewuste balanswijziging en hoort bij een nieuwe meting (pnpm --filter @crawlout/replay balance, fairness) en
// een regel in de CHANGELOG.
//
// Eerlijkheid (fair-ronde): Rustbelt XL is puntsymmetrisch, dus over veel seeds hoort elke speler ongeveer de helft te
// winnen. Vóór de fair-ronde won speler 1 er 28 van de 33 (de spiegel brak op celgrenzen, ingangen van de padgraaf,
// tiebreaks en de volgorde van de AI's; zie packages/sim/CHANGELOG.md 0.10.0). Nu speelt de AI zonder toeval het exacte
// spiegelbeeld tot de gelijke stand bij het midden (mirror.test.ts). Echte-schaalronde (data 0.14.0: gebouwen op echte
// schaal, oneven footprints, woning 13 x 19 met 5 bedden voor 95 scrap): gemeten over de 33 seeds hieronder wint speler 0
// er 13 en speler 1 er 20, 10 keer vernietiging en 23 keer dominantie, alle 33 tussen 25 en 35 minuten (25,5 tot 30,6).
// Met data 0.13.0 was het 18 tegen 15.
// Formatieronde (data 0.15.0, packages/sim 0.12.0: elke unit van een groeps-Move of -AttackMove een eigen plek in een
// formatie): speler 0 wint 17 en speler 1 wint 16, 14 keer vernietiging en 19 keer dominantie, lengte 25,5 tot 36,8
// minuten (32 van de 33 tussen 25 en 35); EXPECTED is opnieuw gemeten.
// Content-x (data 0.16.0: robots, technicus-regel, vangnet, training, turret-netwerk, de passieven van de held; de AI
// bouwt vanaf minuut 14 robots in de robotfabriek; de spiegel-fixes in nearestFreeCellAround en de separatie van units
// op hetzelfde punt): speler 0 wint 15 en speler 1 wint 18, 12 keer vernietiging en 21 keer dominantie, lengte 25,5 tot
// 27,8 minuten (33 van de 33 tussen 25 en 35); EXPECTED is opnieuw gemeten.
// Techboom-ronde (data 0.17.0: de AI spaart voor onderzoek, robots en training, bouwt laserturrets en een
// trainingsfaciliteit, robots tellen mee voor zijn leger, gatherRingM 1): speler 0 wint 19 en speler 1 wint 14, 9 keer
// vernietiging en 24 keer dominantie, lengte 25,9 tot 32,6 minuten (33 van de 33 tussen 25 en 35); de winnaar bouwde in
// 28 van de 33 potjes een sentinel, in 32 drie laserturrets en trainde in alle 33 zijn held; EXPECTED is opnieuw gemeten.
// Gevechtsronde (data 0.19.0: beveiligingsrobot 520 hp en 3,5 s cooldown, sentinel 270 hp; de doelen van Martien in
// packages/sim/test/combat-balance.test.ts): speler 0 wint 16 en speler 1 wint 17, 17 keer vernietiging en 16 keer
// dominantie, lengte 25,9 tot 31,3 minuten (33 van de 33 tussen 25 en 35); EXPECTED is opnieuw gemeten.
// Claimronde (data 0.20.0, sim 0.16.0, op de gevechtsbalans van 0.19.0: de settlement-nodes 9,2 m van hun claimpunt in
// plaats van 4 m, exclusiveRadiusM 12, een claim vindt altijd een plek, de held claimt zonder paal, het eigen gebied van
// 10 m rond de gebouwen en 5 m rond een claimpaal, een unit die tegen een gebouw staat zoekt een weg om of is
// aangekomen): speler 0 wint 20 en speler 1 wint 13, 14 keer vernietiging en 19 keer dominantie, lengte 26,4 tot 38,9
// minuten (31 van de 33 tussen 25 en 35); EXPECTED is opnieuw gemeten.
// Een even footprint (hoofdgebouw 20 x 20) brak de spiegel al bij de start (speler
// 0 won 30 van de 33), een claimpaal van 3 x 3 liet het midden altijd naar speler 0 gaan; zie packages/data/CHANGELOG.md
// 0.14.0. Het verschil tussen de spelers is toeval (één standaardafwijking bij 33 muntworpen is 2,9 potjes), geen
// voorkeur; de marge hieronder is daarom ruimer dan het doel van 40 tot 60 procent: elke speler wint minstens 12 en
// hoogstens 21 van de 33 (36 tot 64 procent). Een sim die een speler voortrekt (zoals 28 tegen 5) valt er ruim buiten.

const EXPECTED = [
  { seed: 1, winner: 1, reason: 'destruction', frame: 32569 },
  { seed: 5, winner: 1, reason: 'dominance', frame: 37427 },
  { seed: 7, winner: 0, reason: 'dominance', frame: 37422 },
  { seed: 42, winner: 1, reason: 'dominance', frame: 33837 },
  { seed: 99, winner: 1, reason: 'destruction', frame: 32494 },
] as const;

// REPLAY_FAST=1 slaat deze 33 potjes (ongeveer 25 s met parallelle processen, 2 minuten na elkaar) over in de snelle
// lus van een werkstroom; CI en een gewone `pnpm test` draaien ze altijd (fase-0 sectie 17, besluit 5).
describe.skipIf(process.env.REPLAY_FAST === '1')(
  'potjelengte en eerlijkheid: AI tegen AI op Rustbelt XL',
  () => {
    let results: MatchResult[] = [];
    beforeAll(async () => {
      results = await playMatchesParallel(FAIRNESS_SEEDS);
    }, 600_000);
    const of = (seed: number): MatchResult => results.find((r) => r.seed === seed)!;

    for (const e of EXPECTED) {
      it(`seed ${e.seed}: een winnaar tussen 25 en 35 minuten, scrap loopt niet op, de held levelt`, () => {
        const r = of(e.seed);
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
      });
    }

    it('eerlijk: over de 33 seeds wint elke speler 12 tot 21 potjes (36 tot 64 procent; doel 40 tot 60)', () => {
      const s = summarize(results);
      expect(s.wins[0] + s.wins[1]).toBe(FAIRNESS_SEEDS.length);
      for (const w of s.wins) {
        expect(w).toBeGreaterThanOrEqual(12);
        expect(w).toBeLessThanOrEqual(21);
      }
    });

    it('beide winroutes komen voor (Spelfundament 12), elk in minstens een kwart van de potjes', () => {
      const s = summarize(results);
      expect(s.reasons.destruction).toBeGreaterThanOrEqual(9);
      expect(s.reasons.dominance).toBeGreaterThanOrEqual(9);
    });

    it('potjelengte: alles tussen 25 en 40 minuten, minstens 30 van de 33 tussen 25 en 35', () => {
      const s = summarize(results);
      expect(s.minMinutes).toBeGreaterThanOrEqual(25);
      expect(s.maxMinutes).toBeLessThan(40);
      expect(s.inWindow).toBeGreaterThanOrEqual(30);
    });
  },
);
