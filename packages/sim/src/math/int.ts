// Integer-rekenen voor de sim. De lint verbiedt `/` en `%` in de sim; alleen hier mogen ze, achter helpers.
/* eslint-disable no-restricted-syntax */
export const idiv = (a: number, b: number): number => Math.trunc(a / b);
export const imod = (a: number, b: number): number => {
  const r = a % b;
  return r < 0 ? r + b : r;
};
/* eslint-enable no-restricted-syntax */
export const clampI = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
