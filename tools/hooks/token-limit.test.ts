import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM script without types
import { MAX_TOKENS, isIgnored, tokensOf } from './token-limit.mjs';

describe('pre-commit token limit', () => {
  it('counts tokens as bytes / 4, rounded up', () => {
    expect(tokensOf(20000)).toBe(5000);
    expect(tokensOf(20001)).toBe(5001);
    expect(MAX_TOKENS).toBe(5000);
  });

  it('ignores lockfiles, built assets, fixtures, map grids and binaries', () => {
    for (const p of [
      'pnpm-lock.yaml',
      'assets/dist/manifest.json',
      'assets/dist/dweller_body_human/lod0.glb',
      'tools/replay/fixtures/s2-rustbelt-skirmish.json',
      'data/maps/rustbelt.passability.json',
      'assets/src/props/Rock001.glb',
    ])
      expect(isIgnored(p)).toBe(true);
  });

  it('checks agent-authored sources, data and docs', () => {
    for (const p of [
      'packages/sim/src/systems/ai.ts',
      'data/loadouts/01-dwellers-core.json',
      'docs/CHANGELOG.md',
      'assets/src/raiders.json',
    ])
      expect(isIgnored(p)).toBe(false);
  });
});
