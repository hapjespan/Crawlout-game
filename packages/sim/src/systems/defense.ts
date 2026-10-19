// Base defence (sim 0.29.0, data 0.35.0; Martien 19 October: "als de basis wordt aangevallen dan gaan ze automatisch in
// de verdedig modus"; voorstel, ter bevestiging door de architect). On per game type (sim.json baseDefense: Survival on,
// skirmish a toggle, off for now); state only where it is on, so every other state keeps its format and hash.
//  - Alarm: an enemy (wave unit, creep, enemy player) hits a building of player p or a unit of p inside p's base radius
//    (combat.ts noteBaseHit). Base: in Survival the build zone of p's slot, else `radius` around his HQ.
//  - While a hostile unit stands inside the radius the alarm holds (the nearest one to the base centre is the threat);
//    calmTicks after the last one it ends.
//  - During the alarm every unit of p inside the radius whose current order is work or nothing (none, gather, build)
//    gets an order in front of it: a fighter (weapon) an AttackMove to the threat (it walks there, so no aggroRange
//    limit; sent again when the threat moved `retarget` from its point), a worker (slave, gatherer, builder, armed or not) a Move to the nearest own HQ or Kooi. Units on any other
//    order (a player command: move, guard, attack, craft, cast) are left alone.
//  - When the alarm ends the front order is dropped, so the previous order (the work) resumes.
import { ROLES } from '@crawlout/data';
import { MAX_ENTITIES, MAX_PLAYERS, OWNER_NEUTRAL } from '@crawlout/protocol';
import { defenseOn } from '../config.env.js';
import {
  C,
  NO_ENTITY,
  ORDER_ATTACK_MOVE,
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

const ROLE_SCAVENGER = ROLES.indexOf('scavenger');
const ROLE_BUILDER = ROLES.indexOf('builder');
const MARK_DEFEND = 1;
const MARK_SHELTER = 2;

export class DefenseState {
  /** Derived from the env (defenseOn), not state: whether the chunks below exist. */
  active = false;
  /** Per player: ticks left of the alarm (0 = calm). */
  readonly alarm = new Int32Array(MAX_PLAYERS);
  /** Per player: the threat position (sim units). */
  readonly tx = new Int32Array(MAX_PLAYERS);
  readonly ty = new Int32Array(MAX_PLAYERS);
  /** Per entity index: MARK_DEFEND or MARK_SHELTER while its front order is a defence order, else 0. */
  readonly mark = new Uint8Array(MAX_ENTITIES);
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
  if (d.alarm[p] === 0) {
    d.tx[p] = w.x[i]!;
    d.ty[p] = w.y[i]!;
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
    let threat = -1;
    let best = 0;
    if (b !== null)
      for (let t = 0; t < w.highWater; t++) {
        if (!hostile(w, t, p) || !inside(w, t, b)) continue;
        const dx = w.x[t]! - b.x;
        const dy = w.y[t]! - b.y;
        const dd = dx * dx + dy * dy;
        if (threat < 0 || dd < best) {
          threat = t;
          best = dd;
        }
      }
    if (threat >= 0) {
      d.alarm[p] = ctx.config.baseDefense.calmTicks + 1;
      d.tx[p] = w.x[threat]!;
      d.ty[p] = w.y[threat]!;
    } else d.alarm[p] = d.alarm[p]! - 1;
    if (d.alarm[p] === 0 || b === null) {
      d.alarm[p] = 0;
      release(ctx, p);
    } else if (threat >= 0) engage(ctx, p, b);
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
  return m === MARK_DEFEND ? t === ORDER_ATTACK_MOVE : t === ORDER_MOVE;
}

function engage(ctx: SimContext, p: number, b: { x: number; y: number; r: number }): void {
  const d = ctx.defense;
  const w = ctx.world;
  for (let i = 0; i < w.highWater; i++) {
    if (!w.has(i, C.unit | C.orders | C.health) || w.owner[i] !== p || w.hp[i]! <= 0) continue;
    if (w.slaveState[i] === SLAVE_CAPTIVE) continue;
    const m = d.mark[i]!;
    if (m !== 0 && !marked(w, i, m)) d.mark[i] = 0;
    // a fighter has a weapon and is no worker: gatherers and builders (the armed Dweller ones too) take shelter
    const role = w.role[i]!;
    const fighter =
      w.has(i, C.combat) && w.damage[i]! > 0 && role !== ROLE_SCAVENGER && role !== ROLE_BUILDER;
    if (d.mark[i] === MARK_DEFEND) {
      const o = w.currentOrder(i);
      const dx = w.ordX[o]! - d.tx[p]!;
      const dy = w.ordY[o]! - d.ty[p]!;
      const r = ctx.config.baseDefense.retarget;
      if (dx * dx + dy * dy <= r * r) continue;
      w.popOrder(i);
    } else if (d.mark[i] === MARK_SHELTER) continue;
    else {
      const t = w.orderType(i);
      if (t !== ORDER_NONE && t !== ORDER_GATHER && t !== ORDER_BUILD) continue;
      if (!inside(w, i, b)) continue;
    }
    let x = d.tx[p]!;
    let y = d.ty[p]!;
    if (!fighter) {
      const s = nearestOwnBuilding(ctx, p, w.x[i]!, w.y[i]!, PROVIDES_HQ | PROVIDES_KOOI);
      if (s < 0) continue;
      x = w.x[s]!;
      y = w.y[s]!;
    }
    stopMoving(ctx, i);
    w.target[i] = NO_ENTITY;
    unshiftOrder(w, i, fighter ? ORDER_ATTACK_MOVE : ORDER_MOVE, x, y);
    d.mark[i] = fighter ? MARK_DEFEND : MARK_SHELTER;
  }
}

/** The alarm of p is over: every defence order in front is dropped, the work behind it resumes. */
function release(ctx: SimContext, p: number): void {
  const d = ctx.defense;
  const w = ctx.world;
  for (let i = 0; i < w.highWater; i++) {
    const m = d.mark[i]!;
    if (m === 0) continue;
    if (w.alive[i] === 1 && w.owner[i] === p && marked(w, i, m)) {
      stopMoving(ctx, i);
      w.popOrder(i);
    }
    if (w.alive[i] !== 1 || w.owner[i] === p) d.mark[i] = 0;
  }
}
