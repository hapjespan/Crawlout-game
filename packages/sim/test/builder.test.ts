import { describe, expect, it } from 'vitest';
import { EVENT_TYPE } from '@crawlout/protocol';
import type { CommandEnvelope } from '@crawlout/protocol';
import { ORDER_BUILD, ORDER_NONE, createSim, deserialize } from '../src/index.js';
import type { Sim } from '../src/index.js';
import { cellCenter } from '../src/testing.js';
import {
  BUILDER,
  CONFIG,
  MILITIA,
  SCAV,
  bundle,
  cmd,
  emptySim,
  envOf,
  testInit,
  typeByKey,
} from './helpers.js';

// Bouwers na de speltest van Martien: hervatten na een onderbreking, Stop wist het geheugen, vrije bouwers helpen
// binnen builderAutoHelpRadius, en Build op een eigen bouwplaats (rechtsklik in de client) is helpen.

const WONING = typeByKey('woning');
const WERKPLAATS = typeByKey('werkplaats');
const woning = CONFIG.buildingTypes.find((b) => b.typeId === WONING)!;
const RADIUS = CONFIG.builderAutoHelpRadius;

function play(
  sim: Sim,
  frames: number,
  script: Map<number, CommandEnvelope[]> = new Map(),
): { type: number; a: number }[] {
  const events: { type: number; a: number }[] = [];
  for (let n = 0; n < frames; n++) {
    const f = sim.frame;
    sim.applyBundle(bundle(f, script.get(f) ?? []));
    sim.tick();
    for (let k = 0; k < sim.events.count; k++)
      events.push({ type: sim.events.type[k]!, a: sim.events.a[k]! });
  }
  return events;
}

/** Eén commando, uitgevoerd in de volgende tick. */
function send(
  sim: Sim,
  type: CommandEnvelope['type'],
  payload: unknown,
  playerId = 0,
): { type: number; a: number }[] {
  return play(sim, 1, new Map([[sim.frame, [cmd(sim.frame, playerId, type, payload)]]]));
}

/** Tikt tot `done` waar is (hoogstens `max` ticks); geeft het aantal ticks. */
function until(sim: Sim, max: number, done: () => boolean): number {
  for (let n = 1; n <= max; n++) {
    play(sim, 1);
    if (done()) return n;
  }
  throw new Error(`niet binnen ${max} ticks`);
}

const builderOf = (sim: Sim, p = 0): number =>
  sim
    .entityIds()
    .find((id) => sim.getUnit(id)!.typeId === BUILDER && sim.getUnit(id)!.owner === p)!;

/** Volledige sim met een woning in aanbouw bij (16, 14) waar de startbouwer van speler 0 al even aan werkt. */
function siteInProgress(): { sim: Sim; builder: number; site: number } {
  const sim = createSim(testInit(2));
  const builder = builderOf(sim);
  const p = cellCenter(16, 14);
  const ev = send(sim, 'Build', { ids: [builder], typeId: WONING, ...p });
  const site = ev.find((e) => e.type === EVENT_TYPE.buildingPlaced)!.a;
  until(sim, 400, () => sim.getUnit(site)!.progress > 0);
  play(sim, 20);
  return { sim, builder, site };
}

const dist = (sim: Sim, a: number, b: number): number => {
  const u = sim.getUnit(a)!;
  const v = sim.getUnit(b)!;
  return Math.hypot(u.x - v.x, u.y - v.y);
};

describe('bouwer hervat zijn bouwplaats', () => {
  it('na een Move naar elders (verder dan de hulpstraal) loopt hij zonder taak terug en bouwt de plaats af', () => {
    const { sim, builder, site } = siteInProgress();
    expect(sim.getUnit(builder)).toMatchObject({
      order: ORDER_BUILD,
      orderTarget: site,
      resumeSite: site,
    });
    send(sim, 'Move', { ids: [builder], ...cellCenter(24, 30) });
    expect(sim.getUnit(builder)).toMatchObject({ order: 1, resumeSite: site }); // ORDER_MOVE, geheugen blijft
    const progress = sim.getUnit(site)!.progress;
    until(sim, 600, () => sim.getUnit(builder)!.order !== 1);
    // aangekomen ver buiten de hulpstraal: het is hervatten, geen helpen
    expect(dist(sim, builder, site)).toBeGreaterThan(RADIUS + 3 * 256);
    expect(sim.getUnit(site)!.progress).toBe(progress);
    play(sim, 2);
    expect(sim.getUnit(builder)).toMatchObject({ order: ORDER_BUILD, orderTarget: site });
    const ev = play(sim, woning.buildTicks + 600);
    expect(ev.some((e) => e.type === EVENT_TYPE.buildingDone && e.a === site)).toBe(true);
    expect(sim.getUnit(builder)).toMatchObject({ order: ORDER_NONE, resumeSite: 0 });
  });

  it('na AttackMove en een Attack waarvan het doel verdwijnt hervat hij ook', () => {
    const { sim, builder, site } = siteInProgress();
    const bt = CONFIG.unitTypes.find((u) => u.typeId === BUILDER)!;
    if (bt.damage > 0) {
      const enemy = sim.spawnUnit({ typeId: SCAV, owner: 1, ...cellCenter(20, 24) });
      send(sim, 'Attack', { ids: [builder], target: enemy });
      expect(sim.getUnit(builder)!.order).toBe(3); // ORDER_ATTACK
      sim.destroyEntity(enemy);
      play(sim, 3);
      expect(sim.getUnit(builder)).toMatchObject({ order: ORDER_BUILD, orderTarget: site });
    }
    send(sim, 'AttackMove', { ids: [builder], ...cellCenter(24, 26) });
    until(sim, 600, () => sim.getUnit(builder)!.order === ORDER_BUILD);
    expect(sim.getUnit(builder)!.orderTarget).toBe(site);
  });

  it('Stop wist het geheugen: hij hervat niet en helpt ook niet vanzelf, tot een nieuw bevel', () => {
    const { sim, builder, site } = siteInProgress();
    send(sim, 'Stop', { ids: [builder] });
    expect(sim.getUnit(builder)).toMatchObject({ order: ORDER_NONE, resumeSite: 0 });
    const progress = sim.getUnit(site)!.progress;
    play(sim, 200);
    // de plaats ligt binnen de hulpstraal, toch blijft hij staan
    expect(dist(sim, builder, site)).toBeLessThan(RADIUS);
    expect(sim.getUnit(builder)).toMatchObject({ order: ORDER_NONE, resumeSite: 0 });
    expect(sim.getUnit(site)!.progress).toBe(progress);
    // een nieuw bevel (Move vlak bij) heft de Stop op: daarna helpt hij weer vanzelf (binnen de straal)
    const b = sim.getUnit(builder)!;
    send(sim, 'Move', { ids: [builder], x: b.x + 256, y: b.y });
    until(sim, 200, () => sim.getUnit(builder)!.order === ORDER_BUILD);
    expect(sim.getUnit(builder)).toMatchObject({ orderTarget: site, resumeSite: site });
  });

  it('Cancel op de unit werkt als Stop', () => {
    const { sim, builder } = siteInProgress();
    send(sim, 'Cancel', { ids: [builder] });
    play(sim, 50);
    expect(sim.getUnit(builder)).toMatchObject({ order: ORDER_NONE, resumeSite: 0 });
  });

  it('een nieuw bouwbevel overschrijft het geheugen; na de nieuwe plaats en een Move gaat hij niet terug naar de oude buiten de straal', () => {
    const { sim, builder, site } = siteInProgress();
    const ev = send(sim, 'Build', { ids: [builder], typeId: WONING, ...cellCenter(14, 40) });
    const second = ev.find((e) => e.type === EVENT_TYPE.buildingPlaced)!.a;
    expect(sim.getUnit(builder)).toMatchObject({
      order: ORDER_BUILD,
      orderTarget: second,
      resumeSite: second,
    });
    send(sim, 'Move', { ids: [builder], ...cellCenter(8, 50) });
    until(sim, 600, () => sim.getUnit(builder)!.order === ORDER_BUILD);
    expect(sim.getUnit(builder)!.orderTarget).toBe(second);
    const done = play(sim, woning.buildTicks + 400);
    expect(done.some((e) => e.type === EVENT_TYPE.buildingDone && e.a === second)).toBe(true);
    // de eerste plaats ligt ver buiten de straal en is vergeten
    expect(sim.getUnit(site)!.buildState).toBe(1);
    expect(sim.getUnit(builder)).toMatchObject({ order: ORDER_NONE, resumeSite: 0 });
  });

  it('Cancel van de bouwplaats: geen hervatten', () => {
    const { sim, builder, site } = siteInProgress();
    send(sim, 'Move', { ids: [builder], ...cellCenter(24, 30) });
    send(sim, 'Cancel', { ids: [site] });
    expect(sim.getUnit(site)).toBeNull();
    until(sim, 600, () => sim.getUnit(builder)!.order === ORDER_NONE);
    play(sim, 20);
    expect(sim.getUnit(builder)).toMatchObject({ order: ORDER_NONE, resumeSite: 0 });
  });

  it('een bouwer die omgeschoold wordt tot militie vergeet zijn plaats', () => {
    const sim = emptySim(3);
    sim.spawnBuilding(WERKPLAATS, 0, 10, 20, true);
    const site = sim.spawnBuilding(WONING, 0, 20, 20, false);
    const b = sim.spawnUnit({ typeId: BUILDER, owner: 0, ...cellCenter(18, 24) });
    sim.setScrap(0, 1000);
    send(sim, 'Build', { ids: [b], typeId: WONING, ...cellCenter(21, 21) });
    expect(sim.getUnit(b)!.resumeSite).toBe(site);
    send(sim, 'SetRole', { ids: [b], role: 'militia' });
    until(sim, 1000, () => sim.getUnit(b)!.typeId === MILITIA);
    play(sim, 2);
    expect(sim.getUnit(b)).toMatchObject({ order: ORDER_NONE, resumeSite: 0 });
  });
});

describe('vrije bouwers helpen binnen builderAutoHelpRadius', () => {
  it('pakt de dichtstbijzijnde eigen bouwplaats op, tiebreak laagste id, niet daarbuiten en niet van een ander', () => {
    expect(RADIUS).toBe(12 * 256);
    const sim = emptySim(5);
    // gelijke afstand (1153 eenheden tot de rand) links en onder: laagste id wint; een vijandelijke plaats dichterbij telt niet
    const b = sim.spawnUnit({ typeId: BUILDER, owner: 0, x: 4224, y: 7807 });
    const left = sim.spawnBuilding(WONING, 0, 10, 30, false);
    const below = sim.spawnBuilding(WONING, 0, 16, 35, false);
    sim.spawnBuilding(WONING, 1, 19, 30, false);
    expect(left).toBeLessThan(below);
    play(sim, 1);
    expect(sim.getUnit(b)).toMatchObject({
      order: ORDER_BUILD,
      orderTarget: left,
      resumeSite: left,
    });
    // omgekeerde spawnvolgorde: weer de laagste id
    const simR = emptySim(5);
    const bR = simR.spawnUnit({ typeId: BUILDER, owner: 0, x: 4224, y: 7807 });
    const belowR = simR.spawnBuilding(WONING, 0, 16, 35, false);
    simR.spawnBuilding(WONING, 0, 10, 30, false);
    play(simR, 1);
    expect(simR.getUnit(bR)!.orderTarget).toBe(belowR);
    // dichterbij wint van de id
    const sim2 = emptySim(5);
    const b2 = sim2.spawnUnit({ typeId: BUILDER, owner: 0, ...cellCenter(16, 30) });
    sim2.spawnBuilding(WONING, 0, 10, 30, false);
    const near = sim2.spawnBuilding(WONING, 0, 19, 30, false);
    play(sim2, 1);
    expect(sim2.getUnit(b2)!.orderTarget).toBe(near);
    // buiten de straal (rand op 14 m): niets
    const sim3 = emptySim(5);
    const b3 = sim3.spawnUnit({ typeId: BUILDER, owner: 0, ...cellCenter(10, 30) });
    sim3.spawnBuilding(WONING, 0, 25, 30, false);
    play(sim3, 30);
    expect(sim3.getUnit(b3)).toMatchObject({ order: ORDER_NONE, resumeSite: 0 });
  });

  it('plunderaars, militie en de held helpen niet; een voltooid gebouw is geen bouwplaats', () => {
    const sim = createSim(testInit(2));
    const others = sim.entityIds().filter((id) => {
      const u = sim.getUnit(id)!;
      return u.owner === 0 && (u.kind === 'hero' || (u.kind === 'unit' && u.typeId !== BUILDER));
    });
    expect(others.length).toBeGreaterThan(0);
    send(sim, 'Stop', { ids: [builderOf(sim)] }); // de startbouwer houden we erbuiten
    sim.spawnBuilding(WONING, 0, 14, 12, true);
    const site = sim.spawnBuilding(WONING, 0, 14, 4, false);
    play(sim, 50);
    for (const id of others) expect(sim.getUnit(id)!.order).toBe(ORDER_NONE);
    expect(sim.getUnit(site)!.progress).toBe(0);
  });

  it('na het afmaken pakt hij de volgende plaats in de buurt op en bouwt alles af', () => {
    const sim = emptySim(6);
    const b = sim.spawnUnit({ typeId: BUILDER, owner: 0, ...cellCenter(16, 30) });
    const s1 = sim.spawnBuilding(WONING, 0, 14, 26, false);
    const s2 = sim.spawnBuilding(WONING, 0, 20, 34, false);
    const ev = play(sim, 2 * woning.buildTicks + 400);
    const done = ev.filter((e) => e.type === EVENT_TYPE.buildingDone).map((e) => e.a);
    expect(done).toEqual([s1, s2]);
    expect(sim.getUnit(b)).toMatchObject({ order: ORDER_NONE, resumeSite: 0 });
  });
});

describe('Build op een eigen bouwplaats is helpen (rechtsklik in de client)', () => {
  it('Build met het typeId en het midden van de plaats: geen kosten, geen nieuwe plaats, dezelfde site (even en oneven footprint)', () => {
    for (const typeId of [WONING, WERKPLAATS]) {
      const sim = emptySim(7);
      const site = sim.spawnBuilding(typeId, 0, 20, 20, false);
      // buiten de hulpstraal, dus het is het bevel en geen automatisch helpen
      const b = sim.spawnUnit({ typeId: BUILDER, owner: 0, ...cellCenter(50, 50) });
      sim.setScrap(0, 500);
      const s = sim.getUnit(site)!;
      const ev = send(sim, 'Build', { ids: [b], typeId, x: s.x, y: s.y });
      expect(ev.some((e) => e.type === EVENT_TYPE.buildingPlaced)).toBe(false);
      expect(sim.playerStatus(0).scrap).toBe(500);
      expect(sim.getUnit(b)).toMatchObject({
        order: ORDER_BUILD,
        orderTarget: site,
        resumeSite: site,
      });
      const built = play(sim, 2000);
      expect(built.some((e) => e.type === EVENT_TYPE.buildingDone && e.a === site)).toBe(true);
    }
  });

  it('twee bouwers op één plaats bouwen sneller dan één', () => {
    const time = (helpers: number): number => {
      const sim = emptySim(8);
      const site = sim.spawnBuilding(WONING, 0, 20, 20, false);
      const ids = Array.from({ length: helpers }, (_, k) =>
        sim.spawnUnit({ typeId: BUILDER, owner: 0, ...cellCenter(19 + 3 * k, 18) }),
      );
      const s = sim.getUnit(site)!;
      send(sim, 'Build', { ids, typeId: WONING, x: s.x, y: s.y });
      return until(sim, 2000, () => sim.getUnit(site)!.buildState === 2);
    };
    expect(time(2)).toBeLessThan(time(1));
  });
});

describe('determinisme van het bouwgeheugen', () => {
  it('resumeSite en buildHold zitten in de hash, en serialize/deserialize halverwege een hervatting geeft dezelfde hashes', () => {
    const a = siteInProgress();
    const b = siteInProgress();
    expect(a.sim.hash()).toBe(b.sim.hash());
    send(a.sim, 'Move', { ids: [a.builder], ...cellCenter(16, 20) });
    send(b.sim, 'Move', { ids: [b.builder], ...cellCenter(16, 20) });
    play(a.sim, 5);
    play(b.sim, 5);
    expect(a.sim.hash()).toBe(b.sim.hash());
    const buf = a.sim.serialize();
    const c = deserialize(buf, envOf(testInit(2)));
    expect(c.hash()).toBe(a.sim.hash());
    const ha: number[] = [];
    const hc: number[] = [];
    for (let k = 0; k < 400; k++) {
      play(a.sim, 1);
      play(c, 1);
      ha.push(a.sim.hash());
      hc.push(c.hash());
    }
    expect(hc).toEqual(ha);
    expect(c.getUnit(a.builder)!.resumeSite).toBe(a.site);
  });

  it('alleen een ander geheugen geeft een andere hash', () => {
    const sim = emptySim(9);
    const u = sim.spawnUnit({ typeId: BUILDER, owner: 0, ...cellCenter(40, 40) });
    const site = sim.spawnBuilding(WONING, 0, 10, 10, false);
    const copy = deserialize(sim.serialize(), envOf(testInit(9)));
    expect(copy.hash()).toBe(sim.hash());
    // een Build en meteen Stop: order en positie gelijk aan een onaangeroerde unit, maar het geheugen (buildHold) niet
    const s = sim.getUnit(site)!;
    play(
      sim,
      1,
      new Map([
        [
          sim.frame,
          [
            cmd(sim.frame, 0, 'Build', { ids: [u], typeId: WONING, x: s.x, y: s.y }),
            cmd(sim.frame, 0, 'Stop', { ids: [u] }),
          ],
        ],
      ]),
    );
    play(copy, 1);
    expect(sim.getUnit(u)).toMatchObject({ order: ORDER_NONE, resumeSite: 0 });
    expect(copy.getUnit(u)).toMatchObject({ order: ORDER_NONE, resumeSite: 0 });
    expect(sim.hash()).not.toBe(copy.hash());
  });
});
