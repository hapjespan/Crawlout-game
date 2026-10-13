import { describe, expect, it } from 'vitest';
import { CLAIM_POINT_TYPE_ID, SCRAP_NODE_TYPE_ID, unitTypeId } from '@crawlout/data';
import { ANIM, ENTITY_FLAG, EVENT_TYPE, readSnapshotHeader, snapshotLayout } from '@crawlout/protocol';
import type { CommandEnvelope } from '@crawlout/protocol';
import { NEUTRAL, ORDER_CRAFT, ORDER_GATHER, createSim, createSimWorkerCore, deserialize } from '../src/index.js';
import type { Sim, SimWorkerOutbound } from '../src/index.js';
import { cellCenter, createOpenMap, createTestMap, testPlayers } from '../src/testing.js';
import { BUILDER, CONFIG, DATA, MILITIA, SCAV, bundle, cmd, emptySim, envOf, runFrames, testInit, typeByKey } from './helpers.js';

const WONING = typeByKey('woning');
const WERKPLAATS = typeByKey('werkplaats');
const HQ = typeByKey('hoofdgebouw');
const scavType = CONFIG.unitTypes.find((u) => u.typeId === SCAV)!;
const milType = CONFIG.unitTypes.find((u) => u.typeId === MILITIA)!;

/** Draait ticks met een vaste commandolijst per frame en verzamelt alle events. */
function play(sim: Sim, frames: number, script: Map<number, CommandEnvelope[]> = new Map()): { type: number; a: number; b: number }[] {
  const events: { type: number; a: number; b: number }[] = [];
  for (let n = 0; n < frames; n++) {
    const f = sim.frame;
    sim.applyBundle(bundle(f, script.get(f) ?? []));
    sim.tick();
    for (let k = 0; k < sim.events.count; k++) events.push({ type: sim.events.type[k]!, a: sim.events.a[k]!, b: sim.events.b[k]! });
  }
  return events;
}

const at = (frame: number, ...cmds: CommandEnvelope[]): Map<number, CommandEnvelope[]> => new Map([[frame, cmds]]);
const kindOf = (sim: Sim, kind: string): number[] => sim.entityIds().filter((id) => sim.getUnit(id)!.kind === kind);

describe('startopstelling', () => {
  it('zet nodes, claimpunten, per speler hoofdgebouw en startunits in vaste id-volgorde, plus startScrap', () => {
    const sim = createSim(testInit(5));
    const map = createTestMap();
    const views = sim.entityIds().map((id) => sim.getUnit(id)!);
    const nodes = map.scrapNodes.length;
    const claims = map.claimPoints.length;
    expect(views.slice(0, nodes).every((v) => v.typeId === SCRAP_NODE_TYPE_ID && v.owner === NEUTRAL)).toBe(true);
    expect(views.slice(nodes, nodes + claims).every((v) => v.typeId === CLAIM_POINT_TYPE_ID && v.owner === NEUTRAL)).toBe(true);
    const faction = DATA.factions[0]!;
    const perPlayer = 1 + faction.startUnits.reduce((n, u) => n + u.count, 0);
    for (let p = 0; p < 2; p++) {
      const block = views.slice(nodes + claims + p * perPlayer, nodes + claims + (p + 1) * perPlayer);
      expect(block[0]).toMatchObject({ kind: 'building', typeId: HQ, owner: p, buildState: 2 });
      const spawn = map.spawns[p]!;
      expect(block[0]!.x >> 8).toBe(spawn.x >> 8);
      const want = faction.startUnits.flatMap((u) => Array.from({ length: u.count }, () => unitTypeId(u.loadoutId)));
      expect(block.slice(1).map((v) => v.typeId)).toEqual(want);
      expect(block.slice(1).every((v) => v.kind === 'unit' && v.owner === p)).toBe(true);
      expect(sim.playerStatus(p)).toMatchObject({ scrap: faction.startScrap, settlers: perPlayer - 1, beds: 6, popCap: 6 });
    }
    // deterministisch: zelfde invoer, zelfde hash; andere spelers, andere hash
    expect(createSim(testInit(5)).hash()).toBe(sim.hash());
    expect(createSim(testInit(5, map, testPlayers(2, true))).hash()).not.toBe(sim.hash());
  });

  it('weigert een map zonder genoeg spawns', () => {
    expect(() => createSim(testInit(1, { ...createTestMap(), spawns: [cellCenter(8, 8)] }))).toThrow(/spawns/);
  });
});

describe('economie', () => {
  it('scavengers verzamelen per rit gatherAmount en leveren af bij het hoofdgebouw', () => {
    const map = createTestMap();
    // een node naast het hoofdgebouw
    const s2 = createSim(testInit(1, { ...map, scrapNodes: [{ ...cellCenter(14, 8), amount: 25 }] }));
    const n = kindOf(s2, 'scrapNode')[0]!;
    const scavs = s2.entityIds().filter((id) => {
      const u = s2.getUnit(id)!;
      return u.kind === 'unit' && u.owner === 0 && u.typeId === SCAV;
    });
    const before = s2.playerStatus(0).scrap;
    const ev = play(s2, 600, at(0, cmd(0, 0, 'Gather', { ids: scavs.slice(0, 2), nodeId: n })));
    // 25 scrap: twee ritten van 10 en een rest van 5, daarna is de node op
    expect(s2.playerStatus(0).scrap).toBe(before + 25);
    expect(s2.getUnit(n)).toBeNull();
    expect(ev.filter((e) => e.type === EVENT_TYPE.resourceDepleted)).toEqual([{ type: EVENT_TYPE.resourceDepleted, a: n, b: 0 }]);
    // zonder nodes in de map zijn de scavengers klaar
    const left = scavs.slice(0, 2).map((id) => s2.getUnit(id)!.order);
    expect(left).toEqual([0, 0]);
    expect(scavType.gatherAmount).toBe(10);
  });

  it('een rit duurt gatherTicks en zet de unit op anim gather', () => {
    const sim = createSim(testInit(1, { ...createTestMap(), scrapNodes: [{ ...cellCenter(13, 8), amount: 500 }] }));
    const n = kindOf(sim, 'scrapNode')[0]!;
    const scav = sim.entityIds().find((id) => sim.getUnit(id)!.typeId === SCAV && sim.getUnit(id)!.owner === 0)!;
    play(sim, 1, at(0, cmd(0, 0, 'Gather', { ids: [scav], nodeId: n })));
    let first = -1;
    for (let f = 1; f < 400 && first < 0; f++) {
      play(sim, 1);
      if (sim.getUnit(scav)!.carry > 0) first = f;
    }
    expect(first).toBeGreaterThan(scavType.gatherTicks);
    expect(sim.getUnit(n)!.amount).toBe(490);
    const snapAnim = (): number => {
      const buf = sim.writeSnapshot();
      const h = readSnapshotHeader(buf);
      const L = snapshotLayout(h.entityCount, h.eventCount);
      const ids = new Uint32Array(buf, L.entity.id, h.entityCount);
      const k = Array.from(ids).indexOf(scav);
      return new Uint8Array(buf, L.entity.flags, h.entityCount)[k]!;
    };
    expect(snapAnim() & ENTITY_FLAG.carrying).toBe(ENTITY_FLAG.carrying);
  });

  it('Build: scrap betalen, bouwplaats blokkeert cellen, bouwer maakt hem af, bedden verhogen de pop-cap', () => {
    const sim = createSim(testInit(2));
    const builder = sim.entityIds().find((id) => sim.getUnit(id)!.typeId === BUILDER && sim.getUnit(id)!.owner === 0)!;
    const wt = CONFIG.buildingTypes.find((b) => b.typeId === WONING)!;
    const before = sim.playerStatus(0);
    const p = cellCenter(16, 14);
    const ev = play(sim, 1, at(0, cmd(0, 0, 'Build', { ids: [builder], typeId: WONING, x: p.x, y: p.y })));
    expect(sim.playerStatus(0).scrap).toBe(before.scrap - wt.scrapCost);
    const site = ev.find((e) => e.type === EVENT_TYPE.buildingPlaced)!.a;
    expect(sim.getUnit(site)).toMatchObject({ kind: 'building', buildState: 1, owner: 0 });
    // tweede plaatsing op dezelfde cellen (ander type) kan niet
    const scrap = sim.playerStatus(0).scrap;
    play(sim, 1, at(1, cmd(1, 0, 'Build', { ids: [builder], typeId: WERKPLAATS, x: p.x, y: p.y })));
    expect(sim.playerStatus(0).scrap).toBe(scrap);
    const done = play(sim, wt.buildTicks + 200);
    expect(done.some((e) => e.type === EVENT_TYPE.buildingDone && e.a === site)).toBe(true);
    expect(sim.getUnit(site)).toMatchObject({ buildState: 2, hp: wt.maxHp });
    expect(sim.playerStatus(0).beds).toBe(before.beds + wt.beds);
    // de bouwer is klaar
    expect(sim.getUnit(builder)!.order).toBe(0);
  });

  it('weigert Build zonder bouwer, zonder scrap, voor een hoofdgebouw of op een muur', () => {
    const sim = createSim(testInit(2));
    const scav = sim.entityIds().find((id) => sim.getUnit(id)!.typeId === SCAV && sim.getUnit(id)!.owner === 0)!;
    const builder = sim.entityIds().find((id) => sim.getUnit(id)!.typeId === BUILDER && sim.getUnit(id)!.owner === 0)!;
    const p = cellCenter(16, 14);
    const h0 = sim.hash();
    const s = sim.serialize();
    play(sim, 1, at(0,
      cmd(0, 0, 'Build', { ids: [scav], typeId: WONING, x: p.x, y: p.y }), // geen bouwer
      cmd(0, 0, 'Build', { ids: [builder], typeId: HQ, x: p.x, y: p.y }), // hoofdgebouw
      cmd(0, 0, 'Build', { ids: [builder], typeId: WONING, ...cellCenter(32, 5) }), // muur
      cmd(0, 1, 'Build', { ids: [builder], typeId: WONING, x: p.x, y: p.y }), // niet van speler 1
    ));
    const ref = deserialize(s, envOf(testInit(2)));
    expect(ref.hash()).toBe(h0);
    play(ref, 1);
    expect(sim.hash()).toBe(ref.hash());
    sim.setScrap(0, 0);
    play(sim, 1, at(1, cmd(1, 0, 'Build', { ids: [builder], typeId: WONING, x: p.x, y: p.y })));
    expect(kindOf(sim, 'building')).toHaveLength(2);
  });

  it('Cancel op een bouwplaats geeft de scrap terug en maakt de cellen vrij', () => {
    const sim = createSim(testInit(2));
    const builder = sim.entityIds().find((id) => sim.getUnit(id)!.typeId === BUILDER && sim.getUnit(id)!.owner === 0)!;
    const before = sim.playerStatus(0).scrap;
    const p = cellCenter(16, 14);
    const ev = play(sim, 1, at(0, cmd(0, 0, 'Build', { ids: [builder], typeId: WONING, x: p.x, y: p.y })));
    const site = ev.find((e) => e.type === EVENT_TYPE.buildingPlaced)!.a;
    play(sim, 1, at(1, cmd(1, 0, 'Cancel', { ids: [site] })));
    expect(sim.getUnit(site)).toBeNull();
    expect(sim.playerStatus(0).scrap).toBe(before);
    expect(sim.spawnUnit({ typeId: SCAV, owner: 0, ...p })).not.toBe(0); // cel weer begaanbaar
  });

  it('huisvesting: met vrije bedden groeit er per ticksPerMinute/housingGrowthPerMin ticks een bewoner bij het hoofdgebouw', () => {
    const sim = emptySim(3);
    sim.spawnBuilding(HQ, 0, 6, 6);
    const per = Math.ceil(CONFIG.ticksPerMinute / CONFIG.factions[0]!.housingGrowthPerMin);
    play(sim, per - 1);
    expect(sim.playerStatus(0).settlers).toBe(0);
    const ev = play(sim, 1);
    expect(sim.playerStatus(0).settlers).toBe(1);
    const spawn = ev.find((e) => e.type === EVENT_TYPE.spawn)!;
    expect(spawn.b).toBe(SCAV);
    // vol: geen groei meer
    play(sim, per * 8);
    expect(sim.playerStatus(0)).toMatchObject({ settlers: 6, pop: 6, popCap: 6 });
  });

  it('SetRole: lopen naar de werkplaats, betalen, craftTicks wachten, dan militie', () => {
    const sim = emptySim(4);
    sim.spawnBuilding(HQ, 0, 6, 6);
    sim.spawnBuilding(WERKPLAATS, 0, 20, 6);
    sim.setScrap(0, 100);
    const s = sim.spawnUnit({ typeId: SCAV, owner: 0, ...cellCenter(8, 20) });
    play(sim, 1, at(0, cmd(0, 0, 'SetRole', { ids: [s], role: 'militia' })));
    expect(sim.getUnit(s)!.order).toBe(ORDER_CRAFT);
    let switched = -1;
    for (let f = 0; f < 600 && switched < 0; f++) {
      play(sim, 1);
      if (sim.getUnit(s)!.typeId === MILITIA) switched = sim.frame;
    }
    expect(switched).toBeGreaterThan(milType.craftTicks);
    expect(sim.playerStatus(0).scrap).toBe(100 - milType.scrapCost);
    expect(sim.getUnit(s)).toMatchObject({ order: 0, role: milType.role, loadoutId: milType.loadoutId });
    // zonder werkplaats wacht een unit (en betaalt niets)
    const t = sim.spawnUnit({ typeId: SCAV, owner: 1, ...cellCenter(40, 40) });
    play(sim, 50, at(sim.frame, cmd(sim.frame, 1, 'SetRole', { ids: [t], role: 'builder' })));
    expect(sim.getUnit(t)).toMatchObject({ typeId: SCAV, order: ORDER_CRAFT });
    // Craft met een loadout met prereqTech (patrol) kan nog niet
    play(sim, 1, at(sim.frame, cmd(sim.frame, 0, 'Craft', { ids: [s], loadoutId: DATA.loadouts.find((l) => l.key === 'patrol')!.id })));
    expect(sim.getUnit(s)!.order).toBe(0);
  });
});

describe('gevecht', () => {
  it('Attack: schade maal de damage-matrix, cooldown, dood wordt een lijk en verdwijnt; events shotFired, hit, death', () => {
    const sim = emptySim(5, createOpenMap(64, 64));
    const a = sim.spawnUnit({ typeId: MILITIA, owner: 0, ...cellCenter(10, 10) });
    const b = sim.spawnUnit({ typeId: SCAV, owner: 1, ...cellCenter(14, 10) });
    const ev = play(sim, 1, at(0, cmd(0, 0, 'Attack', { ids: [a], target: b })));
    const dmg = Math.trunc((milType.damage * CONFIG.damageMatrix[milType.damageType]![scavType.armorType]!) / 1000);
    expect(ev.filter((e) => e.type === EVENT_TYPE.shotFired)).toEqual([{ type: EVENT_TYPE.shotFired, a, b }]);
    expect(ev.filter((e) => e.type === EVENT_TYPE.hit)).toEqual([{ type: EVENT_TYPE.hit, a: b, b: a }]);
    expect(sim.getUnit(b)!.hp).toBe(scavType.maxHp - dmg);
    // de scavenger vecht niet terug (geen militie, geen order)
    const all = play(sim, milType.cooldown * 10);
    const shots = all.filter((e) => e.type === EVENT_TYPE.shotFired);
    expect(shots.every((e) => e.a === a)).toBe(true);
    const death = all.find((e) => e.type === EVENT_TYPE.death)!;
    expect(death).toEqual({ type: EVENT_TYPE.death, a: b, b: SCAV });
    expect(shots.length + 1).toBe(Math.ceil(scavType.maxHp / dmg));
    const corpse = sim.getUnit(b);
    if (CONFIG.corpseTicks > 0 && corpse !== null) expect(corpse.kind).toBe('corpse');
    play(sim, CONFIG.corpseTicks + 1);
    expect(sim.getUnit(b)).toBeNull();
    expect(sim.getUnit(a)!.order).toBe(0);
  });

  it('militie zonder order kiest zelf een doel binnen aggroRange; buiten bereik niet', () => {
    const sim = emptySim(6, createOpenMap(64, 64));
    const far = Math.floor(CONFIG.aggroRange / 256) + 3;
    const a = sim.spawnUnit({ typeId: MILITIA, owner: 0, ...cellCenter(10, 10) });
    const b = sim.spawnUnit({ typeId: SCAV, owner: 1, ...cellCenter(10 + far, 10) });
    play(sim, 20);
    expect(sim.getUnit(b)!.hp).toBe(scavType.maxHp);
    play(sim, 1, at(sim.frame, cmd(sim.frame, 1, 'Move', { ids: [b], ...cellCenter(14, 10) })));
    play(sim, 60);
    expect(sim.getUnit(b)!.hp).toBeLessThan(scavType.maxHp);
    expect(sim.getUnit(a)!.target).toBe(b);
  });

  it('AttackMove: onderweg vechten, daarna doorlopen naar het punt', () => {
    const sim = emptySim(7, createOpenMap(64, 64));
    const a = [0, 1, 2].map((k) => sim.spawnUnit({ typeId: MILITIA, owner: 0, ...cellCenter(5, 10 + k) }));
    const b = sim.spawnUnit({ typeId: SCAV, owner: 1, ...cellCenter(25, 11) });
    const goal = cellCenter(50, 11);
    play(sim, 1, at(0, cmd(0, 0, 'AttackMove', { ids: a, ...goal })));
    play(sim, 900);
    expect(sim.getUnit(b) === null || sim.getUnit(b)!.kind === 'corpse').toBe(true);
    for (const id of a) {
      const u = sim.getUnit(id)!;
      expect(u.order).toBe(0);
      expect(Math.hypot(u.x - goal.x, u.y - goal.y)).toBeLessThan(3 * 256);
    }
  });

  it('gelijktijdig vuren: wie deze tick sneuvelt, schiet deze tick nog terug', () => {
    const sim = emptySim(8, createOpenMap(64, 64));
    const a = sim.spawnUnit({ typeId: MILITIA, owner: 0, ...cellCenter(10, 10) });
    const b = sim.spawnUnit({ typeId: MILITIA, owner: 1, ...cellCenter(13, 10) });
    play(sim, 400);
    // symmetrisch: beide dood in dezelfde tick
    expect(sim.getUnit(a)?.kind ?? 'weg').not.toBe('unit');
    expect(sim.getUnit(b)?.kind ?? 'weg').not.toBe('unit');
  });
});

describe('claims en winroutes', () => {
  it('Claim: na claimTicks ongestoord in de straal is het punt van de speler; een vijand in de straal pauzeert', () => {
    const sim = createSim(testInit(9, createOpenMap(64, 64)));
    const pt = kindOf(sim, 'claimPoint')[0]!;
    const view = sim.getUnit(pt)!;
    const a = sim.spawnUnit({ typeId: SCAV, owner: 0, x: view.x - 512, y: view.y });
    const ev = play(sim, CONFIG.claimTicks + 40, at(0, cmd(0, 0, 'Claim', { ids: [a], pointId: pt })));
    expect(sim.getUnit(pt)!.owner).toBe(0);
    expect(ev.filter((e) => e.type === EVENT_TYPE.claimTaken)).toEqual([{ type: EVENT_TYPE.claimTaken, a: pt, b: 0 }]);
    expect(sim.getUnit(a)!.order).toBe(0);
    // speler 1 probeert, maar speler 0 staat erbij
    const b = sim.spawnUnit({ typeId: SCAV, owner: 1, x: view.x + 512, y: view.y });
    play(sim, CONFIG.claimTicks + 40, at(sim.frame, cmd(sim.frame, 1, 'Claim', { ids: [b], pointId: pt })));
    expect(sim.getUnit(pt)!.owner).toBe(0);
    expect(sim.getUnit(pt)!.claimBy).toBe(NEUTRAL);
    // speler 0 loopt weg: speler 1 neemt het
    play(sim, CONFIG.claimTicks + 200, at(sim.frame, cmd(sim.frame, 0, 'Move', { ids: [a], ...cellCenter(5, 5) })));
    expect(sim.getUnit(pt)!.owner).toBe(1);
  });

  it('winroute B: pointsRequired punten gedurende dominance.ticks geeft de winst', () => {
    const map = { ...createOpenMap(64, 64), dominance: { pointsRequired: 1, ticks: 100 } };
    const sim = createSim(testInit(10, map));
    const pt = kindOf(sim, 'claimPoint')[0]!;
    const v = sim.getUnit(pt)!;
    const a = sim.spawnUnit({ typeId: SCAV, owner: 1, x: v.x, y: v.y + 256 });
    play(sim, 1, at(0, cmd(0, 1, 'Claim', { ids: [a], pointId: pt })));
    for (let f = 0; f < CONFIG.claimTicks + 200 && sim.winner() === null; f++) play(sim, 1);
    const w = sim.winner();
    expect(w).toMatchObject({ playerId: 1, reason: 'dominance' });
    expect(w!.frame).toBeGreaterThanOrEqual(CONFIG.claimTicks + 100 - 2); // claim op tick claimTicks-1, dan 100 ticks houden
    // de winnaar staat vast
    play(sim, 10);
    expect(sim.winner()).toEqual(w);
  });

  it('winroute A: het hoofdgebouw van de tegenstander slopen', () => {
    const sim = createSim(testInit(11, createOpenMap(64, 64)));
    const hq1 = sim.entityIds().find((id) => sim.getUnit(id)!.kind === 'building' && sim.getUnit(id)!.owner === 1)!;
    const v = sim.getUnit(hq1)!;
    const army: number[] = [];
    for (let k = 0; k < 30; k++) army.push(sim.spawnUnit({ typeId: MILITIA, owner: 0, x: v.x - 6 * 256 + (k % 6) * 128, y: v.y - 6 * 256 + Math.floor(k / 6) * 200 }));
    // de verdedigers van speler 1 eerst weg
    for (const id of sim.entityIds()) if (sim.getUnit(id)!.kind === 'unit' && sim.getUnit(id)!.owner === 1) sim.destroyEntity(id);
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
    const u = sim.entityIds().find((id) => sim.getUnit(id)!.kind === 'unit' && sim.getUnit(id)!.owner === 0)!;
    const ref = deserialize(sim.serialize(), envOf(testInit(12)));
    play(sim, 1, at(1, cmd(1, 0, 'Move', { ids: [u], ...cellCenter(20, 20) })));
    play(ref, 1);
    expect(ref.hash()).toBe(sim.hash());
    expect(h).not.toBe(sim.hash());
  });
});

describe('state', () => {
  it('serialize/deserialize midden in een potje met gebouwen, bouwplaatsen, lijken en flow fields: zelfde hash, zelfde vervolg', () => {
    const init = testInit(13, createTestMap(), testPlayers(2, true));
    const sim = createSim(init);
    const builder = sim.entityIds().find((id) => sim.getUnit(id)!.typeId === BUILDER && sim.getUnit(id)!.owner === 0)!;
    const p = cellCenter(16, 14);
    play(sim, 1, at(0, cmd(0, 0, 'Build', { ids: [builder], typeId: WONING, x: p.x, y: p.y })));
    for (const stop of [40, 333, 1200]) {
      play(sim, stop - sim.frame);
      const copy = deserialize(sim.serialize(), envOf(init));
      expect(copy.hash()).toBe(sim.hash());
      expect(runFrames(copy, 300)).toEqual(runFrames(deserialize(sim.serialize(), envOf(init)), 300));
    }
  });

  it('weigert een state met andere spelers (ai-vlag in de envHash)', () => {
    const sim = createSim(testInit(14));
    expect(() => deserialize(sim.serialize(), envOf(testInit(14, createTestMap(), testPlayers(2, true))))).toThrow(/envHash/);
  });

  it('playerStatus en de query in de worker-schil', () => {
    const out: SimWorkerOutbound[] = [];
    const core = createSimWorkerCore({ post: (m) => out.push(m) });
    core.receive({ kind: 'query', playerId: 0 });
    expect(out.pop()!.kind).toBe('error');
    core.receive({ kind: 'init', init: testInit(15) });
    core.receive({ kind: 'query', playerId: 1 });
    const st = out.pop()!;
    expect(st).toEqual({
      kind: 'status',
      frame: 0,
      status: { playerId: 1, scrap: DATA.factions[0]!.startScrap, settlers: 6, pop: 6, popCap: 6, beds: 6, hero: null },
      winner: null,
    });
    core.receive({ kind: 'query', playerId: 7 });
    expect(out.pop()!.kind).toBe('error');
  });

  it('presentatie: een bouwplaats heeft anim build en animT als voortgang', () => {
    const sim = createSim(testInit(16));
    const builder = sim.entityIds().find((id) => sim.getUnit(id)!.typeId === BUILDER && sim.getUnit(id)!.owner === 0)!;
    const p = cellCenter(16, 14);
    const ev = play(sim, 200, at(0, cmd(0, 0, 'Build', { ids: [builder], typeId: WONING, x: p.x, y: p.y })));
    const site = ev.find((e) => e.type === EVENT_TYPE.buildingPlaced)!.a;
    const buf = sim.writeSnapshot();
    const h = readSnapshotHeader(buf);
    const L = snapshotLayout(h.entityCount, h.eventCount);
    const k = Array.from(new Uint32Array(buf, L.entity.id, h.entityCount)).indexOf(site);
    expect(new Uint8Array(buf, L.entity.anim, h.entityCount)[k]).toBe(ANIM.build);
    expect(new Uint16Array(buf, L.entity.animT, h.entityCount)[k]).toBeGreaterThan(0);
    expect(sim.getUnit(builder)!.order).not.toBe(ORDER_GATHER);
  });
});
