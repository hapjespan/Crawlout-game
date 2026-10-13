import { YAW_PLUS_X, YAW_PLUS_Y } from '@crawlout/protocol';
import { bdiv } from './int.js';

// Sinus en cosinus uit een tabel van 1024 integers, opgebouwd bij module-load uit integers (BigInt-Taylorreeks).
// Hoeken in de sim zijn uint16: 0..65535 = 0..360 graden; yaw-conventie uit protocol: YAW_PLUS_X (0) is de +x-as,
// YAW_PLUS_Y (16384) de +y-as, yaw = atan2(dy, dx).
export const TRIG_BITS = 16;
export const TRIG_ONE = 1 << TRIG_BITS; // sin(90 graden) = 65536
export const TRIG_STEPS = 1024;
const STEP_SHIFT = 6; // 65536 / 1024 = 64 hoekeenheden per tabelstap
const QUARTER = TRIG_STEPS >> 2;

// pi * 10^62, ruim genoeg voor een tabel met 16 fractiebits.
const PI_E62 = 314159265358979323846264338327950288419716939937510582097494459n;
const E62 = 10n ** 62n;

function buildQuarter(): Int32Array {
  const S = 1n << 80n; // vaste-komma-schaal voor de reeks
  const piS = bdiv(PI_E62 * S, E62);
  const q = new Int32Array(QUARTER + 1);
  for (let k = 0; k <= QUARTER; k++) {
    // x = 2*pi*k/1024 = pi*k/512, in schaal S
    const x = bdiv(piS * BigInt(k), 512n);
    let term = x;
    let sum = x;
    for (let n = 1n; n < 40n && term !== 0n; n++) {
      term = bdiv(bdiv(-term * x, S) * x, S * (2n * n) * (2n * n + 1n));
      sum += term;
    }
    q[k] = Number(bdiv(sum * BigInt(TRIG_ONE) + (S >> 1n), S));
  }
  return q;
}

function buildTable(): Int32Array {
  const q = buildQuarter();
  const t = new Int32Array(TRIG_STEPS);
  for (let k = 0; k < TRIG_STEPS; k++) {
    const r = k & (QUARTER - 1);
    switch (k >> 8) {
      case 0: t[k] = q[r]!; break;
      case 1: t[k] = q[QUARTER - r]!; break;
      case 2: t[k] = -q[r]!; break;
      default: t[k] = -q[QUARTER - r]!; break;
    }
  }
  return t;
}

/** sin(2*pi*k/1024) * 65536, afgerond, voor k = 0..1023. */
export const SIN_TABLE: Int32Array = buildTable();

/** Sinus van een uint16-hoek, schaal TRIG_ONE. Rondt af naar de dichtstbijzijnde tabelstap. */
export const sinA = (angle: number): number => SIN_TABLE[((angle + 32) >> STEP_SHIFT) & (TRIG_STEPS - 1)]!;
/** Cosinus van een uint16-hoek, schaal TRIG_ONE. */
export const cosA = (angle: number): number => SIN_TABLE[((angle + 32 + YAW_PLUS_Y) >> STEP_SHIFT) & (TRIG_STEPS - 1)]!;

/**
 * Hoek van de vector (dx, dy) als uint16, zonder Math.atan2: octant-reductie plus binair zoeken in de tabel.
 * Resolutie is één tabelstap (64 hoekeenheden, ongeveer 0,35 graden). (0, 0) geeft 0.
 * |dx| en |dy| moeten onder 2^36 blijven zodat de producten onder 2^53 blijven.
 */
export function atan2A(dy: number, dx: number): number {
  if (dx === 0 && dy === 0) return 0;
  let ax = dx < 0 ? -dx : dx;
  let ay = dy < 0 ? -dy : dy;
  const swap = ay > ax;
  if (swap) {
    const t = ax;
    ax = ay;
    ay = t;
  }
  // grootste k in [0, 128] met tan(k) <= ay/ax, dus sin(k)*ax <= ay*cos(k)
  let lo = 0;
  let hi = QUARTER >> 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (SIN_TABLE[mid]! * ax <= ay * SIN_TABLE[mid + QUARTER]!) lo = mid;
    else hi = mid - 1;
  }
  // kies de dichtstbijzijnde van k en k+1
  if (lo < QUARTER >> 1) {
    const errLo = ay * SIN_TABLE[lo + QUARTER]! - SIN_TABLE[lo]! * ax;
    const errHi = SIN_TABLE[lo + 1]! * ax - ay * SIN_TABLE[lo + 1 + QUARTER]!;
    if (errHi < errLo) lo++;
  }
  let a = YAW_PLUS_X + (lo << STEP_SHIFT); // 0..8192
  if (swap) a = YAW_PLUS_Y - a;
  if (dx < 0) a = 32768 - a;
  if (dy < 0) a = 65536 - a;
  return a & 0xffff;
}
