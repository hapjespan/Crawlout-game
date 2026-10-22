import { describe, expect, it } from 'vitest';
import { heroBindings, LOCAL_PREFIX, mergeManifests } from '../src/game/assets.js';

const entry = (id: string, baked = true) => ({
  id,
  lods: [0, 1, 2].map((level) => ({ level, path: `${id}/lod${level}.glb` })),
  ...(baked ? { baked: { path: `${id}/${id}.anim.f32` } } : {}),
});

describe('mergeManifests (local assets over the repo manifest)', () => {
  const repo = { version: 1, assets: [entry('dweller_body_human'), entry('rock001', false)] };

  it('keeps the repo manifest untouched without a local one', () => {
    expect(mergeManifests(repo, undefined)).toEqual({ manifest: repo, localIds: [] });
    expect(mergeManifests(undefined, undefined)).toBeUndefined();
  });

  it('gives local ids precedence and prefixes their paths, the rest stays from the repo', () => {
    const local = { version: 1, assets: [entry('dweller_body_human'), entry('hero_opziener')] };
    const merged = mergeManifests(repo, local)!;
    expect(merged.localIds).toEqual(['dweller_body_human', 'hero_opziener']);
    expect(merged.manifest.assets.map((a) => a.id)).toEqual([
      'dweller_body_human',
      'hero_opziener',
      'rock001',
    ]);
    const dweller = merged.manifest.assets[0]!;
    expect(dweller.lods[0]!.path).toBe(`${LOCAL_PREFIX}dweller_body_human/lod0.glb`);
    expect(dweller.baked!.path).toBe(
      `${LOCAL_PREFIX}dweller_body_human/dweller_body_human.anim.f32`,
    );
    expect(merged.manifest.assets[2]!.lods[0]!.path).toBe('rock001/lod0.glb');
    // The inputs are not changed.
    expect(local.assets[0]!.lods[0]!.path).toBe('dweller_body_human/lod0.glb');
  });

  it('works with only a local manifest', () => {
    const merged = mergeManifests(undefined, { version: 1, assets: [entry('a')] })!;
    expect(merged.manifest.assets.map((a) => a.lods[0]!.path)).toEqual([
      `${LOCAL_PREFIX}a/lod0.glb`,
    ]);
  });
});

describe('heroBindings', () => {
  it('binds hero_<key> to 1000 + heroId, only for ids that exist', () => {
    const heroes = [
      { id: 0, key: 'opziener' },
      { id: 1, key: 'baron' },
    ];
    expect(heroBindings(['dweller_body_human', 'hero_opziener'], heroes)).toEqual({
      hero_opziener: [1000],
    });
    expect(heroBindings([], heroes)).toEqual({});
  });
});
