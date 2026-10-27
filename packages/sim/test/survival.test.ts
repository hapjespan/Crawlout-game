import { describe, expect, it } from 'vitest';
import { OWNER_NEUTRAL } from '@crawlout/protocol';
import {
  HORDE_WINNER,
  PLACE_OK,
  PLACE_ZONE,
  RANK_NORMAL,
  createSim,
  deserialize,
  envHash,
  hqOf,
  threatScore,
  waveUnits,
} from '../src/index.js';
import { isEnemy } from '../src/systems/common.js';
import { placementReasonAt } from '../src/systems/placement.js';
import { createOpenMap, testPlayers } from '../src/testing.js';
import { CONFIG, MILITIA, envOf, typeByKey } from './helpers.js';
import {
  GHOUL,
  KLAUWBEEST,
  SURVIVAL,
  clearUnits,
  edgeOf,
  fastWaves,
  hordeOf,
  isHorde,
  runTo,
  setHqHp,
  survivalInit,
  survivalSim,
  wave,
} from './survivalHarness.js';

/** A copy without the optional `survival` field (a map or config of another game type). */
const withoutSurvival = <T extends { survival?: unknown }>(o: T): T => {
  const c = { ...o };
  delete c.survival;
  return c;
};

const ghoul = CONFIG.unitTypes.find((u) => u.typeId === GHOUL)!;

describe('survival: scaling per player count', () => {
  it('scales the count of normal units and keeps a miniboss or boss at one', () => {
    for (let n = 1; n <= 4; n++) {
      const c = SURVIVAL.scaling[n - 1]!.countPermille;
      expect(waveUnits(SURVIVAL, SURVIVAL.waves[0]!, n)).toHaveLength(Math.ceil((8 * c) / 1000));
      // wave 8: the Klauwbeest plus ghouls and runners
      const w8 = SURVIVAL.waves[7]!;
      const units = waveUnits(SURVIVAL, w8, n);
      expect(units.filter((t) => t === KLAUWBEEST)).toHaveLength(1);
      const normal = w8.spawns.filter(
        (e) => SURVIVAL.ranks[SURVIVAL.typeIds.indexOf(e.typeId)] === RANK_NORMAL,
      );
      const expected = normal.reduce((s, e) => s + Math.ceil((e.count * c) / 1000), 0);
      expect(units.length - 1).toBe(expected);
    }
  });

  it('gives wave units the hp and damage of the player count', () => {
    const sim = survivalSim(testPlayers(2), fastWaves([wave(2, 4)]));
    runTo(sim, 3);
    const sc = SURVIVAL.scaling[1]!;
    const h = hordeOf(sim);
    expect(h.length).toBe(Math.ceil((4 * sc.countPermille) / 1000));
    for (const i of h) {
      expect(sim.world.maxHp[i]).toBe(Math.floor((ghoul.maxHp * sc.hpPermille) / 1000));
      expect(sim.world.hp[i]).toBe(sim.world.maxHp[i]);
      expect(sim.world.damage[i]).toBe(Math.floor((ghoul.damage * sc.damagePermille) / 1000));
      expect(sim.world.owner[i]).toBe(OWNER_NEUTRAL);
    }
  });
});

describe('survival: the wave spawner', () => {
  it('spawns wave 8 with one Klauwbeest over two edges, at four players', () => {
    const w8 = SURVIVAL.waves[7]!;
    const sim = survivalSim(testPlayers(4), fastWaves([{ ...w8, atTicks: 2, batches: 1 }]));
    runTo(sim, 3);
    const h = hordeOf(sim);
    expect(h).toHaveLength(waveUnits(SURVIVAL, w8, 4).length);
    const boss = h.filter((i) => sim.world.typeId[i] === KLAUWBEEST);
    expect(boss).toHaveLength(1);
    const kb = CONFIG.unitTypes.find((u) => u.typeId === KLAUWBEEST)!;
    expect(sim.world.maxHp[boss[0]!]).toBe(
      Math.floor((kb.maxHp * SURVIVAL.scaling[3]!.hpPermille) / 1000),
    );
    expect(new Set(h.map((i) => edgeOf(sim, i))).size).toBe(w8.edges);
  });

  it('spawns the batches of a wave at atTicks and every batchIntervalTicks', () => {
    const sim = survivalSim(
      testPlayers(1),
      fastWaves([wave(20, 8, { batches: 2, batchIntervalTicks: 10 })]),
    );
    runTo(sim, 20);
    expect(hordeOf(sim)).toHaveLength(0);
    runTo(sim, 21);
    expect(hordeOf(sim)).toHaveLength(4);
    runTo(sim, 30);
    expect(hordeOf(sim)).toHaveLength(4);
    runTo(sim, 31);
    expect(hordeOf(sim)).toHaveLength(8);
    expect(sim.survival.batches[0]).toBe(2);
    expect(sim.survivalStatus()).toEqual({
      wavesStarted: 1,
      waves: 1,
      next: null,
      active: [{ target: 0, alive: 8 }],
      result: null,
    });
  });

  it('reports the next wave and its rank for the HUD, and nothing outside Survival', () => {
    const sim = survivalSim();
    expect(sim.survivalStatus()?.next).toEqual({
      wave: 1,
      atFrame: SURVIVAL.waves[0]!.atTicks,
      rank: RANK_NORMAL,
    });
    expect(createSim({ ...survivalInit(), map: createOpenMap(128, 128) }).survivalStatus()).toBe(
      null,
    );
  });

  it('fills PlayerStatus.survival (protocol 0.17.0) with the rank as a string, the same for every player', () => {
    const sim = survivalSim(testPlayers(2));
    const names = ['normal', 'miniboss', 'boss'];
    const seen = new Set<string>();
    for (let k = 0; k <= SURVIVAL.waves.length; k++) {
      for (let j = 0; j < k; j++) sim.survival.batches[j] = 1;
      const s = sim.survivalStatus()!;
      const msg = sim.playerStatus(0).survival!;
      expect(msg).toEqual({
        ...s,
        next: s.next === null ? null : { ...s.next, rank: names[s.next.rank] },
      });
      expect(sim.playerStatus(1).survival).toEqual(msg);
      if (msg.next !== null) seen.add(msg.next.rank);
    }
    expect(seen.has('normal')).toBe(true);
    expect(seen.has('boss') || seen.has('miniboss')).toBe(true);
    const skirmish = createSim({ ...survivalInit(), map: createOpenMap(128, 128) });
    expect(skirmish.playerStatus(0).survival).toBe(null);
  });

  it('spawns within spread of the edge nearest the target zone, then clockwise', () => {
    // solo: slot 0 (nearEdge noord); two edges: noord and oost, the rest to the first
    const sim = survivalSim(testPlayers(1), fastWaves([wave(1, 7, { edges: 2 })]));
    runTo(sim, 2);
    const sm = sim.map.survival!;
    const h = hordeOf(sim);
    const at = h.map((i) => edgeOf(sim, i));
    expect(at.filter((e) => e === sm.zones[0]!.nearEdge)).toHaveLength(4);
    expect(at.filter((e) => e === sm.zones[0]!.nearEdge + 1)).toHaveLength(3);
    for (const i of h) {
      const e = sm.edges[edgeOf(sim, i)]!;
      const d = Math.hypot(sim.world.x[i]! - e.x, sim.world.y[i]! - e.y);
      expect(d).toBeLessThanOrEqual(e.spread + 256);
    }
  });

  it('starts at the zone edge of a target in another slot', () => {
    const players = [
      { factionId: 0, ai: false },
      { factionId: 0, ai: false },
    ];
    const sim = survivalSim(players, fastWaves([wave(3, 4, { edges: 2 })]));
    // player 0 is stronger: three more militia
    for (let k = 0; k < 3; k++) {
      const z = sim.map.survival!.zones[0]!;
      sim.spawnUnit({ typeId: MILITIA, owner: 0, x: z.x + 4096 + k * 512, y: z.y + 4096 });
    }
    runTo(sim, 4);
    expect(sim.survival.target[0]).toBe(2);
    const at = hordeOf(sim).map((i) => edgeOf(sim, i));
    const first = sim.map.survival!.zones[1]!.nearEdge;
    expect(new Set(at)).toEqual(new Set([first, (first + 1) % 4]));
  });
});

describe('survival: the weakest player', () => {
  const duo = () => {
    const s = survivalSim(testPlayers(2), fastWaves([wave(5, 2)]));
    return s;
  };

  it('scores fighters, robots, turrets and a living hero', () => {
    const sim = duo();
    const before = threatScore(sim, SURVIVAL, 0);
    const militia = CONFIG.unitTypes.find((u) => u.typeId === MILITIA)!;
    const z = sim.map.survival!.zones[0]!;
    sim.spawnUnit({ typeId: MILITIA, owner: 0, x: z.x + 4096, y: z.y + 4096 });
    const scaled = Math.floor((militia.scrapCost * SURVIVAL.unitScrapPermille) / 1000);
    expect(threatScore(sim, SURVIVAL, 0)).toBe(before + scaled);
    // the hero counts heroScrap while he lives
    expect(before).toBeGreaterThanOrEqual(SURVIVAL.heroScrap);
  });

  it('targets the lowest score', () => {
    const sim = duo();
    const z = sim.map.survival!.zones[0]!;
    sim.spawnUnit({ typeId: MILITIA, owner: 0, x: z.x + 4096, y: z.y + 4096 });
    runTo(sim, 6);
    expect(sim.survival.target[0]).toBe(2);
  });

  it('breaks a tie on the lowest HQ hp permille, then the lowest slot', () => {
    const tie = duo();
    runTo(tie, 6);
    expect(tie.survival.target[0]).toBe(1);
    const hurt = duo();
    setHqHp(hurt, 1, hurt.world.maxHp[hqOf(hurt, 1)]! - 100);
    runTo(hurt, 6);
    expect(hurt.survival.target[0]).toBe(2);
  });

  it('retargets a living wave when its target loses his HQ', () => {
    const sim = survivalSim(
      testPlayers(2),
      fastWaves([wave(5, 2, { batches: 2, batchIntervalTicks: 500 })]),
    );
    runTo(sim, 6);
    expect(sim.survival.target[0]).toBe(1);
    setHqHp(sim, 0, 0);
    runTo(sim, 8);
    expect(sim.isDefeated(0)).toBe(true);
    expect(sim.survival.target[0]).toBe(2);
    expect(sim.winner()).toBeNull();
  });

  it('always targets the only player solo', () => {
    const sim = survivalSim(testPlayers(1), fastWaves([wave(2, 1)]));
    runTo(sim, 3);
    expect(sim.survival.target[0]).toBe(1);
  });
});

describe('survival: the hostile behaviour', () => {
  it('marches on the target HQ without a leash and attacks it', () => {
    const sim = survivalSim(testPlayers(1), fastWaves([wave(2, 3), wave(100000, 1)]));
    clearUnits(sim, 0);
    const hq = hqOf(sim, 0);
    const full = sim.world.hp[hq]!;
    runTo(sim, 900);
    expect(sim.world.hp[hq]!).toBeLessThan(full);
    for (const i of hordeOf(sim)) expect(sim.world.resolve(sim.world.target[i]!)).toBe(hq);
  });

  it('fights a player unit in its way before the HQ, and the kill gives loot and hero xp', () => {
    const sim = survivalSim(testPlayers(1), fastWaves([wave(2, 1), wave(100000, 1)]));
    runTo(sim, 3);
    const [g] = hordeOf(sim);
    const ids = [0, 1, 2].map((k) =>
      sim.spawnUnit({
        typeId: MILITIA,
        owner: 0,
        x: sim.world.x[g!]! + 512 + k * 256,
        y: sim.world.y[g!]! + 512,
      }),
    );
    runTo(sim, 5);
    expect(ids).toContain(sim.world.target[g!]);
    for (let f = 0; f < 400 && hordeOf(sim).length > 0; f++) runTo(sim, sim.frame + 1);
    expect(hordeOf(sim)).toHaveLength(0);
  });

  it('gives lootScrap and heroXp to the owner of the killing blow', () => {
    const make = () => {
      const s = survivalSim(testPlayers(1), fastWaves([wave(2, 1), wave(100000, 1)]));
      runTo(s, 3);
      return s;
    };
    const a = make();
    const b = make();
    const [g] = hordeOf(b);
    b.world.hp[g!] = 0;
    b.world.lastHit[g!] = 1;
    runTo(a, 4);
    runTo(b, 4);
    expect(b.ps.scrap[0]! - a.ps.scrap[0]!).toBe(SURVIVAL.lootScrap[0]);
    expect(b.ps.heroXp[0]! - a.ps.heroXp[0]!).toBe(SURVIVAL.heroXp[0]);
  });

  it('makes the players one team', () => {
    const sim = survivalSim(testPlayers(2), fastWaves([wave(5, 1)]));
    const z = sim.map.survival!.zones[0]!;
    const a = sim.spawnUnit({ typeId: MILITIA, owner: 0, x: z.x + 4096, y: z.y + 4096 });
    const b = sim.spawnUnit({ typeId: MILITIA, owner: 1, x: z.x + 4352, y: z.y + 4096 });
    runTo(sim, 2);
    const w = sim.world;
    expect(isEnemy(w, w.resolve(a), w.resolve(b))).toBe(false);
    expect(isEnemy(w, w.resolve(b), hqOf(sim, 0))).toBe(false);
  });
});

describe('survival: win and loss', () => {
  it('is won once the win wave spawned and all its units are dead', () => {
    const sim = survivalSim(testPlayers(2), fastWaves([wave(4, 1)]));
    runTo(sim, 4);
    expect(sim.winner()).toBeNull();
    runTo(sim, 6);
    expect(sim.survivalStatus()?.result).toBeNull();
    for (const i of hordeOf(sim)) {
      sim.world.hp[i] = 0;
      sim.world.lastHit[i] = 2;
    }
    runTo(sim, 8);
    expect(sim.survivalStatus()?.result).toEqual({ outcome: 'survived', frame: 6 });
    expect(sim.winner()).toBeNull();
    expect(sim.globals.winner).toBe(0);
  });

  it('is lost once every HQ is gone', () => {
    const sim = survivalSim(testPlayers(2), fastWaves([wave(500, 1)]));
    setHqHp(sim, 0, 0);
    runTo(sim, 3);
    expect(sim.winner()).toBeNull();
    setHqHp(sim, 1, 0);
    runTo(sim, 5);
    expect(sim.survivalStatus()?.result).toMatchObject({ outcome: 'overrun' });
    expect(sim.globals.winner).toBe(HORDE_WINNER);
  });
});

describe('survival: build zones', () => {
  const woning = CONFIG.buildingTypes.find((t) => t.typeId === typeByKey('woning'))!;
  const paal = CONFIG.buildingTypes.find((t) => t.typeId === typeByKey('claimpaal'))!;

  it('lets a player build only in the zone of his slot, a claim building anywhere', () => {
    const sim = survivalSim(testPlayers(2));
    const z = sim.map.survival!.zones[0]!;
    const fx = (z.x >> 8) + 10;
    const fy = (z.y >> 8) + 8;
    expect(placementReasonAt(sim, woning, fx, fy, 0, 0)).toBe(PLACE_OK);
    expect(placementReasonAt(sim, woning, fx, fy, 0, 1)).toBe(PLACE_ZONE);
    expect(placementReasonAt(sim, paal, fx, fy, 0, 1)).not.toBe(PLACE_ZONE);
  });

  it('has no zones outside the game type Survival', () => {
    const init = survivalInit(testPlayers(2));
    const map = withoutSurvival(init.map);
    const sim = createSim({ ...init, map: { ...map, spawns: createOpenMap(128, 128).spawns } });
    const z = init.map.survival!.zones[0]!;
    expect(placementReasonAt(sim, woning, (z.x >> 8) + 10, (z.y >> 8) + 8, 0, 1)).not.toBe(
      PLACE_ZONE,
    );
  });
});

describe('survival: determinism and the env', () => {
  it('serializes mid-wave and continues with the same hashes', () => {
    const init = survivalInit(
      testPlayers(2),
      fastWaves([wave(5, 6, { batches: 2, batchIntervalTicks: 40 })]),
    );
    const a = createSim(init);
    runTo(a, 20);
    const b = deserialize(a.serialize(), envOf(init));
    expect(b.hash()).toBe(a.hash());
    for (let f = 0; f < 200; f++) {
      runTo(a, a.frame + 1);
      runTo(b, b.frame + 1);
      expect(b.hash()).toBe(a.hash());
    }
    expect(hordeOf(b).every((i) => isHorde(b, i))).toBe(true);
  });

  it('leaves the env hash of a game without survival unchanged', () => {
    const map = createOpenMap(128, 128);
    const without = withoutSurvival(CONFIG);
    const players = testPlayers(2);
    expect(envHash({ players, map, config: CONFIG })).toBe(
      envHash({ players, map, config: without }),
    );
    const init = survivalInit(players);
    const plain = withoutSurvival(init.map);
    expect(envHash(envOf(init))).not.toBe(envHash({ ...envOf(init), map: plain }));
  });

  it('rejects a survival map without survival data', () => {
    const init = survivalInit(testPlayers(1));
    const config = withoutSurvival(init.config);
    expect(() => createSim({ ...init, config })).toThrow(/survival/);
  });
});
