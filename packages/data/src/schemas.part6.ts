// Split from schemas.part2.ts to stay under the 5,000-token file limit; schemas.ts re-exports the public surface.
// Holds: RaidPlan (the raid plan of a scripted faction AI).
import { z } from 'zod';
import { comment, id, nonneg, pct } from './schemas.part1.js';

// Het roofplan van de Raider-AI (data 0.21.0). Alle loadout-ids moeten bestaan; de tijden zijn speeltijd in seconden.
export const RaidPlan = z
  .object({
    // Samenstelling van de vechters uit de tenten, cyclisch naar gewicht (een loadout waarvoor de techs er niet zijn slaat hij over)
    fighterMix: z
      .array(z.object({ loadoutId: id, weight: z.number().int().positive() }).strict())
      .min(1),
    // Harass: snelle units (Buggy) die verzamelaars en losse units van de vijand aanvallen en bij te weinig hp terugtrekken
    harass: z
      .object({
        loadoutId: id,
        fromS: nonneg,
        max: z.number().int().positive(),
        retreatHpPct: pct,
        targets: z.enum(['gatherers']),
      })
      .strict()
      .optional(), // data 0.38.0 (proposal): absent = no harass (the Garde)
    // Slavenroof: slavers met escorte op zwervers en op vijandelijke bewoners buiten de basisradius; terug naar de Kooi
    slaveRaids: z
      .object({
        slaverLoadoutId: id,
        fromS: nonneg,
        slavers: z.number().int().positive(),
        escort: z.number().int().nonnegative(),
        maxRaidS: nonneg, // een tocht duurt hoogstens zoveel seconden, daarna terug
        retryS: nonneg, // wachttijd tussen twee tochten
      })
      .strict()
      .optional(), // data 0.38.0 (proposal): absent = no slave raids (a faction without slaves)
    // Garnizoen: zoveel vechters blijven thuis (anders opstand), ook tijdens golven en tochten
    garrison: z.object({ minFighters: z.number().int().nonnegative() }).strict(),
    // Dominantie-push: vanaf fromS en met minArmy vechters neemt hij claimpunten en houdt ze (verder dan claimSafeRadiusM met escorte)
    dominancePush: z.object({ fromS: nonneg, minArmy: z.number().int().nonnegative() }).strict(),
    // Data 0.38.0 (proposal for the architect; the Garde): a faction without slaves produces its free workers (Produce of
    // its cheapest builder and scavenger loadout): `builders` (the script field) builders, and scavengers up to this many
    // (counting the growth). Absent = the workers are slaves (the Raiders).
    workers: z.object({ scavengers: z.number().int().nonnegative() }).strict().optional(),
    // Data 0.38.0 (proposal): true = the fighter mix is made strictly in its cycle order: a building waits while the
    // next fighter (with its techs) comes from another building. Absent = each idle building makes the next it can.
    mixInOrder: z.boolean().optional(),
    // Data 0.43.0 (de Garde-AI; voorstel, ter bevestiging door de architect; docs/garde.md punt 3): support units (the
    // Klerk). From fromS the AI keeps one per `perArmy` fighters, at most `max` alive (plus in production), made where
    // its loadout is made. They are no fighters (they never count for a wave, push or reserve); `withWave` free ones go
    // along with every wave, push and sabotage (the overload stun is a weapon), the rest stand with the defence and
    // repair there. Absent = no support units.
    support: z
      .object({
        loadoutId: id,
        fromS: nonneg,
        max: z.number().int().positive(),
        perArmy: z.number().int().positive(),
        withWave: z.number().int().nonnegative(),
        _comment: comment,
      })
      .strict()
      .optional(),
    // Data 0.43.0 (de Garde-AI; voorstel; docs/garde.md punt 5): the airlift (the Vertibird). From fromS the AI keeps
    // `max` transports alive while its army is at least minArmy (a transport without a wave to carry is wasted scrap,
    // and saving for one starves a shrinking army). While the wave's target lies at least minPathM over land, an empty
    // transport above minHpPct that stands within gatherM of the headquarters takes up to its capacity free fighters
    // within gatherM of it (Load; at least minLoad, so it does not shuttle one at a time) and sets them down at the
    // rally point (Unload there), then flies home. Absent = no airlift.
    airlift: z
      .object({
        loadoutId: id,
        fromS: nonneg,
        max: z.number().int().positive(),
        minArmy: z.number().int().nonnegative(),
        minPathM: nonneg,
        gatherM: z.number().positive(),
        minLoad: z.number().int().positive(),
        minHpPct: pct,
        _comment: comment,
      })
      .strict()
      .optional(),
  })
  .strict();

export type RaidPlan = z.infer<typeof RaidPlan>;
