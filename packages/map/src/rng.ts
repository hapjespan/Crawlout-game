// Eigen seeded integer-RNG voor de map-package (mulberry32). Alleen Math.imul en bitoperaties, geen floats, geen Math.random.
// Bewust los van sim.rng: de generatoren draaien op build-tijd en mogen de sim-RNG niet raken.
export interface Rng {
  /** Volgende uint32. */
  next(): number;
  /** Geheel getal in [0, n), n in 1..65536, zonder modulo en zonder deling. */
  below(n: number): number;
  /** Geheel getal in [lo, hi] inclusief. */
  range(lo: number, hi: number): number;
}

export function createRng(seed: number): Rng {
  let s = seed >>> 0;
  const next = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
  const below = (n: number): number => ((next() >>> 16) * n) >>> 16;
  return { next, below, range: (lo, hi) => lo + below(hi - lo + 1) };
}
