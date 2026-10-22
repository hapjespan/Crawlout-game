import { TICK_HZ, UNITS_PER_METER } from '@crawlout/protocol';

// De enige plek waar menselijke eenheden (meters, seconden) naar sim-eenheden gaan. Deterministisch: altijd Math.trunc.
export const metersToUnits = (m: number): number => Math.trunc(m * UNITS_PER_METER);
export const secondsToTicks = (s: number): number => Math.trunc(s * TICK_HZ);
export const mpsToUnitsPerTick = (mps: number): number =>
  Math.trunc((mps * UNITS_PER_METER) / TICK_HZ);
export const pctToPermille = (pct: number): number => Math.trunc(pct * 10);
// Een snelheid per seconde (hp per seconde, bewoners per seconde) naar duizendsten per tick, zodat een hoeveelheid per tick een
// integer blijft: 12 hp/s is 600 duizendsten per tick (0,6 hp per tick). De sim telt ze op en trekt per 1000 een hele eenheid af.
export const perSecondToMilliPerTick = (perS: number): number =>
  Math.trunc((perS * 1000) / TICK_HZ);
/** Whole degrees (0 to 359, 0 = +x, 90 = +y) to the sim angle (uint16, 65536 per turn). */
export const degreesToAngle = (deg: number): number => Math.trunc((deg * 65536) / 360);
