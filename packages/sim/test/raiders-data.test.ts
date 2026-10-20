import { ROLES } from '@crawlout/data';
import { describe, expect, it } from 'vitest';
import { createSim, validateEnv } from '../src/index.js';
import { createTestMap } from '../src/testing.js';
import { CONFIG, DATA, REAL_CONFIG, envOf, testInit } from './helpers.js';

// Raiders (data 0.21.0): the sim reads the Raider data (sim 0.18.0). These tests pin that it loads and validates, picks
// the right hero base (baseLoadoutId), claim building, hq and safety-net unit, and starts a match with a Raider player.
// The Raider rules themselves (slaves, capture, chems, tents, plunder, tribute) are tested in raiders.test.ts.

const RAIDERS = DATA.factions.findIndex((f) => f.key === 'raiders');
const keyOfType = (typeId: number): string | undefined =>
  DATA.loadouts.find(
    (l) => l.id === REAL_CONFIG.unitTypes.find((u) => u.typeId === typeId)?.loadoutId,
  )?.key;

describe('sim: Raider data (data 0.21.0)', () => {
  it('the real config with both factions validates', () => {
    const init = testInit(1, createTestMap(), [
      { factionId: 0, ai: false },
      { factionId: RAIDERS, ai: false },
    ]);
    expect(() => validateEnv(envOf(init))).not.toThrow();
    expect(REAL_CONFIG.factions).toHaveLength(3); // data 0.37.0: the Garde, data only for now
  });

  it('picks the hq, the claim post, the settler, the roles, the hero base and the safety-net unit of the Raiders', () => {
    const f = REAL_CONFIG.factions[RAIDERS]!;
    const hq = REAL_CONFIG.buildingTypes.find((t) => t.typeId === f.hqTypeId)!;
    expect(DATA.buildings[hq.buildingId]!.key).toBe('raiderkamp');
    const claim = REAL_CONFIG.buildingTypes.find((t) => t.typeId === f.claimTypeId)!;
    expect(DATA.buildings[claim.buildingId]!.key).toBe('plunderpost');
    // the settler (housing growth, scavenger role) is the slave: growth is 0 for the Raiders so none appears
    expect(keyOfType(f.settlerTypeId)).toBe('slaaf');
    expect(f.housingGrowthPerMin).toBe(0);
    expect(keyOfType(f.roleTypeIds[ROLES.indexOf('builder')]!)).toBe('slaaf_bouwer');
    expect(keyOfType(f.roleTypeIds[ROLES.indexOf('militia')]!)).toBe('warlord_basis');
    expect(keyOfType(f.safetyNet!.typeId)).toBe('plunderaar');
    expect(REAL_CONFIG.heroes[f.heroId]!.baseTypeId).toBe(f.roleTypeIds[ROLES.indexOf('militia')]);
    expect(f.aiScript).toBe(DATA.aiScripts.findIndex((a) => a.key === 'raiders-basic'));
  });

  it('starts a match with a Raider player: hq, start units and the hero stand on the map', () => {
    const init = testInit(3, createTestMap(), [
      { factionId: RAIDERS, ai: false },
      { factionId: 0, ai: false },
    ]);
    // compact footprints (helpers CONFIG): the real 17 x 17 camp does not fit the 64 x 64 test map
    const sim = createSim(init);
    const mine = (): { typeId: number; kind: string }[] =>
      sim
        .entityIds()
        .map((id) => sim.getUnit(id)!)
        .filter((u) => u.owner === 0);
    const counts = new Map<string, number>();
    for (const u of mine()) {
      const key = keyOfType(u.typeId) ?? `type${u.typeId}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    expect(counts.get('slaaf')).toBe(6); // data 0.23.0 (was 3)
    expect(counts.get('slaaf_bouwer')).toBe(1);
    expect(counts.get('plunderaar')).toBe(3);
    expect(counts.get('knuppelaar')).toBe(1);
    expect(mine().some((u) => u.kind === 'building')).toBe(true); // the Raiderkamp
    for (let i = 0; i < 200; i++) sim.tick();
    expect(mine().length).toBeGreaterThanOrEqual(9);
  });

  it('does not touch the Dwellers: the test config keeps their script and the Raider script is unused there', () => {
    expect(CONFIG.factions[0]!.aiScript).toBe(0);
    expect(CONFIG.factions[RAIDERS]!.aiScript).toBe(-1);
  });
});
