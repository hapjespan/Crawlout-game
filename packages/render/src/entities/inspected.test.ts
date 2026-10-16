import { describe, expect, it } from 'vitest';
import { INSPECTED_FLAG, stampInspected } from './inspected.js';

describe('stampInspected', () => {
  it('flags only the inspected ids and keeps the other bits', () => {
    const ids = Uint32Array.of(5, 6, 7);
    const flags = Uint8Array.of(1, 0, 8);
    stampInspected(ids, flags, 3, new Set([5, 7]));
    expect([...flags]).toEqual([1 | INSPECTED_FLAG, 0, 8 | INSPECTED_FLAG]);
  });

  it('does nothing for an empty set', () => {
    const flags = Uint8Array.of(1, 0);
    stampInspected(Uint32Array.of(1, 2), flags, 2, new Set());
    expect([...flags]).toEqual([1, 0]);
  });
});
