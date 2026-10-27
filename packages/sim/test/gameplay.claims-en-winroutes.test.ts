// Split from gameplay.test.ts to stay under the 5,000-token file limit.
import { describe, it, expect } from 'vitest';
import { typeByKey, CONFIG, testInit, BUILDER, SCAV, cmd, MILITIA, envOf } from './helpers.js';
import { type Sim, createSim, ORDER_GATHER, deserialize } from '../src/index.js';
import { createOpenMap, cellCenter } from '../src/testing.js';
import { EVENT_TYPE, OWNER_NEUTRAL } from '@crawlout/protocol';
import { at, kindOf, play } from './gameplay.helpers.js';

describe('claims en winroutes', () => {
  const CLAIMPAAL = typeByKey('claimpaal');
  const paal = CONFIG.buildingTypes.find((b) => b.typeId === CLAIMPAAL)!;
  const near = (sim: Sim, a: number, b: number, r: number): boolean => {
    const u = sim.getUnit(a)!;
    const v = sim.getUnit(b)!;
    return (u.x - v.x) ** 2 + (u.y - v.y) ** 2 <= r * r;
  };

  it('Claim: bouwers bouwen de claimpaal bij het punt; af is het punt van de speler, weg valt het terug', () => {
    const sim = createSim(testInit(9, createOpenMap(64, 64)));
    const pt = kindOf(sim, 'claimPoint')[0]!;
    const view = sim.getUnit(pt)!;
    const b0 = sim.spawnUnit({ typeId: BUILDER, owner: 0, x: view.x - 10 * 256, y: view.y });
    const s0 = sim.spawnUnit({ typeId: SCAV, owner: 0, x: view.x - 10 * 256, y: view.y + 256 });
    const before = sim.playerStatus(0).scrap;
    // een scavenger kan niet claimen; de bouwer zet een claimpaal binnen claimRadius neer
    let ev = play(
      sim,
      1,
      at(
        0,
        cmd(0, 0, 'Claim', { ids: [s0], pointId: pt }),
        cmd(0, 0, 'Claim', { ids: [b0], pointId: pt }),
      ),
    );
    const placed = ev.filter((e) => e.type === EVENT_TYPE.buildingPlaced);
    expect(placed).toHaveLength(1);
    const post = placed[0]!.a;
    expect(sim.getUnit(post)).toMatchObject({ typeId: CLAIMPAAL, owner: 0, buildState: 1 });
    expect(near(sim, post, pt, CONFIG.claimRadius)).toBe(true);
    expect(sim.playerStatus(0).scrap).toBe(before - paal.scrapCost);
    // tijdens de bouw: claimBy en voortgang op het punt, eigenaar nog neutraal
    ev = play(sim, 200);
    expect(sim.getUnit(pt)).toMatchObject({ owner: OWNER_NEUTRAL, claimBy: 0 });
    expect(sim.getUnit(pt)!.claimProgress).toBeGreaterThan(0);
    ev = play(sim, paal.buildTicks + 200);
    expect(sim.getUnit(post)!.buildState).toBe(2);
    expect(sim.getUnit(pt)).toMatchObject({ owner: 0, claimBy: OWNER_NEUTRAL, claimProgress: 0 });
    expect(ev.filter((e) => e.type === EVENT_TYPE.claimTaken)).toEqual([
      { type: EVENT_TYPE.claimTaken, a: pt, b: 0 },
    ]);
    // een tweede Claim op een eigen punt is ongeldig
    ev = play(sim, 1, at(sim.frame, cmd(sim.frame, 0, 'Claim', { ids: [b0], pointId: pt })));
    expect(ev.some((e) => e.type === EVENT_TYPE.buildingPlaced)).toBe(false);
    // speler 1 zet ook een paal neer: de huidige eigenaar houdt het punt
    sim.setScrap(1, 500);
    const b1 = sim.spawnUnit({ typeId: BUILDER, owner: 1, x: view.x + 10 * 256, y: view.y });
    play(
      sim,
      paal.buildTicks + 300,
      at(sim.frame, cmd(sim.frame, 1, 'Claim', { ids: [b1], pointId: pt })),
    );
    const posts = kindOf(sim, 'building').filter((id) => sim.getUnit(id)!.typeId === CLAIMPAAL);
    expect(posts.map((id) => sim.getUnit(id)!.owner).sort()).toEqual([0, 1]);
    expect(sim.getUnit(pt)!.owner).toBe(0);
    // de paal van speler 0 gaat neer: het punt gaat naar speler 1
    const army = [0, 1, 2, 3, 4, 5].map((k) =>
      sim.spawnUnit({ typeId: MILITIA, owner: 1, x: view.x - 4 * 256, y: view.y + (k - 3) * 256 }),
    );
    ev = play(sim, 1200, at(sim.frame, cmd(sim.frame, 1, 'Attack', { ids: army, target: post })));
    expect(sim.getUnit(post)).toBeNull();
    expect(sim.getUnit(pt)!.owner).toBe(1);
    expect(ev.filter((e) => e.type === EVENT_TYPE.claimTaken)).toEqual([
      { type: EVENT_TYPE.claimTaken, a: pt, b: 1 },
    ]);
  });

  it('zonder claimgebouw valt het punt terug naar neutraal (claimTaken met b = OWNER_NEUTRAL)', () => {
    const sim = createSim(testInit(19, createOpenMap(64, 64)));
    const pt = kindOf(sim, 'claimPoint')[0]!;
    const v = sim.getUnit(pt)!;
    const post = sim.spawnBuilding(CLAIMPAAL, 0, (v.x >> 8) + 2, v.y >> 8);
    play(sim, 1);
    expect(sim.getUnit(pt)!.owner).toBe(0);
    const army = [0, 1, 2, 3, 4, 5].map((k) =>
      sim.spawnUnit({ typeId: MILITIA, owner: 1, x: v.x + 6 * 256, y: v.y + (k - 3) * 256 }),
    );
    const ev = play(
      sim,
      1200,
      at(sim.frame, cmd(sim.frame, 1, 'Attack', { ids: army, target: post })),
    );
    expect(sim.getUnit(pt)!.owner).toBe(OWNER_NEUTRAL);
    expect(ev.filter((e) => e.type === EVENT_TYPE.claimTaken)).toEqual([
      { type: EVENT_TYPE.claimTaken, a: pt, b: OWNER_NEUTRAL },
    ]);
  });

  it('het hoofdgebouw is een claimbron: een punt bij de spawn is vanaf de start van de speler, zonder event', () => {
    const open = createOpenMap(64, 64);
    const map = { ...open, claimPoints: [{ ...cellCenter(13, 8), kind: 0 }] };
    const sim = createSim(testInit(20, map));
    const pt = kindOf(sim, 'claimPoint')[0]!;
    expect(sim.getUnit(pt)!.owner).toBe(0);
    expect(play(sim, 5).some((e) => e.type === EVENT_TYPE.claimTaken)).toBe(false);
  });

  it('exclusieve nodes: een node binnen exclusiveRadius van een bezet punt is alleen voor de eigenaar, ook buiten claimRadius (data 0.20.0)', () => {
    const open = createOpenMap(64, 64);
    expect(CONFIG.exclusiveRadius).toBeGreaterThan(10 * 256);
    expect(CONFIG.claimRadius).toBeLessThan(10 * 256);
    const map = {
      ...open,
      scrapNodes: [
        { ...cellCenter(42, 32), amount: 500 }, // 10 m van het punt

        { ...cellCenter(40, 50), amount: 500 },
      ],
      claimPoints: [{ ...cellCenter(32, 32), kind: 0 }],
    };
    const sim = createSim(testInit(21, map));
    const [excl, free] = kindOf(sim, 'scrapNode');
    const pt = kindOf(sim, 'claimPoint')[0]!;
    sim.spawnBuilding(CLAIMPAAL, 0, 30, 32);
    play(sim, 1);
    expect(sim.getUnit(pt)!.owner).toBe(0);
    const s1 = sim.spawnUnit({ typeId: SCAV, owner: 1, ...cellCenter(36, 34) });
    const s0 = sim.spawnUnit({ typeId: SCAV, owner: 0, ...cellCenter(36, 30) });
    play(
      sim,
      1,
      at(
        sim.frame,
        cmd(sim.frame, 1, 'Gather', { ids: [s1], nodeId: excl! }),
        cmd(sim.frame, 0, 'Gather', { ids: [s0], nodeId: excl! }),
      ),
    );
    play(sim, 400);
    // speler 0 haalt er scrap; de scavenger van speler 1 is omgeleid naar de vrije node
    expect(sim.getUnit(excl!)!.amount).toBeLessThan(500);
    expect(sim.getUnit(free!)!.amount).toBeLessThan(500);
    expect(sim.getUnit(s1)!.order).toBe(ORDER_GATHER);
    expect(sim.getUnit(s1)!.orderTarget).toBe(free);
  });

  it('winroute B: pointsRequired punten gedurende dominance.ticks geeft de winst', () => {
    const map = { ...createOpenMap(64, 64), dominance: { pointsRequired: 1, ticks: 100 } };
    const sim = createSim(testInit(10, map));
    const pt = kindOf(sim, 'claimPoint')[0]!;
    const v = sim.getUnit(pt)!;
    sim.spawnBuilding(CLAIMPAAL, 1, (v.x >> 8) + 1, v.y >> 8);
    for (let f = 0; f < 300 && sim.winner() === null; f++) play(sim, 1);
    const w = sim.winner();
    expect(w).toMatchObject({ playerId: 1, reason: 'dominance', frame: 99 });
    // de winnaar staat vast
    play(sim, 10);
    expect(sim.winner()).toEqual(w);
  });

  it('PlayerStatus.dominance (protocol 0.6.0): eigen stand en de tegenstander die het dichtst bij dominantie is', () => {
    const map = { ...createOpenMap(64, 64), dominance: { pointsRequired: 1, ticks: 100 } };
    const sim = createSim(testInit(10, map));
    const pt = kindOf(sim, 'claimPoint')[0]!;
    const v = sim.getUnit(pt)!;
    expect(sim.playerStatus(0).dominance).toEqual({
      pointsHeld: 0,
      pointsRequired: 1,
      ticksHeld: 0,
      ticksRequired: 100,
      leader: { playerId: 1, pointsHeld: 0, ticksHeld: 0 },
    });
    sim.spawnBuilding(CLAIMPAAL, 1, (v.x >> 8) + 1, v.y >> 8);
    play(sim, 40);
    const own = sim.playerStatus(1).dominance!;
    expect(own).toMatchObject({ pointsHeld: 1, ticksHeld: 40, ticksRequired: 100 });
    expect(own.leader).toEqual({ playerId: 0, pointsHeld: 0, ticksHeld: 0 });
    expect(sim.playerStatus(0).dominance!.leader).toEqual({
      playerId: 1,
      pointsHeld: 1,
      ticksHeld: sim.dominanceTicks(1),
    });
    // de query verandert de state niet
    const h = sim.hash();
    sim.playerStatus(0);
    expect(sim.hash()).toBe(h);
    // zonder tegenstander die nog meedoet: geen leider (wie opgeeft, verliest ook zijn klok)
    play(sim, 1, at(sim.frame, cmd(sim.frame, 1, 'Surrender', {})));
    expect(sim.playerStatus(0).dominance!.leader).toBeNull();
    expect(sim.playerStatus(1).dominance!.ticksHeld).toBe(0);
  });

  it('winroute A: het hoofdgebouw van de tegenstander slopen', () => {
    const sim = createSim(testInit(11, createOpenMap(64, 64)));
    const hq1 = sim
      .entityIds()
      .find((id) => sim.getUnit(id)!.kind === 'building' && sim.getUnit(id)!.owner === 1)!;
    const v = sim.getUnit(hq1)!;
    const army: number[] = [];
    for (let k = 0; k < 30; k++)
      army.push(
        sim.spawnUnit({
          typeId: MILITIA,
          owner: 0,
          x: v.x - 6 * 256 + (k % 6) * 128,
          y: v.y - 6 * 256 + Math.floor(k / 6) * 200,
        }),
      );
    // de verdedigers van speler 1 eerst weg
    for (const id of sim.entityIds())
      if (sim.getUnit(id)!.kind === 'unit' && sim.getUnit(id)!.owner === 1) sim.destroyEntity(id);
    play(sim, 1, at(sim.frame, cmd(sim.frame, 0, 'Attack', { ids: army, target: hq1 })));
    for (let f = 0; f < 4000 && sim.winner() === null; f++) play(sim, 1);
    expect(sim.getUnit(hq1)).toBeNull();
    expect(sim.winner()).toMatchObject({ playerId: 0, reason: 'destruction' });
    expect(sim.isDefeated(1)).toBe(true);
  });

  it('Surrender: de andere speler wint; commando’s van wie opgaf tellen niet meer', () => {
    const sim = createSim(testInit(12));
    play(sim, 1, at(0, cmd(0, 0, 'Surrender', {})));
    expect(sim.winner()).toMatchObject({ playerId: 1, reason: 'surrender', frame: 0 });
    const h = sim.hash();
    const u = sim
      .entityIds()
      .find((id) => sim.getUnit(id)!.kind === 'unit' && sim.getUnit(id)!.owner === 0)!;
    const ref = deserialize(sim.serialize(), envOf(testInit(12)));
    play(sim, 1, at(1, cmd(1, 0, 'Move', { ids: [u], ...cellCenter(20, 20) })));
    play(ref, 1);
    expect(ref.hash()).toBe(sim.hash());
    expect(h).not.toBe(sim.hash());
  });
});
