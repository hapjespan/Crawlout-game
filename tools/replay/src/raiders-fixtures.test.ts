import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseReplay } from './run.js';
import { raiderMechanics } from './raiders-mechanics.js';

// The Raider fixtures (sim 0.18.0) do what their description says: replay.test.ts pins their hashes, this test pins
// that the mechanics they were made for really happen in them (counted from the public sim state while replaying).

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const load = (name: string) =>
  parseReplay(JSON.parse(readFileSync(join(dir, `${name}.json`), 'utf8')));

describe('Raider fixtures: the mechanics happen', () => {
  it('s10-rustbelt-raiders-slaves: capture, the cage transition, liberation and revolt', () => {
    const m = raiderMechanics(load('s10-rustbelt-raiders-slaves'));
    expect(m.captures).toBeGreaterThanOrEqual(2);
    expect(m.transitions).toBeGreaterThanOrEqual(2);
    expect(m.freed).toBeGreaterThanOrEqual(1);
    expect(m.escaped).toBeGreaterThanOrEqual(1);
  });

  it('s10-rustbelt-raiders-chems: doses and crashes, and tribute from a held settlement point', () => {
    const m = raiderMechanics(load('s10-rustbelt-raiders-chems'));
    expect(m.dosed).toBeGreaterThanOrEqual(3);
    expect(m.crashed).toBeGreaterThanOrEqual(3);
    expect(m.tributeTicks).toBeGreaterThan(1200);
  });

  it('s10-rustbelt-raiders-ai-vs-ai: the Raider AI catches settlers and lives on tribute (data 0.24.0)', () => {
    const m = raiderMechanics(load('s10-rustbelt-raiders-ai-vs-ai'));
    expect(m.captures).toBeGreaterThanOrEqual(1);
    expect(m.tributeTicks).toBeGreaterThan(12000);
  });

  it('s11-rustbelt-raiders-mirror: a Raider AI catches a unit of the other (sim 0.19.0; after 7:20 since sim 0.22.0)', () => {
    const m = raiderMechanics(load('s11-rustbelt-raiders-mirror'));
    expect(m.captures).toBeGreaterThanOrEqual(1);
    expect(m.transitions).toBeGreaterThanOrEqual(1);
  });

  it('s13-rustbelt-raiders-takeover: the start army takes the near camp over, bandits join, the outpost yields', () => {
    const m = raiderMechanics(load('s13-rustbelt-raiders-takeover'));
    expect(m.takeovers).toBeGreaterThanOrEqual(1);
    expect(m.recruits).toBeGreaterThanOrEqual(1);
    expect(m.yields).toBe(2);
  });

  it('s10-rustbelt-raiders-ai-vs-ai and s11-rustbelt-raiders-mirror: the Raider AI takes its camps over (sim 0.22.0)', () => {
    for (const name of ['s10-rustbelt-raiders-ai-vs-ai', 's11-rustbelt-raiders-mirror']) {
      const m = raiderMechanics(load(name));
      expect(m.takeovers, name).toBeGreaterThanOrEqual(2);
      expect(m.recruits, name).toBeGreaterThanOrEqual(2);
      expect(m.yields, name).toBeGreaterThanOrEqual(2);
    }
  });

  it('s10-rustbelt-raiders-net: the tent safety net brings fighters under the threshold', () => {
    const m = raiderMechanics(load('s10-rustbelt-raiders-net'));
    expect(m.netArrivals).toBeGreaterThanOrEqual(3);
  });
});
