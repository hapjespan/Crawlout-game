import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Replay } from '@crawlout/protocol';
import { hqOf, waveAlive } from '@crawlout/sim';
import type { Sim } from '@crawlout/sim';
import { asFixture, createReplaySim, parseReplay } from './run.js';

// Survival co-op (sim 0.27.0): what the s17 fixtures show besides their hashes (fixtures-survival.ts).

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const load = (name: string): Replay =>
  // the dataVersion of a fixture is informative (fase-0 sectie 24 besluit 4, run.ts asFixture)
  asFixture(parseReplay(JSON.parse(readFileSync(join(dir, `${name}.json`), 'utf8'))));

/** Runs a replay up to (not including) `frame`, calling `each` after every tick. */
function play(r: Replay, frame: number, each?: (sim: Sim, f: number) => void): Sim {
  const sim = createReplaySim(r);
  const by = new Map(r.bundles.map((b) => [b.frame, b]));
  for (let f = 0; f < frame; f++) {
    sim.applyBundle(by.get(f) ?? { frame: f, commands: [] });
    sim.tick();
    each?.(sim, f);
  }
  return sim;
}

describe('survival fixtures', () => {
  it('solo: wave 1 targets the player, dies to his defence and pays loot and hero xp', () => {
    const r = load('s17-rustbelt-survival-solo');
    const sim = play(r, 4000);
    expect(sim.survival.target[0]).toBe(1);
    expect(sim.survival.batches[0]).toBe(2);
    expect(waveAlive(sim, 0)).toBe(0);
    expect(sim.ps.scrap[0]).toBeGreaterThan(300);
    expect(sim.ps.heroXp[0]).toBeGreaterThan(0);
    expect(sim.winner()).toBeNull();
  });

  it('duo: wave 1 goes for the weaker slot 1, whose defenders (the armed workers too) hold the HQ; wave 2 too', () => {
    // data 0.36.0, sim 0.30.0: the defend stance; before it the Dweller HQ fell at frame 4.7k and the waves turned to slot 0
    const r = load('s17-rustbelt-survival-duo');
    let first = -1;
    let lost = -1;
    let alarm = 0;
    const sim = play(r, 5301, (s, f) => {
      if (first < 0 && s.survival.batches[0]! > 0) first = s.survival.target[0]! - 1;
      if (lost < 0 && hqOf(s, 1) < 0) lost = f;
      if (s.defense.alarm[1]! > 0) alarm++;
    });
    expect(first).toBe(1);
    expect(alarm).toBeGreaterThan(0);
    expect(lost).toBe(-1);
    expect(sim.survival.target[0]).toBe(2);
    expect(sim.survival.target[1]).toBe(2);
    expect(sim.isDefeated(1)).toBe(false);
    expect(sim.winner()).toBeNull();
  });
});
