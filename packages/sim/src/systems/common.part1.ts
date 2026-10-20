// Split from common.ts to stay under the 5,000-token file limit; common.ts re-exports the public surface.
// Holds: PlayerState, NO_WINNER, WIN_NONE, WIN_DESTRUCTION, WIN_DOMINANCE, WIN_SURRENDER, +23 more.
import { MAX_PLAYERS, OWNER_NEUTRAL, MAX_ENTITIES } from '@crawlout/protocol';
import {
  MAX_ABILITIES,
  SPECIAL_COUNT,
  TECH_WORDS,
  type SimMap,
  type SimConfig,
  type SimPlayer,
  type SimUnitType,
  type SimBuildingType,
} from '../config.js';
import { type World, C, NO_FIELD, NO_GOAL } from '../ecs/world.js';
import type { FlowFields } from '../flowfield.js';
import type { EventBuffer } from '../events.js';
import type { Rng } from '../rng.js';
import type { Auras } from './hero.js';
import type { RobotRates } from './robots.js';
import type { TerrainDistances } from '../pathdist.js';
import type { Vision } from '../vision.js';
import type { CreepCamps } from './creeps.js';
import type { ProjectState } from './project.js';
import type { SurvivalState } from './survival.part1.js';
import type { DefenseState } from './defense.js';
import { imod } from '../math/int.js';
import { ROLES } from '@crawlout/data';
import { atan2A } from '../math/trig.js';

/** Per-speler state (SoA op MAX_PLAYERS). Gaat de hash en de serialisatie in. */
export class PlayerState {
  readonly scrap = new Int32Array(MAX_PLAYERS);
  /** Huisvestingsgroei: opgespaarde bewoners maal ticksPerMinute. */
  readonly growth = new Int32Array(MAX_PLAYERS);
  /** Ticks dat de speler aaneengesloten genoeg claimpunten houdt (winroute B). */
  readonly domTicks = new Int32Array(MAX_PLAYERS);
  /** 1 als de speler af is (hoofdgebouw kwijt of opgegeven). */
  readonly defeated = new Uint8Array(MAX_PLAYERS);
  /** 1 zodra de speler ooit een hoofdgebouw had; pas dan kan hij het verliezen. */
  readonly hadHq = new Uint8Array(MAX_PLAYERS);
  /** Scripted AI: index van de volgende bouworder en de volgende aanvalsgolf. */
  readonly aiBuild = new Int32Array(MAX_PLAYERS);
  readonly aiAttack = new Int32Array(MAX_PLAYERS);
  /** Scripted AI: vanaf dit frame mag de volgende golf na de attackTimers vertrekken (balans speltest 14 oktober). */
  readonly aiWaveAt = new Int32Array(MAX_PLAYERS);
  /**
   * Scripted AI (xl-int): frame + 1 vanaf wanneer hij claimpunten neemt die niet aan zijn kant liggen
   * (claimFarFromTicks plus 0..waveJitterTicks via sim.rng, getrokken zodra claimFarFromTicks bereikt is); 0 = nog niet.
   */
  readonly aiClaimAt = new Int32Array(MAX_PLAYERS);
  /** Onderzochte techs als bitset, TECH_WORDS woorden per speler (bit k = techId k, MAX_TECHS; techBits.ts). */
  readonly tech = new Uint32Array(MAX_PLAYERS * TECH_WORDS);
  // Held (één per speler; systems/hero.ts). De held-entity draagt C.hero; dit blijft bestaan als hij dood is.
  /** HERO_NONE, HERO_ALIVE, HERO_DEAD, HERO_REVIVING of HERO_EMPTY. */
  readonly heroState = new Uint8Array(MAX_PLAYERS);
  /** Entity-id van de levende held, anders 0. */
  readonly heroEnt = new Uint32Array(MAX_PLAYERS);
  readonly heroLevel = new Int32Array(MAX_PLAYERS);
  readonly heroXp = new Int32Array(MAX_PLAYERS);
  /** Gekozen perks als bitset (bit k = perkId k, MAX_PERKS). */
  readonly heroPerks = new Uint32Array(MAX_PLAYERS);
  /** Level-ups zonder gekozen perk. */
  readonly heroPending = new Int32Array(MAX_PLAYERS);
  /** Aantal keer opgelapt. */
  readonly heroRevives = new Int32Array(MAX_PLAYERS);
  /** Ticks tot het oplappen klaar is (HERO_REVIVING). */
  readonly heroTimer = new Int32Array(MAX_PLAYERS);
  /** Per speler en ability-slot (MAX_ABILITIES): cooldown in ticks, en de zone (midden, resterende ticks). */
  readonly abCooldown = new Int32Array(MAX_PLAYERS * MAX_ABILITIES);
  readonly zoneX = new Int32Array(MAX_PLAYERS * MAX_ABILITIES);
  readonly zoneY = new Int32Array(MAX_PLAYERS * MAX_ABILITIES);
  readonly zoneTicks = new Int32Array(MAX_PLAYERS * MAX_ABILITIES);
  /** Getrainde SPECIAL-punten per speler en letter (data 0.16.0, training.json; S P E C I A L). Blijven na de dood van de held. */
  readonly trained = new Uint8Array(MAX_PLAYERS * SPECIAL_COUNT);
  /** Vangnet (data 0.16.0): ticks dat aan de voorwaarde voldaan is (één timer per speler) en het aantal aankomsten. */
  readonly netTimer = new Int32Array(MAX_PLAYERS);
  readonly netArrivals = new Int32Array(MAX_PLAYERS);
  /** Scripted AI: index in de robotvolgorde (robots.sequence) van de volgende robot. */
  readonly aiRobot = new Int32Array(MAX_PLAYERS);
  /** Tribute (data 0.21.0): owed scrap in thousandths times ticksPerMinute, paid out per whole scrap (systems/plunder.ts). */
  readonly tributeAcc = new Int32Array(MAX_PLAYERS);
  /** Raider AI (systems/aiRaiders.ts): position in the fighter mix, and the slave raid (frame it ends or may start, out). */
  readonly aiMix = new Int32Array(MAX_PLAYERS);
  readonly aiRaidAt = new Int32Array(MAX_PLAYERS);
  readonly aiRaidOut = new Uint8Array(MAX_PLAYERS);
  /**
   * Win route C (sim 0.25.0; voorstel, ter bevestiging door de architect): ticks of the player's Bouwproject countdown
   * (systems/project.ts); 0 while he lacks a restored part of some kind.
   */
  readonly projTicks = new Int32Array(MAX_PLAYERS);
  /** Dweller AI (win route C): frame + 1 from which it restores project parts (0 = not yet decided). */
  readonly aiProjectAt = new Int32Array(MAX_PLAYERS);
}

export const NO_WINNER = OWNER_NEUTRAL;

export const WIN_NONE = 0;

export const WIN_DESTRUCTION = 1;

export const WIN_DOMINANCE = 2;

export const WIN_SURRENDER = 3;

/** Win route C, Bouwproject (sim 0.25.0): the countdown of systems/project.ts completed. */
export const WIN_PROJECT = 4;

/** Globale state: winnaar, reden en frame. */
export class GlobalState {
  readonly words = new Int32Array(3);
  get winner(): number {
    return this.words[0]!;
  }
  set winner(v: number) {
    this.words[0] = v;
  }
  get reason(): number {
    return this.words[1]!;
  }
  set reason(v: number) {
    this.words[1] = v;
  }
  get frame(): number {
    return this.words[2]!;
  }
  set frame(v: number) {
    this.words[2] = v;
  }
}

/** Actuele begaanbaarheid: de map plus footprints van gebouwen. Afgeleid uit de gebouwen, herbouwd na deserialize. */
export class Terrain {
  readonly walk: Uint8Array;
  /** Per cel de index + 1 van het gebouw dat hem bezet, 0 = vrij. */
  readonly occ: Int32Array;

  constructor(readonly map: SimMap) {
    this.walk = new Uint8Array(map.passable);
    this.occ = new Int32Array(map.w * map.h);
  }

  setRect(i: number, fx: number, fy: number, fw: number, fh: number, on: boolean): void {
    const w = this.map.w;
    for (let y = fy; y < fy + fh; y++) {
      for (let x = fx; x < fx + fw; x++) {
        const c = y * w + x;
        this.occ[c] = on ? i + 1 : 0;
        this.walk[c] = on ? 0 : this.map.passable[c]!;
      }
    }
  }

  rebuild(world: World): void {
    this.walk.set(this.map.passable);
    this.occ.fill(0);
    for (let i = 0; i < world.highWater; i++) {
      if (world.has(i, C.building))
        this.setRect(i, world.fx[i]!, world.fy[i]!, world.fw[i]!, world.fh[i]!, true);
    }
  }
}

/**
 * Afgeleide lijsten van gebouwen en scrap-nodes (oplopende index), zodat zoekfuncties (dichtstbijzijnde depot,
 * werkplaats of node, dreiging bij de basis) niet elke keer alle entities aflopen. Geen state: de lijsten bouwen zich
 * opnieuw op zodra World.structVersion verandert (elke alloc en free), dus ze bevatten altijd precies de levende
 * gebouwen en nodes in dezelfde volgorde als een volledige scan. Filters op eigenaar, bouwstatus en voorraad doet de
 * aanroeper, zoals voorheen.
 */
export class EntityIndex {
  readonly buildings = new Int32Array(MAX_ENTITIES);
  buildingCount = 0;
  readonly nodes = new Int32Array(MAX_ENTITIES);
  nodeCount = 0;
  private version = -1;

  refresh(w: World): void {
    if (this.version === w.structVersion) return;
    this.version = w.structVersion;
    let b = 0;
    let n = 0;
    for (let i = 0; i < w.highWater; i++) {
      if (w.alive[i] !== 1) continue;
      const m = w.mask[i]!;
      if ((m & C.building) !== 0) this.buildings[b++] = i;
      if ((m & C.resource) !== 0) this.nodes[n++] = i;
    }
    this.buildingCount = b;
    this.nodeCount = n;
  }
}

/** Wat de systemen van de sim nodig hebben. Eén object, zodat de systemen losse functies blijven. */
export interface SimContext {
  readonly world: World;
  readonly flow: FlowFields;
  readonly terrain: Terrain;
  readonly map: SimMap;
  readonly config: SimConfig;
  readonly players: readonly SimPlayer[];
  readonly playerCount: number;
  readonly ps: PlayerState;
  readonly globals: GlobalState;
  readonly events: EventBuffer;
  readonly rng: Rng;
  /** Het frame dat nu wordt uitgevoerd. */
  readonly frame: number;
  /** Indices van de claimpunten, oplopend (afgeleid: ze ontstaan alleen in de startopstelling en verdwijnen nooit). */
  readonly claimPoints: readonly number[];
  /** Ability-zones van deze tick (afgeleid, systems/hero.ts auraSystem). */
  readonly auras: Auras;
  /** Tempo van robots zonder technicus van deze tick (afgeleid, systems/robots.ts robotRulesSystem). */
  readonly robotRates: RobotRates;
  /** Gebouwen en scrap-nodes als lijst (afgeleid, ververst zich zelf; zie EntityIndex). */
  readonly index: EntityIndex;
  /** Padafstanden over het terrein voor de keuzes van de AI (afgeleid, gecachet; zie pathdist.ts). */
  readonly terrainDist: TerrainDistances;
  /** Fog of war (vision.ts): explored per player (state), visible counts and World.visTo (derived). */
  readonly vision: Vision;
  /** Creep camps (sim 0.20.0, systems/creeps.ts): state per camp. */
  readonly creeps: CreepCamps;
  /**
   * Win route C (sim 0.25.0, systems/project.ts): entity indices of the parts of the strip mall in map order (derived:
   * created in start() and never freed; empty without a Bouwproject), and their state.
   */
  readonly projectParts: readonly number[];
  readonly project: ProjectState;
  /** Survival co-op (sim 0.27.0, systems/survival.ts): wave targets and batches (state only in the game type Survival). */
  readonly survival: SurvivalState;
  /** Base defence (sim 0.29.0, systems/defense.ts). */
  readonly defense: DefenseState;
  unitType(typeId: number): SimUnitType | undefined;
  buildingType(typeId: number): SimBuildingType | undefined;
}

/**
 * De k-de speler in de beurtvolgorde van deze tick (fair-ronde): de volgorde draait elke tick door (frame f: speler
 * f mod n eerst), zodat bij een gelijke stand geen speler vast voorgaat. Een functie van het frame, geen state.
 */
export function playerInTurn(ctx: SimContext, k: number): number {
  const n = ctx.playerCount;
  return n > 1 ? imod(ctx.frame + k, n) : 0;
}

/** Wisselt het flow field van een unit en houdt de refcount bij (afgeleide data). */
export function setFlowField(ctx: SimContext, i: number, slot: number): void {
  const w = ctx.world;
  const old = w.flowField[i]!;
  if (old === slot) return;
  if (old !== NO_FIELD) ctx.flow.refcount[old] = ctx.flow.refcount[old]! - 1;
  w.flowField[i] = slot;
  if (slot !== NO_FIELD) ctx.flow.refcount[slot] = ctx.flow.refcount[slot]! + 1;
}

/** Cel-index voor een positie in eenheden (moet binnen de map liggen). */
export const cellAt = (map: SimMap, x: number, y: number): number => (y >> 8) * map.w + (x >> 8);

export const inMap = (map: SimMap, x: number, y: number): boolean =>
  x >= 0 && y >= 0 && x < map.w << 8 && y < map.h << 8;

export const walkableAt = (ctx: SimContext, x: number, y: number): boolean =>
  ctx.terrain.walk[cellAt(ctx.map, x, y)] === 1;

/** Geometrie: een achtervolgde unit krijgt pas een nieuw flow field als hij zoveel cellen van het oude doel is. */
export const CHASE_REPATH_CELLS = 4;

/**
 * Laat unit i naar (x, y) lopen via het flow field naar de doelrechthoek (cellen). arriveR is de aankomstafstand;
 * groupR > 0 zet de contactregel voor groeps-Moves aan. Een veld met hetzelfde doel wordt hergebruikt.
 */
export function steerTo(
  ctx: SimContext,
  i: number,
  x: number,
  y: number,
  rx: number,
  ry: number,
  rw: number,
  rh: number,
  arriveR: number,
  groupR: number,
): void {
  const w = ctx.world;
  w.mvOn[i] = 1;
  w.goalX[i] = x;
  w.goalY[i] = y;
  w.goalR[i] = arriveR;
  w.groupR[i] = groupR;
  if (ctx.flow.hasTarget(w.flowField[i]!, rx, ry, rw, rh)) return;
  setFlowField(ctx, i, NO_FIELD);
  setFlowField(ctx, i, ctx.flow.acquire(rx, ry, rw, rh));
}

/** Naar een punt in de map: de cel als doelrechthoek, of de footprint van het gebouw dat op die cel staat. */
export function steerToPoint(
  ctx: SimContext,
  i: number,
  x: number,
  y: number,
  arriveR: number,
  groupR: number,
): void {
  steerVia(ctx, i, x, y, x, y, arriveR, groupR);
}

/**
 * Like steerToPoint toward (tx, ty) (its cell, or the footprint of the building on it, as the target of the flow
 * field), but with its own goal (gx, gy) near it: a worker's spot on the ring around a node shares the node's field.
 */
export function steerVia(
  ctx: SimContext,
  i: number,
  tx: number,
  ty: number,
  gx: number,
  gy: number,
  arriveR: number,
  groupR: number,
): void {
  const b = ctx.terrain.occ[cellAt(ctx.map, tx, ty)]! - 1;
  const w = ctx.world;
  if (b >= 0) steerTo(ctx, i, gx, gy, w.fx[b]!, w.fy[b]!, w.fw[b]!, w.fh[b]!, arriveR, groupR);
  else steerTo(ctx, i, gx, gy, tx >> 8, ty >> 8, 1, 1, arriveR, groupR);
}

/** Achter een bewegend doel aan: het veld blijft zolang het oude doel dicht genoeg bij de nieuwe positie ligt. */
export function steerChase(ctx: SimContext, i: number, x: number, y: number): void {
  const w = ctx.world;
  const f = w.flowField[i]!;
  if (f !== NO_FIELD && w.mvOn[i] === 1 && ctx.flow.tw[f] === 1 && ctx.flow.th[f] === 1) {
    const dx = ctx.flow.tx0[f]! - (x >> 8);
    const dy = ctx.flow.ty0[f]! - (y >> 8);
    if (
      dx <= CHASE_REPATH_CELLS &&
      -dx <= CHASE_REPATH_CELLS &&
      dy <= CHASE_REPATH_CELLS &&
      -dy <= CHASE_REPATH_CELLS
    ) {
      w.goalX[i] = x;
      w.goalY[i] = y;
      w.goalR[i] = 0;
      w.groupR[i] = 0;
      return;
    }
  }
  steerToPoint(ctx, i, x, y, 0, 0);
}

/** Stopt met lopen en laat het flow field los. */
export function stopMoving(ctx: SimContext, i: number): void {
  const w = ctx.world;
  w.mvOn[i] = 0;
  w.goalX[i] = NO_GOAL;
  w.goalY[i] = NO_GOAL;
  w.goalR[i] = 0;
  w.groupR[i] = 0;
  setFlowField(ctx, i, NO_FIELD);
}

/**
 * Kwadraat van de afstand van (x, y) tot de rechthoek van cellen [fx, fx+fw) x [fy, fy+fh), in eenheden. De rechthoek
 * loopt van rand tot rand, (fx << 8) tot en met ((fx + fw) << 8) (fair-ronde: met "- 1" aan de verre kant was hij niet
 * gelijk aan zijn spiegelbeeld, en kwam een unit bij de ene speler een tick eerder bij een gebouw aan dan bij de andere).
 */
export function distToRect2(
  x: number,
  y: number,
  fx: number,
  fy: number,
  fw: number,
  fh: number,
): number {
  const x0 = fx << 8;
  const y0 = fy << 8;
  const x1 = (fx + fw) << 8;
  const y1 = (fy + fh) << 8;
  const dx = x < x0 ? x0 - x : x > x1 ? x - x1 : 0;
  const dy = y < y0 ? y0 - y : y > y1 ? y - y1 : 0;
  return dx * dx + dy * dy;
}

/** Of entity t binnen afstand r van unit i ligt: tot de footprint voor gebouwen, tot de rand (radius) voor units. */
export function withinReach(w: World, i: number, t: number, r: number): boolean {
  if ((w.mask[t]! & C.building) !== 0)
    return distToRect2(w.x[i]!, w.y[i]!, w.fx[t]!, w.fy[t]!, w.fw[t]!, w.fh[t]!) <= r * r;
  const dx = w.x[t]! - w.x[i]!;
  const dy = w.y[t]! - w.y[i]!;
  const rr = r + w.radius[t]!;
  return dx * dx + dy * dy <= rr * rr;
}

const ROLE_BUILDER_INDEX = ROLES.indexOf('builder');

/**
 * Whether unit i builds like a builder (Build, Claim, help at a site, resume a site): role builder, or a robot whose
 * type has canBuild (data 0.26.0, the bouwrobot; voorstel, ter bevestiging door de architect). The hero never builds.
 */
export function canBuild(ctx: SimContext, i: number): boolean {
  const w = ctx.world;
  if ((w.mask[i]! & C.hero) !== 0) return false;
  return w.role[i] === ROLE_BUILDER_INDEX || ctx.unitType(w.typeId[i]!)?.canBuild === true;
}

/** Laat unit i naar entity t lopen: een gebouw via zijn footprint, anders via de cel van t. */
export function steerToEntity(ctx: SimContext, i: number, t: number): void {
  const w = ctx.world;
  if ((w.mask[t]! & C.building) !== 0)
    steerTo(ctx, i, w.x[t]!, w.y[t]!, w.fx[t]!, w.fy[t]!, w.fw[t]!, w.fh[t]!, 0, 0);
  else steerToPoint(ctx, i, w.x[t]!, w.y[t]!, 0, 0);
}

export function face(w: World, i: number, x: number, y: number): void {
  const dx = x - w.x[i]!;
  const dy = y - w.y[i]!;
  if (dx !== 0 || dy !== 0) w.yaw[i] = atan2A(dy, dx);
}

/**
 * Whether player p sees entity t now (fog of war, sim 0.17.0): his own entities always, others while one of his discs
 * covers their cell (a building: any cell of its footprint). From the end of the previous tick (World.visTo).
 */
export function visibleTo(w: World, t: number, p: number): boolean {
  return p < MAX_PLAYERS && ((w.visTo[t]! >>> p) & 1) !== 0;
}
