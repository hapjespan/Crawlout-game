import { MAX_ENTITIES } from '@crawlout/protocol';
import { C, NO_FIELD, NO_GOAL, ORDER_MOVE } from '../ecs/world.js';
import { clampI, idiv } from '../math/int.js';
import { isqrt } from '../math/sqrt.js';
import { SIN_TABLE, TRIG_BITS, atan2A } from '../math/trig.js';
import type { SimContext } from './common.js';
import { cellAt, passableAt, setFlowField } from './common.js';

// Systeem 4: beweging plus separatie.
//  a) gewenste snelheid per unit uit zijn Move-order: flow field naar de volgende cel, vlak bij het doel recht erop af;
//  b) separatie: overlappende units duwen elkaar uit elkaar (integer-sommen, dus volgorde-onafhankelijk);
//     een bewegende unit die een al gearriveerde unit met hetzelfde doel raakt, is ook klaar;
//  c) toepassen met botsing tegen geblokkeerde cellen (eerst diagonaal, dan per as glijden).
// Alles leest de posities van het begin van de stap en schrijft pas in c).

const BUCKET_SHIFT = 9; // buckets van 512 eenheden = 2 m, >= twee keer de maximale straal
const MAX_STEP = 255; // maximale verplaatsing per as per tick, kleiner dan een cel

/** Animatie-ids in de snapshot (voorstel, nog niet in contract 1 vastgelegd). */
export const ANIM_IDLE = 0;
export const ANIM_WALK = 1;

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

/** Order klaar: van de ring af en het flow field loslaten. goalX/goalY blijven staan voor de contactregel. */
function arrive(ctx: SimContext, i: number): void {
  ctx.world.popOrder(i);
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
  const arrive2 = cfg.arriveRadius * cfg.arriveRadius;
  for (let i = 0; i < n; i++) {
    s.vx[i] = 0;
    s.vy[i] = 0;
    s.moving[i] = 0;
    s.contact[i] = 0;
    if (w.alive[i] !== 1 || (w.mask[i]! & need) !== need) continue;
    const o = w.currentOrder(i);
    if (o < 0 || w.ordType[o] !== ORDER_MOVE) continue;
    const x = w.x[i]!;
    const y = w.y[i]!;
    const gx = w.ordX[o]!;
    const gy = w.ordY[o]!;
    const gdx = gx - x;
    const gdy = gy - y;
    if (gdx * gdx + gdy * gdy <= arrive2) {
      arrive(ctx, i);
      continue;
    }
    s.moving[i] = 1;
    let ax = gx;
    let ay = gy;
    const slot = w.flowField[i]!;
    const cx = x >> 8;
    const cy = y >> 8;
    const near = Math.abs(cx - (gx >> 8)) <= 1 && Math.abs(cy - (gy >> 8)) <= 1;
    if (slot !== NO_FIELD && !near) {
      const cell = cellAt(map, x, y);
      const nb = ctx.flow.nextCell(slot, cell);
      if (nb >= 0 && nb !== cell) {
        const ny = idiv(nb, map.w);
        ax = ((nb - ny * map.w) << 8) + 128;
        ay = (ny << 8) + 128;
      }
      // nb < 0: het veld kent deze cel (nog) niet; dan recht op het doel af, de botsing laat langs muren glijden.
    }
    const dx = ax - x;
    const dy = ay - y;
    const len = isqrt(dx * dx + dy * dy);
    const sp = w.speed[i]!;
    if (len === 0) continue;
    if (ax === gx && ay === gy && len <= sp) {
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
    // Contactregel alleen binnen de groepsstraal rond het doel; verder weg loopt een unit door en duwt de groep in.
    let movingWithGoal = false;
    if (s.moving[i] === 1 && w.goalX[i] !== NO_GOAL) {
      const gdx = w.goalX[i]! - x;
      const gdy = w.goalY[i]! - y;
      const gr = w.groupR[i]!;
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
          if (
            movingWithGoal &&
            d2 < reach * reach &&
            w.ordCount[j] === 0 &&
            w.goalX[j] === w.goalX[i] &&
            w.goalY[j] === w.goalY[i]
          ) {
            s.contact[i] = 1;
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
        }
      }
    }
    s.sx[i] = sx;
    s.sy[i] = sy;
  }

  // c) toepassen
  const animStep = cfg.walkAnimStep;
  for (let i = 0; i < n; i++) {
    if (w.alive[i] !== 1 || (w.mask[i]! & need) !== need) continue;
    let vx = s.vx[i]!;
    let vy = s.vy[i]!;
    if (s.contact[i] === 1) {
      arrive(ctx, i);
      s.moving[i] = 0;
      vx = 0;
      vy = 0;
    }
    if (vx !== 0 || vy !== 0) w.yaw[i] = atan2A(vy, vx);
    const mx = clampI(vx + s.sx[i]!, -MAX_STEP, MAX_STEP);
    const my = clampI(vy + s.sy[i]!, -MAX_STEP, MAX_STEP);
    if (mx !== 0 || my !== 0) {
      const x = w.x[i]!;
      const y = w.y[i]!;
      const nx = clampI(x + mx, 0, maxX);
      const ny = clampI(y + my, 0, maxY);
      if (passableAt(map, nx, ny)) {
        w.x[i] = nx;
        w.y[i] = ny;
      } else if (passableAt(map, nx, y)) {
        w.x[i] = nx;
      } else if (passableAt(map, x, ny)) {
        w.y[i] = ny;
      }
    }
    w.anim[i] = s.moving[i] === 1 ? ANIM_WALK : ANIM_IDLE;
    w.animT[i] = (w.animT[i]! + animStep) & 0xffff;
  }
}
