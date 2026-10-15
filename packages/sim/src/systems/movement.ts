import { MAX_ENTITIES } from '@crawlout/protocol';
import { MAX_SPEED } from '../config.js';
import { C, NO_FIELD, NO_GOAL } from '../ecs/world.js';
import { scalePermille } from '../effects.js';
import { clampI, idiv } from '../math/int.js';
import { isqrt } from '../math/sqrt.js';
import { SIN_TABLE, TRIG_BITS, atan2A } from '../math/trig.js';
import type { SimContext } from './common.js';
import { cellAt, setFlowField, walkableAt } from './common.js';
import { lineClear } from './formation.js';

// Systeem 4: beweging plus separatie.
//  a) gewenste snelheid per unit met mvOn: flow field naar de volgende cel, vlak bij het doel recht erop af;
//     binnen goalR van het doel is de unit er (mvOn = 0, veld los; goalX/goalY blijven voor de contactregel);
//  b) separatie: overlappende units duwen elkaar uit elkaar (integer-sommen, dus volgorde-onafhankelijk); een
//     lopende unit die een andere voor zich raakt, wijkt daarbij ook naar rechts uit (geen kop-op-kop-blokkade);
//     a group Move (groupR > 0) within groupR of its goal that touches a stopped unit standing closer to that goal
//     has arrived as well (its slot is taken or out of reach);
//  c) toepassen met botsing tegen geblokkeerde cellen (eerst diagonaal, dan per as glijden).
// Alles leest de posities van het begin van de stap en schrijft pas in c). Welke kant op een unit wil, bepaalt
// systeem 2 (orders en AI) met steerTo; dit systeem voert alleen uit.

/** Geometrie: separatie-buckets van 2^9 = 512 eenheden (2 m), minstens twee keer de maximale straal. */
const BUCKET_SHIFT = 9;
/** Geometrie: maximale verplaatsing per as per tick, kleiner dan een cel (256), zodat niemand door een muur tunnelt. */
const MAX_STEP = 255;

export class MovementScratch {
  readonly gridW: number;
  readonly gridH: number;
  readonly head: Int32Array;
  readonly next = new Int32Array(MAX_ENTITIES);
  readonly vx = new Int32Array(MAX_ENTITIES);
  readonly vy = new Int32Array(MAX_ENTITIES);
  readonly sx = new Int32Array(MAX_ENTITIES);
  readonly sy = new Int32Array(MAX_ENTITIES);
  readonly moving = new Uint8Array(MAX_ENTITIES);
  readonly contact = new Uint8Array(MAX_ENTITIES);

  constructor(mapW: number, mapH: number) {
    this.gridW = ((mapW << 8) + (1 << BUCKET_SHIFT) - 1) >> BUCKET_SHIFT;
    this.gridH = ((mapH << 8) + (1 << BUCKET_SHIFT) - 1) >> BUCKET_SHIFT;
    this.head = new Int32Array(this.gridW * this.gridH);
  }
}

/**
 * Nooit precies op een celgrens (fair-ronde): een coördinaat v = 256k hoort bij cel k, zijn spiegelbeeld (180 graden om
 * het midden van de map, v' = 2 * mid - v) ook bij cel W - k in plaats van bij de gespiegelde cel W - 1 - k. Dan kiest
 * een unit op de grens een andere volgende cel dan zijn spiegelbeeld. Een unit die op een grens uitkomt, schuift daarom
 * één eenheid op naar het midden van de map (het spiegelbeeld schuift dan precies gespiegeld); op de middellijn zelf
 * naar de kant van zijn eigen spawn (spawn op de middellijn: omlaag). Zo blijft `>> 8` overal gelijk aan de cel.
 */
function offGrid(v: number, mid: number, spawn: number): number {
  if ((v & 255) !== 0) return v;
  if (v < mid) return v + 1;
  if (v > mid) return v - 1;
  return spawn > mid ? v + 1 : v - 1;
}

/** Whether the goal lies in the target rectangle of flow field `slot` (then the field itself leads there). */
function goalInTarget(ctx: SimContext, slot: number, gx: number, gy: number): boolean {
  const f = ctx.flow;
  const cx = gx >> 8;
  const cy = gy >> 8;
  return (
    cx >= f.tx0[slot]! &&
    cy >= f.ty0[slot]! &&
    cx < f.tx0[slot]! + f.tw[slot]! &&
    cy < f.ty0[slot]! + f.th[slot]!
  );
}

/** Aangekomen: niet meer lopen, veld los. goalX/goalY blijven staan voor de contactregel van groeps-Moves. */
function arrive(ctx: SimContext, i: number): void {
  ctx.world.mvOn[i] = 0;
  setFlowField(ctx, i, NO_FIELD);
}

export function movementSystem(ctx: SimContext, s: MovementScratch): void {
  const w = ctx.world;
  const map = ctx.map;
  const cfg = ctx.config;
  const n = w.highWater;
  const need = C.transform | C.movement;
  const maxX = (map.w << 8) - 1;
  const maxY = (map.h << 8) - 1;

  // Ruimtelijke buckets; aflopend invoegen geeft oplopende lijsten.
  s.head.fill(-1);
  for (let i = n - 1; i >= 0; i--) {
    if (w.alive[i] !== 1 || (w.mask[i]! & need) !== need) continue;
    const b = (w.y[i]! >> BUCKET_SHIFT) * s.gridW + (w.x[i]! >> BUCKET_SHIFT);
    s.next[i] = s.head[b]!;
    s.head[b] = i;
  }

  // a) gewenste snelheid
  const dr2 = cfg.formation.directRange * cfg.formation.directRange;
  for (let i = 0; i < n; i++) {
    s.vx[i] = 0;
    s.vy[i] = 0;
    s.moving[i] = 0;
    s.contact[i] = 0;
    if (w.alive[i] !== 1 || (w.mask[i]! & need) !== need || w.mvOn[i] !== 1) continue;
    const x = w.x[i]!;
    const y = w.y[i]!;
    const gx = w.goalX[i]!;
    const gy = w.goalY[i]!;
    const gdx = gx - x;
    const gdy = gy - y;
    const ar = w.goalR[i]!;
    const gr = w.groupR[i]!;
    if (gdx * gdx + gdy * gdy <= ar * ar) {
      arrive(ctx, i);
      continue;
    }
    s.moving[i] = 1;
    let ax = gx;
    let ay = gy;
    let snap = true; // bij het eindpunt (doel of eigen celmidden) niet voorbij schieten
    let slot = w.flowField[i]!;
    const cx = x >> 8;
    const cy = y >> 8;
    const near = Math.abs(cx - (gx >> 8)) <= 1 && Math.abs(cy - (gy >> 8)) <= 1;
    // Group order (groupR > 0): the field leads to the group's anchor, the goal is the unit's own formation slot.
    // Once the slot is in sight (within directRange, a straight walkable line) or the field's target is reached, the
    // unit leaves the field for good and walks straight to its slot (systems/formation.ts).
    const toSlot = slot !== NO_FIELD && !near && gr > 0 && !goalInTarget(ctx, slot, gx, gy);
    if (toSlot && gdx * gdx + gdy * gdy <= dr2 && lineClear(ctx, x, y, gx, gy)) {
      setFlowField(ctx, i, NO_FIELD);
      slot = NO_FIELD;
    }
    if (slot !== NO_FIELD && !near) {
      const cell = cellAt(map, x, y);
      const nb = ctx.flow.nextCell(slot, cell);
      if (toSlot && nb === cell) {
        setFlowField(ctx, i, NO_FIELD); // at the anchor: straight to the slot from here
      } else if (nb >= 0 && nb !== cell) {
        const ny = idiv(nb, map.w);
        ax = ((nb - ny * map.w) << 8) + 128;
        ay = (ny << 8) + 128;
        snap = false;
      } else if (nb === cell) {
        // Rand van de doelrechthoek bereikt (bijvoorbeeld naast een gebouw): naar het midden van de eigen cel.
        ax = (cx << 8) + 128;
        ay = (cy << 8) + 128;
      }
      // nb < 0: het veld kent deze cel (nog) niet; dan recht op het doel af, de botsing laat langs muren glijden.
    }
    const dx = ax - x;
    const dy = ay - y;
    const len = isqrt(dx * dx + dy * dy);
    let sp = ctx.auras.any
      ? clampI(scalePermille(w.speed[i]!, ctx.auras.speed[i]!), 0, MAX_SPEED)
      : w.speed[i]!;
    // technicus-regel (data 0.16.0): een ongedekte robot loopt op robotRates.rate promille
    if (ctx.robotRates.any) sp = idiv(sp * ctx.robotRates.rate[i]!, 1000);
    if (len === 0) continue;
    if (snap && len <= sp) {
      s.vx[i] = dx;
      s.vy[i] = dy;
    } else {
      s.vx[i] = idiv(dx * sp, len);
      s.vy[i] = idiv(dy * sp, len);
    }
  }

  // b) separatie en contact-aankomst
  const perm = cfg.separationPermille;
  const slack = cfg.arriveRadius;
  for (let i = 0; i < n; i++) {
    s.sx[i] = 0;
    s.sy[i] = 0;
    if (w.alive[i] !== 1 || (w.mask[i]! & need) !== need) continue;
    const ri = w.radius[i]!;
    if (ri === 0) continue;
    const x = w.x[i]!;
    const y = w.y[i]!;
    const bx = x >> BUCKET_SHIFT;
    const by = y >> BUCKET_SHIFT;
    // Contactregel alleen voor groeps-Moves binnen de groepsstraal rond het doel; verder weg loopt een unit door.
    let movingWithGoal = false;
    const gr = w.groupR[i]!;
    if (s.moving[i] === 1 && gr > 0 && w.goalX[i] !== NO_GOAL) {
      const gdx = w.goalX[i]! - x;
      const gdy = w.goalY[i]! - y;
      movingWithGoal = gdx * gdx + gdy * gdy <= gr * gr;
    }
    let sx = 0;
    let sy = 0;
    for (let gy = by - 1; gy <= by + 1; gy++) {
      if (gy < 0 || gy >= s.gridH) continue;
      for (let gx = bx - 1; gx <= bx + 1; gx++) {
        if (gx < 0 || gx >= s.gridW) continue;
        for (let j = s.head[gy * s.gridW + gx]!; j >= 0; j = s.next[j]!) {
          if (j === i) continue;
          const rj = w.radius[j]!;
          if (rj === 0) continue;
          const rr = ri + rj;
          const dx = x - w.x[j]!;
          const dy = y - w.y[j]!;
          const reach = rr + slack;
          if (dx >= reach || -dx >= reach || dy >= reach || -dy >= reach) continue;
          const d2 = dx * dx + dy * dy;
          if (movingWithGoal && d2 < reach * reach && w.mvOn[j] === 0) {
            // j stands between i and its goal (closer to that goal than i): i has arrived. A neighbour on its own
            // slot next to i's slot is not in the way and does not stop i short of its slot.
            const jx = w.goalX[i]! - w.x[j]!;
            const jy = w.goalY[i]! - w.y[j]!;
            const ix = w.goalX[i]! - x;
            const iy = w.goalY[i]! - y;
            if (jx * jx + jy * jy < ix * ix + iy * iy) s.contact[i] = 1;
          }
          if (d2 >= rr * rr || perm === 0) continue;
          if (d2 === 0) {
            // Zelfde punt: richting uit het indexpaar, tegengesteld voor de twee units.
            const lo = i < j ? i : j;
            const hi = i < j ? j : i;
            const k = (Math.imul(lo, 0x9e3779b1) ^ Math.imul(hi, 0x85ebca6b)) & 1023;
            const push = Math.max(1, idiv(rr * perm, 2000));
            const sign = i === lo ? 1 : -1;
            sx += sign * ((SIN_TABLE[(k + 256) & 1023]! * push) >> TRIG_BITS);
            sy += sign * ((SIN_TABLE[k]! * push) >> TRIG_BITS);
            continue;
          }
          const d = isqrt(d2);
          const push = Math.max(1, idiv((rr - d) * perm, 2000));
          sx += idiv(dx * push, d);
          sy += idiv(dy * push, d);
          // Uitwijken: staat j voor i op zijn looprichting, dan stapt i ook opzij, altijd naar rechts van zijn eigen
          // richting. Twee units die recht op elkaar af lopen, gaan zo elk een andere kant op langs elkaar heen in plaats
          // van elkaar eindeloos tegen te houden (duw en snelheid heffen elkaar dan precies op).
          const vix = s.vx[i]!;
          const viy = s.vy[i]!;
          if (s.moving[i] === 1 && vix * dx + viy * dy < 0) {
            const vl = isqrt(vix * vix + viy * viy);
            if (vl > 0) {
              sx += idiv(-viy * push, vl);
              sy += idiv(vix * push, vl);
            }
          }
        }
      }
    }
    s.sx[i] = sx;
    s.sy[i] = sy;
  }

  // c) toepassen
  for (let i = 0; i < n; i++) {
    if (w.alive[i] !== 1 || (w.mask[i]! & need) !== need) continue;
    let vx = s.vx[i]!;
    let vy = s.vy[i]!;
    if (s.contact[i] === 1) {
      arrive(ctx, i);
      vx = 0;
      vy = 0;
    }
    if (vx !== 0 || vy !== 0) w.yaw[i] = atan2A(vy, vx);
    const mx = clampI(vx + s.sx[i]!, -MAX_STEP, MAX_STEP);
    const my = clampI(vy + s.sy[i]!, -MAX_STEP, MAX_STEP);
    if (mx !== 0 || my !== 0) {
      const x = w.x[i]!;
      const y = w.y[i]!;
      const sp = map.spawns[w.owner[i]!];
      const nx = offGrid(clampI(x + mx, 0, maxX), map.w << 7, sp === undefined ? 0 : sp.x);
      const ny = offGrid(clampI(y + my, 0, maxY), map.h << 7, sp === undefined ? 0 : sp.y);
      if (walkableAt(ctx, nx, ny)) {
        w.x[i] = nx;
        w.y[i] = ny;
      } else if (walkableAt(ctx, nx, y)) {
        w.x[i] = nx;
      } else if (walkableAt(ctx, x, ny)) {
        w.y[i] = ny;
      }
    }
  }
}
