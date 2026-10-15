import { MAX_ENTITIES, MAX_PLAYERS, OWNER_NEUTRAL } from '@crawlout/protocol';
import type { SimBuildingType, SimConfig, SimMap, SimPlayer, SimUnitType } from '../config.js';
import { MAX_ABILITIES } from '../config.js';
import type { World } from '../ecs/world.js';
import { BSTATE_DONE, C, NO_FIELD, NO_GOAL } from '../ecs/world.js';
import type { EventBuffer } from '../events.js';
import type { FlowFields } from '../flowfield.js';
import type { TerrainDistances } from '../pathdist.js';
import { idiv } from '../math/int.js';
import { atan2A } from '../math/trig.js';
import type { Rng } from '../rng.js';
import type { Auras } from './hero.js';

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
  /** Onderzochte techs als bitset (bit k = techId k, MAX_TECHS). */
  readonly tech = new Uint32Array(MAX_PLAYERS);
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
}

export const NO_WINNER = OWNER_NEUTRAL;
export const WIN_NONE = 0;
export const WIN_DESTRUCTION = 1;
export const WIN_DOMINANCE = 2;
export const WIN_SURRENDER = 3;

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
  /** Gebouwen en scrap-nodes als lijst (afgeleid, ververst zich zelf; zie EntityIndex). */
  readonly index: EntityIndex;
  /** Padafstanden over het terrein voor de keuzes van de AI (afgeleid, gecachet; zie pathdist.ts). */
  readonly terrainDist: TerrainDistances;
  unitType(typeId: number): SimUnitType | undefined;
  buildingType(typeId: number): SimBuildingType | undefined;
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
  const b = ctx.terrain.occ[cellAt(ctx.map, x, y)]! - 1;
  const w = ctx.world;
  if (b >= 0) steerTo(ctx, i, x, y, w.fx[b]!, w.fy[b]!, w.fw[b]!, w.fh[b]!, arriveR, groupR);
  else steerTo(ctx, i, x, y, x >> 8, y >> 8, 1, 1, arriveR, groupR);
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

/** Kwadraat van de afstand van (x, y) tot de rechthoek van cellen [fx, fx+fw) x [fy, fy+fh), in eenheden. */
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
  const x1 = ((fx + fw) << 8) - 1;
  const y1 = ((fy + fh) << 8) - 1;
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

/** Vijandige, levende entity met Health (unit of gebouw) voor unit i. */
export function isEnemy(w: World, i: number, t: number): boolean {
  if (!w.has(t, C.health) || w.hp[t]! <= 0) return false;
  const o = w.owner[t]!;
  return o !== OWNER_NEUTRAL && o !== w.owner[i]!;
}

/** Kwadraat van de afstand tussen de middelpunten van twee entities. */
export function dist2(w: World, i: number, j: number): number {
  const dx = w.x[j]! - w.x[i]!;
  const dy = w.y[j]! - w.y[i]!;
  return dx * dx + dy * dy;
}

/** Dichtstbijzijnde voltooide eigen gebouw met een van de provides-bits, of -1. Tiebreak laagste index. */
export function nearestOwnBuilding(
  ctx: SimContext,
  owner: number,
  x: number,
  y: number,
  providesMask: number,
): number {
  const w = ctx.world;
  const idx = ctx.index;
  idx.refresh(w);
  let best = -1;
  let bestD = 0;
  for (let k = 0; k < idx.buildingCount; k++) {
    const j = idx.buildings[k]!;
    if (w.owner[j] !== owner || w.bstate[j] !== BSTATE_DONE) continue;
    const bt = ctx.buildingType(w.typeId[j]!);
    if (bt === undefined || (bt.provides & providesMask) === 0) continue;
    const d = distToRect2(x, y, w.fx[j]!, w.fy[j]!, w.fw[j]!, w.fh[j]!);
    if (best < 0 || d < bestD) {
      best = j;
      bestD = d;
    }
  }
  return best;
}

/**
 * Of speler p van scrap-node `node` mag verzamelen: niet als de node binnen claimRadius ligt van een claimpunt van
 * een andere speler, tenzij hij ook binnen de straal van een eigen punt ligt.
 */
export function nodeAllowed(ctx: SimContext, node: number, p: number): boolean {
  const w = ctx.world;
  const r = ctx.config.claimRadius;
  const r2 = r * r;
  let blocked = false;
  for (const pt of ctx.claimPoints) {
    const o = w.owner[pt]!;
    if (o === OWNER_NEUTRAL) continue;
    const dx = w.x[node]! - w.x[pt]!;
    const dy = w.y[node]! - w.y[pt]!;
    if (dx * dx + dy * dy > r2) continue;
    if (o === p) return true;
    blocked = true;
  }
  return !blocked;
}

/** Dichtstbijzijnde scrap-node met voorraad waar speler p mag verzamelen (nodeAllowed), of -1. Tiebreak laagste index. */
export function nearestNode(ctx: SimContext, p: number, x: number, y: number): number {
  const w = ctx.world;
  const idx = ctx.index;
  idx.refresh(w);
  let best = -1;
  let bestD = 0;
  for (let k = 0; k < idx.nodeCount; k++) {
    const j = idx.nodes[k]!;
    if (w.amount[j]! <= 0 || !nodeAllowed(ctx, j, p)) continue;
    const dx = w.x[j]! - x;
    const dy = w.y[j]! - y;
    const d = dx * dx + dy * dy;
    if (best < 0 || d < bestD) {
      best = j;
      bestD = d;
    }
  }
  return best;
}

/**
 * Cellen op ring d (Chebyshev-afstand d >= 1) rond de rechthoek [fx, fx+fw) x [fy, fy+fh), rij voor rij, binnen
 * de map. Roept visit aan tot die true geeft; geeft dan die cel-index terug, anders -1.
 */
export function scanRing(
  map: SimMap,
  fx: number,
  fy: number,
  fw: number,
  fh: number,
  d: number,
  visit: (cx: number, cy: number) => boolean,
): number {
  const x0 = fx - d;
  const y0 = fy - d;
  const x1 = fx + fw - 1 + d;
  const y1 = fy + fh - 1 + d;
  for (let cy = y0; cy <= y1; cy++) {
    if (cy < 0 || cy >= map.h) continue;
    const edgeRow = cy === y0 || cy === y1;
    for (let cx = x0; cx <= x1; cx += edgeRow || cx === x1 ? 1 : x1 - x0) {
      if (cx < 0 || cx >= map.w) continue;
      if (visit(cx, cy)) return cy * map.w + cx;
    }
  }
  return -1;
}

/** Geometrie: zover (in ringen van 1 cel) zoekt de sim naar een vrije cel rond een gebouw. */
export const MAX_FREE_RING = 24;

/** De vrije (begaanbare) cel rond een rechthoek die het dichtst bij (x, y) ligt, ring voor ring. -1 als er geen is. */
export function nearestFreeCellAround(
  ctx: SimContext,
  fx: number,
  fy: number,
  fw: number,
  fh: number,
  x: number,
  y: number,
): number {
  const map = ctx.map;
  for (let d = 1; d <= MAX_FREE_RING; d++) {
    let best = -1;
    let bestD = 0;
    scanRing(map, fx, fy, fw, fh, d, (cx, cy) => {
      const c = cy * map.w + cx;
      if (ctx.terrain.walk[c] !== 1) return false;
      const dx = (cx << 8) + 128 - x;
      const dy = (cy << 8) + 128 - y;
      const dd = dx * dx + dy * dy;
      if (best < 0 || dd < bestD) {
        best = c;
        bestD = dd;
      }
      return false;
    });
    if (best >= 0) return best;
  }
  return -1;
}

/**
 * De k-de vrije cel rond een rechthoek: ring voor ring, en binnen een ring de cel het dichtst bij het midden van de map
 * eerst (dan rij voor rij). Op een puntsymmetrische map krijgen beide spelers zo elkaars spiegelbeeld (rij voor rij
 * alleen is dat niet: de bovenste rij ligt voor de ene speler aan de kant van het midden en voor de ander aan de rand).
 * -1 als er minder zijn.
 */
export function nthFreeCellAround(
  ctx: SimContext,
  fx: number,
  fy: number,
  fw: number,
  fh: number,
  k: number,
): number {
  const map = ctx.map;
  const mx2 = map.w - 1;
  const my2 = map.h - 1;
  let left = k;
  const ring: number[] = [];
  const key: number[] = [];
  for (let d = 1; d <= MAX_FREE_RING; d++) {
    ring.length = 0;
    key.length = 0;
    scanRing(map, fx, fy, fw, fh, d, (cx, cy) => {
      if (ctx.terrain.walk[cy * map.w + cx] !== 1) return false;
      // afstand tot het midden van de map, in halve cellen (het midden kan op een celgrens liggen)
      const dx = 2 * cx - mx2;
      const dy = 2 * cy - my2;
      const v = dx * dx + dy * dy;
      let j = ring.length;
      ring.push(0);
      key.push(0);
      while (j > 0 && key[j - 1]! > v) {
        ring[j] = ring[j - 1]!;
        key[j] = key[j - 1]!;
        j--;
      }
      ring[j] = cy * map.w + cx;
      key[j] = v;
      return false;
    });
    if (left < ring.length) return ring[left]!;
    left -= ring.length;
  }
  return -1;
}

/** Midden van cel-index c in eenheden. */
export function cellCenterOf(map: SimMap, c: number): { x: number; y: number } {
  const cy = idiv(c, map.w);
  return { x: ((c - cy * map.w) << 8) + 128, y: (cy << 8) + 128 };
}

/** Plaatst unit i op het midden van cel c. */
export function placeOnCell(ctx: SimContext, i: number, c: number): void {
  const p = cellCenterOf(ctx.map, c);
  ctx.world.x[i] = p.x;
  ctx.world.y[i] = p.y;
}
