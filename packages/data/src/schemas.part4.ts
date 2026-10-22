// Split from schemas.ts to stay under the 5,000-token file limit; schemas.ts re-exports the public surface.
// Holds: SimTuning, CreepUnit, CreepTier, CreepTakeoverTier, CreepTakeover, Creeps, +9 more.
import { z } from 'zod';
import {
  ArmorType,
  BodyType,
  DamageType,
  Effect,
  comment,
  id,
  nonneg,
  pct,
  sight,
} from './schemas.part1.js';
import {
  BaseDefenseTuning,
  DifficultyTuning,
  FormationTuning,
  GuardTuning,
  PlacementTuning,
  VisionTuning,
} from './schemas.part3.js';

// Sim-tuning (data/sim.json): globale getallen die de sim nodig heeft maar die bij geen loadout horen.
export const SimTuning = z
  .object({
    unitRadiusM: nonneg, // globale unitstraal voor separatie, in meters
    arriveRadiusM: nonneg, // een Move-order is klaar binnen deze afstand
    separationPct: z.number().min(0).max(100), // deel van de overlap dat separatie per tick oplost
    // Data 0.11.0 (sim-core, grote map): hiërarchische padvinding in cellen van 1 m (zie _comment in data/sim.json)
    pathSectorCells: z
      .number()
      .int()
      .min(4)
      .max(64)
      .refine((v) => (v & (v - 1)) === 0, 'een macht van 2'), // sectorzijde van de padgraaf
    pathEntranceMaxCells: z.number().int().positive(), // langste ingang per knopenpaar op een sectorgrens, hoogstens pathSectorCells
    pathCacheCells: z.number().int().positive(), // geheugenbudget van de regiovelden; snelheid, nooit de uitkomst
    walkAnimStep: z.number().int().min(0).max(65535), // ruwe animT-stap per tick (0..65535 wrapt), geen menselijke eenheid
    // Sprint 2 (sim-core, ter review door de architect en content):
    aggroRangeM: nonneg, // militie en units op AttackMove kiezen zelf een doel binnen deze afstand
    interactRangeM: nonneg, // reikwijdte voor verzamelen, afleveren, bouwen en omscholen (tot node of footprint)
    claimRadiusM: nonneg, // straal rond een claimpunt: een voltooid claimgebouw (provides claim) hierbinnen houdt het punt (exclusieve nodes: exclusiveRadiusM, data 0.20.0)
    popCapMax: z.number().int().nonnegative(), // bovengrens pop-cap per speler, los van de bedden (Spelfundament 2.5)
    corpseS: nonneg, // seconden dat een gedode unit als lijk blijft staan (death-animatie)
    cancelRefundPct: z.number().min(0).max(100), // teruggave bij Cancel van een bouwplaats of betaalde omscholing (besluit sprint 2)
    // Sprint 3 (sim-core, ter review): SPECIAL van de held, per punt van de letter (zie _comment in data/sim.json).
    specialStrengthDamagePct: z.number(), // S: procent extra schade van de held per punt
    specialPerceptionRangeM: z.number(), // P: meter extra wapenbereik van de held per punt
    specialEnduranceHpPct: z.number(), // E: procent extra hp van de held per punt
    specialCharismaGrowthPct: z.number(), // C: procent extra huisvestingsgroei per punt, zolang de held leeft
    specialIntelligenceResearchPct: z.number(), // I: procent onderzoekstijd per punt (negatief = sneller), zolang de held leeft
    specialAgilitySpeedPct: z.number(), // A: procent extra snelheid van de held per punt
    specialLuckCritPct: z.number().min(0), // L: procent kans op een kritiek schot van de held per punt
    critDamagePct: z.number().min(0), // extra schade van een kritiek schot, in procent
    // Data 0.8.0 (sim-core, speltest): een bouwer zonder taak helpt vanzelf bij een eigen bouwplaats binnen deze straal (tot de rand van de footprint)
    builderAutoHelpRadiusM: nonneg,
    _comment: comment,
    // Data 0.16.0 (sim-core, visual review item 5): group-order spreading (see _comment in data/sim.json)
    formation: FormationTuning,
    // Data 0.18.0 (sim-core, playtest 16 October; bevestigd in fase-0 sectie 22 besluit 4 tot 6): building placement
    // margins, and new scavenger settlers of a human player start gathering at the nearest reachable node within this
    // radius of where they arrive (0 = off; the scripted AI assigns its own settlers)
    placement: PlacementTuning,
    autoGatherRadiusM: nonneg,
    // Data 0.20.0 (claim round, Martien 16 October; bevestigd in fase-0 sectie 22 besluit 4 tot 6): a scrap node within
    // this distance of a held claim point is exclusive to its owner. Was claimRadiusM; separate so a map can keep its
    // scrap outside the claim circle (room for the claim post) and the node still belongs to the claimed point.
    exclusiveRadiusM: nonneg,
    // Data 0.20.0 (claim round, Martien 16 October; bevestigd in fase-0 sectie 22 besluit 4 tot 6): the hero claims a
    // free claim point by standing in its circle for heroClaimS (0 = off), without a post; such a tower-less claim
    // goes over to an enemy after contestFlipS with enemy units and none of the holder in the circle
    heroClaimS: nonneg,
    contestFlipS: nonneg,
    // Data 0.22.0 (fog of war; bevestigd in fase-0 sectie 23 besluit 1): the vision grid and default sight radii
    vision: VisionTuning,
    // Data 0.29.0 (the Guard command; voorstel, ter bevestiging door de architect)
    guard: GuardTuning,
    baseDefense: BaseDefenseTuning,
    // Data 0.45.0 (moeilijkheidsgraad, sim 0.37.0, protocol 0.21.0; voorstel, besluit fase-0 sectie 26): de banden per
    // niveau van MatchSettings.difficulty. Optioneel: data zonder dit blok kent geen niveaus (de AI speelt zijn script).
    difficulty: DifficultyTuning.optional(),
  })
  .strict()
  .refine((t) => t.pathEntranceMaxCells <= t.pathSectorCells, {
    message: 'pathEntranceMaxCells is hoogstens pathSectorCells',
    path: ['pathEntranceMaxCells'],
  })
  .refine((t) => t.exclusiveRadiusM >= t.claimRadiusM, {
    message: 'exclusiveRadiusM is minstens claimRadiusM',
    path: ['exclusiveRadiusM'],
  });

// Creep camps (data 0.25.0, phase 2 round 2; bevestigd in fase-0 sectie 23 besluit 5): data/creeps.json. Bandit
// nests of the map (MapDef.creepCamps, Spelfundament 3.2: "bandietennesten als creeps met loot en held-XP"). `units`
// are the neutral loadouts of the camps (no faction: they are never trained or built; the loader appends them after
// the loadouts of the factions, so their typeIds follow the faction loadouts); `tiers` is what a camp of a map tier
// holds and gives. The rules (sim, packages/sim/src/systems/creeps.ts): a camp aggroes on a player unit within
// aggroRadiusM of its centre (or when one of its bandits is hit), its bandits fight player units within leashRadiusM of
// the centre and never attack buildings; a bandit beyond leashRadiusM, or no player unit left in that circle, sends the
// whole camp home, where it heals to full. The last bandit's killing blow gives lootScrap to that player and heroXp to
// his living hero within heroXpRadiusM of the centre. respawnS 0: the camp stays empty, else it comes back that long
// after it was cleared once no player unit is within aggroRadiusM.
export const CreepUnit = z
  .object({
    id,
    naam: z.string().min(1),
    bodyType: BodyType,
    weapon: z.string(),
    armorType: ArmorType,
    hp: z.number().positive(),
    damage: nonneg,
    damageType: DamageType,
    rangeM: nonneg,
    speedMps: nonneg,
    cooldownS: nonneg,
    sightM: sight.optional(),
    visuals: z.object({ meshSlots: z.record(z.string(), z.string()) }).strict(),
    _comment: comment,
  })
  .strict();

export const CreepTier = z
  .object({
    tier: z.number().int().positive(),
    naam: z.string().min(1),
    units: z.array(z.object({ unitId: id, count: z.number().int().positive() }).strict()).min(1),
    aggroRadiusM: z.number().positive(),
    leashRadiusM: z.number().positive(),
    respawnS: nonneg,
    lootScrap: z.number().int().nonnegative(),
    heroXp: z.number().int().nonnegative(),
    heroXpRadiusM: nonneg,
    _comment: comment,
  })
  .strict()
  .refine((t) => t.leashRadiusM >= t.aggroRadiusM, {
    message: 'leashRadiusM is minstens aggroRadiusM',
    path: ['leashRadiusM'],
  });

// Camp takeover (data 0.27.0, sim 0.22.0; voorstel, ter bevestiging door de architect): per faction the camp tiers it
// can take over instead of clearing them (Spelfundament 4, "plunderen en werven": the Raiders recruit). A camp of such
// a tier that fights units of only that faction within its leash circle, at least `minUnits` of them, surrenders once
// its bandits are down to `surrenderHpPct` of their summed hp: the survivors join that player as fighters, he gets the
// tier's lootScrap and heroXp as for a clear, and the camp is his outpost. Killing the last bandit takes it over too.
// The outpost yields one bandit of the tier (in tier order) every `yieldS` for its owner, at most `yieldMax` in all,
// while no unit of another player stands within aggroRadiusM of the centre. A faction without an entry clears camps as
// before.
export const CreepTakeoverTier = z
  .object({
    tier: z.number().int().positive(),
    surrenderHpPct: pct,
    minUnits: z.number().int().positive(),
    yieldS: nonneg,
    yieldMax: z.number().int().nonnegative().max(255),
    _comment: comment,
  })
  .strict();

export const CreepTakeover = z
  .object({
    faction: id,
    tiers: z.array(CreepTakeoverTier).min(1),
    _comment: comment,
  })
  .strict();

export const Creeps = z
  .object({
    units: z.array(CreepUnit),
    tiers: z.array(CreepTier),
    takeover: z.array(CreepTakeover).optional(),
    _comment: comment,
  })
  .strict();

// Win route C, Bouwproject (data 0.31.0; voorstel, ter bevestiging door content en de architect;
// docs/winroute-c-winkelcentrum.md): an old strip mall whose parts stand as neutral ruins on the map
// (MapDef.projectSites). Builders restore a ruin (Build on it): restoreScrap at once, restoreS of building work. A
// restored part belongs to its restorer, gives his effects (tech semantics), beds and sight, and can be attacked; at 0
// hp it falls back to a ruin. Who holds a restored part of every kind runs the public countdown (countdownS); a hit on
// one of his parts pauses it for pauseAfterHitS, losing his last part of a kind resets it. The loader appends two
// building types per part after the faction buildings (the restored part with the part id as key, the ruin with
// `<id>_ruin`), faction NEUTRAL_FACTION_ID, so no faction building changes id.
export const ProjectPart = z
  .object({
    id,
    naam: z.string().min(1),
    hp: z.number().positive(),
    armorType: ArmorType,
    restoreScrap: nonneg,
    restoreS: nonneg,
    footprint: z
      .object({ w: z.number().int().positive(), h: z.number().int().positive() })
      .strict(), // cellen van 1 m
    beds: z.number().int().nonnegative(),
    sightM: sight.optional(), // the restored part, beyond the footprint edge; absent = vision.buildingSightM
    effects: z.array(Effect), // for the holder of the restored part, like a researched tech
    visuals: z.object({ ruin: z.string().min(1), restored: z.string().min(1) }).strict(),
    _comment: comment,
  })
  .strict();

export const Project = z
  .object({
    countdownS: z.number().positive(),
    pauseAfterHitS: nonneg,
    parts: z.array(ProjectPart).min(1),
    _comment: comment,
  })
  .strict();

export type ProjectPart = z.infer<typeof ProjectPart>;

export type Project = z.infer<typeof Project>;

export type CreepUnit = z.infer<typeof CreepUnit>;

export type CreepTier = z.infer<typeof CreepTier>;

export type Creeps = z.infer<typeof Creeps>;

export type CreepTakeover = z.infer<typeof CreepTakeover>;

export type SimTuning = z.infer<typeof SimTuning>;
