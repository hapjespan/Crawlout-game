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
    _comment: comment,
  })
  .strict();

export const Effect = z.object({ stat: z.string(), target: z.string(), delta: z.number() }).strict();

export const Tech = z
  .object({ id, faction: id, scrapCost: nonneg, researchS: nonneg, building: id, prereqTech: z.array(id), effects: z.array(Effect), _comment: comment })
  .strict();

export const Special = z.object({ S: z.number().int(), P: z.number().int(), E: z.number().int(), C: z.number().int(), I: z.number().int(), A: z.number().int(), L: z.number().int() }).strict();

export const Hero = z
  .object({
    id,
    faction: id,
    archetype: Archetype,
    special: Special,
    abilities: z.array(z.object({ id, cooldownS: nonneg, rangeM: nonneg, _comment: comment }).strict()),
    perkPool: z.array(id),
    reviveScrap: nonneg,
    reviveS: nonneg,
    revivePenaltyPct: nonneg, // 20 volgens het Spelfundament
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
    scrapNodes: z.array(z.object({ x: z.number().int(), y: z.number().int(), amount: nonneg }).strict()),
    claimPoints: z.array(z.object({ x: z.number().int(), y: z.number().int(), kind: z.enum(['scrap', 'settlement', 'powerArmor']) }).strict()),
    spawns: z.array(z.object({ x: z.number().int(), y: z.number().int() }).strict()),
    creepCamps: z.array(z.object({ x: z.number().int(), y: z.number().int(), tier: z.number().int() }).strict()),
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
    _comment: comment,
  })
  .strict();

export type Faction = z.infer<typeof Faction>;
export type Loadout = z.infer<typeof Loadout>;
export type Building = z.infer<typeof Building>;
export type Tech = z.infer<typeof Tech>;
export type Hero = z.infer<typeof Hero>;
export type Perk = z.infer<typeof Perk>;
export type MapDef = z.infer<typeof MapDef>;
export type AiScript = z.infer<typeof AiScript>;
export type DamageMatrix = z.infer<typeof DamageMatrix>;
export type SimTuning = z.infer<typeof SimTuning>;
