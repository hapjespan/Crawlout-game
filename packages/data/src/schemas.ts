import { z } from 'zod';

// Contract 3: schema-skeletten. Werkstroom content werkt ze uit; velden komen uit fase-0 sectie 6.
// Alle schema's zijn strict: onbekende velden laten de build falen. Eenheden hier zijn menselijk (m, s, %).
const id = z.string().min(1);
const nonneg = z.number().nonnegative();
const comment = z.string().optional(); // _comment: bedoeling van de waarde; verplicht gebruiken bij balanswaarden

export const ArmorType = z.enum(['none', 'light', 'medium', 'heavy', 'robot']);
export const DamageType = z.enum(['ballistic', 'energy', 'melee', 'fire']);
export const BodyType = z.enum(['human', 'robot']);
// Volgorde = index in ROLES (GameData). Nieuwe rollen staan achteraan zodat bestaande indices gelijk blijven.
// technician en robot (data 0.16.0): de technicus-regel en de Robotfabriek van de Dwellers.
export const Role = z.enum(['scavenger', 'builder', 'militia', 'technician', 'robot']);
export const Archetype = z.enum(['bouwer', 'krijger', 'tacticus']);
export const Provides = z.enum([
  'werkplaats',
  'huisvesting',
  'claim',
  'turret',
  'beacon',
  'lab',
  'hq',
  'training',
]);
export const Stat = z.enum(['S', 'P', 'E', 'C', 'I', 'A', 'L']);

// Vangnet (Spelfundament 4, data 0.16.0). Per factie een eigen actie; nu bekend: radiobaken_instroom (Dwellers).
// De arrival-velden (intervalS, maxArrivals, loadoutId) zijn verplicht bij die actie en verboden bij een andere.
export const SafetyNetAction = z.enum(['radiobaken_instroom']);
export const SafetyNet = z
  .object({
    threshold: z.number().int().nonnegative(),
    action: SafetyNetAction,
    intervalS: nonneg.optional(),
    maxArrivals: z.number().int().positive().optional(),
    loadoutId: id.optional(),
  })
  .strict()
  .superRefine((n, ctx) => {
    const needed = n.action === 'radiobaken_instroom';
    for (const field of ['intervalS', 'maxArrivals', 'loadoutId'] as const) {
      if (needed && n[field] === undefined)
        ctx.addIssue({ code: 'custom', path: [field], message: `verplicht bij ${n.action}` });
      if (!needed && n[field] !== undefined)
        ctx.addIssue({ code: 'custom', path: [field], message: `niet toegestaan bij ${n.action}` });
    }
    if (needed && n.intervalS !== undefined && n.intervalS <= 0)
      ctx.addIssue({ code: 'custom', path: ['intervalS'], message: 'moet groter dan 0 zijn' });
  });

// Robotregels van een factie met robots (data 0.16.0): de technicus-regel. Zie het _comment in data/factions.json.
export const RobotRules = z
  .object({
    robotsPerTechnician: z.number().int().positive(),
    technicianRoles: z.array(Role).min(1),
    robotPenaltyPct: z.number().min(0).max(100),
  })
  .strict();

export const Faction = z
  .object({
    id,
    naam: z.string(),
    bodyTypes: z.array(BodyType),
    startUnits: z.array(z.object({ loadoutId: id, count: z.number().int().positive() }).strict()),
    startScrap: nonneg,
    housingGrowthPerMin: nonneg,
    safetyNet: SafetyNet,
    robotRules: RobotRules.optional(), // alleen een factie met bodyType robot
    uniqueUnits: z.array(id),
    uniqueBuildings: z.array(id),
    specialChannel: z.enum(['training', 'chems', 'tech']),
    _comment: comment,
  })
  .strict()
  .superRefine((f, ctx) => {
    if (f.bodyTypes.includes('robot') !== (f.robotRules !== undefined))
      ctx.addIssue({
        code: 'custom',
        path: ['robotRules'],
        message: 'verplicht bij bodyType robot en anders niet toegestaan',
      });
  });

// Reparatie van een support-robot (data 0.16.0). targets: wat hij repareert (eigen units van bodyType robot en eigen gebouwen).
export const RepairTarget = z.enum(['building', 'robot']);
export const Repair = z
  .object({
    repairRateHpPerS: nonneg, // hp per seconde die hij op een doel in bereik herstelt
    rangeM: nonneg, // afstand (tot de rand van een footprint of het midden van een unit) waarbinnen hij repareert
    seekRangeM: nonneg, // afstand waarbinnen hij zelf een beschadigd doel zoekt als hij niets te doen heeft
    targets: z.array(RepairTarget).min(1),
  })
  .strict();
// Belegering (data 0.16.0): extra schade tegen gebouwen, bovenop de damage-matrix.
export const Siege = z
  .object({
    vsBuildingsDamagePct: nonneg, // 150 = 150 procent extra (dus 250 procent in totaal) tegen gebouwen
    buildingsFirst: z.boolean(), // kiest zelf eerst een gebouw als doel, daarna pas units
  })
  .strict();

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
    // Aanwezig = gebouw-id waar de unit nieuw gebouwd wordt (robots); verplicht bij bodyType robot, verboden bij human.
    producedAt: id.optional(),
    repair: Repair.optional(), // alleen role robot
    siege: Siege.optional(), // alleen role robot
    _comment: comment,
  })
  .strict()
  .superRefine((l, ctx) => {
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
    if (!robot && l.producedAt !== undefined)
      ctx.addIssue({
        code: 'custom',
        path: ['producedAt'],
        message: 'niet toegestaan bij bodyType human',
      });
    for (const field of ['repair', 'siege'] as const)
      if (l[field] !== undefined && !robot)
        ctx.addIssue({ code: 'custom', path: [field], message: 'alleen voor een robot' });
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
    _comment: comment,
  })
  .strict()
  .superRefine((b, ctx) => {
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

// Effect-stats met de suffix-conventie: Pct = procenten (promille in GameData), M = meters (eenheden), S = seconden (ticks).
// De losse SPECIAL-letters (S P E C I A L) zijn ruwe gehele getallen; die zijn bewust geen S-suffix.
export const EffectStat = z.enum([
  'hpPct',
  'damagePct',
  'speedPct',
  'rangeM',
  'gatherRatePct',
  'buildTimePct',
  'researchTimePct',
  'S',
  'P',
  'E',
  'C',
  'I',
  'A',
  'L',
  // Data 0.16.0: kosten van onderzoek in procenten (negatief = goedkoper); target 'alle'. Achteraan, zodat de indices gelijk blijven.
  'researchCostPct',
]);
export const Effect = z
  .object({ stat: EffectStat, target: z.string(), delta: z.number() })
  .strict();

export const Tech = z
  .object({
    id,
    faction: id,
    scrapCost: nonneg,
    researchS: nonneg,
    building: id,
    prereqTech: z.array(id),
    effects: z.array(Effect),
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
    perkPool: z.array(id),
    reviveScrap: nonneg,
    reviveS: nonneg,
    revivePenaltyPct: nonneg, // 20 volgens het Spelfundament
    maxRevives: z.number().int().nonnegative(), // aantal keer oplappen voordat de held leeg is
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
    _comment: comment,
  })
  .strict();

const pct = z.number().min(0).max(100);
/** Waar de AI een gebouw uit de bouwvolgorde neerzet: bij het hoofdgebouw, bij zijn eigen claimpunt het dichtst bij huis, of bij zijn claimpunt het dichtst bij de vijand. */
export const AiSite = z.enum(['hq', 'claim', 'front']);

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
    claimRadiusM: nonneg, // straal rond een claimpunt: een voltooid claimgebouw (provides claim) hierbinnen houdt het punt, scrap-nodes hierbinnen zijn exclusief
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
  })
  .strict()
  .refine((t) => t.pathEntranceMaxCells <= t.pathSectorCells, {
    message: 'pathEntranceMaxCells is hoogstens pathSectorCells',
    path: ['pathEntranceMaxCells'],
  });

export type Faction = z.infer<typeof Faction>;
export type Loadout = z.infer<typeof Loadout>;
export type Building = z.infer<typeof Building>;
export type Tech = z.infer<typeof Tech>;
export type Ability = z.infer<typeof Ability>;
export type Hero = z.infer<typeof Hero>;
export type EffectStat = z.infer<typeof EffectStat>;
export type Perk = z.infer<typeof Perk>;
export type Training = z.infer<typeof Training>;
export type MapDef = z.infer<typeof MapDef>;
export type AiScript = z.infer<typeof AiScript>;
export type DamageMatrix = z.infer<typeof DamageMatrix>;
export type SimTuning = z.infer<typeof SimTuning>;
export type FormationTuning = z.infer<typeof FormationTuning>;
