// Integer-rekenen voor de sim. De lint verbiedt `/` en `%` in de sim; alleen hier mogen ze, achter helpers.
// idiv is exact zolang |a| en |b| onder 2^53 blijven: IEEE-deling is correct afgerond en Math.trunc is deterministisch.
/* eslint-disable no-restricted-syntax */
export const idiv = (a: number, b: number): number => Math.trunc(a / b);
export const imod = (a: number, b: number): number => {
  const r = a % b;
  return r < 0 ? r + b : r;
};
/** BigInt-deling (rondt af naar nul). Alleen voor tabellen die bij module-load worden opgebouwd. */
export const bdiv = (a: bigint, b: bigint): bigint => a / b;
/* eslint-enable no-restricted-syntax */
export const clampI = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
