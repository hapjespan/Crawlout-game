// Base defence (sim 0.29.0, data 0.35.0; Martien 19 October: "als de basis wordt aangevallen dan gaan ze automatisch in
// de verdedig modus"), a defend stance since sim 0.30.0, data 0.36.0 (Martien 20 October: "Nee ze schuilen niet maar
// verdedigen bij een basis aanval ipv direct aanvallen"); voorstel, ter bevestiging door de architect. On per game type
// (sim.json baseDefense: Survival on, skirmish a toggle, off for now); state only where it is on, so every other state
// keeps its format and hash.
//  - Alarm: an enemy (wave unit, creep, enemy player) hits a building of player p or a unit of p inside p's base radius
//    (combat.ts noteBaseHit). Base: in Survival the build zone of p's slot, else `radius` around his HQ.
//  - While a hostile unit stands inside the radius the alarm holds; calmTicks after the last one it ends.
//  - During the alarm every unit of p inside the radius whose current order is work or nothing (none, gather, build)
//    gets an order in front of it. An armed unit (combat, damage > 0: fighters and the armed scavengers and builders)
//    an Attack on the nearest hostile inside the radius, its own spot kept as the post in ordX/ordY: it shoots from
//    where it stands or walks just far enough to reach it, no charge to the threat. Each tick the target is checked:
//    out of the radius or dead, the nearest other hostile inside, none left, a Move back to the post (no chase
//    beyond the radius; there the Move ends and the work resumes). An unarmed unit (damage 0: the Raider slaves)
//    a Move to the nearest own HQ or Kooi. Units on any other order (a player command: move, guard, attack, craft,
//    cast) are left alone.
//  - When the alarm ends the Attack or shelter order in front is dropped, so the previous order (the work) resumes; a
//    unit on its way back to its post walks on.
import { MAX_ENTITIES, MAX_PLAYERS, OWNER_NEUTRAL } from '@crawlout/protocol';
import { defenseOn } from '../config.env.js';
import {
  C,
  NO_ENTITY,
  ORDER_ATTACK,
  ORDER_BUILD,
  ORDER_GATHER,
  ORDER_MOVE,
  ORDER_NONE,
  ORDER_SLOTS,
  PHASE_GO,
  SLAVE_CAPTIVE,
  SLAVE_SLAVE,
  type World,
} from '../ecs/world.js';
import { PROVIDES_HQ, PROVIDES_KOOI } from '../fromData.part1.js';
import { type SimContext, nearestOwnBuilding, stopMoving } from './common.js';
import { SLOT_PENDING } from './formation.part1.js';
import { hqOf } from './survival.part1.js';

/** Front order an Attack on a hostile inside the radius, ordX/ordY the post. */
const MARK_DEFEND = 1;
/** Front order a Move to the HQ or Kooi (unarmed). */
const MARK_SHELTER = 2;
/** Front order a Move back to the post (no hostile left inside the radius). */
const MARK_RETURN = 3;

export class DefenseState {
  /** Derived from the env (defenseOn), not state: whether the chunks below exist. */
  active = false;
  /** Per player: ticks left of the alarm (0 = calm). */
  readonly alarm = new Int32Array(MAX_PLAYERS);
  /** Per entity index: MARK_DEFEND, MARK_SHELTER or MARK_RETURN while its front order is a defence order, else 0. */
  readonly mark = new Uint8Array(MAX_ENTITIES);
  /** Scratch, not state: the hostiles inside the base radius this tick (entity indices, ascending). */
  readonly foes = new Int32Array(MAX_ENTITIES);
  foeCount = 0;
}

export const defenseActive = (ctx: SimContext): boolean => defenseOn(ctx);

/** Centre and radius of player p's base, or null without an HQ outside Survival. */
function baseOf(ctx: SimContext, p: number): { x: number; y: number; r: number } | null {
  const z = ctx.map.survival?.zones[p];
  if (z !== undefined) return { x: z.x, y: z.y, r: z.radius };
  const hq = hqOf(ctx, p);
  if (hq < 0) return null;
  return { x: ctx.world.x[hq]!, y: ctx.world.y[hq]!, r: ctx.config.baseDefense.radius };
}

const inside = (w: World, i: number, b: { x: number; y: number; r: number }): boolean => {
  const dx = w.x[i]! - b.x;
  const dy = w.y[i]! - b.y;
  return dx * dx + dy * dy <= b.r * b.r;
};

/** Whether unit t is hostile to player p: a wave unit or creep, or (outside co-op) a unit of another player. */
function hostile(w: World, t: number, p: number): boolean {
  if (!w.has(t, C.unit | C.health) || w.hp[t]! <= 0) return false;
  const st = w.slaveState[t]!;
  if (st === SLAVE_SLAVE || st === SLAVE_CAPTIVE) return false;
  const o = w.owner[t]!;
  if (o === OWNER_NEUTRAL) return w.creepCamp[t] !== 0;
  return o < MAX_PLAYERS && o !== p && !w.coop;
}

/** Combat hook: attacker i hit t. Raises the alarm of t's owner when t is his building or a unit in his base. */
export function noteBaseHit(ctx: SimContext, i: number, t: number): void {
  const d = ctx.defense;
  if (!d.active) return;
  const w = ctx.world;
  const p = w.owner[t]!;
  if (p >= ctx.playerCount || !hostile(w, i, p)) return;
  if ((w.mask[t]! & C.building) === 0) {
    const b = baseOf(ctx, p);
    if (b === null || !inside(w, t, b)) return;
  }
  d.alarm[p] = ctx.config.baseDefense.calmTicks + 1;
}

/** System 2, before the orders: holds or ends each alarm and gives the units of an alarmed base their front order. */
export function defenseSystem(ctx: SimContext): void {
  const d = ctx.defense;
  if (!d.active) return;
  const w = ctx.world;
  for (let p = 0; p < ctx.playerCount; p++) {
    if (d.alarm[p] === 0) continue;
    const b = baseOf(ctx, p);
    d.foeCount = 0;
    if (b !== null)
      for (let t = 0; t < w.highWater; t++) {
        if (!hostile(w, t, p) || !inside(w, t, b)) continue;
        d.foes[d.foeCount++] = t;
      }
    if (d.foeCount > 0) d.alarm[p] = ctx.config.baseDefense.calmTicks + 1;
    else d.alarm[p] = d.alarm[p]! - 1;
    if (d.alarm[p] === 0 || b === null) {
      d.alarm[p] = 0;
      release(ctx, p);
    } else engage(ctx, p, b);
  }
}

/** Puts an order (formation slot pending) in front of i's current one, which waits behind it; a full ring drops its last. */
function unshiftOrder(w: World, i: number, type: number, x: number, y: number): void {
  const c = w.ordCount[i]!;
  const head = (w.ordHead[i]! + ORDER_SLOTS - 1) & (ORDER_SLOTS - 1);
  const slot = i * ORDER_SLOTS + head;
  w.ordType[slot] = type;
  w.ordX[slot] = x;
  w.ordY[slot] = y;
  w.ordT[slot] = SLOT_PENDING;
  w.ordHead[i] = head;
  w.ordCount[i] = c < ORDER_SLOTS ? c + 1 : ORDER_SLOTS;
  w.phase[i] = PHASE_GO;
  w.work[i] = 0;
}

/** Whether i's front order is still the defence order its mark says. */
function marked(w: World, i: number, m: number): boolean {
  const t = w.orderType(i);
  return m === MARK_DEFEND ? t === ORDER_ATTACK : t === ORDER_MOVE;
}

/** The hostile of this tick's list nearest to unit i (lowest index on a tie), or -1. */
function nearestFoe(d: DefenseState, w: World, i: number): number {
  let best = -1;
  let bestD = 0;
  for (let k = 0; k < d.foeCount; k++) {
    const t = d.foes[k]!;
    const dx = w.x[t]! - w.x[i]!;
    const dy = w.y[t]! - w.y[i]!;
    const dd = dx * dx + dy * dy;
    if (best < 0 || dd < bestD) {
      best = t;
      bestD = dd;
    }
  }
  return best;
}

/** Whether t is in this tick's list of hostiles inside the radius. */
function isFoe(d: DefenseState, t: number): boolean {
  for (let k = 0; k < d.foeCount; k++) if (d.foes[k] === t) return true;
  return false;
}

/** Puts an Attack on foe f in front of i's current order, with post (x, y). */
function defend(ctx: SimContext, i: number, f: number, x: number, y: number): void {
  const w = ctx.world;
  stopMoving(ctx, i);
  unshiftOrder(w, i, ORDER_ATTACK, x, y);
  const id = w.idOf(f);
  w.ordT[w.currentOrder(i)] = id;
  w.target[i] = id;
  ctx.defense.mark[i] = MARK_DEFEND;
}

function engage(ctx: SimContext, p: number, b: { x: number; y: number; r: number }): void {
  const d = ctx.defense;
  const w = ctx.world;
  for (let i = 0; i < w.highWater; i++) {
    if (!w.has(i, C.unit | C.orders | C.health) || w.owner[i] !== p || w.hp[i]! <= 0) continue;
    if (w.slaveState[i] === SLAVE_CAPTIVE) continue;
    const m = d.mark[i]!;
    if (m !== 0 && !marked(w, i, m)) d.mark[i] = 0;
    const mk = d.mark[i]!;
    if (mk === MARK_SHELTER) continue;
    if (mk === MARK_DEFEND) {
      // keep the target while it is a hostile inside the radius, else the nearest other one, else back to the post
      const o = w.currentOrder(i);
      const cur = w.resolve(w.ordT[o]!);
      if (cur >= 0 && isFoe(d, cur)) continue;
      const f = nearestFoe(d, w, i);
      if (f >= 0) {
        w.ordT[o] = w.idOf(f);
        w.target[i] = w.idOf(f);
        continue;
      }
      const x = w.ordX[o]!;
      const y = w.ordY[o]!;
      stopMoving(ctx, i);
      w.popOrder(i);
      w.target[i] = NO_ENTITY;
      unshiftOrder(w, i, ORDER_MOVE, x, y);
      d.mark[i] = MARK_RETURN;
      continue;
    }
    if (mk === MARK_RETURN) {
      // on its way back to its post: a new hostile inside the radius, defend again from the same post
      const f = nearestFoe(d, w, i);
      if (f < 0) continue;
      const o = w.currentOrder(i);
      const x = w.ordX[o]!;
      const y = w.ordY[o]!;
      w.popOrder(i);
      defend(ctx, i, f, x, y);
      continue;
    }
    const t = w.orderType(i);
    if (t !== ORDER_NONE && t !== ORDER_GATHER && t !== ORDER_BUILD) continue;
    if (!inside(w, i, b) || d.foeCount === 0) continue;
    if (w.has(i, C.combat) && w.damage[i]! > 0) {
      defend(ctx, i, nearestFoe(d, w, i), w.x[i]!, w.y[i]!);
      continue;
    }
    // unarmed (damage 0, the Raider slaves): shelter at the nearest own HQ or Kooi
    const s = nearestOwnBuilding(ctx, p, w.x[i]!, w.y[i]!, PROVIDES_HQ | PROVIDES_KOOI);
    if (s < 0) continue;
    stopMoving(ctx, i);
    w.target[i] = NO_ENTITY;
    unshiftOrder(w, i, ORDER_MOVE, w.x[s]!, w.y[s]!);
    d.mark[i] = MARK_SHELTER;
  }
}

/** The alarm of p is over: every Attack or shelter order in front is dropped, the work behind it resumes. */
function release(ctx: SimContext, p: number): void {
  const d = ctx.defense;
  const w = ctx.world;
  for (let i = 0; i < w.highWater; i++) {
    const m = d.mark[i]!;
    if (m === 0) continue;
    if (w.alive[i] === 1 && w.owner[i] === p && m !== MARK_RETURN && marked(w, i, m)) {
      stopMoving(ctx, i);
      w.popOrder(i);
    }
    if (w.alive[i] !== 1 || w.owner[i] === p) d.mark[i] = 0;
  }
}
