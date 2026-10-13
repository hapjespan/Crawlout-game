import { MAX_PLAYERS, UNITS_PER_METER } from '@crawlout/protocol';
import { isInt } from './math/int.js';
import { FNV_OFFSET, fnv1a, fnv1aInt, fnv1aString } from './math/fnv.js';

// De grens van de sim: alles in sim-eenheden (integers). De adapter in fromData.ts vult deze types uit GameData
// (packages/data) en MapGrid (packages/map); de sim leest nooit meters, seconden of JSON en importeert packages/map niet.

/** Punt in sim-eenheden (1 m = 256). */
export interface SimPoint {
  readonly x: number;
  readonly y: number;
}

export interface SimScrapNode extends SimPoint {
  readonly amount: number;
}

export interface SimClaimPoint extends SimPoint {
  /** Index in CLAIM_KINDS (fromData.ts). Informatief; elk claimpunt telt mee voor dominantie. */
  readonly kind: number;
}

/** Map plus features. Posities in sim-eenheden; passable in cellen van 1 m (256 eenheden), rij voor rij. */
export interface SimMap {
  readonly w: number;
  readonly h: number;
  /** 1 = begaanbaar, 0 = geblokkeerd. Gebouwen blokkeren daarbovenop cellen in de sim zelf. */
  readonly passable: Uint8Array;
  /** Startposities; spawns[i] hoort bij playerId i. */
  readonly spawns: readonly SimPoint[];
  readonly scrapNodes: readonly SimScrapNode[];
  readonly claimPoints: readonly SimClaimPoint[];
  /** Winroute B: pointsRequired claimpunten gedurende ticks vasthouden. */
  readonly dominance: { readonly pointsRequired: number; readonly ticks: number };
}

/** Eén unittype (body plus loadout) in sim-eenheden. typeId = unitTypeId(loadoutId) uit @crawlout/data. */
export interface SimUnitType {
  readonly typeId: number;
  readonly loadoutId: number;
  readonly factionId: number;
  readonly bodyType: number;
  /** Index in ROLES: 0 scavenger, 1 builder, 2 militia. */
  readonly role: number;
  readonly armorType: number;
  readonly maxHp: number;
  readonly speed: number; // eenheden per tick
  readonly radius: number; // eenheden, voor separatie
  readonly damage: number;
  readonly damageType: number;
  readonly range: number; // eenheden
  readonly cooldown: number; // ticks tussen twee schoten
  readonly gatherAmount: number; // scrap per rit, 0 = verzamelt niet
  readonly gatherTicks: number;
  readonly scrapCost: number; // kosten van omscholen in de werkplaats
  readonly craftTicks: number;
  readonly popCost: number;
  /** Tech-ids die nodig zijn. Onderzoek bestaat nog niet in de sim: een type met prereqTech is nog niet beschikbaar. */
  readonly prereqTech: readonly number[];
}

/** Eén gebouwtype. typeId = buildingTypeId(buildingId) uit @crawlout/data. */
export interface SimBuildingType {
  readonly typeId: number;
  readonly buildingId: number;
  readonly factionId: number;
  readonly maxHp: number;
  readonly armorType: number;
  readonly scrapCost: number;
  readonly buildTicks: number;
  readonly footprintW: number; // cellen
  readonly footprintH: number;
  readonly beds: number;
  /** Bitmasker over PROVIDES (packages/data): bit k = PROVIDES[k]. */
  readonly provides: number;
  readonly prereqTech: readonly number[];
}

export interface SimFaction {
  readonly factionId: number;
  /** In bestandsvolgorde (contract 2, startopstelling). */
  readonly startUnits: readonly { readonly typeId: number; readonly count: number }[];
  readonly startScrap: number;
  /** Bewoners per minuut zolang er vrije bedden zijn; de sim telt per tick op tot ticksPerMinute. */
  readonly housingGrowthPerMin: number;
  /** Het hoofdgebouw (provides hq) dat in start() op de spawn komt. */
  readonly hqTypeId: number;
  /** Unittype van een nieuwe bewoner uit huisvestingsgroei; 0 = geen groei. */
  readonly settlerTypeId: number;
  /** Per rol (index in ROLES) het unittype waar SetRole naartoe omschoolt; 0 = niet beschikbaar. */
  readonly roleTypeIds: readonly number[];
  /** Index in SimConfig.aiScripts voor AI-spelers van deze factie, -1 = geen script. */
  readonly aiScript: number;
}

export interface SimAiScript {
  readonly buildOrder: readonly { readonly atTick: number; readonly typeId: number }[];
  readonly attackTimersTicks: readonly number[];
}

export interface SimConfig {
  /** data/VERSION; gaat de hash-seed in, zodat een replay nooit stil op andere data draait. */
  readonly dataVersion: string;
  readonly unitTypes: readonly SimUnitType[];
  readonly buildingTypes: readonly SimBuildingType[];
  /** Op factionId: factions[k].factionId === k. */
  readonly factions: readonly SimFaction[];
  readonly aiScripts: readonly SimAiScript[];
  /** damageMatrix[damageType][armorType] in promille (1000 = normale schade). */
  readonly damageMatrix: readonly (readonly number[])[];
  /** Ticks in een minuut, voor housingGrowthPerMin (omgerekend door de adapter, niet door de sim). */
  readonly ticksPerMinute: number;
  /** Afstand (eenheden) waarbinnen een Move-order klaar is. */
  readonly arriveRadius: number;
  /** Deel van de overlap dat separatie per tick oplost, in promille (0..1000). */
  readonly separationPermille: number;
  /** Maximaal aantal flow-field-cellen dat per tick wordt uitgebreid, alle velden samen. */
  readonly flowFieldBudget: number;
  /** animT-stap per tick (0..65535 wrapt). */
  readonly walkAnimStep: number;
  /** Afstand waarbinnen militie (en elke unit op AttackMove) zelf een doel kiest. */
  readonly aggroRange: number;
  /** Reikwijdte voor verzamelen, afleveren, bouwen en omscholen: afstand tot node of footprint. */
  readonly interactRange: number;
  /** Straal rond een claimpunt waarbinnen units het nemen. */
  readonly claimRadius: number;
  /** Ticks dat claimende units ongestoord in de straal moeten staan. */
  readonly claimTicks: number;
  /** Bovengrens van de pop-cap, los van het aantal bedden. */
  readonly popCapMax: number;
  /** Ticks dat een gedode unit als lijk (anim death) blijft staan. */
  readonly corpseTicks: number;
  /** Scripted AI: deel van de bewoners dat de AI tot militie omschoolt, in promille. */
  readonly aiMilitiaPermille: number;
}

/** Eén speler in de startopstelling, in playerId-volgorde. */
export interface SimPlayer {
  readonly factionId: number;
  /** AI-speler (LobbyPlayer.ai): de sim geeft zelf zijn commando's in systeemstap 2. */
  readonly ai: boolean;
}

export interface SimInit {
  readonly seed: number;
  readonly players: readonly SimPlayer[];
  readonly map: SimMap;
  readonly config: SimConfig;
}

/** Alles wat geen state is maar wel nodig is om een geserialiseerde state te laden. */
export type SimEnv = Omit<SimInit, 'seed'>;

/** Geometrie: maximale mapzijde in cellen; houdt celindices en coordinaten ruim binnen int32. */
export const MAX_MAP_CELLS_SIDE = 1024;
/** Geometrie: bovengrens snelheid, kleiner dan een cel, zodat een unit nooit door een muur van 1 cel tunnelt. */
export const MAX_SPEED = UNITS_PER_METER >> 1;
/** Geometrie: bovengrens unitstraal; de separatie-grid gaat uit van buckets van 2 m. */
export const MAX_RADIUS = UNITS_PER_METER;
/** Geometrie: grootste footprint-zijde in cellen (past in Uint8 en in de ringzoeker rond gebouwen). */
export const MAX_FOOTPRINT = 16;
const U16 = 0xffff;
const I31 = 0x7fffffff;

function req(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`SimInit ongeldig: ${msg}`);
}

const intIn = (v: unknown, lo: number, hi: number): boolean => isInt(v) && v >= lo && v <= hi;

function checkPoint(map: SimMap, p: SimPoint, what: string): void {
  req(intIn(p.x, 0, (map.w << 8) - 1) && intIn(p.y, 0, (map.h << 8) - 1), `${what} (${p.x},${p.y}) ligt buiten de map`);
}

/** Valideert de invoer eenmalig voor de eerste tick. Gooit bij ongeldige invoer. */
export function validateEnv(env: SimEnv): void {
  const { map, config, players } = env;
  req(intIn(players.length, 1, MAX_PLAYERS), `aantal spelers ${players.length}`);
  req(intIn(map.w, 1, MAX_MAP_CELLS_SIDE) && intIn(map.h, 1, MAX_MAP_CELLS_SIDE), `mapmaat ${map.w}x${map.h}`);
  req(map.passable.length === map.w * map.h, 'passable heeft niet w*h cellen');
  for (let i = 0; i < map.passable.length; i++) req(map.passable[i]! <= 1, `passable[${i}] is geen 0 of 1`);
  req(map.spawns.length >= players.length, `map heeft ${map.spawns.length} spawns voor ${players.length} spelers`);
  for (const s of map.spawns) checkPoint(map, s, 'spawn');
  for (const n of map.scrapNodes) {
    checkPoint(map, n, 'scrap-node');
    req(intIn(n.amount, 0, I31), 'scrap-node amount');
  }
  for (const c of map.claimPoints) {
    checkPoint(map, c, 'claimpunt');
    req(intIn(c.kind, 0, 0xff), 'claimpunt kind');
  }
  req(intIn(map.dominance.pointsRequired, 1, 0xff) && intIn(map.dominance.ticks, 1, I31), 'dominance');

  req(typeof config.dataVersion === 'string' && config.dataVersion.length > 0, 'dataVersion ontbreekt');
  req(intIn(config.arriveRadius, 0, MAX_RADIUS * 4), 'arriveRadius');
  req(intIn(config.separationPermille, 0, 1000), 'separationPermille');
  req(intIn(config.flowFieldBudget, 1, 1 << 24), 'flowFieldBudget');
  req(intIn(config.walkAnimStep, 0, U16), 'walkAnimStep');
  req(intIn(config.ticksPerMinute, 1, I31), 'ticksPerMinute');
  req(intIn(config.aggroRange, 0, MAX_MAP_CELLS_SIDE << 8), 'aggroRange');
  req(intIn(config.interactRange, 0, MAX_MAP_CELLS_SIDE << 8), 'interactRange');
  req(intIn(config.claimRadius, 0, MAX_MAP_CELLS_SIDE << 8), 'claimRadius');
  req(intIn(config.claimTicks, 1, I31), 'claimTicks');
  req(intIn(config.popCapMax, 0, 4096), 'popCapMax');
  req(intIn(config.corpseTicks, 0, U16), 'corpseTicks');
  req(intIn(config.aiMilitiaPermille, 0, 1000), 'aiMilitiaPermille');

  const armorCount = config.damageMatrix[0]?.length ?? 0;
  req(config.damageMatrix.length > 0 && armorCount > 0, 'damageMatrix leeg');
  for (const row of config.damageMatrix) {
    req(row.length === armorCount, 'damageMatrix niet rechthoekig');
    for (const v of row) req(intIn(v, 0, 100000), 'damageMatrix-waarde');
  }

  const unitIds = new Set<number>();
  for (const u of config.unitTypes) {
    const at = `unittype ${u.typeId}`;
    req(intIn(u.typeId, 1, U16) && !unitIds.has(u.typeId), `${at}: typeId ongeldig of dubbel`);
    unitIds.add(u.typeId);
    req(intIn(u.maxHp, 1, I31), `${at}: maxHp`);
    req(intIn(u.speed, 0, MAX_SPEED), `${at}: speed (max ${MAX_SPEED})`);
    req(intIn(u.radius, 0, MAX_RADIUS), `${at}: radius (max ${MAX_RADIUS})`);
    req(intIn(u.armorType, 0, armorCount - 1) && intIn(u.damageType, 0, config.damageMatrix.length - 1), `${at}: armor- of damageType`);
    req(intIn(u.bodyType, 0, 0xff) && intIn(u.role, 0, 0xff) && intIn(u.loadoutId, 0, U16), `${at}: bodyType, role of loadoutId`);
    req(intIn(u.factionId, 0, config.factions.length - 1), `${at}: factionId`);
    req(intIn(u.damage, 0, I31) && intIn(u.range, 0, MAX_MAP_CELLS_SIDE << 8) && intIn(u.cooldown, 0, I31), `${at}: gevecht`);
    req(intIn(u.gatherAmount, 0, I31) && intIn(u.gatherTicks, 0, I31), `${at}: verzamelen`);
    req(u.gatherAmount === 0 || u.gatherTicks > 0, `${at}: gatherAmount zonder gatherTicks`);
    req(intIn(u.scrapCost, 0, I31) && intIn(u.craftTicks, 0, I31) && intIn(u.popCost, 0, 0xff), `${at}: kosten`);
    for (const t of u.prereqTech) req(intIn(t, 0, U16), `${at}: prereqTech`);
  }
  const buildingIds = new Set<number>();
  for (const b of config.buildingTypes) {
    const at = `gebouwtype ${b.typeId}`;
    req(intIn(b.typeId, 1, U16) && !buildingIds.has(b.typeId) && !unitIds.has(b.typeId), `${at}: typeId ongeldig of dubbel`);
    buildingIds.add(b.typeId);
    req(intIn(b.maxHp, 1, I31) && intIn(b.armorType, 0, armorCount - 1), `${at}: hp of armorType`);
    req(intIn(b.scrapCost, 0, I31) && intIn(b.buildTicks, 0, I31) && intIn(b.beds, 0, 0xffff), `${at}: kosten, bouwtijd of bedden`);
    req(intIn(b.footprintW, 1, MAX_FOOTPRINT) && intIn(b.footprintH, 1, MAX_FOOTPRINT), `${at}: footprint`);
    req(intIn(b.provides, 0, 0xff) && intIn(b.factionId, 0, config.factions.length - 1), `${at}: provides of factionId`);
    for (const t of b.prereqTech) req(intIn(t, 0, U16), `${at}: prereqTech`);
  }
  config.factions.forEach((f, k) => {
    const at = `factie ${k}`;
    req(f.factionId === k, `${at}: factionId moet de index zijn`);
    for (const s of f.startUnits) req(unitIds.has(s.typeId) && intIn(s.count, 1, 1024), `${at}: startUnits`);
    req(intIn(f.startScrap, 0, I31) && intIn(f.housingGrowthPerMin, 0, I31), `${at}: startScrap of housingGrowthPerMin`);
    req(buildingIds.has(f.hqTypeId), `${at}: hqTypeId`);
    req(f.settlerTypeId === 0 || unitIds.has(f.settlerTypeId), `${at}: settlerTypeId`);
    for (const t of f.roleTypeIds) req(t === 0 || unitIds.has(t), `${at}: roleTypeIds`);
    req(intIn(f.aiScript, -1, config.aiScripts.length - 1), `${at}: aiScript`);
  });
  for (const s of config.aiScripts) {
    for (const o of s.buildOrder) req(intIn(o.atTick, 0, I31) && buildingIds.has(o.typeId), 'aiScript buildOrder');
    for (const t of s.attackTimersTicks) req(intIn(t, 0, I31), 'aiScript attackTimersTicks');
  }
  for (const p of players) {
    req(intIn(p.factionId, 0, config.factions.length - 1), `speler met onbekende factie ${p.factionId}`);
    req(typeof p.ai === 'boolean', 'speler zonder ai-vlag');
  }
}

const hashInts = (h: number, vs: readonly number[]): number => {
  let x = fnv1aInt(h, vs.length);
  for (const v of vs) x = fnv1aInt(x, v);
  return x;
};

/**
 * Hash van de omgeving (dataVersion, config, map, spelers) in vaste veldvolgorde. Gaat de state-header in,
 * zodat twee clients met andere data, een andere map of andere spelers op tick 0 al verschillen.
 */
export function envHash(env: SimEnv): number {
  const { map, config: c, players } = env;
  let h = fnv1aString(FNV_OFFSET, c.dataVersion);
  h = hashInts(h, [
    c.ticksPerMinute,
    c.arriveRadius,
    c.separationPermille,
    c.flowFieldBudget,
    c.walkAnimStep,
    c.aggroRange,
    c.interactRange,
    c.claimRadius,
    c.claimTicks,
    c.popCapMax,
    c.corpseTicks,
    c.aiMilitiaPermille,
  ]);
  h = fnv1aInt(h, c.unitTypes.length);
  for (const u of c.unitTypes) {
    h = hashInts(h, [u.typeId, u.loadoutId, u.factionId, u.bodyType, u.role, u.armorType, u.maxHp, u.speed, u.radius, u.damage, u.damageType]);
    h = hashInts(h, [u.range, u.cooldown, u.gatherAmount, u.gatherTicks, u.scrapCost, u.craftTicks, u.popCost]);
    h = hashInts(h, u.prereqTech);
  }
  h = fnv1aInt(h, c.buildingTypes.length);
  for (const b of c.buildingTypes) {
    h = hashInts(h, [b.typeId, b.buildingId, b.factionId, b.maxHp, b.armorType, b.scrapCost, b.buildTicks, b.footprintW, b.footprintH, b.beds, b.provides]);
    h = hashInts(h, b.prereqTech);
  }
  h = fnv1aInt(h, c.factions.length);
  for (const f of c.factions) {
    h = hashInts(h, [f.factionId, f.startScrap, f.housingGrowthPerMin, f.hqTypeId, f.settlerTypeId, f.aiScript]);
    h = fnv1aInt(h, f.startUnits.length);
    for (const s of f.startUnits) h = hashInts(h, [s.typeId, s.count]);
    h = hashInts(h, f.roleTypeIds);
  }
  h = fnv1aInt(h, c.aiScripts.length);
  for (const s of c.aiScripts) {
    h = fnv1aInt(h, s.buildOrder.length);
    for (const o of s.buildOrder) h = hashInts(h, [o.atTick, o.typeId]);
    h = hashInts(h, s.attackTimersTicks);
  }
  h = fnv1aInt(h, c.damageMatrix.length);
  for (const row of c.damageMatrix) h = hashInts(h, row);

  h = fnv1aInt(h, players.length);
  for (const p of players) h = hashInts(h, [p.factionId, p.ai ? 1 : 0]);

  h = hashInts(h, [map.w, map.h]);
  h = fnv1a(h, map.passable);
  h = fnv1aInt(h, map.spawns.length);
  for (const s of map.spawns) h = hashInts(h, [s.x, s.y]);
  h = fnv1aInt(h, map.scrapNodes.length);
  for (const n of map.scrapNodes) h = hashInts(h, [n.x, n.y, n.amount]);
  h = fnv1aInt(h, map.claimPoints.length);
  for (const p of map.claimPoints) h = hashInts(h, [p.x, p.y, p.kind]);
  return hashInts(h, [map.dominance.pointsRequired, map.dominance.ticks]);
}
