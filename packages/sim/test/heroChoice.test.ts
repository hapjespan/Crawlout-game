import { describe, expect, it } from 'vitest';
import type { CommandEnvelope } from '@crawlout/protocol';
import { heroTypeId, type GameData } from '@crawlout/data';
import {
  createSim,
  deserialize,
  envHash,
  MAX_PERKS,
  simPlayersFromLobby,
  validateEnv,
  type Sim,
  type SimConfig,
  type SimPlayer,
} from '../src/index.js';
import { createOpenMap } from '../src/testing.js';
import { choiceHeroes, choicePerks } from '../src/config.heroes.js';
import {
  effectSum,
  STAT_BUILD_TIME,
  STAT_GATHER,
  STAT_RANGE,
  STAT_RESEARCH_TIME,
} from '../src/effects.js';
import { hasPerk } from '../src/perkBits.js';
import { createHero, heroIndex } from '../src/systems/hero.js';
import { survivalSim } from './survivalHarness.js';
import { CONFIG, DATA, REAL_CONFIG, bundle, cmd, typeByKey } from './helpers.js';

// Hero choice (sim 0.33.0, data 0.39.0, protocol 0.19.0; docs/held-keuze.md): a player plays the hero of his archetype
// of his faction; without a choice the Krijger. One test per mechanic of the six new heroes.
const fid = (key: string) => DATA.factions.find((f) => f.key === key)!.id;
const hid = (key: string) => DATA.heroes.findIndex((h) => h.key === key);
const pid = (key: string) => DATA.perks.find((p) => p.key === key)!.id;
const DW = fid('dwellers');
const RA = fid('raiders');
const GA = fid('garde');
const lobby = (faction: string, extra: { ai?: boolean; heroArchetype?: string } = {}) => ({
  faction,
  ai: extra.ai ?? false,
  ...(extra.heroArchetype === undefined ? {} : { heroArchetype: extra.heroArchetype }),
});

function sim2(players: SimPlayer[], start = true, config: SimConfig = CONFIG): Sim {
  return createSim({ seed: 5, map: createOpenMap(), players, config }, { start });
}
const run = (sim: Sim, n: number, cmds: CommandEnvelope[] = []) => {
  for (let k = 0; k < n; k++) {
    sim.applyBundle(bundle(sim.frame, k === 0 ? cmds : []));
    sim.tick();
  }
};
const heroAt = (sim: Sim, p: number) => {
  const i = heroIndex(sim, p);
  return { i, x: sim.world.x[i]!, y: sim.world.y[i]! };
};
const unitNear = (sim: Sim, key: string, owner: number, x: number, y: number) =>
  sim.world.resolve(sim.spawnUnit({ typeId: typeByKey(key), owner, x, y }));

describe('hero choice: the lobby to SimPlayer', () => {
  it('no choice or krijger = no heroId (the faction hero); bouwer and tacticus pick the hero of the faction', () => {
    const ps = simPlayersFromLobby(
      DATA,
      [
        lobby('dwellers'),
        lobby('raiders', { heroArchetype: 'krijger' }),
        lobby('dwellers', { heroArchetype: 'bouwer' }),
        lobby('garde', { heroArchetype: 'tacticus' }),
      ].map((p, playerId) => ({ ...p, playerId })),
    );
    expect(ps.map((p) => p.heroId)).toEqual([
      undefined,
      undefined,
      hid('voorman'),
      hid('archivaris'),
    ]);
    expect(REAL_CONFIG.factions[DW]!.heroId).toBe(hid('opziener'));
    expect(() =>
      simPlayersFromLobby(DATA, [{ playerId: 0, ...lobby('dwellers', { heroArchetype: 'held' }) }]),
    ).toThrow(/archetype/);
  });

  it('an AI without a choice plays the archetype of its script (data/ai heroArchetype, absent krijger)', () => {
    const players = [
      { playerId: 0, ...lobby('dwellers', { ai: true }) },
      { playerId: 1, ...lobby('raiders', { ai: true }) },
    ];
    expect(simPlayersFromLobby(DATA, players).map((p) => p.heroId)).toEqual([undefined, undefined]);
    // the Dwellers script against the Raiders (versus) says tacticus, the Raider default script bouwer
    const data: GameData = {
      ...DATA,
      aiScripts: DATA.aiScripts.map((a) =>
        a.factionId === DW && a.versusFactionId === RA
          ? { ...a, heroArchetype: 2 }
          : a.factionId === RA && a.versusFactionId < 0
            ? { ...a, heroArchetype: 0 }
            : a,
      ),
    };
    expect(simPlayersFromLobby(data, players).map((p) => p.heroId)).toEqual([
      hid('controleur'),
      hid('marktmeester'),
    ]);
    // a lobby choice goes before the script
    players[1] = { playerId: 1, ...lobby('raiders', { ai: true, heroArchetype: 'krijger' }) };
    expect(simPlayersFromLobby(data, players)[1]!.heroId).toBeUndefined();
  });

  it('validateEnv refuses a hero of another faction', () => {
    const env = { map: createOpenMap(), config: REAL_CONFIG };
    expect(() =>
      validateEnv({ ...env, players: [{ factionId: DW, ai: false, heroId: hid('ketenmeester') }] }),
    ).toThrow(/held/);
    expect(() =>
      validateEnv({ ...env, players: [{ factionId: DW, ai: false, heroId: hid('voorman') }] }),
    ).not.toThrow();
  });
});

describe('hero choice: envHash scoping', () => {
  it('without a choice the envHash ignores the choice heroes and their perks; a choice hashes them', () => {
    const choiceH = choiceHeroes(REAL_CONFIG);
    const choiceP = choicePerks(REAL_CONFIG);
    expect(choiceH.size).toBe(6);
    expect(choiceP.size).toBe(18);
    const strip: SimConfig = {
      ...REAL_CONFIG,
      heroes: REAL_CONFIG.heroes.filter((h) => !choiceH.has(h.heroId)),
      perks: REAL_CONFIG.perks.filter((p) => !choiceP.has(p.perkId)),
    };
    const map = createOpenMap();
    const plain = [
      { factionId: DW, ai: false },
      { factionId: RA, ai: true },
    ];
    expect(envHash({ map, config: REAL_CONFIG, players: plain })).toBe(
      envHash({ map, config: strip, players: plain }),
    );
    const voorman = [{ ...plain[0]!, heroId: hid('voorman') }, plain[1]!];
    const controleur = [{ ...plain[0]!, heroId: hid('controleur') }, plain[1]!];
    const h1 = envHash({ map, config: REAL_CONFIG, players: voorman });
    expect(h1).not.toBe(envHash({ map, config: REAL_CONFIG, players: plain }));
    expect(h1).not.toBe(envHash({ map, config: REAL_CONFIG, players: controleur }));
  });
});

describe('hero choice: spawn, revive, perks', () => {
  it('the chosen hero spawns with its body and HeroStatus, and comes back the same after a revive', () => {
    const sim = sim2([
      { factionId: DW, ai: false, heroId: hid('voorman') },
      { factionId: RA, ai: false },
    ]);
    const { i } = heroAt(sim, 0);
    expect(sim.world.typeId[i]).toBe(heroTypeId(hid('voorman')));
    expect(sim.playerStatus(0).hero!.heroId).toBe(hid('voorman'));
    expect(sim.playerStatus(1).hero!.heroId).toBe(hid('warlord'));
    // death and revive at the headquarters
    sim.world.hp[i] = 0;
    run(sim, 2);
    expect(sim.playerStatus(0).hero!.state).toBe('dead');
    const hq = sim
      .entityIds()
      .find((id) => sim.getUnit(id)!.kind === 'building' && sim.getUnit(id)!.owner === 0)!;
    const h = REAL_CONFIG.heroes[hid('voorman')]!;
    sim.setScrap(0, h.reviveScrap);
    run(sim, h.reviveTicks + 2, [cmd(sim.frame, 0, 'Recruit', { buildingId: hq })]);
    const back = heroIndex(sim, 0);
    expect(back).toBeGreaterThanOrEqual(0);
    expect(sim.world.typeId[back]).toBe(heroTypeId(hid('voorman')));
    expect(sim.playerStatus(0).hero!.heroId).toBe(hid('voorman'));
  });

  it('a choice perk from the own pool is picked; one from another hero is refused', () => {
    const sim = sim2([
      { factionId: DW, ai: false, heroId: hid('voorman') },
      { factionId: RA, ai: false },
    ]);
    const heroId = hid('voorman');
    sim.ps.heroPending[0] = 2;
    const gather0 = effectSum(sim, 0, STAT_GATHER, typeByKey('scavenger'), false);
    run(sim, 1, [cmd(sim.frame, 0, 'PickPerk', { heroId, perkId: pid('voorraadkast') })]);
    expect(hasPerk(sim.ps, 0, pid('voorraadkast'))).toBe(true);
    expect(effectSum(sim, 0, STAT_GATHER, typeByKey('scavenger'), false)).toBe(gather0 + 60); // permille
    run(sim, 1, [cmd(sim.frame, 0, 'PickPerk', { heroId, perkId: pid('lange_ketting') })]);
    expect(hasPerk(sim.ps, 0, pid('lange_ketting'))).toBe(false);
    expect(sim.playerStatus(0).hero!.perks).toEqual([pid('voorraadkast')]);
  });
});

describe('hero choice: passives of the Bouwer and the Tacticus', () => {
  const sumOf = (heroKey: string, faction: number, stat: number, unit: string) => {
    const sim = sim2(
      [
        { factionId: faction, ai: false, heroId: hid(heroKey) },
        { factionId: DW, ai: false },
      ],
      false,
    );
    startHero(sim);
    return effectSum(sim, 0, stat, typeByKey(unit), false); // Pct in permille, rangeM in units
  };
  it('Voorman: scavengers +8 gather, builders 10 percent faster', () => {
    expect(sumOf('voorman', DW, STAT_GATHER, 'scavenger')).toBe(80);
    expect(sumOf('voorman', DW, STAT_BUILD_TIME, 'bouwer')).toBe(-100);
  });
  it('Marktmeester: slaves +10 gather, slave builders 10 percent faster', () => {
    expect(sumOf('marktmeester', RA, STAT_GATHER, 'slaaf')).toBe(100);
    expect(sumOf('marktmeester', RA, STAT_BUILD_TIME, 'slaaf_bouwer')).toBe(-100);
  });
  it('Kwartiermeester: zoekers +8 gather, research 10 percent faster', () => {
    expect(sumOf('kwartiermeester', GA, STAT_GATHER, 'initiate_zoeker')).toBe(80);
    expect(sumOf('kwartiermeester', GA, STAT_RESEARCH_TIME, 'initiate_zoeker')).toBe(-100);
  });
  it('Controleur and Archivaris: turrets +1 m range (a real turret reaches further)', () => {
    expect(sumOf('controleur', DW, STAT_RANGE, 'turret_laser')).toBe(256);
    const range = (players: SimPlayer[]) => {
      const sim = sim2(players, false);
      startHero(sim);
      const t = sim.world.resolve(sim.spawnBuilding(typeByKey('geschutstoren'), 0, 30, 30, true));
      run(sim, 1);
      return sim.world.range[t]!;
    };
    const krijger = range([
      { factionId: GA, ai: false },
      { factionId: DW, ai: false },
    ]);
    const archivaris = range([
      { factionId: GA, ai: false, heroId: hid('archivaris') },
      { factionId: DW, ai: false },
    ]);
    expect(archivaris - krijger).toBe(256);
  });
});

describe('hero choice: auras and abilities', () => {
  const pair = (heroKey: string, faction: number, enemy: number) =>
    sim2(
      [
        { factionId: faction, ai: false, heroId: hid(heroKey) },
        { factionId: enemy, ai: false },
      ],
      false,
    );
  for (const [key, faction, enemyUnit] of [
    ['controleur', DW, 'plunderaar'],
    ['ketenmeester', RA, 'militie'],
  ] as const) {
    it(`${key}: the aura slows an enemy within 8 m by 10 percent, not one at 10 m`, () => {
      const sim = pair(key, faction, faction === DW ? RA : DW);
      startHero(sim);
      const { x, y } = heroAt(sim, 0);
      const near = unitNear(sim, enemyUnit, 1, x + 6 * 256, y);
      const far = unitNear(sim, enemyUnit, 1, x + 10 * 256, y);
      run(sim, 1);
      expect(sim.auras.speed[near]).toBe(-100);
      expect(sim.auras.speed[far]).toBe(0);
    });
  }

  for (const [key, faction, own, speed, taken] of [
    ['voorman', DW, 'scavenger', 250, -100],
    ['marktmeester', RA, 'slaaf', 300, 0],
    ['kwartiermeester', GA, 'initiate_zoeker', 200, -100],
  ] as const) {
    it(`${key}: the ability on the hero speeds own units in the radius (also workers)`, () => {
      const sim = pair(key, faction, DW === faction ? RA : DW);
      startHero(sim);
      const { x, y } = heroAt(sim, 0);
      const u = unitNear(sim, own, 0, x + 4 * 256, y);
      run(sim, 1, [cmd(sim.frame, 0, 'HeroAbility', { heroId: hid(key), abilityId: 0 })]);
      expect(sim.auras.speed[u]).toBe(speed);
      expect(sim.auras.taken[u]).toBe(taken);
    });
  }

  for (const [key, faction, speed, damage] of [
    ['controleur', DW, -400, -250],
    ['ketenmeester', RA, -450, -150],
    ['archivaris', GA, -350, -300],
  ] as const) {
    it(`${key}: the ability at a point slows and weakens enemies there`, () => {
      const sim = pair(key, faction, faction === DW ? RA : DW);
      startHero(sim);
      const { x, y } = heroAt(sim, 0);
      const enemy = unitNear(sim, faction === DW ? 'plunderaar' : 'militie', 1, x + 10 * 256, y);
      const tx = x + 10 * 256;
      run(sim, 1, [cmd(sim.frame, 0, 'HeroAbility', { heroId: hid(key), abilityId: 0, x: tx, y })]);
      // 10 m from the hero: outside the 8 m aura of the Controleur and the Ketenmeester
      expect(sim.auras.speed[enemy]).toBe(speed);
      expect(sim.auras.damage[enemy]).toBe(damage);
    });
  }
});

describe('hero choice: Survival co-op', () => {
  it('two players with their own choice each get their hero; the run plays on', () => {
    const sim = survivalSim([
      { factionId: DW, ai: false, heroId: hid('controleur') },
      { factionId: DW, ai: false, heroId: hid('voorman') },
    ]);
    expect(sim.playerStatus(0).hero!.heroId).toBe(hid('controleur'));
    expect(sim.playerStatus(1).hero!.heroId).toBe(hid('voorman'));
    run(sim, 200);
    expect(sim.playerStatus(1).hero!.state).toBe('alive');
  });
});

describe('MAX_PERKS 64 (sim 0.33.0)', () => {
  const morePerks = (n: number): SimConfig => {
    const extra = Array.from({ length: n - CONFIG.perks.length }, (_, k) => ({
      ...CONFIG.perks[0]!,
      perkId: CONFIG.perks.length + k,
    }));
    const perks = [...CONFIG.perks, ...extra];
    const opz = hid('opziener');
    return {
      ...CONFIG,
      perks,
      heroes: CONFIG.heroes.map((h) =>
        h.heroId === opz ? { ...h, perkPool: [...h.perkPool, n - 1] } : h,
      ),
    };
  };

  it('validates up to MAX_PERKS perks and refuses more', () => {
    expect(MAX_PERKS).toBe(64);
    const env = { map: createOpenMap(), players: [{ factionId: DW, ai: false }] };
    expect(() => validateEnv({ ...env, config: morePerks(MAX_PERKS) })).not.toThrow();
    expect(() => validateEnv({ ...env, config: morePerks(MAX_PERKS + 1) })).toThrow(/perks/);
  });

  it('a perk above 32 lives in the second word; the state carries it only with more than 32 perks', () => {
    const players = [
      { factionId: DW, ai: false },
      { factionId: RA, ai: false },
    ];
    const sim = sim2(players, true, morePerks(40));
    const small = sim2(players, true);
    expect(sim.serialize().byteLength - small.serialize().byteLength).toBe(4 * 8 /* MAX_PLAYERS */);
    sim.ps.heroPending[0] = 1;
    run(sim, 1, [cmd(sim.frame, 0, 'PickPerk', { heroId: hid('opziener'), perkId: 39 })]);
    expect(hasPerk(sim.ps, 0, 39)).toBe(true);
    expect(sim.playerStatus(0).hero!.perks).toEqual([39]);
    const copy = deserialize(sim.serialize(), {
      players: sim.players,
      map: sim.map,
      config: sim.config,
    });
    expect(copy.hash()).toBe(sim.hash());
    expect(hasPerk(copy.ps, 0, 39)).toBe(true);
  });
});

/** Spawns player 0's hero (a sim made with start false has none). */
function startHero(sim: Sim): void {
  createHero(sim, 0, 40 * 256, 40 * 256);
}
