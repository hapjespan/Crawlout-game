import { z } from 'zod';

// Contract 3: schema-skeletten. Werkstroom content werkt ze uit; velden komen uit fase-0 sectie 6.
// Alle schema's zijn strict: onbekende velden laten de build falen. Eenheden hier zijn menselijk (m, s, %).
const id = z.string().min(1);
const nonneg = z.number().nonnegative();
// Fog of war (data 0.22.0): a sight radius in metres; 64 m bounds the stamp of the vision grid
const sight = z.number().min(0).max(64);
const comment = z.string().optional(); // _comment: bedoeling van de waarde; verplicht gebruiken bij balanswaarden
const pct = z.number().min(0).max(100);

export const ArmorType = z.enum(['none', 'light', 'medium', 'heavy', 'robot']);
export const DamageType = z.enum(['ballistic', 'energy', 'melee', 'fire']);
// Nieuwe lichaamstypen staan achteraan zodat bestaande indices gelijk blijven. beast en vehicle (data 0.21.0; voorstel, ter
// bevestiging door de architect): honden en de Buggy van de Raiders; geen rol- of rig-regel in de sim, alleen een ander lichaam.
export const BodyType = z.enum(['human', 'robot', 'beast', 'vehicle']);
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
  // Data 0.21.0 (Raiders; voorstel, ter bevestiging door de architect), achteraan: tent (vechters-instroom, vangnet),
  // kooi (slaven: transitie en werkgebied), depot (afleverpunt naast hq en werkplaats), chemlab (chems, SPECIAL-kanaal)
  'tent',
  'kooi',
  'depot',
  'chemlab',
]);
export const Stat = z.enum(['S', 'P', 'E', 'C', 'I', 'A', 'L']);

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

// Vangnet (Spelfundament 4, data 0.16.0). Per factie een eigen actie; nu bekend: radiobaken_instroom (Dwellers) en
// tenten_instroom (Raiders, data 0.21.0; voorstel, ter bevestiging door de architect: threshold telt vechters, de
// instroom komt uit een voltooide tent). De arrival-velden (intervalS, maxArrivals, loadoutId) zijn verplicht bij
// elke actie van deze enum en verboden bij een toekomstige actie zonder aankomst.
export const SafetyNetAction = z.enum(['radiobaken_instroom', 'tenten_instroom']);
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
    const needed = n.action === 'radiobaken_instroom' || n.action === 'tenten_instroom';
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

// ---------------------------------------------------------------------------------------------------------------------
// Raiders (data 0.21.0; voorstel, ter bevestiging door de architect). Alleen data: de sim leest deze velden nog niet
// (zie packages/data/CHANGELOG.md 0.21.0 voor wat de sim moet bouwen). Alle blokken zijn optioneel, een Dweller-record
// blijft ongewijzigd geldig. Eenheden menselijk (m, s, %), de loader rekent om.
// ---------------------------------------------------------------------------------------------------------------------

// Bevrijding van een slaaf: een vijandelijke unit raakt hem touchS seconden aan zonder Raider (niet-slaaf) binnen guardRadiusM.
export const SlaveLiberation = z
  .object({
    touchS: nonneg, // seconden onafgebroken aanraken
    touchRangeM: nonneg, // afstand waarbinnen een unit de slaaf "aanraakt"
    guardRadiusM: nonneg, // een eigen vechter (geen slaaf) binnen deze straal om de slaaf stopt de bevrijding
    freedSpeedPct: z.number(), // bonus op de loopsnelheid van de bevrijde slaaf op weg naar huis (tempo voor de bevrijder)
  })
  .strict();
// Opstand bij te weinig garnizoen: zie het _comment in data/factions.json voor de precieze regel.
export const SlaveRevolt = z
  .object({
    garrisonRadiusM: nonneg, // een eigen vechter binnen deze straal van de Kooi telt als garnizoen
    slavesPerGuard: z.number().int().positive(), // benodigd garnizoen = max(minGuards, ceil(slaven / slavesPerGuard))
    minGuards: z.number().int().nonnegative(),
    graceS: nonneg, // zoveel seconden tekort voordat de opstand begint
    emptyGraceS: nonneg, // idem bij nul vechters (korter)
    escapePct: pct, // deel van de slaven bij die Kooi dat per opstand ontsnapt
    repeatS: nonneg, // zolang het tekort blijft: elke zoveel seconden opnieuw
  })
  .strict();
export const SlaveRules = z
  .object({
    capturedLoadoutId: id, // loadout waar een gevangene na de Kooi-transitie een slaaf van wordt
    minDistanceFromOwnerBaseM: nonneg, // roven alleen verder dan dit van het hoofdgebouw van de eigenaar van het doel
    liberation: SlaveLiberation,
    revolt: SlaveRevolt,
  })
  .strict();
// Plunderen: scrap uit gesloopte vijandelijke gebouwen en gedode verzamelaars.
export const PlunderRules = z
  .object({
    buildingLootPct: pct, // procent van de scrapCost van een door deze factie gesloopt vijandelijk gebouw
    depotLootMultiplierPct: nonneg, // 200 = dubbele buit voor een depot (provides hq, werkplaats of depot)
    carryLootPct: pct, // procent van de vracht van een gedode vijandelijke verzamelaar
    bonusTech: id.optional(), // tech die de buit vergroot
    bonusPct: nonneg.optional(), // extra buit in procent bij bonusTech (25 = een kwart meer)
  })
  .strict()
  .refine((p) => (p.bonusTech === undefined) === (p.bonusPct === undefined), {
    message: 'bonusTech en bonusPct horen bij elkaar',
    path: ['bonusPct'],
  });
// Tribute van een bezet neutraal claimpunt (MapDef.claimPoints[].kind).
export const Tribute = z
  .object({
    claimKind: z.enum(['scrap', 'settlement', 'powerArmor']),
    scrapPerMin: nonneg, // ruw, per bezet punt
    bonusTech: id.optional(),
    bonusPct: nonneg.optional(),
  })
  .strict()
  .refine((t) => (t.bonusTech === undefined) === (t.bonusPct === undefined), {
    message: 'bonusTech en bonusPct horen bij elkaar',
    path: ['bonusPct'],
  });
// Een chem (SPECIAL-kanaal 'chems'): een dosis geeft effects gedurende activeS en daarna crash gedurende crashS. Geen verslaving.
// Doel 'alle' = elke unit in de aura van de Chem-dealer, 'held' = de held van de speler als hij in die aura staat.
export const Chem = z
  .object({
    id,
    naam: z.string(),
    flavourText: z.string(),
    requiresTech: id, // tech die de chem ontgrendelt (onderzocht in de chemlab)
    doseScrap: nonneg, // scrap per dosis, betaald op het moment dat de dealer doseert
    activeS: z.number().positive(),
    crashS: z.number().positive(),
    cooldownS: nonneg, // minimale tijd tussen twee doses op dezelfde unit (gerekend vanaf het einde van de crash)
    effects: z.array(Effect).min(1), // tijdens de werking
    crash: z.array(Effect).min(1), // tijdens de crash
    refined: z
      .object({ requiresTech: id, activePct: z.number(), crashPct: z.number() })
      .strict()
      .optional(), // verfijnde stoffen: werkingsduur en crashduur in procenten (negatief = korter)
    _comment: comment,
  })
  .strict();
// Een unit die chems uitdeelt (Chem-dealer): in gevecht doseert hij eigen units binnen radiusM met een chem uit de lijst.
export const UnitAura = z
  .object({
    radiusM: nonneg,
    chems: z.array(id).min(1), // chem-ids van de factie, in voorkeursvolgorde
    trigger: z.enum(['gevecht']), // gevecht: zodra een vijand binnen aggroRangeM van de dealer of een eigen unit in de aura staat
  })
  .strict();
// Slaver: roft een neutrale zwerver of een verslagen vijandelijke bewoner (hp onder maxHpPct); de gevangene loopt naar de
// dichtstbijzijnde eigen Kooi (SlaveRules).
export const CaptureTarget = z.enum(['wanderer', 'resident']);
export const Capture = z
  .object({
    rangeM: nonneg,
    captureS: nonneg, // seconden onafgebroken binnen rangeM
    targets: z.array(CaptureTarget).min(1),
    maxHpPct: pct, // een vijandelijke bewoner (bodyType human, geen held) is alleen te roven onder dit hp-percentage
  })
  .strict();
// Kooi (provides kooi): slaven in transitie en het werkgebied van de slaven die eraan gebonden zijn.
export const Cage = z
  .object({
    capacity: z.number().int().positive(), // aantal slaven dat aan deze Kooi gebonden kan zijn (transitie en werk)
    transitionS: z.number().positive(), // tijd in de Kooi voordat een gevangene werker is
    workRadiusM: nonneg, // een gebonden slaaf werkt (verzamelt, bouwt) alleen binnen deze straal van de Kooi
  })
  .strict();
// Plaatsingsregel op afstand van het eigen hoofdgebouw (midden tot midden): de Kooi staat aan de rand van de basis.
export const BuildingPlacement = z
  .object({ minFromHqM: nonneg, maxFromHqM: nonneg })
  .strict()
  .refine((p) => p.maxFromHqM >= p.minFromHqM, {
    message: 'maxFromHqM is minstens minFromHqM',
    path: ['maxFromHqM'],
  });

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
    // Data 0.21.0 (Raiders; voorstel, ter bevestiging door de architect), alle optioneel en alleen de sim-regels van de Raiders
    slaves: SlaveRules.optional(),
    plunder: PlunderRules.optional(),
    tribute: Tribute.optional(),
    chems: z.array(Chem).optional(), // verplicht bij specialChannel chems en anders niet toegestaan
    _comment: comment,
  })
  .strict()
  .superRefine((f, ctx) => {
    if ((f.specialChannel === 'chems') !== (f.chems !== undefined && f.chems.length > 0))
      ctx.addIssue({
        code: 'custom',
        path: ['chems'],
        message: 'verplicht (niet leeg) bij specialChannel chems en anders niet toegestaan',
      });
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
    // Aanwezig = gebouw-id waar de unit nieuw gebouwd wordt (robots); verplicht bij bodyType robot.
    // Data 0.21.0 (voorstel, ter bevestiging door de architect): ook toegestaan voor een ander lichaam (de vechters,
    // honden en de Buggy van de Raiders worden nieuw gebouwd in een tent of de autosloperij); een slaaf heeft het nooit.
    producedAt: id.optional(),
    repair: Repair.optional(), // alleen role robot
    siege: Siege.optional(), // alleen role robot
    // Data 0.21.0 (Raiders; voorstel, ter bevestiging door de architect), alle optioneel
    slave: z.boolean().optional(), // true = slaaf: arbeider (role scavenger of builder), vecht nooit, werkt binnen de Kooi-straal, bevrijdbaar
    capture: Capture.optional(), // Slaver
    aura: UnitAura.optional(), // Chem-dealer
    // Data 0.22.0 (fog of war; voorstel, ter bevestiging door de architect): sight radius from the unit's centre;
    // absent = sim.json vision.unitSightM
    sightM: sight.optional(),
    _comment: comment,
  })
  .strict()
  .superRefine((l, ctx) => {
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
    // Data 0.21.0 (Raiders; voorstel, ter bevestiging door de architect), optioneel
    cage: Cage.optional(), // verplicht bij provides kooi en anders niet toegestaan
    placement: BuildingPlacement.optional(), // de Kooi staat aan de rand van de basis
    // Data 0.22.0 (fog of war; voorstel, ter bevestiging door de architect): sight radius beyond the footprint edge
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
    // Data 0.21.0 (Raiders; voorstel, ter bevestiging door de architect), alle optioneel: de intimidatie-aura van de Warlord
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
    // Data 0.22.0 (fog of war; voorstel, ter bevestiging door de architect): sight radius of the hero; absent =
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
      .strict(),
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
      .strict(),
    // Garnizoen: zoveel vechters blijven thuis (anders opstand), ook tijdens golven en tochten
    garrison: z.object({ minFighters: z.number().int().nonnegative() }).strict(),
    // Dominantie-push: vanaf fromS en met minArmy vechters neemt hij claimpunten en houdt ze (verder dan claimSafeRadiusM met escorte)
    dominancePush: z.object({ fromS: nonneg, minArmy: z.number().int().nonnegative() }).strict(),
  })
  .strict();

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
    // Data 0.20.0 (voorstel): an idle hero walks to a neutral claim point within this distance and claims it by
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
    // Data 0.21.0 (Raiders; voorstel, ter bevestiging door de architect): het roof- en harassplan van het Raider-script
    // (optioneel; Dwellers hebben het niet). De rest van het script (bouwvolgorde, golven, claims) gebruikt de gewone velden.
    raidPlan: RaidPlan.optional(),
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

// Building placement margins (data/sim.json `placement`, data 0.18.0; voorstel, ter bevestiging door de architect).
export const PlacementTuning = z
  .object({
    clearanceM: z.number().min(1), // free walkable ground around every footprint, also from nodes and claim points; at least 1 m (one cell), then placing a building never cuts a walkable connection
    depotClearanceM: nonneg, // aisle around a drop-off building (provides hq or werkplaats): no other building this close
    // Data 0.20.0 (Martien 16 October; voorstel, ter bevestiging door de architect): territory. A new footprint must
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

// Fog of war (data/sim.json `vision`, data 0.22.0; voorstel, ter bevestiging door de architect). Every own unit and
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
    // Data 0.18.0 (sim-core, playtest 16 October; voorstel, ter bevestiging door de architect): building placement
    // margins, and new scavenger settlers of a human player start gathering at the nearest reachable node within this
    // radius of where they arrive (0 = off; the scripted AI assigns its own settlers)
    placement: PlacementTuning,
    autoGatherRadiusM: nonneg,
    // Data 0.20.0 (claim round, Martien 16 October; voorstel, ter bevestiging door de architect): a scrap node within
    // this distance of a held claim point is exclusive to its owner. Was claimRadiusM; separate so a map can keep its
    // scrap outside the claim circle (room for the claim post) and the node still belongs to the claimed point.
    exclusiveRadiusM: nonneg,
    // Data 0.20.0 (claim round, Martien 16 October; voorstel, ter bevestiging door de architect): the hero claims a
    // free claim point by standing in its circle for heroClaimS (0 = off), without a post; such a tower-less claim
    // goes over to an enemy after contestFlipS with enemy units and none of the holder in the circle
    heroClaimS: nonneg,
    contestFlipS: nonneg,
    // Data 0.22.0 (fog of war; voorstel, ter bevestiging door de architect): the vision grid and default sight radii
    vision: VisionTuning,
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

export type Faction = z.infer<typeof Faction>;
export type Chem = z.infer<typeof Chem>;
export type SlaveRules = z.infer<typeof SlaveRules>;
export type RaidPlan = z.infer<typeof RaidPlan>;
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
export type PlacementTuning = z.infer<typeof PlacementTuning>;
export type VisionTuning = z.infer<typeof VisionTuning>;
