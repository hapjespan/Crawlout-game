import { describe, expect, it } from 'vitest';
import { EVENT_TYPE } from '@crawlout/protocol';
import type { CommandEnvelope } from '@crawlout/protocol';
import { ORDER_BUILD, ORDER_NONE, createSim } from '../src/index.js';
import type { Sim } from '../src/index.js';
import { cellCenter, createOpenMap } from '../src/testing.js';
import {
  BUILDER,
  CONFIG,
  MILITIA,
  SCAV,
  bundle,
  cmd,
  emptySim,
  testInit,
  typeByKey,
} from './helpers.js';

// The bouwrobot (data 0.26.0, sim 0.21.0; voorstel, ter bevestiging door de architect): a robot with canBuild builds
// like the human bouwer (Build, help at a site, resume a site), stays a robot (no bed, robot pop, a technician covers
// it and it is none itself, never retrained) and builds at its robot rate without a technician.

const BOT = typeByKey('bouwrobot');
const GUARD = typeByKey('beveiligingsrobot');
const TECHNICUS = typeByKey('technicus');
const WONING = typeByKey('woning');
const WERKPLAATS = typeByKey('werkplaats');
const woning = CONFIG.buildingTypes.find((b) => b.typeId === WONING)!;
const unitType = (typeId: number) => CONFIG.unitTypes.find((u) => u.typeId === typeId)!;
const rules = CONFIG.factions[0]!.robotRules!;
const RADIUS = CONFIG.builderAutoHelpRadius;

function play(
  sim: Sim,
  frames: number,
  cmds: CommandEnvelope[] = [],
): { type: number; a: number }[] {
  const events: { type: number; a: number }[] = [];
  for (let n = 0; n < frames; n++) {
    sim.applyBundle(bundle(sim.frame, n === 0 ? cmds : []));
    sim.tick();
    for (let k = 0; k < sim.events.count; k++)
      events.push({ type: sim.events.type[k]!, a: sim.events.a[k]! });
  }
  return events;
}
const send = (sim: Sim, type: CommandEnvelope['type'], payload: unknown) =>
  play(sim, 1, [cmd(sim.frame, 0, type, payload)]);
const open = (): Sim => emptySim(1, createOpenMap(64, 64));
const rate = (sim: Sim, id: number): number =>
  sim.robotRates.any ? sim.robotRates.rate[sim.world.resolve(id)]! : 1000;

describe('bouwrobot: data', () => {
  it('is a robot with canBuild, produced in the robot factory, that cannot fight', () => {
    const t = unitType(BOT);
    expect(t.canBuild).toBe(true);
    expect(t.producedAtTypeId).toBe(typeByKey('robotfabriek'));
    expect(t.damage).toBe(0);
    expect(t.maxHp).toBeGreaterThan(unitType(BUILDER).maxHp);
    // no other type has canBuild: the human builders build through their role
    expect(CONFIG.unitTypes.filter((u) => u.canBuild).map((u) => u.typeId)).toEqual([BOT]);
  });
});

describe('bouwrobot: builds like the bouwer', () => {
  it('Build places a site next to the base and the robot builds it to the end, as fast as a bouwer', () => {
    const sim = createSim(testInit(2));
    // the start builder of player 0 covers the robot as a technician; move him out of the way first
    const builder = sim
      .entityIds()
      .find((id) => sim.getUnit(id)!.typeId === BUILDER && sim.getUnit(id)!.owner === 0)!;
    const bot = sim.spawnUnit({ typeId: BOT, owner: 0, ...cellCenter(14, 12) });
    send(sim, 'Stop', { ids: [builder] });
    const ev = send(sim, 'Build', { ids: [bot], typeId: WONING, ...cellCenter(16, 14) });
    const site = ev.find((e) => e.type === EVENT_TYPE.buildingPlaced)?.a;
    expect(site).toBeDefined();
    expect(sim.getUnit(bot)).toMatchObject({
      order: ORDER_BUILD,
      orderTarget: site,
      resumeSite: site,
    });
    // work starts once he is in reach; from then on one tick of progress per tick, like a human
    for (let n = 0; n < 600 && sim.getUnit(site!)!.progress === 0; n++) play(sim, 1);
    const p0 = sim.getUnit(site!)!.progress;
    play(sim, 10);
    expect(sim.getUnit(site!)!.progress - p0).toBe(10 * 1000);
    const done = play(sim, woning.buildTicks + 50);
    expect(done.some((e) => e.type === EVENT_TYPE.buildingDone && e.a === site)).toBe(true);
    expect(sim.getUnit(bot)).toMatchObject({ order: ORDER_NONE, resumeSite: 0 });
  });

  it('helps at an own site within builderAutoHelpRadius and resumes it after a Move', () => {
    const sim = open();
    sim.spawnUnit({ typeId: TECHNICUS, owner: 0, ...cellCenter(4, 60) });
    const site = sim.spawnBuilding(WONING, 0, 20, 20, false);
    const bot = sim.spawnUnit({ typeId: BOT, owner: 0, ...cellCenter(18, 34) });
    play(sim, 2);
    expect(sim.getUnit(bot)).toMatchObject({
      order: ORDER_BUILD,
      orderTarget: site,
      resumeSite: site,
    });
    // far away (beyond the help radius) he still comes back: resuming, not helping
    send(sim, 'Move', { ids: [bot], ...cellCenter(58, 58) });
    expect(sim.getUnit(bot)!.resumeSite).toBe(site);
    for (let n = 0; n < 1200 && sim.getUnit(bot)!.order !== ORDER_BUILD; n++) play(sim, 1);
    const b = sim.getUnit(bot)!;
    const s = sim.getUnit(site)!;
    expect(Math.hypot(b.x - s.x, b.y - s.y)).toBeGreaterThan(RADIUS);
    expect(b).toMatchObject({ order: ORDER_BUILD, orderTarget: site });
  });

  it('a guard robot or a scavenger does not build', () => {
    const sim = open();
    const guard = sim.spawnUnit({ typeId: GUARD, owner: 0, ...cellCenter(18, 34) });
    const scav = sim.spawnUnit({ typeId: SCAV, owner: 0, ...cellCenter(20, 34) });
    const site = sim.spawnBuilding(WONING, 0, 20, 20, false);
    play(sim, 2);
    const { x, y } = sim.getUnit(site)!;
    send(sim, 'Build', { ids: [guard, scav], typeId: WONING, x, y });
    expect(sim.getUnit(guard)!.order).toBe(ORDER_NONE);
    expect(sim.getUnit(scav)!.order).not.toBe(ORDER_BUILD);
    // the same command with the bouwrobot added: only he goes to help
    const bot = sim.spawnUnit({ typeId: BOT, owner: 0, ...cellCenter(58, 58) });
    send(sim, 'Build', { ids: [guard, scav, bot], typeId: WONING, x, y });
    expect(sim.getUnit(bot)).toMatchObject({ order: ORDER_BUILD, orderTarget: site });
    expect(sim.getUnit(guard)!.order).toBe(ORDER_NONE);
  });
});

describe('bouwrobot: a robot (technician rule, pop, no retraining)', () => {
  it('needs a technician and is none itself; uncovered it builds at the robot rate', () => {
    const sim = open();
    const bot = sim.spawnUnit({ typeId: BOT, owner: 0, ...cellCenter(10, 10) });
    const guard = sim.spawnUnit({ typeId: GUARD, owner: 0, ...cellCenter(14, 10) });
    play(sim, 1);
    // the bouwrobot does not cover the guard, nor itself
    expect(rate(sim, bot)).toBe(1000 - rules.penaltyPermille);
    expect(rate(sim, guard)).toBe(1000 - rules.penaltyPermille);
    expect(sim.playerStatus(0).robotPop).toBe(unitType(BOT).popCost + unitType(GUARD).popCost);
    expect(sim.playerStatus(0).settlers).toBe(0);
    // uncovered: half the progress per tick
    const site = sim.spawnBuilding(WONING, 0, 8, 14, false);
    for (let n = 0; n < 400 && sim.getUnit(site)!.progress === 0; n++) play(sim, 1);
    const p0 = sim.getUnit(site)!.progress;
    play(sim, 10);
    expect(sim.getUnit(site)!.progress - p0).toBe(10 * (1000 - rules.penaltyPermille));
    // one technician covers both (lowest id first), then full rate
    sim.spawnUnit({ typeId: TECHNICUS, owner: 0, ...cellCenter(40, 40) });
    play(sim, 1);
    expect(rate(sim, bot)).toBe(1000);
    expect(rate(sim, guard)).toBe(1000);
    const p1 = sim.getUnit(site)!.progress;
    play(sim, 10);
    expect(sim.getUnit(site)!.progress - p1).toBe(10 * 1000);
  });

  it('can not be retrained: SetRole and Craft leave him a bouwrobot', () => {
    const sim = open();
    sim.spawnBuilding(WERKPLAATS, 0, 20, 20, true);
    sim.setScrap(0, 1000);
    const bot = sim.spawnUnit({ typeId: BOT, owner: 0, ...cellCenter(18, 18) });
    send(sim, 'SetRole', { ids: [bot], role: 'militia' });
    send(sim, 'SetRole', { ids: [bot], role: 'builder' });
    send(sim, 'Craft', { ids: [bot], loadoutId: unitType(MILITIA).loadoutId });
    expect(sim.getUnit(bot)!.order).toBe(ORDER_NONE);
    play(sim, 200);
    expect(sim.getUnit(bot)!.typeId).toBe(BOT);
    expect(sim.playerStatus(0).scrap).toBe(1000);
    // and no human can be crafted into one (it is produced in the factory)
    const scav = sim.spawnUnit({ typeId: SCAV, owner: 0, ...cellCenter(18, 19) });
    send(sim, 'Craft', { ids: [scav], loadoutId: unitType(BOT).loadoutId });
    expect(sim.getUnit(scav)!.order).toBe(ORDER_NONE);
  });
});
