import { MAX_ENTITIES, MAX_PLAYERS } from '@crawlout/protocol';
import { MAX_CARGO } from '../config.limits.js';
import { BSTATE_DONE, C } from '../ecs/world.js';
import { applyStats, hasTechs, STAT_DAMAGE, STAT_HP } from '../effects.js';
import type { SimContext } from './common.js';

// The Garde, round A (data 0.38.0, sim 0.32.0; proposal for the architect; docs/garde.md items 1 and 2).
//  - Veteran promotion: a unit of a type in its faction's veterancy.typeIds (the Initiate-wacht) counts the enemy units
//    it kills (killing blow, combat.ts); at each rank's kills it climbs a rank, whose hpPermille and damagePermille add to
//    its stats (applyStats, like a tech; the hp grows with the new maximum). Counter and rank are per entity, cleared
//    when the index is freed. The hero never ranks.
//  - Fusion cores (system 6): a player whose faction has fusionCores and who holds a completed building of its type and
//    its prereqTech starts one core when the stock is under maxStock and he has the scrap (paid at the start); after
//    craftTicks (only while such a building stands) the stock grows by one. A loadout with fusionCores takes that many
//    at the start of its production (Produce, systems/robots.ts) and Cancel gives them back.
// State only where a player plays a faction with Garde rules (`active`, config.hash.garde.ts gardeOn), so every other
// state keeps its format and hash.

export class GardeState {
  /** Derived from the env: a player plays a faction with veterancy or fusion cores. */
  active = false;
  /** Enemy units killed, per entity (capped at 255). */
  readonly kills = new Uint8Array(MAX_ENTITIES);
  /** Veteran rank per entity: 0 none, k = ranks[k - 1]. */
  readonly rank = new Uint8Array(MAX_ENTITIES);
  /** Fusion cores in stock, per player. */
  readonly cores = new Uint8Array(MAX_PLAYERS);
  /** 0 = no core in work, else 1 + ticks of work on the current core, per player. */
  readonly coreWork = new Int32Array(MAX_PLAYERS);
  // Round B (sim 0.33.0; garde.klerk.ts, garde.transport.ts, garde.powerArmor.ts)
  /** Overload: the frame until which an entity is stunned (exclusive), and from which a Klerk may overload again. */
  readonly stunUntil = new Int32Array(MAX_ENTITIES);
  readonly overloadAt = new Int32Array(MAX_ENTITIES);
  /** Map power armour: the quality of a frame in permille, 0 = full. */
  readonly quality = new Uint16Array(MAX_ENTITIES);
  /** Cargo per transport: passengers, and per slot (MAX_CARGO per entity) typeId, hp, veteran rank and kills. */
  readonly cargoN = new Uint8Array(MAX_ENTITIES);
  readonly cargoType = new Uint16Array(MAX_ENTITIES * MAX_CARGO);
  readonly cargoHp = new Uint16Array(MAX_ENTITIES * MAX_CARGO);
  readonly cargoRank = new Uint8Array(MAX_ENTITIES * MAX_CARGO);
  readonly cargoKills = new Uint8Array(MAX_ENTITIES * MAX_CARGO);
  /** Per powerArmor claim point (entity index): its holder + 1 (0 none), his wait in ticks, the id of his frame. */
  readonly paHolder = new Uint8Array(MAX_ENTITIES);
  readonly paTimer = new Int32Array(MAX_ENTITIES);
  readonly paFrame = new Uint32Array(MAX_ENTITIES);
}

/** A unit i of a player made the killing blow on an enemy unit: count it and promote at the next rank. */
export function veteranKill(ctx: SimContext, i: number): void {
  const g = ctx.garde;
  const w = ctx.world;
  if (!g.active || (w.mask[i]! & (C.unit | C.hero)) !== C.unit) return;
  const v = ctx.config.factions[ctx.players[w.owner[i]!]!.factionId]!.veterancy;
  if (v === null || !v.typeIds.includes(w.typeId[i]!)) return;
  const k = g.kills[i]! < 255 ? g.kills[i]! + 1 : 255;
  g.kills[i] = k;
  let r = 0;
  while (r < v.ranks.length && v.ranks[r]!.kills <= k) r++;
  if (r <= g.rank[i]!) return;
  g.rank[i] = r;
  applyStats(ctx, i, true);
}

/** The permille that the rank of unit i adds to `stat` (STAT_HP or STAT_DAMAGE); 0 without a rank. */
export function veteranPermille(ctx: SimContext, i: number, stat: number): number {
  const g = ctx.garde;
  if (!g.active) return 0;
  // round B (sim 0.33.0): a frame of the map below full quality (garde.powerArmor.ts)
  const q = g.quality[i]!;
  const lessQ = q !== 0 && (stat === STAT_HP || stat === STAT_DAMAGE) ? q - 1000 : 0;
  const r = g.rank[i]!;
  if (r === 0) return lessQ;
  const w = ctx.world;
  const rank = ctx.config.factions[ctx.players[w.owner[i]!]!.factionId]!.veterancy?.ranks[r - 1];
  if (rank === undefined) return lessQ;
  return (
    lessQ + (stat === STAT_HP ? rank.hpPermille : stat === STAT_DAMAGE ? rank.damagePermille : 0)
  );
}

/** Whether player p holds a completed, living building of type typeId. */
function holds(ctx: SimContext, p: number, typeId: number): boolean {
  const w = ctx.world;
  const idx = ctx.index;
  idx.refresh(w);
  for (let k = 0; k < idx.buildingCount; k++) {
    const j = idx.buildings[k]!;
    if (w.owner[j] === p && w.typeId[j] === typeId && w.bstate[j] === BSTATE_DONE && w.hp[j]! > 0)
      return true;
  }
  return false;
}

/** System 6: the fusion cores of every player whose faction has them. */
export function fusionCoreSystem(ctx: SimContext): void {
  const g = ctx.garde;
  if (!g.active) return;
  const ps = ctx.ps;
  for (let p = 0; p < ctx.playerCount; p++) {
    const fc = ctx.config.factions[ctx.players[p]!.factionId]!.fusionCores;
    if (fc === null || ps.defeated[p] !== 0) continue;
    if (!holds(ctx, p, fc.buildingTypeId)) continue;
    if (g.coreWork[p] === 0) {
      if (g.cores[p]! >= fc.maxStock || !hasTechs(ctx, p, fc.prereqTech)) continue;
      if (ps.scrap[p]! < fc.scrapCost) continue;
      ps.scrap[p] = ps.scrap[p]! - fc.scrapCost;
      g.coreWork[p] = 1;
      continue;
    }
    g.coreWork[p] = g.coreWork[p]! + 1;
    if (g.coreWork[p]! > fc.craftTicks) {
      g.cores[p] = g.cores[p]! + 1;
      g.coreWork[p] = 0;
    }
  }
}

/** Produce: whether p has the cores for type t, and take them. */
export function takeCores(ctx: SimContext, p: number, cores: number, take: boolean): boolean {
  if (cores <= 0) return true;
  const g = ctx.garde;
  if (!g.active || g.cores[p]! < cores) return false;
  if (take) g.cores[p] = g.cores[p]! - cores;
  return true;
}

/** Cancel of a production that took `cores`: back into the stock. */
export function refundCores(ctx: SimContext, p: number, cores: number): void {
  if (cores <= 0 || !ctx.garde.active) return;
  const v = ctx.garde.cores[p]! + cores;
  ctx.garde.cores[p] = v < 255 ? v : 255;
}
