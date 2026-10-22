import { idiv } from './int.js';

const TWO_32 = 4294967296;

/** floor(sqrt(n)) voor een integer 0 <= n < 2^53, via integer-Newton. Geen Math.sqrt. */
export function isqrt(n: number): number {
  if (n < 2) {
    if (n < 0) throw new RangeError(`isqrt van negatief getal: ${n}`);
    return n;
  }
  // bitlengte van n, ook boven 2^32
  let bits: number;
  if (n < TWO_32) bits = 32 - Math.clz32(n);
  else bits = 64 - Math.clz32(idiv(n, TWO_32));
  // startwaarde: macht van twee >= sqrt(n), daarna daalt Newton monotoon naar floor(sqrt(n))
  let x = 1;
  for (let i = (bits + 1) >> 1; i > 0; i--) x *= 2;
  for (;;) {
    const y = idiv(x + idiv(n, x), 2);
    if (y >= x) return x;
    x = y;
  }
}
