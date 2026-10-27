// FNV-1a 32-bit. Bytegewijs, zoals de standaard; Math.imul voor de bedoelde 32-bit wrap.
export const FNV_OFFSET = 0x811c9dc5;
export const FNV_PRIME = 0x01000193;

export function fnv1a(h: number, bytes: Uint8Array): number {
  let x = h | 0;
  for (let i = 0; i < bytes.length; i++) x = Math.imul(x ^ bytes[i]!, FNV_PRIME);
  return x >>> 0;
}

/** Een int32 als 4 bytes little-endian in de hash. */
export function fnv1aInt(h: number, v: number): number {
  let x = h | 0;
  x = Math.imul(x ^ (v & 0xff), FNV_PRIME);
  x = Math.imul(x ^ ((v >>> 8) & 0xff), FNV_PRIME);
  x = Math.imul(x ^ ((v >>> 16) & 0xff), FNV_PRIME);
  x = Math.imul(x ^ ((v >>> 24) & 0xff), FNV_PRIME);
  return x >>> 0;
}
