import { describe, expect, it } from 'vitest';
import { OWNER_NEUTRAL } from '@crawlout/protocol';
import type { CommandEnvelope } from '@crawlout/protocol';
import { createSim, deserialize } from '../src/index.js';
import type { Sim, SimMap } from '../src/index.js';
import { ORDER_GUARD, SLAVE_SLAVE } from '../src/ecs/world.js';
import { cellCenter, createOpenMap } from '../src/testing.js';
import {
  CONFIG,
  DATA,
  MILITIA,
  REAL_CONFIG,
  SCAV,
  bundle,
  cmd,
  envOf,
  testInit,
  typeByKey,
} from './helpers.js';

// The guard rule and the Guard command (data 0.29.0, sim 0.24.0, protocol 0.15.0; voorstel, ter bevestiging door
// content en de architect). Martien, 18 oktober: "Slaven die werken bij scrap en daarbij een kooi naast de scrap, lopen
// niet weg bij 1 militie/raider want door de dreiging. Als er geen kooi dichtbij staat dan zijn er 2 op 5 slaven nodig.
// Geef de raider/militie een bewaakmodus-optie op een kooi zodat dit in een actie werkt." And: "een bewaker op een
// scrapbron dekt 3 slaven. = 5 efficiënter dan 2 los in de buurt zonder taak". The Raiders are player 0, the Dwellers
// player 1, on an open 96 x 96 map after the start setup (the start units taken away; the Raiderkamp at (8, 8) is a
// Kooi, about 20 m from node A) with two scrap nodes: A at (30, 24) with a Kooi next to it (its footprint 4 m away), B
// at (60, 60) with the nearest Kooi (the slaves' own, at (60, 30)) about 28 m away: no Kooi near.

const RAIDERS = DATA.factions.findIndex((f) => f.key === 'raiders');
const PLAYERS = [
  { factionId: RAIDERS, ai: false },
  { factionId: 0, ai: false },
];
const RULES = CONFIG.factions[RAIDERS]!.slaves!;
const KOOI = typeByKey('kooi');
const SLAAF = typeByKey('slaaf');
const PLUNDERAAR = typeByKey('plunderaar');
const KNUPPELAAR = typeByKey('knuppelaar');
const NODE_A = { x: 30, y: 24 };
const NODE_B = { x: 60, y: 60 };

function guardMap(): SimMap {
  return {
    ...createOpenMap(96, 96),
    scrapNodes: [
      { ...cellCenter(NODE_A.x, NODE_A.y), amount: 50000 },
      { ...cellCenter(NODE_B.x, NODE_B.y), amount: 50000 },
    ],
  };
}

interface Arena {
  sim: Sim;
  /** Entity ids of node A and B, the Kooi next to A and the Kooi of the B slaves. */
  a: number;
  b: number;
  kooiA: number;
  kooiB: number;
}

function arena(seed = 1): Arena {
  const sim = createSim(testInit(seed, guardMap(), PLAYERS));
  // the start units go (the headquarters and heroes stay): only the slaves and fighters of each test
  for (const id of sim.entityIds()) {
    const u = sim.getUnit(id)!;
    if (u.kind === 'unit' && u.owner < 2) sim.destroyEntity(id);
  }
  const nodes = sim.entityIds().filter((id) => sim.getUnit(id)!.kind === 'scrapNode');
  const at = (c: { x: number; y: number }): number =>
    nodes.find((id) => {
      const u = sim.getUnit(id)!;
      return u.x >> 8 === c.x && u.y >> 8 === c.y;
    })!;
  const kooiA = sim.spawnBuilding(KOOI, 0, NODE_A.x + 4, NODE_A.y - 1, true);
  const kooiB = sim.spawnBuilding(KOOI, 0, 60, 30, true);
  return { sim, a: at(NODE_A), b: at(NODE_B), kooiA, kooiB };
}

function play(sim: Sim, frames: number, cmds: CommandEnvelope[] = []): void {
  for (let n = 0; n < frames; n++) {
    const f = sim.frame;
    sim.applyBundle(bundle(f, n === 0 ? cmds : []));
    sim.tick();
  }
}
const now = (sim: Sim, p: number, type: CommandEnvelope['type'], payload: unknown): void =>
  play(sim, 1, [cmd(sim.frame, p, type, payload)]);
const spawn = (sim: Sim, typeId: number, owner: number, cx: number, cy: number): number => {
  const id = sim.spawnUnit({ typeId, owner, ...cellCenter(cx, cy) });
  expect(id).not.toBe(0);
  return id;
};

/** n slaves of player 0 bound to `kooi`, gathering at `node`, spawned next to it. */
function slavesAt(sim: Sim, n: number, node: number, kooi: number): number[] {
  const u = sim.getUnit(node)!;
  const ids = Array.from({ length: n }, (_, k) => {
    const id = spawn(sim, SLAAF, 0, (u.x >> 8) - 2 + (k % 3), (u.y >> 8) + 2 + Math.floor(k / 3));
    const i = sim.world.resolve(id);
    sim.world.slaveState[i] = SLAVE_SLAVE;
    sim.world.slaveCage[i] = kooi;
    return id;
  });
  now(sim, 0, 'Gather', { ids, nodeId: node });
  return ids;
}
const owners = (sim: Sim, ids: number[]): number[] =>
  ids.map((id) => sim.world.owner[sim.world.resolve(id)]!);
const escaped = (sim: Sim, ids: number[]): number =>
  owners(sim, ids).filter((o) => o === OWNER_NEUTRAL).length;
const groups = (sim: Sim) => sim.playerStatus(0).slaveGroups!;
const orderOf = (sim: Sim, id: number): number => sim.getUnit(id)!.order;
/** Distance in metres from unit `id` to the centre of entity `to`. */
const dist = (sim: Sim, id: number, to: number): number => {
  const u = sim.getUnit(id)!;
  const t = sim.getUnit(to)!;
  return Math.hypot(u.x - t.x, u.y - t.y) / 256;
};

describe('the guard rule: a Kooi next to the scrap', () => {
  it('one guard keeps every slave at a node with a Kooi near; Guard on the Kooi does it in one action', () => {
    const { sim, a, kooiA, kooiB } = arena();
    const ids = slavesAt(sim, 6, a, kooiB); // bound to the far Kooi: the Kooi next to the node counts
    const g = spawn(sim, PLUNDERAAR, 0, 40, 10);
    now(sim, 0, 'Guard', { ids: [g], targetId: kooiA });
    expect(orderOf(sim, g)).toBe(ORDER_GUARD);
    play(sim, RULES.graceTicks + RULES.emptyGraceTicks + 40);
    expect(escaped(sim, ids)).toBe(0);
    const st = groups(sim);
    expect(st).toHaveLength(1);
    expect(st[0]).toMatchObject({
      kind: 'kooi',
      targetId: kooiA,
      slaves: 6,
      guards: 1,
      guardsNeeded: RULES.cageGuards,
      guardMode: 1,
      nodeIds: [a],
      escapeInTicks: 0,
    });
    // the guard walked to the Kooi and waits there
    expect(sim.getUnit(g)!.moving).toBe(false);
    expect(dist(sim, g, kooiA)).toBeLessThan(CONFIG.guard.stand / 256 + 3);
  });

  it('without a guard the group runs after emptyGraceTicks; a loose fighter near the Kooi counts too', () => {
    const { sim, a, kooiA } = arena();
    const ids = slavesAt(sim, 4, a, kooiA);
    const loose = spawn(sim, PLUNDERAAR, 0, NODE_A.x + 6, NODE_A.y - 6);
    play(sim, RULES.graceTicks + 20);
    expect(escaped(sim, ids)).toBe(0);
    expect(groups(sim)[0]).toMatchObject({ guards: 1, guardMode: 0, guardsNeeded: 1 });
    sim.destroyEntity(loose);
    play(sim, 2);
    expect(groups(sim)[0]!.escapeInTicks).toBeGreaterThan(RULES.emptyGraceTicks - 5);
    play(sim, RULES.emptyGraceTicks);
    expect(escaped(sim, ids)).toBe(Math.max(1, Math.trunc((4 * RULES.escapePermille) / 1000)));
  });
});

describe('the guard rule: no Kooi near the scrap', () => {
  it('loose fighters: 2 per 5 slaves; with one too few the group revolts after graceTicks', () => {
    const { sim, b, kooiB } = arena();
    const ids = slavesAt(sim, 5, b, kooiB);
    const loose = [0, 1].map((k) => spawn(sim, PLUNDERAAR, 0, NODE_B.x + 5 + k, NODE_B.y - 5));
    play(sim, RULES.graceTicks + 20);
    expect(escaped(sim, ids)).toBe(0);
    expect(groups(sim)).toEqual([
      expect.objectContaining({ kind: 'node', targetId: b, slaves: 5, guards: 2, guardsNeeded: 2 }),
    ]);
    expect(groups(sim)[0]!.guardsNeeded).toBe(
      Math.ceil((5 * RULES.noCageGuards) / RULES.noCageSlaves),
    );
    sim.destroyEntity(loose[0]!);
    play(sim, RULES.emptyGraceTicks + 5);
    expect(escaped(sim, ids)).toBe(0); // short, not empty: the long grace
    play(sim, RULES.graceTicks);
    expect(escaped(sim, ids)).toBeGreaterThan(0);
  });

  it('guard mode on the node: one guard covers 5 slaves, more efficient than 2 loose ones; 6 need 2', () => {
    const { sim, b, kooiB } = arena();
    const ids = slavesAt(sim, 5, b, kooiB);
    const g = spawn(sim, PLUNDERAAR, 0, NODE_B.x + 20, NODE_B.y);
    now(sim, 0, 'Guard', { ids: [g], targetId: b });
    play(sim, RULES.graceTicks + RULES.emptyGraceTicks + 40);
    expect(escaped(sim, ids)).toBe(0);
    expect(groups(sim)[0]).toMatchObject({ guards: 1, guardMode: 1, guardsNeeded: 1 });
    expect(RULES.guardModeSlavesPerGuard).toBe(5);
    // the guard stands near the node, out of the gatherers' ring
    expect(dist(sim, g, b)).toBeLessThanOrEqual(CONFIG.guard.stand / 256 + 1);
    // a sixth slave: 2 needed, one guard is short
    const more = slavesAt(sim, 1, b, kooiB);
    play(sim, 2);
    expect(groups(sim)[0]).toMatchObject({ slaves: 6, guards: 1, guardsNeeded: 2 });
    play(sim, RULES.graceTicks);
    expect(escaped(sim, [...ids, ...more])).toBeGreaterThan(0);
  });

  it('the groups are per node: a guard at one node does not cover another', () => {
    const { sim, a, b, kooiA, kooiB } = arena();
    slavesAt(sim, 2, a, kooiA);
    slavesAt(sim, 2, b, kooiB);
    const g = spawn(sim, PLUNDERAAR, 0, NODE_B.x + 3, NODE_B.y);
    now(sim, 0, 'Guard', { ids: [g], targetId: b });
    play(sim, 5);
    expect(groups(sim)).toEqual([
      expect.objectContaining({ kind: 'kooi', targetId: kooiA, guards: 0, guardsNeeded: 1 }),
      expect.objectContaining({ kind: 'node', targetId: b, guards: 1, guardsNeeded: 1 }),
    ]);
  });
});

describe('the Guard command', () => {
  it('takes fighters only, on an own Kooi or a node with scrap', () => {
    const { sim, a, kooiA } = arena();
    const [slave] = slavesAt(sim, 1, a, kooiA);
    const fighter = spawn(sim, PLUNDERAAR, 0, 30, 30);
    const enemyKooi = sim.spawnBuilding(KOOI, 1, 80, 80, true);
    const scav = spawn(sim, SCAV, 1, 40, 40);
    now(sim, 0, 'Guard', { ids: [slave, fighter], targetId: enemyKooi });
    expect(orderOf(sim, fighter)).not.toBe(ORDER_GUARD);
    now(sim, 0, 'Guard', { ids: [slave, fighter], targetId: a });
    expect(orderOf(sim, fighter)).toBe(ORDER_GUARD);
    expect(orderOf(sim, slave!)).not.toBe(ORDER_GUARD);
    now(sim, 1, 'Guard', { ids: [scav], targetId: a });
    expect(orderOf(sim, scav)).not.toBe(ORDER_GUARD); // a worker is no guard
  });

  // sim 0.38.0, besluit fase-0 sectie 27: Martien, 22 oktober — Bewaak mag ook op een eigen claimpaal, wachtpost of
  // geschutstoren. Alleen de Raiders hebben een Kooi, dus tot nu toe had alleen zij diepte in deze order.
  it('takes an own claim post, headquarters or turret too, and refuses an enemy, unfinished or other building', () => {
    const { sim } = arena();
    const m = spawn(sim, MILITIA, 1, 60, 50);
    const hq = sim
      .entityIds()
      .find((id) => sim.getUnit(id)!.kind === 'building' && sim.getUnit(id)!.owner === 1)!;
    const posts = [
      sim.spawnBuilding(typeByKey('claimpaal'), 1, 66, 50, true),
      sim.spawnBuilding(typeByKey('turret'), 1, 70, 50, true),
    ];
    for (const post of posts) {
      expect(post).not.toBe(0);
      now(sim, 1, 'Stop', { ids: [m] });
      now(sim, 1, 'Guard', { ids: [m], targetId: post });
      expect(orderOf(sim, m), String(post)).toBe(ORDER_GUARD);
    }
    // the headquarters provides claim as well, so it is a post too
    now(sim, 1, 'Stop', { ids: [m] });
    now(sim, 1, 'Guard', { ids: [m], targetId: hq });
    expect(orderOf(sim, m)).toBe(ORDER_GUARD);
    // not: another player's post, a building site, or a building without kooi, claim or turret
    const refused = [
      sim.spawnBuilding(typeByKey('claimpaal'), 0, 74, 50, true),
      sim.spawnBuilding(typeByKey('claimpaal'), 1, 78, 50, false),
      sim.spawnBuilding(typeByKey('werkplaats'), 1, 82, 50, true),
    ];
    for (const post of refused) {
      now(sim, 1, 'Stop', { ids: [m] });
      now(sim, 1, 'Guard', { ids: [m], targetId: post });
      expect(orderOf(sim, m), String(post)).not.toBe(ORDER_GUARD);
    }
  });

  it('a post that stops being one ends the order (the guard post is checked every tick)', () => {
    const { sim } = arena();
    const m = spawn(sim, MILITIA, 1, 60, 50);
    const toren = sim.spawnBuilding(typeByKey('turret'), 1, 62, 50, true);
    now(sim, 1, 'Guard', { ids: [m], targetId: toren });
    expect(orderOf(sim, m)).toBe(ORDER_GUARD);
    sim.world.owner[sim.world.resolve(toren)] = 0; // taken over
    play(sim, 3);
    expect(orderOf(sim, m)).toBe(0);
  });

  it('the hero does not take it; a Dweller militie guards a node as well (harmless)', () => {
    const sim = createSim(testInit(1, guardMap(), PLAYERS));
    const hero = sim.playerStatus(0).hero!.entityId;
    const node = sim.entityIds().find((id) => {
      const u = sim.getUnit(id)!;
      return u.kind === 'scrapNode' && u.x >> 8 === NODE_B.x;
    })!;
    now(sim, 0, 'Guard', { ids: [hero], targetId: node });
    expect(orderOf(sim, hero)).not.toBe(ORDER_GUARD);
    const m = spawn(sim, MILITIA, 1, 60, 50);
    now(sim, 1, 'Guard', { ids: [m], targetId: node });
    expect(orderOf(sim, m)).toBe(ORDER_GUARD);
    play(sim, 600);
    expect(dist(sim, m, node)).toBeLessThanOrEqual(CONFIG.guard.stand / 256 + 1);
    expect(sim.playerStatus(1).slaveGroups).toEqual([]);
  });

  it('a guard fights an enemy at its post and comes back; it does not follow it beyond the leash', () => {
    const { sim, b } = arena();
    const guards = [0, 1].map((k) => spawn(sim, KNUPPELAAR, 0, NODE_B.x + 3, NODE_B.y + k));
    now(sim, 0, 'Guard', { ids: guards, targetId: b });
    play(sim, 100);
    // an enemy walks past the node and on, 40 m away: the guards go for it, then let it go
    const e = spawn(sim, MILITIA, 1, NODE_B.x - 6, NODE_B.y);
    now(sim, 1, 'Move', { ids: [e], ...cellCenter(NODE_B.x - 40, NODE_B.y) });
    let fought = false;
    let far = 0;
    for (let n = 0; n < 600; n++) {
      play(sim, 1);
      for (const g of guards) {
        if (sim.getUnit(g)!.target !== 0) fought = true;
        far = Math.max(far, dist(sim, g, b));
      }
    }
    expect(fought).toBe(true);
    const leash = CONFIG.guard.leash / 256;
    expect(far).toBeLessThanOrEqual(leash + 2);
    for (const g of guards) {
      expect(orderOf(sim, g)).toBe(ORDER_GUARD);
      expect(dist(sim, g, b)).toBeLessThanOrEqual(CONFIG.guard.stand / 256 + 1);
    }
  });

  it('ends when the post is gone; another command replaces it', () => {
    const { sim, kooiA, b } = arena();
    const g = spawn(sim, PLUNDERAAR, 0, 30, 30);
    now(sim, 0, 'Guard', { ids: [g], targetId: kooiA });
    sim.world.hp[sim.world.resolve(kooiA)] = 0; // razed
    play(sim, 3);
    expect(orderOf(sim, g)).toBe(0);
    now(sim, 0, 'Guard', { ids: [g], targetId: b });
    now(sim, 0, 'Move', { ids: [g], ...cellCenter(10, 80) });
    expect(orderOf(sim, g)).not.toBe(ORDER_GUARD);
  });
});

describe('the Raider AI guards its slave groups (sim 0.24.0, instead of the old garrison)', () => {
  it('Guard on the Raiderkamp for its home guard, Guard on a node without a Kooi near for 1 per 5, released after', () => {
    const plan = REAL_CONFIG.aiScripts[REAL_CONFIG.factions[RAIDERS]!.aiScript]!.raidPlan!;
    const sim = createSim({
      seed: 3,
      players: [
        { factionId: RAIDERS, ai: true },
        { factionId: 0, ai: false },
      ],
      map: guardMap(),
      config: { ...CONFIG, aiScripts: REAL_CONFIG.aiScripts, factions: REAL_CONFIG.factions },
    });
    const w = sim.world;
    const camp = sim
      .entityIds()
      .find((id) => sim.getUnit(id)!.kind === 'building' && sim.getUnit(id)!.owner === 0)!;
    const nodes = sim.entityIds().filter((id) => sim.getUnit(id)!.kind === 'scrapNode');
    const b = nodes.find((id) => sim.getUnit(id)!.x >> 8 === NODE_B.x)!;
    const kooiB = sim.spawnBuilding(KOOI, 0, 60, 30, true);
    for (let k = 0; k < 6; k++) spawn(sim, PLUNDERAAR, 0, 14 + k, 14);
    const ids = slavesAt(sim, 6, b, kooiB);
    const guardsOn = (post: number): number =>
      sim.entityIds().filter((id) => {
        const i = w.resolve(id);
        return (
          w.owner[i] === 0 && orderOf(sim, id) === ORDER_GUARD && w.ordT[w.currentOrder(i)] === post
        );
      }).length;
    play(sim, 200);
    expect(guardsOn(camp)).toBe(plan.garrisonMinFighters);
    expect(guardsOn(b)).toBe(Math.ceil(6 / RULES.guardModeSlavesPerGuard));
    play(sim, 600);
    for (const g of groups(sim))
      expect(g.guards, JSON.stringify(g)).toBeGreaterThanOrEqual(g.guardsNeeded);
    expect(escaped(sim, ids)).toBe(0);
    // the node's slaves gone: its guards are released for the army
    for (const id of ids) sim.destroyEntity(id);
    play(sim, 3);
    expect(guardsOn(b)).toBe(0);
  });
});

describe('the guard rule: determinism', () => {
  it('serialize while a group is short and deserialize: the same escapes and hashes after', () => {
    const run = (): { sim: Sim; ids: number[] } => {
      const { sim, b, kooiB } = arena(7);
      const ids = slavesAt(sim, 5, b, kooiB);
      const g = spawn(sim, PLUNDERAAR, 0, NODE_B.x + 4, NODE_B.y);
      now(sim, 0, 'Guard', { ids: [g], targetId: b });
      slavesAt(sim, 3, b, kooiB); // 8 slaves: 2 needed
      play(sim, 300);
      return { sim, ids };
    };
    const one = run();
    const two = run();
    const copy = deserialize(one.sim.serialize(), envOf(testInit(7, guardMap(), PLAYERS)));
    for (let n = 0; n < RULES.graceTicks; n++) {
      for (const s of [one.sim, two.sim, copy]) play(s, 1);
      expect(copy.hash()).toBe(one.sim.hash());
      expect(two.sim.hash()).toBe(one.sim.hash());
    }
    expect(escaped(one.sim, one.ids)).toBeGreaterThan(0);
  });
});
