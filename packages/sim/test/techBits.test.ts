import { describe, expect, it } from 'vitest';
import {
  MAX_TECHS,
  TECH_WORDS,
  anyTech,
  createSim,
  deserialize,
  grantTech,
  hasTech,
  validateEnv,
} from '../src/index.js';
import { CONFIG, envOf, testInit } from './helpers.js';

// MAX_TECHS 64 (sim 0.31.0, data 0.37.0 the Garde filled 32): the tech bitset is TECH_WORDS uint32 words per player.
describe('tech bitset', () => {
  it('holds 64 techs per player in two words, and keeps the players apart', () => {
    expect(MAX_TECHS).toBe(64);
    expect(TECH_WORDS).toBe(2);
    const sim = createSim(testInit());
    expect(anyTech(sim.ps, 1)).toBe(false);
    for (const t of [0, 31, 32, 63]) grantTech(sim.ps, 1, t);
    for (let t = 0; t < MAX_TECHS; t++) {
      expect(hasTech(sim.ps, 1, t)).toBe([0, 31, 32, 63].includes(t));
      expect(hasTech(sim.ps, 0, t)).toBe(false);
    }
    expect(anyTech(sim.ps, 1)).toBe(true);
    // a tech in the second word goes into the state: hash and serialize see it
    const before = new Uint8Array(sim.serialize());
    grantTech(sim.ps, 0, 40);
    const after = new Uint8Array(sim.serialize());
    expect(after).not.toEqual(before);
    expect(hasTech(deserialize(after.buffer, envOf(testInit())).ps, 0, 40)).toBe(true);
  });

  it('validates up to MAX_TECHS techs and refuses more', () => {
    const base = CONFIG.techs[0]!;
    const techs = (n: number) =>
      Array.from({ length: n }, (_, k) => ({ ...base, techId: k, prereqTech: [] }));
    const env = envOf(testInit());
    expect(() =>
      validateEnv({ ...env, config: { ...env.config, techs: techs(MAX_TECHS) } }),
    ).not.toThrow();
    expect(() =>
      validateEnv({ ...env, config: { ...env.config, techs: techs(MAX_TECHS + 1) } }),
    ).toThrow(/techs/);
  });
});
