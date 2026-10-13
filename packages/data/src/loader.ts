import { ZodError, type ZodTypeAny, type z } from 'zod';
import { AiScript, ArmorType, EffectStat, Building, DamageMatrix, DamageType, Faction, Hero, Loadout, Perk, Role, SimTuning, Stat, Tech, BodyType, Provides, Archetype } from './schemas.js';
import { metersToUnits, mpsToUnitsPerTick, pctToPermille, secondsToTicks } from './units.js';

// De loader: PUUR. Geen fs, geen IO, geen klok. Krijgt geparste JSON, valideert met de zod-schema's,
// rekent om naar sim-eenheden (integers) en geeft numerieke ids terug (index op gesorteerde string-id).
// Valt onder de determinisme-lint (fase-0 sectie 7). Bestanden inlezen doet node.ts.

/** Geparste JSON-inhoud van data/ (zonder maps). Elk veld is nog onvalideerd (`unknown`). */
export interface RawGameData {
  /** Inhoud van data/VERSION (semver, witruimte wordt genegeerd). */
  version: string;
  factions: unknown;
  loadouts: unknown;
  buildings: unknown;
  tech: unknown;
  heroes: unknown;
  perks: unknown;
  damageMatrix: unknown;
  /** Inhoud van data/sim.json. */
  sim: unknown;
  /** Alle bestanden uit data/ai/, in elke volgorde (de loader sorteert op id). */
  ai: unknown[];
}

// Vaste volgorde van de enums: de index is de numerieke waarde in GameData.
export const ARMOR_TYPES = ArmorType.options;
export const DAMAGE_TYPES = DamageType.options;
export const BODY_TYPES = BodyType.options;
export const ROLES = Role.options;
export const ARCHETYPES = Archetype.options;
export const PROVIDES = Provides.options;
export const STATS = Stat.options;

export interface EffectData {
  stat: EffectStat;
  /** String-id of vrij doel ('held', 'alle'); de sim lost dit zelf op. */
  target: string;
  /** Pct-stat: promille. M-stat: sim-eenheden. S-stat: ticks. Anders: ruw geheel getal. Zie convertDelta. */
  delta: number;
}

export interface FactionData {
  id: number;
  key: string;
  naam: string;
  bodyTypes: number[]; // index in BODY_TYPES
  startUnits: { loadoutId: number; count: number }[];
  startScrap: number;
  /** Bewoners per minuut, ruw (de sim rekent zelf naar ticks). */
  housingGrowthPerMin: number;
  safetyNet: { threshold: number; action: string };
  uniqueUnits: number[]; // loadout-ids
  uniqueBuildings: number[]; // building-ids
  specialChannel: 'training' | 'chems' | 'tech';
}

export interface LoadoutData {
  id: number;
  key: string;
  factionId: number;
  bodyType: number; // index in BODY_TYPES
  role: number; // index in ROLES
  weapon: string;
  armorType: number; // index in ARMOR_TYPES
  damageType: number; // index in DAMAGE_TYPES
  hpI: number;
  damage: number;
  rangeU: number;
  speedUPT: number;
  cooldownTicks: number;
  scrapCost: number;
  craftTicks: number;
  /** Scrap per verzamelronde (integer); 0 voor niet-verzamelaars. */
  gatherAmount: number;
  /** Ticks per verzamelronde; 0 voor niet-verzamelaars. */
  gatherTicks: number;
  popCost: number;
  prereqTech: number[]; // tech-ids
  visuals: { meshSlots: Record<string, string> };
}

export interface BuildingData {
  id: number;
  key: string;
  factionId: number;
  hpI: number;
  armorType: number;
  scrapCost: number;
  buildTicks: number;
  footprint: { w: number; h: number }; // cellen van 1 m
  beds: number;
  provides: number[]; // indices in PROVIDES
  prereqTech: number[];
  visuals: { mesh: string };
}

export interface TechData {
  id: number;
  key: string;
  factionId: number;
  scrapCost: number;
  researchTicks: number;
  buildingId: number;
  prereqTech: number[];
  effects: EffectData[];
}

export interface HeroData {
  id: number;
  key: string;
  factionId: number;
  archetype: number; // index in ARCHETYPES
  special: [number, number, number, number, number, number, number]; // volgorde van STATS: S P E C I A L
  abilities: { id: string; cooldownTicks: number; rangeU: number }[];
  perkPool: number[]; // perk-ids
  reviveScrap: number;
  reviveTicks: number;
  revivePenaltyPermille: number;
  /** Aantal keer oplappen voordat de held leeg is. */
  maxRevives: number;
}

export interface PerkData {
  id: number;
  key: string;
  naam: string;
  flavourText: string;
  requires: { stat: number; min: number }; // stat = index in STATS
  effects: EffectData[];
}

export interface AiScriptData {
  id: number;
  key: string;
  factionId: number;
  buildOrder: { atTick: number; buildingId: number }[];
  attackTimersTicks: number[];
  rallyPointU: { x: number; y: number };
}

/** Sim-tuning in sim-eenheden (integers). */
export interface SimTuningData {
  unitRadiusU: number;
  arriveRadiusU: number;
  separationPermille: number;
  flowFieldBudget: number;
  walkAnimStep: number;
}

export interface GameData {
  /** Semver uit data/VERSION, ongewijzigd. Hoort in replay en hash-seed. */
  dataVersion: string;
  /** Semver als integer (major*1_000_000 + minor*1_000 + patch), handig voor een hash-seed. */
  dataVersionPacked: number;
  /** Alle arrays staan op numerieke id: records[i].id === i. Gesorteerd op string-id. */
  factions: FactionData[];
  loadouts: LoadoutData[];
  buildings: BuildingData[];
  tech: TechData[];
  heroes: HeroData[];
  perks: PerkData[];
  aiScripts: AiScriptData[];
  /** damageMatrix[damageTypeIndex][armorTypeIndex] = multiplier in promille (1000 = 100 procent). */
  damageMatrix: number[][];
  sim: SimTuningData;
}

/** Dominantie-regel van een map in sim-eenheden (maps worden door packages/map geladen; deze omrekening is de enige plek). */
export interface DominanceData {
  pointsRequired: number;
  /** Tijdslimiet in ticks. */
  ticks: number;
}

/** Rekent MapDef.dominance om naar sim-eenheden. */
export function convertDominance(d: { pointsRequired: number; minutes: number }): DominanceData {
  return { pointsRequired: d.pointsRequired, ticks: secondsToTicks(d.minutes * 60) };
}

function parseWith<S extends ZodTypeAny>(file: string, schema: S, value: unknown): z.infer<S> {
  const result = schema.safeParse(value);
  if (result.success) return result.data as z.infer<S>;
  throw new Error(`data/${file}: ${formatZodError(result.error)}`);
}

function formatZodError(error: ZodError): string {
  return error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ');
}

function parseList<S extends ZodTypeAny>(file: string, schema: S, value: unknown): z.infer<S>[] {
  if (!Array.isArray(value)) throw new Error(`data/${file}: verwacht een array`);
  return value.map((item: unknown, index: number) => parseWith(`${file}[${index}]`, schema, item));
}

const compareIds = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Sorteert op string-id (tiebreak is de id zelf; dubbele ids zijn een fout) en geeft record plus numerieke id. */
function sortById<T extends { id: string }>(file: string, records: T[]): T[] {
  const sorted = [...records].sort((a, b) => compareIds(a.id, b.id));
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.id === sorted[i - 1]!.id) throw new Error(`data/${file}: dubbele id '${sorted[i]!.id}'`);
  }
  return sorted;
}

type IdIndex = ReadonlyMap<string, number>;

function indexOf(records: { id: string }[]): IdIndex {
  const map = new Map<string, number>();
  records.forEach((record, i) => map.set(record.id, i));
  return map;
}

function ref(index: IdIndex, what: string, where: string, key: string): number {
  const found = index.get(key);
  if (found === undefined) throw new Error(`${where}: onbekende ${what} '${key}'`);
  return found;
}

/** Omrekening van een effect-delta op basis van het stat-suffix: Pct naar promille, M naar eenheden, S naar ticks. */
export function convertDelta(stat: EffectStat, delta: number): number {
  if (stat.length === 1) return Math.trunc(delta); // SPECIAL-letter, geen suffix
  if (stat.endsWith('Pct')) return pctToPermille(delta);
  if (stat.endsWith('M')) return metersToUnits(delta);
  if (stat.endsWith('S')) return secondsToTicks(delta);
  return Math.trunc(delta);
}

const convertEffects = (effects: { stat: EffectStat; target: string; delta: number }[]): EffectData[] =>
  effects.map((e) => ({ stat: e.stat, target: e.target, delta: convertDelta(e.stat, e.delta) }));

function parseVersion(version: string): { text: string; packed: number } {
  const text = version.trim();
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (!match) throw new Error(`data/VERSION: ongeldige semver '${text}'`);
  return { text, packed: Number(match[1]) * 1000000 + Number(match[2]) * 1000 + Number(match[3]) };
}

/**
 * Valideert en converteert de ruwe data naar GameData (sim-eenheden, numerieke ids).
 * Gooit een Error met bestandsnaam en pad bij elke ongeldigheid (onbekend veld, dangling referentie, dubbele id).
 * Pure functie: zelfde input geeft altijd gelijke output.
 */
export function loadGameData(raw: RawGameData): GameData {
  const version = parseVersion(raw.version);

  const factionsRaw = sortById('factions.json', parseList('factions.json', Faction, raw.factions));
  const loadoutsRaw = sortById('loadouts.json', parseList('loadouts.json', Loadout, raw.loadouts));
  const buildingsRaw = sortById('buildings.json', parseList('buildings.json', Building, raw.buildings));
  const techRaw = sortById('tech.json', parseList('tech.json', Tech, raw.tech));
  const heroesRaw = sortById('heroes.json', parseList('heroes.json', Hero, raw.heroes));
  const perksRaw = sortById('perks.json', parseList('perks.json', Perk, raw.perks));
  const matrixRaw = parseWith('damage-matrix.json', DamageMatrix, raw.damageMatrix);
  const simRaw = parseWith('sim.json', SimTuning, raw.sim);
  const aiRaw = sortById(
    'ai/*.json',
    raw.ai.map((item, index) => parseWith(`ai/[${index}]`, AiScript, item)),
  );

  const factionIx = indexOf(factionsRaw);
  const loadoutIx = indexOf(loadoutsRaw);
  const buildingIx = indexOf(buildingsRaw);
  const techIx = indexOf(techRaw);
  const perkIx = indexOf(perksRaw);

  const idx = <T extends readonly string[]>(options: T, value: T[number]): number => options.indexOf(value);

  const factions: FactionData[] = factionsRaw.map((f, id) => {
    const where = `data/factions.json '${f.id}'`;
    return {
      id,
      key: f.id,
      naam: f.naam,
      bodyTypes: f.bodyTypes.map((b) => idx(BODY_TYPES, b)),
      startUnits: f.startUnits.map((u) => ({ loadoutId: ref(loadoutIx, 'loadout', where, u.loadoutId), count: u.count })),
      startScrap: Math.trunc(f.startScrap),
      housingGrowthPerMin: Math.trunc(f.housingGrowthPerMin),
      safetyNet: { threshold: f.safetyNet.threshold, action: f.safetyNet.action },
      uniqueUnits: f.uniqueUnits.map((u) => ref(loadoutIx, 'loadout', where, u)),
      uniqueBuildings: f.uniqueBuildings.map((b) => ref(buildingIx, 'gebouw', where, b)),
      specialChannel: f.specialChannel,
    };
  });

  const loadouts: LoadoutData[] = loadoutsRaw.map((l, id) => {
    const where = `data/loadouts.json '${l.id}'`;
    return {
      id,
      key: l.id,
      factionId: ref(factionIx, 'factie', where, l.faction),
      bodyType: idx(BODY_TYPES, l.bodyType),
      role: idx(ROLES, l.role),
      weapon: l.weapon,
      armorType: idx(ARMOR_TYPES, l.armorType),
      damageType: idx(DAMAGE_TYPES, l.damageType),
      hpI: Math.trunc(l.hp),
      damage: Math.trunc(l.damage),
      rangeU: metersToUnits(l.rangeM),
      speedUPT: mpsToUnitsPerTick(l.speedMps),
      cooldownTicks: secondsToTicks(l.cooldownS),
      scrapCost: Math.trunc(l.scrapCost),
      craftTicks: secondsToTicks(l.craftS),
      gatherAmount: l.gatherAmount,
      gatherTicks: secondsToTicks(l.gatherS),
      popCost: l.popCost,
      prereqTech: l.prereqTech.map((t) => ref(techIx, 'tech', where, t)),
      visuals: { meshSlots: { ...l.visuals.meshSlots } },
    };
  });

  const buildings: BuildingData[] = buildingsRaw.map((b, id) => {
    const where = `data/buildings.json '${b.id}'`;
    return {
      id,
      key: b.id,
      factionId: ref(factionIx, 'factie', where, b.faction),
      hpI: Math.trunc(b.hp),
      armorType: idx(ARMOR_TYPES, b.armorType),
      scrapCost: Math.trunc(b.scrapCost),
      buildTicks: secondsToTicks(b.buildS),
      footprint: { w: b.footprint.w, h: b.footprint.h },
      beds: b.beds,
      provides: b.provides.map((p) => idx(PROVIDES, p)),
      prereqTech: b.prereqTech.map((t) => ref(techIx, 'tech', where, t)),
      visuals: { mesh: b.visuals.mesh },
    };
  });

  const tech: TechData[] = techRaw.map((t, id) => {
    const where = `data/tech.json '${t.id}'`;
    return {
      id,
      key: t.id,
      factionId: ref(factionIx, 'factie', where, t.faction),
      scrapCost: Math.trunc(t.scrapCost),
      researchTicks: secondsToTicks(t.researchS),
      buildingId: ref(buildingIx, 'gebouw', where, t.building),
      prereqTech: t.prereqTech.map((p) => ref(techIx, 'tech', where, p)),
      effects: convertEffects(t.effects),
    };
  });

  const heroes: HeroData[] = heroesRaw.map((h, id) => {
    const where = `data/heroes.json '${h.id}'`;
    return {
      id,
      key: h.id,
      factionId: ref(factionIx, 'factie', where, h.faction),
      archetype: idx(ARCHETYPES, h.archetype),
      special: [h.special.S, h.special.P, h.special.E, h.special.C, h.special.I, h.special.A, h.special.L],
      abilities: h.abilities.map((a) => ({ id: a.id, cooldownTicks: secondsToTicks(a.cooldownS), rangeU: metersToUnits(a.rangeM) })),
      perkPool: h.perkPool.map((p) => ref(perkIx, 'perk', where, p)),
      reviveScrap: Math.trunc(h.reviveScrap),
      reviveTicks: secondsToTicks(h.reviveS),
      revivePenaltyPermille: pctToPermille(h.revivePenaltyPct),
      maxRevives: h.maxRevives,
    };
  });

  const perks: PerkData[] = perksRaw.map((p, id) => ({
    id,
    key: p.id,
    naam: p.naam,
    flavourText: p.flavourText,
    requires: { stat: idx(STATS, p.requires.stat), min: p.requires.min },
    effects: convertEffects(p.effects),
  }));

  const aiScripts: AiScriptData[] = aiRaw.map((a, id) => {
    const where = `data/ai '${a.id}'`;
    return {
      id,
      key: a.id,
      factionId: ref(factionIx, 'factie', where, a.faction),
      buildOrder: a.buildOrder.map((o) => ({ atTick: secondsToTicks(o.atS), buildingId: ref(buildingIx, 'gebouw', where, o.buildingId) })),
      attackTimersTicks: a.attackTimersS.map((s) => secondsToTicks(s)),
      rallyPointU: { x: metersToUnits(a.rallyPoint.x), y: metersToUnits(a.rallyPoint.y) },
    };
  });

  // Vaste volgorde via de enum-lijsten; nooit via Object.keys.
  const damageMatrix = DAMAGE_TYPES.map((damageType) => ARMOR_TYPES.map((armorType) => pctToPermille(matrixRaw[damageType][armorType] ?? 0)));

  return {
    dataVersion: version.text,
    dataVersionPacked: version.packed,
    factions,
    loadouts,
    buildings,
    tech,
    heroes,
    perks,
    aiScripts,
    damageMatrix,
    sim: {
      unitRadiusU: metersToUnits(simRaw.unitRadiusM),
      arriveRadiusU: metersToUnits(simRaw.arriveRadiusM),
      separationPermille: pctToPermille(simRaw.separationPct),
      flowFieldBudget: simRaw.flowFieldBudgetCells,
      walkAnimStep: simRaw.walkAnimStep,
    },
  };
}
