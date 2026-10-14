import { z } from 'zod';

// Contract 3: schema-skeletten. Werkstroom content werkt ze uit; velden komen uit fase-0 sectie 6.
// Alle schema's zijn strict: onbekende velden laten de build falen. Eenheden hier zijn menselijk (m, s, %).
const id = z.string().min(1);
const nonneg = z.number().nonnegative();
const comment = z.string().optional(); // _comment: bedoeling van de waarde; verplicht gebruiken bij balanswaarden

export const ArmorType = z.enum(['none', 'light', 'medium', 'heavy', 'robot']);
export const DamageType = z.enum(['ballistic', 'energy', 'melee', 'fire']);
export const BodyType = z.enum(['human', 'robot']);
export const Role = z.enum(['scavenger', 'builder', 'militia']);
export const Archetype = z.enum(['bouwer', 'krijger', 'tacticus']);
export const Provides = z.enum(['werkplaats', 'huisvesting', 'claim', 'turret', 'beacon', 'lab', 'hq', 'training']);
export const Stat = z.enum(['S', 'P', 'E', 'C', 'I', 'A', 'L']);

export const Faction = z
  .object({
    id,
    naam: z.string(),
    bodyTypes: z.array(BodyType),
    startUnits: z.array(z.object({ loadoutId: id, count: z.number().int().positive() }).strict()),
    startScrap: nonneg,
    housingGrowthPerMin: nonneg,
    safetyNet: z.object({ threshold: z.number().int().nonnegative(), action: z.string() }).strict(),
    uniqueUnits: z.array(id),
    uniqueBuildings: z.array(id),
    specialChannel: z.enum(['training', 'chems', 'tech']),
    _comment: comment,
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
    _comment: comment,
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
    footprint: z.object({ w: z.number().int().positive(), h: z.number().int().positive() }).strict(), // cellen van 1 m
    beds: z.number().int().nonnegative(),
    provides: z.array(Provides),
    prereqTech: z.array(id),
    visuals: z.object({ mesh: z.string() }).strict(),
    // Alleen voor gebouwen met provides turret (besluit 8, sectie 14); verplicht daar, zie de refine.
    damage: nonneg.optional(),
    damageType: DamageType.optional(),
    rangeM: nonneg.optional(),
    cooldownS: nonneg.optional(),
    _comment: comment,
  })
  .strict()
  .superRefine((b, ctx) => {
    if (!b.provides.includes('turret')) return;
    for (const field of ['damage', 'damageType', 'rangeM', 'cooldownS'] as const) {
      if (b[field] === undefined) ctx.addIssue({ code: 'custom', path: [field], message: `verplicht voor een gebouw met provides turret` });
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
]);
export const Effect = z.object({ stat: EffectStat, target: z.string(), delta: z.number() }).strict();

export const Tech = z
  .object({ id, faction: id, scrapCost: nonneg, researchS: nonneg, building: id, prereqTech: z.array(id), effects: z.array(Effect), _comment: comment })
  .strict();

export const Special = z.object({ S: z.number().int(), P: z.number().int(), E: z.number().int(), C: z.number().int(), I: z.number().int(), A: z.number().int(), L: z.number().int() }).strict();

// Effect van een ability op alles binnen de radius, gedurende durationS. Zelfde stat-enum en suffix-conventie als tech en perks.
// side: 'enemy' = vijanden van de held, 'ally' = eigen units en gebouwen van de speler. target: 'units', 'turrets' of 'alle'.
export const AbilityEffect = z.object({ stat: EffectStat, side: z.enum(['enemy', 'ally']), target: z.enum(['units', 'turrets', 'alle']), delta: z.number() }).strict();

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
    abilities: z.array(Ability),
    perkPool: z.array(id),
    reviveScrap: nonneg,
    reviveS: nonneg,
    revivePenaltyPct: nonneg, // 20 volgens het Spelfundament
    maxRevives: z.number().int().nonnegative(), // aantal keer oplappen voordat de held leeg is
    _comment: comment,
  })
  .strict();

export const Perk = z
  .object({ id, naam: z.string(), flavourText: z.string(), requires: z.object({ stat: Stat, min: z.number().int() }).strict(), effects: z.array(Effect), _comment: comment })
  .strict();

const ArmorRow = z.record(ArmorType, z.number().nonnegative()); // multiplier in procenten per pantsertype
// Strict object per schadetype (i.p.v. record) zodat het bestand een _comment kan dragen.
export const DamageMatrix = z.object({ _comment: comment, ballistic: ArmorRow, energy: ArmorRow, melee: ArmorRow, fire: ArmorRow }).strict();

export const MapDef = z
  .object({
    id,
    size: z.object({ w: z.number().int().positive(), h: z.number().int().positive() }).strict(), // cellen van 1 m
    heightmap: z.string(),
    passability: z.string(),
    props: z.string().optional(), // optioneel, buiten de sim: decoratieve props (data/maps/<id>.props.json), alleen voor de renderer
    scrapNodes: z.array(z.object({ x: z.number().int(), y: z.number().int(), amount: nonneg }).strict()),
    claimPoints: z.array(z.object({ x: z.number().int(), y: z.number().int(), kind: z.enum(['scrap', 'settlement', 'powerArmor']) }).strict()),
    spawns: z.array(z.object({ x: z.number().int(), y: z.number().int() }).strict()),
    creepCamps: z.array(z.object({ x: z.number().int(), y: z.number().int(), tier: z.number().int() }).strict()),
    dominance: z.object({ pointsRequired: z.number().int().positive(), minutes: z.number().positive() }).strict(),
    _comment: comment,
  })
  .strict();

export const AiScript = z
  .object({
    id,
    faction: id,
    buildOrder: z.array(z.object({ atS: nonneg, buildingId: id }).strict()),
    attackTimersS: z.array(nonneg),
    rallyPoint: z.object({ x: z.number().int(), y: z.number().int() }).strict(),
    militiaPct: z.number().min(0).max(100), // deel van de bewoners dat de AI tot militie omschoolt (besluit sprint 2: uit sim.json)
    _comment: comment,
  })
  .strict();

// Sim-tuning (data/sim.json): globale getallen die de sim nodig heeft maar die bij geen loadout horen.
export const SimTuning = z
  .object({
    unitRadiusM: nonneg, // globale unitstraal voor separatie, in meters
    arriveRadiusM: nonneg, // een Move-order is klaar binnen deze afstand
    separationPct: z.number().min(0).max(100), // deel van de overlap dat separatie per tick oplost
    flowFieldBudgetCells: z.number().int().positive(), // max flow-field-cellen per tick, alle velden samen
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
  })
  .strict();

export type Faction = z.infer<typeof Faction>;
export type Loadout = z.infer<typeof Loadout>;
export type Building = z.infer<typeof Building>;
export type Tech = z.infer<typeof Tech>;
export type Ability = z.infer<typeof Ability>;
export type Hero = z.infer<typeof Hero>;
export type EffectStat = z.infer<typeof EffectStat>;
export type Perk = z.infer<typeof Perk>;
export type MapDef = z.infer<typeof MapDef>;
export type AiScript = z.infer<typeof AiScript>;
export type DamageMatrix = z.infer<typeof DamageMatrix>;
export type SimTuning = z.infer<typeof SimTuning>;
