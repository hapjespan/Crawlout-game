// Split from schemas.ts to stay under the 5,000-token file limit; schemas.ts re-exports the public surface.
// Holds: id, nonneg, sight, comment, pct, ArmorType, +31 more.
import { z } from 'zod';

// Contract 3: schema-skeletten. Werkstroom content werkt ze uit; velden komen uit fase-0 sectie 6.
// Alle schema's zijn strict: onbekende velden laten de build falen. Eenheden hier zijn menselijk (m, s, %).
export const id = z.string().min(1);

export const nonneg = z.number().nonnegative();

// Fog of war (data 0.22.0): a sight radius in metres; 64 m bounds the stamp of the vision grid
export const sight = z.number().min(0).max(64);

export const comment = z.string().optional(); // _comment: bedoeling van de waarde; verplicht gebruiken bij balanswaarden

export const pct = z.number().min(0).max(100);

export const ArmorType = z.enum(['none', 'light', 'medium', 'heavy', 'robot']);

export const DamageType = z.enum(['ballistic', 'energy', 'melee', 'fire']);

// Nieuwe lichaamstypen staan achteraan zodat bestaande indices gelijk blijven. beast en vehicle (data 0.21.0; bevestigd in
// fase-0 sectie 23 besluit 2): honden en de Buggy van de Raiders; geen rol- of rig-regel in de sim, alleen een ander lichaam.
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
  // Data 0.21.0 (Raiders; bevestigd in fase-0 sectie 23 besluit 2), achteraan: tent (vechters-instroom, vangnet),
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
  // Data 0.38.0 (sim 0.32.0, proposal for the architect): incoming damage in percent (negative = less damage taken);
  // only in ability and hero-aura effects (the armour aura of the Paladin-Commander). Appended, so the indices stay.
  'damageTakenPct',
]);

export const Effect = z
  .object({ stat: EffectStat, target: z.string(), delta: z.number() })
  .strict();

// Vangnet (Spelfundament 4, data 0.16.0). Per factie een eigen actie; nu bekend: radiobaken_instroom (Dwellers) en
// tenten_instroom (Raiders, data 0.21.0; bevestigd in fase-0 sectie 23 besluit 2: threshold telt vechters, de
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
// Raiders (data 0.21.0; bevestigd in fase-0 sectie 23 besluit 2). Alleen data: de sim leest deze velden nog niet
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

// Opstand bij te weinig bewakers (data 0.29.0, de bewaakregel; voorstel, ter bevestiging door content en de architect):
// zie het _comment in data/factions.json en data/README.md voor de precieze regel.
const perGuard = z.number().int().positive();

export const SlaveRevolt = z
  .object({
    cageNearM: nonneg, // een eigen Kooi binnen deze afstand van een node (midden node tot rand Kooi): de slaven daar horen bij de Kooi
    guardRadiusM: nonneg, // een eigen vechter binnen deze straal van de Kooi of een node van de groep telt als bewaker
    cageGuards: z.number().int().nonnegative(), // bewakers voor een Kooi-groep (de dreiging van de Kooi)
    guardModeSlavesPerGuard: perGuard, // node zonder Kooi, met een bewaker in bewaakmodus op de node: ceil(n / dit)
    noCageGuards: perGuard, // node zonder Kooi, zonder bewaakmodus: ceil(n * noCageGuards / noCageSlaves)
    noCageSlaves: perGuard,
    escapeM: nonneg, // een ontsnapte slaaf loopt zo ver weg van de Kooi of node
    graceS: nonneg, // zoveel seconden tekort voordat de opstand begint
    emptyGraceS: nonneg, // idem bij nul bewakers (korter)
    escapePct: pct, // deel van de slaven van die groep dat per opstand ontsnapt
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

// Data 0.38.0 (sim 0.32.0, proposal for the architect; docs/garde.md item 1): veteran promotion. A unit of one of
// `loadouts` that kills enemy units climbs the ranks (ascending kills); a rank adds hpPct and damagePct to its unit.
export const VeteranRank = z
  .object({
    id,
    kills: z.number().int().positive(),
    hpPct: z.number(),
    damagePct: z.number(),
    _comment: comment,
  })
  .strict();
export const Veterancy = z
  .object({ loadouts: z.array(id).min(1), ranks: z.array(VeteranRank).min(1), _comment: comment })
  .strict()
  .superRefine((v, ctx) => {
    for (let i = 1; i < v.ranks.length; i++)
      if (v.ranks[i]!.kills <= v.ranks[i - 1]!.kills)
        ctx.addIssue({
          code: 'custom',
          path: ['ranks', i, 'kills'],
          message: 'ranks need ascending kills',
        });
  });

// Data 0.38.0 (sim 0.32.0, proposal for the architect; docs/garde.md item 2): fusion cores. A completed `building` of the
// faction crafts one core at a time (scrapCost paid at the start, craftS long, with prereqTech) while the stock is
// under maxStock; a loadout with fusionCores takes that many cores from the stock when its production starts.
export const FusionCores = z
  .object({
    building: id,
    scrapCost: nonneg,
    craftS: z.number().positive(),
    maxStock: z.number().int().positive().max(255),
    prereqTech: z.array(id),
    _comment: comment,
  })
  .strict();

// Data 0.39.0 (the Garde, round B; proposal for the architect; docs/garde.md items 3 to 5), all optional on a loadout:
// overload (the Klerk: its hit on an enemy unit of one of `targets` stuns it stunS long, then cooldownS before the next),
// transport (the Vertibird: up to `capacity` own human units board it within loadRangeM, Load and Unload).
export const Overload = z
  .object({ targets: z.array(id).min(1), stunS: z.number().positive(), cooldownS: nonneg })
  .strict();
export const Transport = z
  .object({ capacity: z.number().int().positive().max(8), loadRangeM: nonneg })
  .strict();
// On a faction (the Garde): the power armour of the map. A player holding a claim point of kind powerArmor gets a frame
// of `loadout` next to it, respawnS after he took it or after his last frame of that point died; a player of another
// faction gets it at otherQualityPct of its hp and damage.
export const MapPowerArmor = z
  .object({
    loadout: id,
    respawnS: z.number().positive(),
    otherQualityPct: z.number().positive().max(100),
    _comment: comment,
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
    // Data 0.21.0 (Raiders; bevestigd in fase-0 sectie 23 besluit 2), alle optioneel en alleen de sim-regels van de Raiders
    slaves: SlaveRules.optional(),
    plunder: PlunderRules.optional(),
    tribute: Tribute.optional(),
    chems: z.array(Chem).optional(), // verplicht bij specialChannel chems en anders niet toegestaan
    // Data 0.38.0 (de Garde; proposal for the architect), both optional
    veterancy: Veterancy.optional(),
    fusionCores: FusionCores.optional(),
    mapPowerArmor: MapPowerArmor.optional(), // data 0.39.0 (proposal)
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
// Data 0.39.0 (the Garde, round B; proposal for the architect): 'vehicle', own units of bodyType vehicle (the frames
// and the Vertibird), for the Klerk. Appended, so the indices stay.
export const RepairTarget = z.enum(['building', 'robot', 'vehicle']);

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

export type Faction = z.infer<typeof Faction>;

export type Chem = z.infer<typeof Chem>;

export type SlaveRules = z.infer<typeof SlaveRules>;

export type EffectStat = z.infer<typeof EffectStat>;
