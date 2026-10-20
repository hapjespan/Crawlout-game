import { describe, expect, it } from 'vitest';
import {
  createSim,
  deserialize,
  envHash,
  type Sim,
  type SimConfig,
  type SimMap,
} from '../src/index.js';
import { createOpenMap, createTestMap } from '../src/testing.js';
import { overloadHit } from '../src/systems/garde.klerk.js';
import { createClaimPoint } from '../src/entities.js';
import { NO_FIELD } from '../src/ecs/world.js';
import { DATA, REAL_CONFIG, bundle, cmd, typeByKey } from './helpers.js';

// The Garde, round B (sim 0.33.0, data 0.39.0, protocol 0.18.0; docs/garde.md items 3, 4, 5 and 8).
const GARDE = DATA.factions.find((f) => f.key === 'garde')!.id;
const DWELLERS = DATA.factions.find((f) => f.key === 'dwellers')!.id;
const RAIDERS = DATA.factions.find((f) => f.key === 'raiders')!.id;
const C = 256;

function sim2(
  map: SimMap = createOpenMap(),
  b = DWELLERS,
  start = false,
  config = REAL_CONFIG,
): Sim {
  return createSim(
    {
      seed: 11,
      map,
      players: [
        { factionId: GARDE, ai: false },
        { factionId: b, ai: false },
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

const unit = (sim: Sim, key: string, owner: number, cx: number, cy: number) =>
  sim.spawnUnit({ typeId: typeByKey(key), owner, x: cx * C + 128, y: cy * C + 128 });
const ix = (sim: Sim, id: number) => sim.world.resolve(id);
const envOf = (sim: Sim) => ({ players: sim.players, map: sim.map, config: sim.config });

describe('Garde: the Klerk (item 3)', () => {
  it('repairs an own frame and a building, not a human', () => {
    const sim = sim2();
    const w = sim.world;
    const frame = ix(sim, unit(sim, 'krachtpantser', 0, 20, 20));
    const human = ix(sim, unit(sim, 'initiate_wacht', 0, 22, 22));
    const klerk = ix(sim, unit(sim, 'klerk', 0, 21, 21));
    w.hp[frame] = 100;
    w.hp[human] = 10;
    run(sim, 40);
    expect(w.hp[frame]).toBeGreaterThan(100);
    expect(w.hp[human]).toBe(10);
    // a building, once the frame is full
    w.hp[frame] = w.maxHp[frame]!;
    const b = ix(sim, sim.spawnBuilding(typeByKey('kazerne'), 0, 26, 18, true));
    w.hp[b] = 50;
    run(sim, 200);
    expect(w.hp[b]).toBeGreaterThan(50);
    expect(w.target[klerk]).not.toBe(0);
  });

  it('overloads enemy power armour: stunned, no moving, then a cooldown', () => {
    const sim = sim2();
    const w = sim.world;
    const klerk = ix(sim, unit(sim, 'klerk', 0, 20, 20));
    const paId = unit(sim, 'krachtpantser', 1, 21, 20);
    const pa = ix(sim, paId);
    const o = sim.config.unitTypes.find((u) => u.typeId === typeByKey('klerk'))!.overload!;
    overloadHit(sim, klerk, pa);
    expect(sim.garde.stunUntil[pa]).toBe(sim.frame + o.stunTicks);
    const x0 = w.x[pa]!;
    run(sim, 1, [cmd(sim.frame, 1, 'Move', { ids: [paId], x: 60 * C, y: 20 * C })]);
    run(sim, o.stunTicks - 2);
    expect(w.x[pa]).toBe(x0);
    run(sim, 20);
    expect(w.x[pa]).toBeGreaterThan(x0);
    // the cooldown: no new stun yet; an initiate is never overloaded
    overloadHit(sim, klerk, pa);
    expect(sim.garde.stunUntil[pa]).toBeLessThan(sim.frame);
    const ini = ix(sim, unit(sim, 'initiate_wacht', 1, 22, 22));
    sim.garde.overloadAt[klerk] = 0;
    overloadHit(sim, klerk, ini);
    expect(sim.garde.stunUntil[ini]).toBe(0);
  });
});

describe('Garde: map power armour (item 4)', () => {
  const paMap = (): SimMap => ({
    ...createOpenMap(),
    claimPoints: [{ x: 64 * C + 128, y: 64 * C + 128, kind: 2 }],
  });

  it('a Dweller holding a powerArmor point gets a frame at 2/3, the Garde one at full quality', () => {
    for (const [owner, quality] of [
      [1, 670],
      [0, 1000],
    ] as const) {
      const map = paMap();
      const sim = sim2(map, DWELLERS);
      const w = sim.world;
      const pt = createClaimPoint(sim, map.claimPoints[0]!.x, map.claimPoints[0]!.y);
      sim.claimPoints.push(pt);
      w.owner[pt] = owner;
      w.beacon[pt] = 1; // a beacon (hero claim): it holds without a post
      const m = sim.config.factions[GARDE]!.mapPowerArmor!;
      const frames = () => {
        const out: number[] = [];
        for (let i = 0; i < w.highWater; i++)
          if (w.alive[i] === 1 && w.typeId[i] === m.typeId && w.owner[i] === owner && w.hp[i]! > 0)
            out.push(i);
        return out;
      };
      run(sim, m.respawnTicks - 2);
      expect(frames()).toHaveLength(0);
      run(sim, 3);
      expect(frames()).toHaveLength(1);
      const f = frames()[0]!;
      const base = sim.config.unitTypes.find((u) => u.typeId === m.typeId)!.maxHp;
      expect(w.maxHp[f]).toBe(Math.trunc((base * quality) / 1000));
      // no second frame while the first lives; a new one respawnTicks after its death
      run(sim, m.respawnTicks + 5);
      expect(frames()).toHaveLength(1);
      w.hp[f] = 0;
      run(sim, m.respawnTicks + 5);
      expect(frames()).toHaveLength(1);
    }
  });
});

describe('Garde: the Vertibird (item 5)', () => {
  it('flies straight over a wall where a walker goes round', () => {
    const sim = sim2(createTestMap());
    const w = sim.world;
    const vId = unit(sim, 'vertibird', 0, 20, 10);
    const v = ix(sim, vId);
    run(sim, 1, [cmd(sim.frame, 0, 'Move', { ids: [vId], x: 44 * C + 128, y: 10 * C + 128 })]);
    for (let k = 0; k < 200 && w.mvOn[v] === 1; k++) {
      run(sim, 1);
      expect(Math.abs(w.y[v]! - (10 * C + 128))).toBeLessThan(C);
    }
    expect(Math.abs(w.x[v]! - (44 * C + 128))).toBeLessThan(C);
    expect(w.flowField[v]).toBe(NO_FIELD); // it never took a flow field
  });

  it('Load, capacity, pop, Unload at a point, serialize, and the cargo dies with it', () => {
    const sim = sim2();
    const w = sim.world;
    const vId = unit(sim, 'vertibird', 0, 30, 30);
    const v = ix(sim, vId);
    const ids = [0, 1, 2, 3, 4].map((k) => unit(sim, 'initiate_wacht', 0, 26 + k, 26));
    ids.forEach((id, k) => (w.hp[ix(sim, id)] = 20 + k));
    const settlers0 = sim.playerStatus(0).settlers;
    run(sim, 1, [cmd(sim.frame, 0, 'Load', { ids, transportId: vId })]);
    run(sim, 120);
    expect(sim.garde.cargoN[v]).toBe(4);
    const left = ids.filter((id) => w.resolve(id) >= 0);
    expect(left).toHaveLength(1); // the fifth found no room
    const boardedHp = ids.map((id, k) => (left.includes(id) ? -1 : 20 + k)).filter((h) => h > 0);
    expect(sim.playerStatus(0).settlers).toBe(settlers0);
    const copy = deserialize(sim.serialize(), envOf(sim));
    expect(copy.hash()).toBe(sim.hash());
    run(sim, 1, [cmd(sim.frame, 0, 'Unload', { ids: [vId], x: 60 * C, y: 60 * C })]);
    run(sim, 200);
    expect(sim.garde.cargoN[v]).toBe(0);
    const out: number[] = [];
    for (let i = 0; i < w.highWater; i++)
      if (w.alive[i] === 1 && w.typeId[i] === typeByKey('initiate_wacht') && w.x[i]! > 50 * C)
        out.push(i);
    expect(out).toHaveLength(4);
    expect(out.map((i) => w.hp[i]!).sort((a, b) => a - b)).toEqual(boardedHp);
    // aboard again, then the transport dies
    run(sim, 1, [cmd(sim.frame, 0, 'Load', { ids: out.map((i) => w.idOf(i)), transportId: vId })]);
    run(sim, 120);
    expect(sim.garde.cargoN[v]).toBe(4);
    w.hp[v] = 0;
    run(sim, 2);
    expect(sim.garde.cargoN[v]).toBe(0);
    expect(sim.playerStatus(0).settlers).toBe(settlers0 - 4); // sim 0.34.0: the Vertibird itself is no settler
  });
});

describe('Garde: round B hashing is faction-scoped (item 8)', () => {
  const env = (config: SimConfig, a: number, b: number) => ({
    map: createOpenMap(),
    players: [
      { factionId: a, ai: true },
      { factionId: b, ai: true },
    ],
    config,
  });

  it('the new Garde techs, Klerk repair, transport and map power armour only count with the Garde', () => {
    const last = REAL_CONFIG.techs.length - 1;
    const klerk = typeByKey('klerk');
    const edit: SimConfig = {
      ...REAL_CONFIG,
      techs: REAL_CONFIG.techs.map((t, k) =>
        k === last ? { ...t, scrapCost: t.scrapCost + 1 } : t,
      ),
      unitTypes: REAL_CONFIG.unitTypes.map((u) =>
        u.typeId === klerk ? { ...u, repair: { ...u.repair!, range: u.repair!.range + 1 } } : u,
      ),
    };
    expect(REAL_CONFIG.techs[last]!.factionId).toBe(GARDE);
    expect(envHash(env(edit, DWELLERS, RAIDERS))).toBe(
      envHash(env(REAL_CONFIG, DWELLERS, RAIDERS)),
    );
    expect(envHash(env(edit, GARDE, RAIDERS))).not.toBe(envHash(env(REAL_CONFIG, GARDE, RAIDERS)));
  });
});
