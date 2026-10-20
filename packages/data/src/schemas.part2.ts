// Split from schemas.ts to stay under the 5,000-token file limit; schemas.ts re-exports the public surface.
// Holds: Loadout, TurretNetwork, Building, Tech, Special, AbilityEffect, +20 more.
import { z } from 'zod';
import {
  Archetype,
  ArmorType,
  BodyType,
  BuildingPlacement,
  Cage,
  Capture,
  DamageType,
  Effect,
  EffectStat,
  Provides,
  Repair,
  Overload,
  Transport,
  Role,
  Siege,
  Stat,
  UnitAura,
  comment,
  id,
  nonneg,
  pct,
  sight,
} from './schemas.part1.js';

export const Loadout = z
  .object({
    id,
    faction: id,
    bodyType: BodyType,
    role: Role,
    weapon: z.string(),
    armorType: ArmorType,
    hp: nonneg,
    damage: nonneg,
    damageType: DamageType,
    rangeM: nonneg,
    speedMps: nonneg,
    cooldownS: nonneg,
    scrapCost: nonneg,
    craftS: nonneg,
    gatherAmount: z.number().int().nonnegative(), // scrap per verzamelronde; 0 voor niet-verzamelaars
    gatherS: nonneg, // seconden per verzamelronde; 0 voor niet-verzamelaars
    popCost: z.number().int().positive(),
    prereqTech: z.array(id),
    visuals: z.object({ meshSlots: z.record(z.string(), z.string()) }).strict(), // slot -> manifest-id
    // Data 0.16.0: waar een unit gemaakt wordt. Afwezig = omscholen van een bewoner in de werkplaats (alle bewoners).
    // Aanwezig = gebouw-id waar de unit nieuw gebouwd wordt (robots); verplicht bij bodyType robot.
    // Data 0.21.0 (bevestigd in fase-0 sectie 23 besluit 2): ook toegestaan voor een ander lichaam (de vechters,
    // honden en de Buggy van de Raiders worden nieuw gebouwd in een tent of de autosloperij); een slaaf heeft het nooit.
    producedAt: id.optional(),
    repair: Repair.optional(), // role robot, or (data 0.39.0, proposal) role technician (the Klerk)
    siege: Siege.optional(), // alleen role robot
    // Data 0.21.0 (Raiders; bevestigd in fase-0 sectie 23 besluit 2), alle optioneel
    slave: z.boolean().optional(), // true = slaaf: arbeider (role scavenger of builder), vecht nooit, werkt binnen de Kooi-straal, bevrijdbaar
    capture: Capture.optional(), // Slaver
    aura: UnitAura.optional(), // Chem-dealer
    // Data 0.38.0 (de Garde; proposal for the architect): fusion cores this unit takes from the stock when its
    // production starts (factions fusionCores); absent = 0
    fusionCores: z.number().int().nonnegative().max(255).optional(),
    // Data 0.39.0 (the Garde, round B; proposal for the architect): see Overload and Transport in schemas.part1.ts;
    // flying = moves straight over any terrain (no flow field, no walls, no separation); absent = false
    overload: Overload.optional(),
    transport: Transport.optional(),
    flying: z.boolean().optional(),
    // Data 0.22.0 (fog of war; bevestigd in fase-0 sectie 23 besluit 1): sight radius from the unit's centre;
    // absent = sim.json vision.unitSightM
    sightM: sight.optional(),
    // Data 0.26.0 (voorstel, ter bevestiging door de architect): a robot that builds like a builder (Build, help at a
    // site, resume a site, Claim). Only for role robot (a human builder has role builder); absent = false.
    canBuild: z.boolean().optional(),
    _comment: comment,
  })
  .strict()
  .superRefine((l, ctx) => {
    if (l.canBuild === true && l.role !== 'robot')
      ctx.addIssue({
        code: 'custom',
        path: ['canBuild'],
        message: 'alleen voor een robot (een bewoner bouwt met role builder)',
      });
    if (l.slave === true) {
      const bad = (path: string, message: string): void =>
        ctx.addIssue({ code: 'custom', path: [path], message });
      if (l.role !== 'scavenger' && l.role !== 'builder')
        bad('role', 'een slaaf is een arbeider: role scavenger of builder');
      if (l.bodyType !== 'human') bad('bodyType', 'een slaaf is human');
      if (l.damage > 0) bad('damage', 'een slaaf vecht nooit: damage 0');
      if (l.producedAt !== undefined) bad('producedAt', 'een slaaf wordt geroofd, niet gebouwd');
      if (l.capture !== undefined || l.aura !== undefined)
        bad('slave', 'een slaaf heeft geen capture of aura');
    }
    const robot = l.bodyType === 'robot';
    if (robot !== (l.role === 'robot'))
      ctx.addIssue({
        code: 'custom',
        path: ['role'],
        message: 'role robot hoort bij bodyType robot en andersom',
      });
    if (robot && l.producedAt === undefined)
      ctx.addIssue({
        code: 'custom',
        path: ['producedAt'],
        message: 'verplicht bij bodyType robot',
      });
    if (l.siege !== undefined && !robot)
      ctx.addIssue({ code: 'custom', path: ['siege'], message: 'alleen voor een robot' });
    if (l.repair !== undefined && !robot && l.role !== 'technician')
      ctx.addIssue({
        code: 'custom',
        path: ['repair'],
        message: 'alleen voor een robot of een technician',
      });
  });

// Turret-netwerk (data 0.16.0): een turret krijgt extra schade voor elke andere eigen voltooide turret binnen radiusM,
// gemaximeerd, zodra requiresTech onderzocht is. Alleen voor een gebouw met provides turret.
export const TurretNetwork = z
  .object({
    requiresTech: id, // tech die het netwerk activeert
    radiusM: nonneg, // straal rond het midden van de turret
    damagePctPerTurret: nonneg, // procent extra schade per andere turret in de straal
    maxDamagePct: nonneg, // bovengrens van het totale netwerkbonus
  })
  .strict();

export const Building = z
  .object({
    id,
    faction: id,
    hp: nonneg,
    armorType: ArmorType,
    scrapCost: nonneg,
    buildS: nonneg,
    footprint: z
      .object({ w: z.number().int().positive(), h: z.number().int().positive() })
      .strict(), // cellen van 1 m
    beds: z.number().int().nonnegative(),
    provides: z.array(Provides),
    prereqTech: z.array(id),
    visuals: z.object({ mesh: z.string() }).strict(),
    // Alleen voor gebouwen met provides turret (besluit 8, sectie 14); verplicht daar, zie de refine.
    damage: nonneg.optional(),
    damageType: DamageType.optional(),
    rangeM: nonneg.optional(),
    cooldownS: nonneg.optional(),
    network: TurretNetwork.optional(), // data 0.16.0, alleen bij provides turret
    // Data 0.21.0 (Raiders; bevestigd in fase-0 sectie 23 besluit 2), optioneel
    cage: Cage.optional(), // verplicht bij provides kooi en anders niet toegestaan
    placement: BuildingPlacement.optional(), // de Kooi staat aan de rand van de basis
    // Data 0.22.0 (fog of war; bevestigd in fase-0 sectie 23 besluit 1): sight radius beyond the footprint edge
    // (the sim adds half the larger footprint side); absent = rangeM + vision.turretSightExtraM for a turret, else
    // vision.buildingSightM
    sightM: sight.optional(),
    _comment: comment,
  })
  .strict()
  .superRefine((b, ctx) => {
    if (b.provides.includes('kooi') !== (b.cage !== undefined))
      ctx.addIssue({
        code: 'custom',
        path: ['cage'],
        message: 'verplicht bij provides kooi en anders niet toegestaan',
      });
    if (!b.provides.includes('turret')) {
      if (b.network !== undefined)
        ctx.addIssue({
          code: 'custom',
          path: ['network'],
          message: 'alleen voor een gebouw met provides turret',
        });
      return;
    }
    for (const field of ['damage', 'damageType', 'rangeM', 'cooldownS'] as const) {
      if (b[field] === undefined)
        ctx.addIssue({
          code: 'custom',
          path: [field],
          message: `verplicht voor een gebouw met provides turret`,
        });
    }
  });

export const Tech = z
  .object({
    id,
    faction: id,
    scrapCost: nonneg,
    researchS: nonneg,
    building: id,
    prereqTech: z.array(id),
    effects: z.array(Effect),
    // Data 0.39.0 (proposal for the architect): techs sort by (idGroup, id); a later group appends its techIds without
    // shifting the older ones, so recorded replays keep their Research techIds. Absent = 0.
    idGroup: z.number().int().nonnegative().max(255).optional(),
    _comment: comment,
  })
  .strict();

export const Special = z
  .object({
    S: z.number().int(),
    P: z.number().int(),
    E: z.number().int(),
    C: z.number().int(),
    I: z.number().int(),
    A: z.number().int(),
    L: z.number().int(),
  })
  .strict();

// Effect van een ability op alles binnen de radius, gedurende durationS. Zelfde stat-enum en suffix-conventie als tech en perks.
// side: 'enemy' = vijanden van de held, 'ally' = eigen units en gebouwen van de speler. target: 'units', 'turrets' of 'alle'.
export const AbilityEffect = z
  .object({
    stat: EffectStat,
    side: z.enum(['enemy', 'ally']),
    target: z.enum(['units', 'turrets', 'alle']),
    delta: z.number(),
  })
  .strict();

export const Ability = z
  .object({
    id,
    naam: z.string(),
    cooldownS: nonneg,
    rangeM: nonneg, // max afstand van de held tot het doelpunt (0 = op de held zelf)
    radiusM: nonneg, // straal rond het doelpunt waarbinnen de effecten gelden
    durationS: nonneg, // duur van de effecten in seconden
    effects: z.array(AbilityEffect),
    _comment: comment,
  })
  .strict();

// Passieve aura rond de held (data 0.21.0): effecten op alles binnen radiusM, zolang de held leeft. Zelfde stats als een ability.
export const HeroAura = z
  .object({ radiusM: nonneg, effects: z.array(AbilityEffect).min(1) })
  .strict();

export const Hero = z
  .object({
    id,
    faction: id,
    archetype: Archetype,
    special: Special,
    naam: z.string(), // weergavenaam voor de HUD
    /**
     * XP per levelstap, PER STAP (niet cumulatief): xpPerLevel[0] = xp om van level 1 naar 2 te komen, [1] = van 2 naar 3, enzovoort.
     * Maxlevel = lengte + 1. De loader levert de cumulatieve drempels (xpThresholds) als integers.
     */
    xpPerLevel: z.array(z.number().int().positive()).min(1),
    xpPerKill: z.number().int().nonnegative(), // xp voor de held per gedode vijandelijke unit
    xpPerDiscovery: z.number().int().nonnegative(), // xp voor de held per ontdekking (eerste keer een claimpunt of creep-kamp nemen)
    // Balans speltest 14 oktober: xp voor de held per vijandelijke unit die een eigen unit of turret doodt binnen xpAssistRadiusM van de levende held
    xpPerAssist: z.number().int().nonnegative(),
    xpAssistRadiusM: nonneg,
    abilities: z.array(Ability),
    // Data 0.16.0: passieve effecten van de held voor zijn speler, zolang hij leeft; zelfde semantiek als perk-effecten
    // (optelbaar, geschaald met revivePenaltyPct per oplap, weg als de held dood of leeg is).
    passives: z.array(Effect),
    // Data 0.21.0 (Raiders; bevestigd in fase-0 sectie 23 besluit 2), alle optioneel: de intimidatie-aura van de Warlord
    // (altijd aan, zolang de held leeft; zelfde effect-vorm als een ability), xp per geroofde gevangene, en het basis-loadout
    // van de held (afwezig = het goedkoopste loadout met role militia zonder prereqTech en zonder producedAt van de factie).
    aura: HeroAura.optional(),
    xpPerCapture: z.number().int().nonnegative().optional(),
    baseLoadoutId: id.optional(),
    perkPool: z.array(id),
    reviveScrap: nonneg,
    reviveS: nonneg,
    revivePenaltyPct: nonneg, // 20 volgens het Spelfundament
    maxRevives: z.number().int().nonnegative(), // aantal keer oplappen voordat de held leeg is
    // Data 0.22.0 (fog of war; bevestigd in fase-0 sectie 23 besluit 1): sight radius of the hero; absent =
    // sim.json vision.heroSightM
    sightM: sight.optional(),
    _comment: comment,
  })
  .strict();

export const Perk = z
  .object({
    id,
    naam: z.string(),
    flavourText: z.string(),
    requires: z.object({ stat: Stat, min: z.number().int() }).strict(),
    effects: z.array(Effect),
    _comment: comment,
  })
  .strict();

// Trainingsprogramma (data 0.16.0, SPECIAL-kanaal 'training' van de Dwellers): koopt +pointsPerRun punten op een SPECIAL-letter
// van de held van de speler, in een gebouw met provides training. Elke run kost scrapCost + scrapCostStep maal het aantal
// al getrainde punten op die letter en duurt trainS + trainSStep maal dat aantal; hoogstens maxPoints punten per letter.
export const Training = z
  .object({
    id,
    faction: id,
    special: Stat,
    building: id,
    scrapCost: nonneg,
    scrapCostStep: nonneg,
    trainS: nonneg,
    trainSStep: nonneg,
    pointsPerRun: z.number().int().positive(),
    maxPoints: z.number().int().positive(),
    prereqTech: z.array(id),
    _comment: comment,
  })
  .strict();

const ArmorRow = z.record(ArmorType, z.number().nonnegative()); // multiplier in procenten per pantsertype

// Strict object per schadetype (i.p.v. record) zodat het bestand een _comment kan dragen.
export const DamageMatrix = z
  .object({
    _comment: comment,
    ballistic: ArmorRow,
    energy: ArmorRow,
    melee: ArmorRow,
    fire: ArmorRow,
  })
  .strict();

export const MapDef = z
  .object({
    id,
    size: z.object({ w: z.number().int().positive(), h: z.number().int().positive() }).strict(), // cellen van 1 m
    heightmap: z.string(),
    passability: z.string(),
    props: z.string().optional(), // optioneel, buiten de sim: decoratieve props (data/maps/<id>.props.json), alleen voor de renderer
    water: z.string().optional(), // optioneel, buiten de sim: watermasker (data/maps/<id>.water.json, crawlout-grid/1 u8: 0 droog, 1 water, 2 ondiep en begaanbaar), alleen voor de renderer; de sim leest de passability
    scrapNodes: z.array(
      z.object({ x: z.number().int(), y: z.number().int(), amount: nonneg }).strict(),
    ),
    claimPoints: z.array(
      z
        .object({
          x: z.number().int(),
          y: z.number().int(),
          kind: z.enum(['scrap', 'settlement', 'powerArmor']),
        })
        .strict(),
    ),
    spawns: z.array(z.object({ x: z.number().int(), y: z.number().int() }).strict()),
    creepCamps: z.array(
      z.object({ x: z.number().int(), y: z.number().int(), tier: z.number().int() }).strict(),
    ),
    dominance: z
      .object({ pointsRequired: z.number().int().positive(), minutes: z.number().positive() })
      .strict(),
    // Win route C (data 0.31.0; voorstel, ter bevestiging door de architect): the ruined parts of the strip mall, the
    // centre cell of each footprint (odd footprints, data/project.json) and the part id. Optional: a map without them
    // has no Bouwproject. Only in the game type Bouwproject do they reach the sim (MatchSettings.mode 'project').
    projectSites: z
      .array(z.object({ part: id, x: z.number().int(), y: z.number().int() }).strict())
      .optional(),
    _comment: comment,
  })
  .strict();

/** Waar de AI een gebouw uit de bouwvolgorde neerzet: bij het hoofdgebouw, bij zijn eigen claimpunt het dichtst bij huis, of bij zijn claimpunt het dichtst bij de vijand. */
export const AiSite = z.enum(['hq', 'claim', 'front']);

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
  })
  .strict();

export type RaidPlan = z.infer<typeof RaidPlan>;

export type Loadout = z.infer<typeof Loadout>;

export type Building = z.infer<typeof Building>;

export type Tech = z.infer<typeof Tech>;

export type Ability = z.infer<typeof Ability>;

export type Hero = z.infer<typeof Hero>;

export type Perk = z.infer<typeof Perk>;

export type Training = z.infer<typeof Training>;

export type MapDef = z.infer<typeof MapDef>;

export type DamageMatrix = z.infer<typeof DamageMatrix>;
