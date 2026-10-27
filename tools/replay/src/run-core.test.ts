import { describe, expect, it } from 'vitest';
import { compareRun } from './run-core.js';
import type { Replay } from '@crawlout/protocol';

describe('compareRun', () => {
  it('fails a fixture without hashes: it would guard nothing', () => {
    const r = { hashes: [] } as unknown as Replay;
    const res = compareRun(r, { lastFrame: 10, hashes: [] });
    expect(res.ok).toBe(false);
    expect(res.mismatch).toBeNull();
  });
});
