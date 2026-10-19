// Split from schemas.ts to stay under the 5,000-token file limit; schemas.ts re-exports the public surface.
// Holds: AiScript, FormationTuning, PlacementTuning, VisionTuning, GuardTuning, BaseDefenseTuning, AiScript, +3 more.
import { z } from 'zod';
import { comment, id, nonneg, pct, sight } from './schemas.part1.js';
import { AiSite, RaidPlan } from './schemas.part2.js';

export const AiScript = z
  .object({
    id,
    faction: id,
    // site (balans speltest 14 oktober): optioneel, standaard hq
    buildOrder: z.array(
      z.object({ atS: nonneg, buildingId: id, site: AiSite.optional() }).strict(),
    ),
    attackTimersS: z.array(nonneg), // de eerste aanvalsgolven; daarna elke waveIntervalS
    militiaPct: pct, // deel van de bewoners dat de AI tot militie omschoolt aan het begin (besluit sprint 2: uit sim.json)
    // Balans speltest 14 oktober: een AI die bijbouwt, onderzoekt, claimt, verdedigt en in groeiende golven aanvalt.
    militiaPctMax: pct, // bovengrens van het militie-aandeel
    militiaPctPerMin: nonneg, // het militie-aandeel stijgt zoveel procentpunt per minuut speeltijd, tot militiaPctMax
    threatMilitiaPct: pct, // minimaal militie-aandeel zolang er vijanden bij een eigen gebouw staan
    builders: z.number().int().nonnegative(), // zoveel bouwers houdt hij (omscholen in de werkplaats)
    housingBuildingId: id, // het gebouw voor extra bedden
    housingFreeBeds: z.number().int().nonnegative(), // bouwt bij als er zoveel of minder vrije bedden zijn (tot popCapMax)
    research: z.array(id), // techs in volgorde, vanaf researchFromS, zodra hij ze kan betalen
    researchFromS: nonneg,
    armyLoadouts: z.array(id).min(1), // loadouts voor het leger in voorkeursvolgorde; de eerste waarvoor de techs er zijn
    richScrap: nonneg, // boven deze voorraad schoolt hij bestaande militie om naar het eerste loadout uit armyLoadouts en bouwt hij richBuilds
    richBuilds: z.array(z.object({ buildingId: id, site: AiSite }).strict()), // extra gebouwen bij genoeg scrap, in volgorde; een verloren gebouw bouwt hij opnieuw
    scavengersPerNode: z.number().int().positive(), // hoogstens zoveel plunderaars per scrap-node; de rest wordt militie
    claimFromS: nonneg, // vanaf dan neemt een vrije bouwer neutrale claimpunten (dichtstbij eerst)
    claimSafeRadiusM: nonneg, // een claimpunt verder dan dit van het hoofdgebouw neemt hij pas vanaf claimFarFromS, met zijn vrije militie als escorte
    claimFarFromS: nonneg,
    // Data 0.20.0 (bevestigd in fase-0 sectie 22 besluit 4 tot 6): an idle hero walks to a neutral claim point within this distance and claims it by
    // standing there (sim.json heroClaimS); absent or 0 = off
    heroClaimRadiusM: nonneg.optional(),
    defendRadiusM: nonneg, // vijandelijke units binnen deze afstand van een eigen gebouw zijn een dreiging
    rallySite: AiSite, // verzamelpunt tussen de golven: hoofdgebouw, eigen claimpunt het dichtst bij huis, of het dichtst bij de vijand
    rallyRadiusM: nonneg, // militie zonder taak verder dan dit van het verzamelpunt loopt erheen
    waveIntervalS: z.number().positive(), // na de laatste attackTimersS komt er elke zoveel seconden een golf
    waveJitterS: nonneg, // plus een willekeurige 0..waveJitterS seconden (sim.rng), zodat de AI niet voorspelbaar is
    waveMinArmy: z.number().int().nonnegative(), // de eerste golf vertrekt pas met zoveel militie
    waveArmyGrowth: z.number().int().nonnegative(), // elke volgende golf vraagt zoveel militie meer
    waveMaxWaitS: nonneg, // na zoveel seconden wachten vertrekt de golf ook met waveMinArmy
    pushMinArmy: z.number().int().nonnegative(), // een golf van minder militie valt alleen claimpunten aan (een raid); vanaf zoveel gaat hij naar het hoofdgebouw
    pushFromS: nonneg, // en dat pas vanaf deze speeltijd; daarvoor is elke golf een raid
    // Data 0.16.0: robotproductie van de AI (optioneel, alleen een factie met robots)
    robots: z
      .object({
        sequence: z.array(id).min(1), // loadouts in cyclische volgorde; een nog niet beschikbare slaat hij over
        fromS: nonneg, // vanaf deze speeltijd
        max: z.number().int().positive(), // hoogstens zoveel levende robots
        // data 0.17.0 (confirmed, fase-0 section 21 decision 1): robots count with their popCost toward
        // waveMinArmy, pushMinArmy and reserve.minArmy
        countAsArmy: z.boolean().optional(),
        // data 0.17.0 (confirmed, section 21 decision 1): the AI keeps this much pop free for robots (no housing
        // beyond popCapMax - reservePop beds)
        reservePop: z.number().int().nonnegative().optional(),
        // data 0.26.0 (voorstel, ter bevestiging door de architect): builder robots (a loadout with canBuild) besides
        // the sequence: from fromS on the AI keeps up to max of them (alive plus in production); they build like its
        // builders, do not count toward max, the army or the human builders of `builders`
        builders: z
          .object({
            loadoutId: id,
            max: z.number().int().positive(),
            fromS: nonneg,
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    // Data 0.17.0 (confirmed, fase-0 section 21 decision 1): spending rules for the tech tree (optional). From fromS
    // on, with at least minArmy army and no enemy at its buildings, the AI saves for the first goal that only misses
    // scrap, in the order research, robots, training (robots first from robotsFirstFromS); recruiting militia only
    // spends what is above that reserve.
    reserve: z
      .object({
        fromS: nonneg,
        minArmy: z.number().int().nonnegative(),
        robotsFirstFromS: nonneg, // from then on robots come before research
      })
      .strict()
      .optional(),
    // Data 0.17.0 (confirmed, fase-0 section 21 decision 1): SPECIAL training of the AI (optional): from fromS on,
    // one run at a time per training building, in this order; a program listed n times is trained up to n points
    // (never past its maxPoints); only under the reserve condition.
    training: z
      .object({
        sequence: z.array(id).min(1),
        fromS: nonneg,
      })
      .strict()
      .optional(),
    // Data 0.21.0 (Raiders; bevestigd in fase-0 sectie 23 besluit 2): het roof- en harassplan van het Raider-script
    // (optioneel; Dwellers hebben het niet). De rest van het script (bouwvolgorde, golven, claims) gebruikt de gewone velden.
    raidPlan: RaidPlan.optional(),
    // Data 0.25.0 (creep camps; bevestigd in fase-0 sectie 23 besluit 5): when the AI clears the bandit camps of the
    // map (data/creeps.json). From fromS on, with no enemy at its buildings, an idle army of at least minArmy (the
    // entry for the camp's tier; a tier without an entry is never attacked) walks to the nearest living camp within
    // maxPathM over land of its headquarters, with the hero. Absent = the AI leaves the camps alone.
    creeps: z
      .object({
        fromS: nonneg,
        maxPathM: z.number().positive(),
        tiers: z
          .array(
            z
              .object({ tier: z.number().int().positive(), minArmy: z.number().int().positive() })
              .strict(),
          )
          .min(1),
        _comment: comment,
      })
      .strict()
      .optional(),
    // Data 0.31.0 (win route C; voorstel, ter bevestiging door content en de architect): how the AI treats the
    // Bouwproject (only in the game type Bouwproject). restoreFromS (absent = never restore): from then on, with an army of
    // at least restoreMinArmy and no enemy at its buildings, it sends `builders` idle builders to restore the nearest ruin
    // of a kind it lacks (one restore at a time). sabotageKinds: once an opponent holds a restored part of this many kinds
    // (or runs his countdown), an idle army of at least sabotageMinArmy attacks his part nearest to the own headquarters.
    // rallyAtParts: an idle army rallies at the own parts while it holds one (the defence of the turtle).
    project: z
      .object({
        restoreFromS: nonneg.optional(),
        restoreMinArmy: z.number().int().nonnegative(),
        builders: z.number().int().positive(),
        sabotageKinds: z.number().int().positive(),
        sabotageMinArmy: z.number().int().nonnegative(),
        rallyAtParts: z.boolean(),
        _comment: comment,
      })
      .strict()
      .optional(),
    // Data 0.24.0 (proposal, to be confirmed by the architect): the script an AI of `faction` plays against an opponent of
    // this faction (optional; the opponent's faction is lobby knowledge). Without `versus` it is the faction's default
    // script; at most one script per faction and opponent (the loader checks).
    versus: id.optional(),
    // Data 0.24.0 (proposal, to be confirmed by the architect): liberation (optional). With at least minFree idle militia
    // and no threat, the AI sends up to `units` of them (Attack: walk up and touch) to the visible enemy slave or captive
    // nearest its headquarters within radiusM of one of its own buildings.
    liberate: z
      .object({
        minFree: z.number().int().positive(),
        units: z.number().int().positive(),
        radiusM: nonneg,
      })
      .strict()
      .optional(),
    // Data 0.24.0 (proposal, to be confirmed by the architect): while an enemy stands within defendRadiusM of the
    // headquarters, every militia and robot that is not on a push turns to that threat, also those already on their way
    // to a threat elsewhere or on a raid (optional, default false)
    defendHqFirst: z.boolean().optional(),
    allInWithoutNodes: z.boolean(), // zonder bruikbare scrap-node (geen inkomen meer) gaan elke golf naar het hoofdgebouw, met de plunderaars mee
    _comment: comment,
  })
  .strict();

// Formation and arrival spreading for group orders (data/sim.json `formation`, data 0.15.0).
export const FormationTuning = z
  .object({
    gapM: nonneg, // free space between neighbouring formation slots
    widthPct: z.number().positive(), // columns ~ sqrt(units * widthPct / 100): wider than deep above 100
    slackM: nonneg, // a unit this close to its slot that touches a blocking stationary unit has arrived
    directRangeM: nonneg, // within this range of its slot, with a clear line, a unit leaves the flow field and walks straight
    gatherRingM: nonneg, // radius of the ring of worker slots around a scrap node
    _comment: comment,
  })
  .strict();

// Building placement margins (data/sim.json `placement`, data 0.18.0; bevestigd in fase-0 sectie 22 besluit 4 tot 6).
export const PlacementTuning = z
  .object({
    clearanceM: z.number().min(1), // free walkable ground around every footprint, also from nodes and claim points; at least 1 m (one cell), then placing a building never cuts a walkable connection
    depotClearanceM: nonneg, // aisle around a drop-off building (provides hq or werkplaats): no other building this close
    // Data 0.20.0 (Martien 16 October; bevestigd in fase-0 sectie 22 besluit 4 tot 6): territory. A new footprint must
    // touch a cell within buildRangeM of an own building (claimBuildRangeM of a claim post), counted in steps over
    // walkable terrain (a cliff, rock or water stops it); 0 = no territory rule
    buildRangeM: z.number().min(0).max(100),
    claimBuildRangeM: z.number().min(0).max(100),
    _comment: comment,
  })
  .strict()
  .refine((t) => t.depotClearanceM >= t.clearanceM, {
    message: 'depotClearanceM is minstens clearanceM',
    path: ['depotClearanceM'],
  });

// Fog of war (data/sim.json `vision`, data 0.22.0; bevestigd in fase-0 sectie 23 besluit 1). Every own unit and
// building reveals a disc on the vision grid of cellM x cellM metres; the defaults hold for records without sightM.
export const VisionTuning = z
  .object({
    cellM: z.union([z.literal(1), z.literal(2), z.literal(4)]), // side of a vision cell; 1, 2 or 4 m (a power of two)
    unitSightM: sight, // default sight of a loadout, from the unit's centre
    heroSightM: sight, // default sight of a hero
    buildingSightM: sight, // default sight of a building beyond its footprint edge
    turretSightExtraM: sight, // default sight of a turret beyond its rangeM (from the footprint edge)
    _comment: comment,
  })
  .strict();

// Guard mode (data/sim.json `guard`, data 0.29.0; voorstel, ter bevestiging door de architect): the Guard command
// (protocol 0.15.0) keeps a fighter at an own Kooi or a scrap node.
export const GuardTuning = z
  .object({
    standM: nonneg, // a guard walks back until it is within this of its target (Kooi footprint edge, node centre)
    leashM: nonneg, // a guard fights an enemy only while it stays within this of its target, at least standM
    _comment: comment,
  })
  .strict()
  .refine((t) => t.leashM >= t.standM, {
    message: 'leashM is minstens standM',
    path: ['leashM'],
  });

// Base defence (data/sim.json `baseDefense`, data 0.35.0; voorstel, ter bevestiging door de architect): fighters in an
// attacked base engage the threat, workers take shelter, everyone resumes after calmS without a threat.
export const BaseDefenseTuning = z
  .object({
    survival: z.boolean(), // on in the game type Survival (radius: the build zone)
    skirmish: z.boolean(), // on in every other game type (radius: radiusM around the HQ)
    radiusM: z.number().positive(),
    calmS: nonneg, // the alarm ends this long after the last threat in the radius
    retargetM: nonneg, // defenders get a new AttackMove point once the threat is this far from the old one
    _comment: comment,
  })
  .strict();

export type AiScript = z.infer<typeof AiScript>;

export type FormationTuning = z.infer<typeof FormationTuning>;

export type PlacementTuning = z.infer<typeof PlacementTuning>;

export type VisionTuning = z.infer<typeof VisionTuning>;
