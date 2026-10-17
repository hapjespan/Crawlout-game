import type { SimChem, SimFaction } from '../config.js';
import { EFFECT_TARGET_ALL } from '../config.js';
import {
  C,
  CHEM_ACTIVE,
  CHEM_COOL,
  CHEM_CRASH,
  CHEM_NONE,
  NO_ENTITY,
  SLAVE_NONE,
} from '../ecs/world.js';
import {
  SPECIAL_A,
  SPECIAL_S,
  STAT_DAMAGE,
  STAT_SPECIAL,
  STAT_SPEED,
  hasTechs,
  scalePermille,
} from '../effects.js';
import type { SimContext } from './common.js';
import { isEnemy } from './common.js';

// Chems (Spelfundament 6, data 0.21.0 factions chems and loadouts aura; sim 0.18.0). The SPECIAL channel of the Raiders:
//  - A Chem-dealer (loadouts aura) doses the own units within aura.radius (centre to centre; itself too; not slaves)
//    while a fight is on (trigger gevecht: the dealer or one of those units has a living enemy target). It doses the
//    first chem of aura.chems whose requiresTech the player has; every unit without a chem (phase none, so not during
//    a dose, its crash or its cooldown) gets one for doseScrap each, in ascending id, as long as the scrap lasts.
//  - A dose is active for activeTicks, then crashes for crashTicks, then cools down for cooldownTicks (no new dose
//    until then): one chem per unit, no addiction. With the refined tech the active and crash durations change by
//    refined.activePermille and crashPermille (zuivere_stoffen: +30 and -30 percent).
//  - Effects (derived per tick in systems/hero.ts auraSystem, like an ability zone): damagePct and speedPct of the
//    chem (or its crash) on the dosed unit; on the hero also the SPECIAL letters S and A of target held, as Strength
//    (damage) and Agility (speed) per point (sim.json special), while the dose is active.

/** The chem of unit i (from its faction by w.chem), or undefined. */
export function chemOf(ctx: SimContext, i: number): SimChem | undefined {
  const w = ctx.world;
  const c = w.chem[i]!;
  const p = w.owner[i]!;
  if (c === 0 || p >= ctx.playerCount) return undefined;
  return factionOf(ctx, p).chems[c - 1];
}

const factionOf = (ctx: SimContext, p: number): SimFaction =>
  ctx.config.factions[ctx.players[p]!.factionId]!;

/** Duration of the active phase or the crash for player p, with the refined tech. */
function duration(ctx: SimContext, p: number, c: SimChem, crash: boolean): number {
  const base = crash ? c.crashTicks : c.activeTicks;
  const r = c.refined;
  if (r === null || !hasTechs(ctx, p, [r.requiresTech])) return base;
  return scalePermille(base, crash ? r.crashPermille : r.activePermille);
}

/** Whether unit j has a living, visible enemy target (it is in a fight). */
function fighting(ctx: SimContext, j: number): boolean {
  const w = ctx.world;
  const id = w.target[j]!;
  if (id === NO_ENTITY) return false;
  const t = w.resolve(id);
  return t >= 0 && isEnemy(w, j, t);
}

/** System 6: the chem timers of every unit, then the doses of every Chem-dealer. */
export function chemSystem(ctx: SimContext): void {
  const w = ctx.world;
  let dealers = false;
  for (let i = 0; i < w.highWater; i++) {
    if (w.alive[i] !== 1 || !w.has(i, C.unit | C.health)) continue;
    if ((w.mask[i]! & C.hero) === 0 && ctx.unitType(w.typeId[i]!)?.aura != null) dealers = true;
    if (w.chemPhase[i] === CHEM_NONE) continue;
    w.chemTicks[i] = w.chemTicks[i]! - 1;
    while (w.chemTicks[i]! <= 0 && w.chemPhase[i] !== CHEM_NONE) {
      const c = chemOf(ctx, i);
      const ph = w.chemPhase[i]!;
      if (c === undefined || ph === CHEM_COOL) {
        w.chem[i] = 0;
        w.chemPhase[i] = CHEM_NONE;
        w.chemTicks[i] = 0;
      } else if (ph === CHEM_ACTIVE) {
        w.chemPhase[i] = CHEM_CRASH;
        w.chemTicks[i] = duration(ctx, w.owner[i]!, c, true);
      } else {
        w.chemPhase[i] = CHEM_COOL;
        w.chemTicks[i] = c.cooldownTicks;
      }
    }
  }
  if (!dealers) return;
  for (let d = 0; d < w.highWater; d++) {
    if (w.alive[d] !== 1 || !w.has(d, C.unit | C.health) || w.hp[d]! <= 0) continue;
    if ((w.mask[d]! & (C.hero | C.corpse)) !== 0) continue;
    const aura = ctx.unitType(w.typeId[d]!)?.aura;
    if (aura == null) continue;
    const p = w.owner[d]!;
    if (p >= ctx.playerCount || ctx.ps.defeated[p] !== 0 || w.slaveState[d] !== SLAVE_NONE)
      continue;
    const f = factionOf(ctx, p);
    let k = -1;
    for (const c of aura.chems) {
      const ch = f.chems[c];
      if (ch !== undefined && (ch.requiresTech < 0 || hasTechs(ctx, p, [ch.requiresTech]))) {
        k = c;
        break;
      }
    }
    if (k < 0) continue;
    const chem = f.chems[k]!;
    const r = aura.radius;
    let fight = false;
    for (let j = 0; j < w.highWater && !fight; j++) {
      if (!inAura(ctx, d, j, p, r)) continue;
      if (fighting(ctx, j)) fight = true;
    }
    if (!fight) continue;
    for (let j = 0; j < w.highWater; j++) {
      if (w.chemPhase[j] !== CHEM_NONE || !inAura(ctx, d, j, p, r)) continue;
      if (ctx.ps.scrap[p]! < chem.doseScrap) break;
      ctx.ps.scrap[p] = ctx.ps.scrap[p]! - chem.doseScrap;
      w.chem[j] = k + 1;
      w.chemPhase[j] = CHEM_ACTIVE;
      w.chemTicks[j] = duration(ctx, p, chem, false);
    }
  }
}

/** Whether unit j is an own living unit of p (not a slave or captive) within r of dealer d. */
function inAura(ctx: SimContext, d: number, j: number, p: number, r: number): boolean {
  const w = ctx.world;
  if (w.alive[j] !== 1 || w.owner[j] !== p || !w.has(j, C.unit | C.health) || w.hp[j]! <= 0)
    return false;
  if ((w.mask[j]! & C.corpse) !== 0 || w.slaveState[j] !== SLAVE_NONE) return false;
  const dx = w.x[j]! - w.x[d]!;
  const dy = w.y[j]! - w.y[d]!;
  return dx <= r && -dx <= r && dy <= r && -dy <= r && dx * dx + dy * dy <= r * r;
}

/**
 * The speed and damage permille of unit i from its chem now (active effects or crash), added to `out` [speed, damage].
 * True when it has any.
 */
export function chemModifiers(ctx: SimContext, i: number, out: Int32Array): boolean {
  const w = ctx.world;
  const ph = w.chemPhase[i]!;
  if (ph !== CHEM_ACTIVE && ph !== CHEM_CRASH) return false;
  const c = chemOf(ctx, i);
  if (c === undefined) return false;
  const hero = (w.mask[i]! & C.hero) !== 0;
  const sp = ctx.config.special;
  let speed = 0;
  let damage = 0;
  for (const e of ph === CHEM_ACTIVE ? c.effects : c.crash) {
    if (e.target !== EFFECT_TARGET_ALL && !hero) continue;
    if (e.stat === STAT_DAMAGE) damage += e.delta;
    else if (e.stat === STAT_SPEED) speed += e.delta;
    else if (hero && e.stat === STAT_SPECIAL + SPECIAL_S)
      damage += e.delta * sp.strengthDamagePermille;
    else if (hero && e.stat === STAT_SPECIAL + SPECIAL_A)
      speed += e.delta * sp.agilitySpeedPermille;
  }
  out[0] = out[0]! + speed;
  out[1] = out[1]! + damage;
  return speed !== 0 || damage !== 0;
}
