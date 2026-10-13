import { TICK_HZ, UNITS_PER_METER } from '@crawlout/protocol';

// De enige plek waar menselijke eenheden (meters, seconden) naar sim-eenheden gaan. Deterministisch: altijd Math.trunc.
export const metersToUnits = (m: number): number => Math.trunc(m * UNITS_PER_METER);
export const secondsToTicks = (s: number): number => Math.trunc(s * TICK_HZ);
export const mpsToUnitsPerTick = (mps: number): number => Math.trunc((mps * UNITS_PER_METER) / TICK_HZ);
export const pctToPermille = (pct: number): number => Math.trunc(pct * 10);
