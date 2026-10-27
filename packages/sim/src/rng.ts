import { imod } from './math/int.js';

// xorshift32: één stream per sim, seed uit de lobby. De state zit in de hash en in de serialisatie.
const ZERO_SEED_REPLACEMENT = 0x6d2b79f5;

/** Mengt een lobby-seed tot een niet-nul startstate (xorshift32 blijft op 0 hangen). */
export function seedToState(seed: number): number {
  let x = Math.imul((seed >>> 0) ^ 0x9e3779b9, 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  x = (x ^ (x >>> 16)) >>> 0;
  return x === 0 ? ZERO_SEED_REPLACEMENT : x;
}

export class Rng {
  state: number;

  constructor(seed: number) {
    this.state = seedToState(seed);
  }

  /** Volgende uint32. */
  next(): number {
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x >>> 0;
    return this.state;
  }

  /** Integer in [0, n), n > 0. */
  nextInt(n: number): number {
    return imod(this.next(), n);
  }
}
