import { describe, expect, it } from 'vitest';
import { createSim, deserialize, envHash, type Sim, type SimConfig } from '../src/index.js';
import { createOpenMap } from '../src/testing.js';
import { heroSpecial, SPECIAL_I, SPECIAL_P, SPECIAL_S } from '../src/effects.js';
import { grantTech } from '../src/techBits.js';
import { veteranKill } from '../src/systems/garde.js';
import { createHero, heroIndex } from '../src/systems/hero.js';
import { DATA, REAL_CONFIG, bundle, cmd, typeByKey } from './helpers.js';

// The Garde, round A (sim 0.32.0, data 0.38.0; docs/garde.md items 1, 2, 6 and 7).
const GARDE = DATA.factions.find((f) => f.key === 'garde')!.id;
const DWELLERS = DATA.factions.find((f) => f.key === 'dwellers')!.id;
const RAIDERS = DATA.factions.find((f) => f.key === 'raiders')!.id;
const tech = (key: string) => DATA.tech.find((t) => t.key === key)!.id;
const loadoutId = (key: string) => DATA.loadouts.find((l) => l.key === key)!.id;

function gardeSim(start = true, config: SimConfig = REAL_CONFIG): Sim {
  return createSim(
    {
      seed: 7,
      map: createOpenMap(),
      players: [
        { factionId: GARDE, ai: false },
        { factionId: DWELLERS, ai: false },
      ],
      config,
    },
    { start },
  );
}

const run = (sim: Sim, n: number, cmds: Parameters<typeof bundle>[1] = []) => {
  for (let k = 0; k < n; k++) {
    sim.applyBundle(bundle(sim.frame, k === 0 ? cmds : []));
    sim.tick();
  }
};

describe('Garde: veteran promotion (item 1)', () => {
  it('an Initiate-wacht becomes Ridder after 3 kills and Paladin after 8, with more hp and damage', () => {
    const sim = gardeSim(false);
    const id = sim.spawnUnit({
      typeId: typeByKey('initiate_wacht'),
      owner: 0,
      x: 20 * 256,
      y: 20 * 256,
    });
    const i = sim.world.resolve(id);
    const hp0 = sim.world.maxHp[i]!;
    const dmg0 = sim.world.damage[i]!;
    for (let k = 0; k < 2; k++) veteranKill(sim, i);
    expect(sim.garde.rank[i]).toBe(0);
    veteranKill(sim, i);
    expect(sim.garde.rank[i]).toBe(1);
    expect(sim.world.maxHp[i]).toBe(Math.trunc((hp0 * 1250) / 1000));
    expect(sim.world.hp[i]).toBe(sim.world.maxHp[i]);
    for (let k = 0; k < 5; k++) veteranKill(sim, i);
    expect(sim.garde.rank[i]).toBe(2);
    expect(sim.world.damage[i]).toBe(Math.trunc((dmg0 * 1300) / 1000));
    // another loadout (a zoeker) never ranks
    const z = sim.world.resolve(
      sim.spawnUnit({ typeId: typeByKey('initiate_zoeker'), owner: 0, x: 24 * 256, y: 20 * 256 }),
    );
    for (let k = 0; k < 9; k++) veteranKill(sim, z);
    expect(sim.garde.rank[z]).toBe(0);
  });

  it('serialize and deserialize keep kills and ranks (same hash)', () => {
    const sim = gardeSim(false);
    const i = sim.world.resolve(
      sim.spawnUnit({ typeId: typeByKey('initiate_wacht'), owner: 0, x: 20 * 256, y: 20 * 256 }),
    );
    for (let k = 0; k < 4; k++) veteranKill(sim, i);
    run(sim, 3);
    const copy = deserialize(sim.serialize(), envOfSim(sim));
    expect(copy.hash()).toBe(sim.hash());
    expect(copy.garde.kills[i]).toBe(4);
    expect(copy.garde.rank[i]).toBe(1);
    run(copy, 20);
    run(sim, 20);
    expect(copy.hash()).toBe(sim.hash());
  });
});

/** The env a sim was made with (for deserialize). */
function envOfSim(sim: Sim) {
  return { players: sim.players, map: sim.map, config: sim.config };
}

describe('Garde: fusion cores (item 2)', () => {
  it('the smederij crafts cores after fusiekernen; a frame takes one; Cancel gives it back', () => {
    const sim = gardeSim(false);
    const smederij = sim.spawnBuilding(typeByKey('smederij'), 0, 30, 30, true);
    sim.setScrap(0, 1000);
    const fc = REAL_CONFIG.factions[GARDE]!.fusionCores!;
    run(sim, fc.craftTicks + 5);
    expect(sim.garde.cores[0]).toBe(0); // no fusiekernen yet
    grantTech(sim.ps, 0, tech('fusiekernen'));
    run(sim, fc.craftTicks + 2);
    expect(sim.garde.cores[0]).toBe(1);
    expect(sim.playerStatus(0).scrap).toBe(1000 - fc.scrapCost * 2); // the second one is in work
    run(sim, fc.craftTicks * 3);
    expect(sim.garde.cores[0]).toBe(fc.maxStock);
    // sim 0.34.0: a frame needs no bed (the player has none here)
    const produce = cmd(sim.frame, 0, 'Produce', {
      buildingId: smederij,
      loadoutId: loadoutId('krachtpantser'),
    });
    run(sim, 1, [produce]);
    expect(sim.garde.cores[0]).toBe(fc.maxStock - 1);
    run(sim, 1, [cmd(sim.frame, 0, 'Cancel', { ids: [smederij] })]);
    expect(sim.garde.cores[0]).toBe(fc.maxStock);
    // without a core the frame is refused
    sim.garde.cores[0] = 0;
    sim.garde.coreWork[0] = 0;
    sim.setScrap(0, 150);
    run(sim, 1, [
      cmd(sim.frame, 0, 'Produce', { buildingId: smederij, loadoutId: loadoutId('krachtpantser') }),
    ]);
    expect(sim.world.job[sim.world.resolve(smederij)]).toBe(0);
  });
});

describe('Garde: tech on target held and the Paladin-Commander (items 6 and 7)', () => {
  it('holobanden gives the hero +1 I, P and S; his damage and range follow', () => {
    const sim = gardeSim(false);
    createHero(sim, 0, 40 * 256, 40 * 256);
    const h = heroIndex(sim, 0);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(sim.world.typeId[h]).toBe(1000 + DATA.heroes.findIndex((x) => x.key === 'zwaardridder'));
    const before = [SPECIAL_I, SPECIAL_P, SPECIAL_S].map((k) => heroSpecial(sim, 0, k));
    const dmg = sim.world.damage[h]!;
    const range = sim.world.range[h]!;
    const archief = sim.spawnBuilding(typeByKey('archief'), 0, 90, 90, true);
    expect(archief).not.toBe(0);
    sim.setScrap(0, 500);
    run(sim, 1, [cmd(sim.frame, 0, 'Research', { techId: tech('holobanden') })]);
    run(sim, 25 * 20 + 40);
    expect([SPECIAL_I, SPECIAL_P, SPECIAL_S].map((k) => heroSpecial(sim, 0, k))).toEqual(
      before.map((v) => v + 1),
    );
    expect(sim.world.damage[h]!).toBeGreaterThan(dmg);
    expect(sim.world.range[h]!).toBeGreaterThan(range);
  });

  it('the armour aura: an own unit near the hero takes 15 percent less damage', () => {
    const sim = gardeSim(false);
    createHero(sim, 0, 40 * 256, 40 * 256);
    const h = heroIndex(sim, 0);
    const x = sim.world.x[h]!;
    const y = sim.world.y[h]!;
    const near = sim.world.resolve(
      sim.spawnUnit({ typeId: typeByKey('initiate_wacht'), owner: 0, x: x + 512, y }),
    );
    run(sim, 1);
    expect(sim.auras.taken[near]).toBe(-150);
    expect(sim.auras.taken[h]).toBe(-150);
  });
});

describe('Garde: hashing is faction-scoped (sim 0.32.0)', () => {
  it('an env without the Garde ignores its rules, script and hero; a Garde env does not', () => {
    const strip: SimConfig = {
      ...REAL_CONFIG,
      factions: REAL_CONFIG.factions.map((f) =>
        f.factionId === GARDE
          ? { ...f, veterancy: null, fusionCores: null, aiScript: -1, heroId: -1 }
          : f,
      ),
      aiScripts: REAL_CONFIG.aiScripts.filter(
        (_, k) => k !== REAL_CONFIG.factions[GARDE]!.aiScript,
      ),
      heroes: REAL_CONFIG.heroes.filter((h) => h.factionId !== GARDE),
    };
    // the Raiders' script index moves down with the Garde script gone
    const raidersScript = REAL_CONFIG.factions[RAIDERS]!.aiScript;
    const stripped: SimConfig = {
      ...strip,
      factions: strip.factions.map((f) =>
        f.factionId === RAIDERS ? { ...f, aiScript: raidersScript - 1 } : f,
      ),
    };
    const env = (config: SimConfig, a: number, b: number) => ({
      map: createOpenMap(),
      players: [
        { factionId: a, ai: true },
        { factionId: b, ai: true },
      ],
      config,
    });
    expect(envHash(env(REAL_CONFIG, DWELLERS, RAIDERS))).toBe(
      envHash(env(stripped, DWELLERS, RAIDERS)),
    );
    const garde = REAL_CONFIG.factions[GARDE]!;
    const less: SimConfig = {
      ...REAL_CONFIG,
      factions: REAL_CONFIG.factions.map((f) =>
        f.factionId === GARDE
          ? { ...garde, fusionCores: { ...garde.fusionCores!, maxStock: 3 } }
          : f,
      ),
    };
    expect(envHash(env(REAL_CONFIG, DWELLERS, RAIDERS))).toBe(
      envHash(env(less, DWELLERS, RAIDERS)),
    );
    expect(envHash(env(REAL_CONFIG, GARDE, DWELLERS))).not.toBe(
      envHash(env(less, GARDE, DWELLERS)),
    );
  });
});
