import { describe, expect, it } from 'vitest';
import { CLAIM_POINT_TYPE_ID, SCRAP_NODE_TYPE_ID, heroTypeId, unitTypeId } from '@crawlout/data';
import { ANIM, ENTITY_FLAG, EVENT_TYPE, OWNER_NEUTRAL, readSnapshotHeader, snapshotLayout } from '@crawlout/protocol';
import type { CommandEnvelope } from '@crawlout/protocol';
import { ORDER_CRAFT, ORDER_GATHER, createSim, createSimWorkerCore, deserialize } from '../src/index.js';
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
    expect(views.slice(0, nodes).every((v) => v.typeId === SCRAP_NODE_TYPE_ID && v.owner === OWNER_NEUTRAL)).toBe(true);
    expect(views.slice(nodes, nodes + claims).every((v) => v.typeId === CLAIM_POINT_TYPE_ID && v.owner === OWNER_NEUTRAL)).toBe(true);
    const faction = DATA.factions[0]!;
    const settlers = faction.startUnits.reduce((n, u) => n + u.count, 0);
    const perPlayer = 2 + settlers; // hoofdgebouw, startunits, held
    for (let p = 0; p < 2; p++) {
      const block = views.slice(nodes + claims + p * perPlayer, nodes + claims + (p + 1) * perPlayer);
      expect(block[0]).toMatchObject({ kind: 'building', typeId: HQ, owner: p, buildState: 2 });
      const spawn = map.spawns[p]!;
      expect(block[0]!.x >> 8).toBe(spawn.x >> 8);
      const want = faction.startUnits.flatMap((u) => Array.from({ length: u.count }, () => unitTypeId(u.loadoutId)));
      expect(block.slice(1, 1 + settlers).map((v) => v.typeId)).toEqual(want);
      expect(block.slice(1, 1 + settlers).every((v) => v.kind === 'unit' && v.owner === p)).toBe(true);
      expect(block[1 + settlers]).toMatchObject({ kind: 'hero', typeId: heroTypeId(DATA.heroes[0]!.id), owner: p });
      expect(sim.playerStatus(p)).toMatchObject({ scrap: faction.startScrap, settlers, beds: 6, popCap: 6 });
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
    const g = scavType.gatherAmount;
    const s2 = createSim(testInit(1, { ...map, scrapNodes: [{ ...cellCenter(14, 8), amount: 2 * g + (g >> 1) }] }));
    const n = kindOf(s2, 'scrapNode')[0]!;
    const scavs = s2.entityIds().filter((id) => {
      const u = s2.getUnit(id)!;
      return u.kind === 'unit' && u.owner === 0 && u.typeId === SCAV;
    });
    const before = s2.playerStatus(0).scrap;
    const ev = play(s2, 6 * scavType.gatherTicks, at(0, cmd(0, 0, 'Gather', { ids: scavs.slice(0, 2), nodeId: n })));
    // twee ritten van gatherAmount en een rest van de helft, daarna is de node op
    expect(s2.playerStatus(0).scrap).toBe(before + 2 * g + (g >> 1));
    expect(s2.getUnit(n)).toBeNull();
    expect(ev.filter((e) => e.type === EVENT_TYPE.resourceDepleted)).toEqual([{ type: EVENT_TYPE.resourceDepleted, a: n, b: 0 }]);
    // zonder nodes in de map zijn de scavengers klaar
    const left = scavs.slice(0, 2).map((id) => s2.getUnit(id)!.order);
    expect(left).toEqual([0, 0]);
  });

  it('een rit duurt gatherTicks en zet de unit op anim gather', () => {
    const sim = createSim(testInit(1, { ...createTestMap(), scrapNodes: [{ ...cellCenter(13, 8), amount: 500 }] }));
    const n = kindOf(sim, 'scrapNode')[0]!;
    const scav = sim.entityIds().find((id) => sim.getUnit(id)!.typeId === SCAV && sim.getUnit(id)!.owner === 0)!;
    play(sim, 1, at(0, cmd(0, 0, 'Gather', { ids: [scav], nodeId: n })));
    let first = -1;
    for (let f = 1; f < 2 * scavType.gatherTicks + 200 && first < 0; f++) {
      play(sim, 1);
      if (sim.getUnit(scav)!.carry > 0) first = f;
    }
    expect(first).toBeGreaterThan(scavType.gatherTicks);
    expect(sim.getUnit(n)!.amount).toBe(500 - scavType.gatherAmount);
    const snapAnim = (): number => {
      const buf = sim.writeSnapshot();
      const h = readSnapshotHeader(buf);
      const L = snapshotLayout(h.entityCount, h.eventCount);
      const ids = new Uint32Array(buf, L.entity.id, h.entityCount);
      const k = Array.from(ids).indexOf(scav);
      return new Uint8Array(buf, L.entity.flags, h.entityCount)[k]!;
    };
    expect(snapAnim() & ENTITY_FLAG.carrying).toBe(ENTITY_FLAG.carrying);
    // hpPct van een scrap-node is de resterende voorraad in procenten van de startvoorraad (afgerond naar beneden)
    const buf = sim.writeSnapshot();
    const h = readSnapshotHeader(buf);
    const L = snapshotLayout(h.entityCount, h.eventCount);
    const k = Array.from(new Uint32Array(buf, L.entity.id, h.entityCount)).indexOf(n);
    expect(new Uint8Array(buf, L.entity.hpPct, h.entityCount)[k]).toBe(Math.trunc(((500 - scavType.gatherAmount) * 100) / 500));
    expect(new Uint8Array(buf, L.entity.owner, h.entityCount)[k]).toBe(OWNER_NEUTRAL);
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

  it('Cancel geeft cancelRefundPermille van de prijs terug (bouwplaats en betaalde omscholing)', () => {
    const half = { ...testInit(2), config: { ...CONFIG, cancelRefundPermille: 500 } };
    const sim = createSim(half);
    const builder = sim.entityIds().find((id) => sim.getUnit(id)!.typeId === BUILDER && sim.getUnit(id)!.owner === 0)!;
    const before = sim.playerStatus(0).scrap;
    const p = cellCenter(16, 14);
    const ev = play(sim, 1, at(0, cmd(0, 0, 'Build', { ids: [builder], typeId: WONING, x: p.x, y: p.y })));
    const site = ev.find((e) => e.type === EVENT_TYPE.buildingPlaced)!.a;
    play(sim, 1, at(1, cmd(1, 0, 'Cancel', { ids: [site] })));
    const cost = CONFIG.buildingTypes.find((b) => b.typeId === WONING)!.scrapCost;
    expect(sim.playerStatus(0).scrap).toBe(before - cost + (cost >> 1));
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

describe('onderzoek en craft', () => {
  const techByKey = (key: string) => CONFIG.techs[DATA.tech.find((t) => t.key === key)!.id]!;
  const GEWEERREK = techByKey('geweerrek');
  const PANTSER = techByKey('composiet_pantser');
  const PATROL_LOADOUT = DATA.loadouts.find((l) => l.key === 'patrol')!.id;
  const TURRET = typeByKey('turret');

  it('Research: kosten meteen, researchTicks in de werkplaats, daarna ontgrendelt prereqTech loadouts en gebouwen', () => {
    const sim = createSim(testInit(30));
    sim.setScrap(0, 1000);
    const builder = sim.entityIds().find((id) => sim.getUnit(id)!.typeId === BUILDER && sim.getUnit(id)!.owner === 0)!;
    const scav = sim.entityIds().find((id) => sim.getUnit(id)!.typeId === SCAV && sim.getUnit(id)!.owner === 0)!;
    const t = cellCenter(16, 14);
    // zonder tech: geen turret en geen patrol; zonder werkplaats: geen onderzoek
    let ev = play(sim, 1, at(0, cmd(0, 0, 'Build', { ids: [builder], typeId: TURRET, ...t }), cmd(0, 0, 'Research', { techId: GEWEERREK.techId })));
    expect(ev.some((e) => e.type === EVENT_TYPE.buildingPlaced)).toBe(false);
    expect(sim.playerStatus(0).scrap).toBe(1000);
    const ws = sim.spawnBuilding(WERKPLAATS, 0, 14, 4);
    play(sim, 1, at(sim.frame, cmd(sim.frame, 0, 'Craft', { ids: [scav], loadoutId: PATROL_LOADOUT })));
    expect(sim.getUnit(scav)!.order).toBe(0);
    // een tech met een onvervulde prereqTech kan niet
    play(sim, 1, at(sim.frame, cmd(sim.frame, 0, 'Research', { techId: PANTSER.techId })));
    expect(sim.playerStatus(0).scrap).toBe(1000);
    play(sim, 1, at(sim.frame, cmd(sim.frame, 0, 'Research', { techId: GEWEERREK.techId }), cmd(sim.frame, 0, 'Research', { techId: GEWEERREK.techId })));
    expect(sim.playerStatus(0).scrap).toBe(1000 - GEWEERREK.scrapCost);
    expect(sim.researched(0)).toEqual([]);
    play(sim, GEWEERREK.researchTicks - 1);
    expect(sim.researched(0)).toEqual([GEWEERREK.techId]);
    expect(sim.getUnit(ws)!.buildState).toBe(2);
    ev = play(sim, 1, at(sim.frame, cmd(sim.frame, 0, 'Build', { ids: [builder], typeId: TURRET, ...t })));
    expect(ev.some((e) => e.type === EVENT_TYPE.buildingPlaced && e.b === TURRET)).toBe(true);
    play(sim, 1, at(sim.frame, cmd(sim.frame, 0, 'Craft', { ids: [scav], loadoutId: PATROL_LOADOUT })));
    expect(sim.getUnit(scav)!.order).toBe(ORDER_CRAFT);
    // speler 1 heeft de tech niet
    expect(sim.researched(1)).toEqual([]);
  });

  it('PlayerStatus.queue: lopend onderzoek en omscholen met voortgang in promille', () => {
    const sim = emptySim(32);
    const ws = sim.spawnBuilding(WERKPLAATS, 0, 14, 4);
    sim.setScrap(0, 1000);
    const scav = sim.spawnUnit({ typeId: SCAV, owner: 0, ...cellCenter(13, 5) });
    expect(sim.playerStatus(0).queue).toEqual([]);
    play(sim, 1, at(0, cmd(0, 0, 'Research', { techId: GEWEERREK.techId }), cmd(0, 0, 'Craft', { ids: [scav], loadoutId: PATROL_LOADOUT })));
    // patrol vraagt geweerrek: alleen het onderzoek loopt
    let q = sim.playerStatus(0).queue!;
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ kind: 'research', buildingId: ws, id: GEWEERREK.techId });
    expect(q[0]!.progressPermille).toBeLessThan(10); // één tick werk in het frame van het commando
    play(sim, GEWEERREK.researchTicks >> 1);
    q = sim.playerStatus(0).queue!;
    expect(q[0]!.progressPermille).toBeGreaterThan(400);
    expect(q[0]!.progressPermille).toBeLessThan(600);
    play(sim, GEWEERREK.researchTicks);
    expect(sim.playerStatus(0).queue).toEqual([]);
    const patrol = CONFIG.unitTypes.find((u) => u.loadoutId === PATROL_LOADOUT)!;
    play(sim, 1, at(sim.frame, cmd(sim.frame, 0, 'Craft', { ids: [scav], loadoutId: PATROL_LOADOUT })));
    play(sim, 40);
    q = sim.playerStatus(0).queue!;
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ kind: 'craft', buildingId: ws, id: PATROL_LOADOUT });
    expect(q[0]!.progressPermille).toBeGreaterThan(0);
    play(sim, patrol.craftTicks);
    expect(sim.playerStatus(0).queue).toEqual([]);
    expect(sim.getUnit(scav)!.typeId).toBe(patrol.typeId);
  });

  it('tech-effecten: hpPct op militie verhoogt maxHp en hp van bestaande en nieuwe units; Cancel stopt onderzoek met teruggave', () => {
    const sim = emptySim(31);
    sim.spawnBuilding(WERKPLAATS, 0, 14, 4);
    sim.setScrap(0, 1000);
    const m = sim.spawnUnit({ typeId: MILITIA, owner: 0, ...cellCenter(10, 20) });
    const enemy = sim.spawnUnit({ typeId: MILITIA, owner: 1, ...cellCenter(50, 50) });
    play(sim, 1, at(0, cmd(0, 0, 'Research', { techId: GEWEERREK.techId })));
    play(sim, GEWEERREK.researchTicks);
    // Cancel halverwege: teruggave volgens cancelRefundPermille, geen tech
    const ws = kindOf(sim, 'building')[0]!;
    play(sim, 1, at(sim.frame, cmd(sim.frame, 0, 'Research', { techId: PANTSER.techId })));
    play(sim, 10);
    const before = sim.playerStatus(0).scrap;
    play(sim, 1, at(sim.frame, cmd(sim.frame, 0, 'Cancel', { ids: [ws] })));
    expect(sim.playerStatus(0).scrap).toBe(before + idivTest(PANTSER.scrapCost * CONFIG.cancelRefundPermille, 1000));
    play(sim, PANTSER.researchTicks + 10);
    expect(sim.researched(0)).toEqual([GEWEERREK.techId]);
    // opnieuw, nu tot het eind
    play(sim, 1, at(sim.frame, cmd(sim.frame, 0, 'Research', { techId: PANTSER.techId })));
    play(sim, PANTSER.researchTicks);
    expect(sim.researched(0)).toEqual([PANTSER.techId, GEWEERREK.techId].sort((a, b) => a - b));
    const boosted = idivTest(milType.maxHp * (1000 + PANTSER.effects[0]!.delta), 1000);
    expect(sim.getUnit(m)).toMatchObject({ maxHp: boosted, hp: boosted });
    expect(sim.getUnit(enemy)).toMatchObject({ maxHp: milType.maxHp });
    const fresh = sim.spawnUnit({ typeId: MILITIA, owner: 0, ...cellCenter(11, 20) });
    expect(sim.getUnit(fresh)).toMatchObject({ maxHp: boosted, hp: boosted });
  });
});

const idivTest = (a: number, b: number): number => Math.trunc(a / b);

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
    let ev = play(sim, 1, at(0, cmd(0, 0, 'Claim', { ids: [s0], pointId: pt }), cmd(0, 0, 'Claim', { ids: [b0], pointId: pt })));
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
    expect(ev.filter((e) => e.type === EVENT_TYPE.claimTaken)).toEqual([{ type: EVENT_TYPE.claimTaken, a: pt, b: 0 }]);
    // een tweede Claim op een eigen punt is ongeldig
    ev = play(sim, 1, at(sim.frame, cmd(sim.frame, 0, 'Claim', { ids: [b0], pointId: pt })));
    expect(ev.some((e) => e.type === EVENT_TYPE.buildingPlaced)).toBe(false);
    // speler 1 zet ook een paal neer: de huidige eigenaar houdt het punt
    sim.setScrap(1, 500);
    const b1 = sim.spawnUnit({ typeId: BUILDER, owner: 1, x: view.x + 10 * 256, y: view.y });
    play(sim, paal.buildTicks + 300, at(sim.frame, cmd(sim.frame, 1, 'Claim', { ids: [b1], pointId: pt })));
    const posts = kindOf(sim, 'building').filter((id) => sim.getUnit(id)!.typeId === CLAIMPAAL);
    expect(posts.map((id) => sim.getUnit(id)!.owner).sort()).toEqual([0, 1]);
    expect(sim.getUnit(pt)!.owner).toBe(0);
    // de paal van speler 0 gaat neer: het punt gaat naar speler 1
    const army = [0, 1, 2, 3, 4, 5].map((k) => sim.spawnUnit({ typeId: MILITIA, owner: 1, x: view.x - 4 * 256, y: view.y + (k - 3) * 256 }));
    ev = play(sim, 1200, at(sim.frame, cmd(sim.frame, 1, 'Attack', { ids: army, target: post })));
    expect(sim.getUnit(post)).toBeNull();
    expect(sim.getUnit(pt)!.owner).toBe(1);
    expect(ev.filter((e) => e.type === EVENT_TYPE.claimTaken)).toEqual([{ type: EVENT_TYPE.claimTaken, a: pt, b: 1 }]);
  });

  it('zonder claimgebouw valt het punt terug naar neutraal (claimTaken met b = OWNER_NEUTRAL)', () => {
    const sim = createSim(testInit(19, createOpenMap(64, 64)));
    const pt = kindOf(sim, 'claimPoint')[0]!;
    const v = sim.getUnit(pt)!;
    const post = sim.spawnBuilding(CLAIMPAAL, 0, (v.x >> 8) + 2, v.y >> 8);
    play(sim, 1);
    expect(sim.getUnit(pt)!.owner).toBe(0);
    const army = [0, 1, 2, 3, 4, 5].map((k) => sim.spawnUnit({ typeId: MILITIA, owner: 1, x: v.x + 6 * 256, y: v.y + (k - 3) * 256 }));
    const ev = play(sim, 1200, at(sim.frame, cmd(sim.frame, 1, 'Attack', { ids: army, target: post })));
    expect(sim.getUnit(pt)!.owner).toBe(OWNER_NEUTRAL);
    expect(ev.filter((e) => e.type === EVENT_TYPE.claimTaken)).toEqual([{ type: EVENT_TYPE.claimTaken, a: pt, b: OWNER_NEUTRAL }]);
  });

  it('het hoofdgebouw is een claimbron: een punt bij de spawn is vanaf de start van de speler, zonder event', () => {
    const open = createOpenMap(64, 64);
    const map = { ...open, claimPoints: [{ ...cellCenter(13, 8), kind: 0 }] };
    const sim = createSim(testInit(20, map));
    const pt = kindOf(sim, 'claimPoint')[0]!;
    expect(sim.getUnit(pt)!.owner).toBe(0);
    expect(play(sim, 5).some((e) => e.type === EVENT_TYPE.claimTaken)).toBe(false);
  });

  it('exclusieve nodes: een node binnen claimRadius van een bezet punt is alleen voor de eigenaar', () => {
    const open = createOpenMap(64, 64);
    const map = { ...open, scrapNodes: [{ ...cellCenter(34, 32), amount: 500 }, { ...cellCenter(40, 50), amount: 500 }], claimPoints: [{ ...cellCenter(32, 32), kind: 0 }] };
    const sim = createSim(testInit(21, map));
    const [excl, free] = kindOf(sim, 'scrapNode');
    const pt = kindOf(sim, 'claimPoint')[0]!;
    sim.spawnBuilding(CLAIMPAAL, 0, 30, 32);
    play(sim, 1);
    expect(sim.getUnit(pt)!.owner).toBe(0);
    const s1 = sim.spawnUnit({ typeId: SCAV, owner: 1, ...cellCenter(36, 34) });
    const s0 = sim.spawnUnit({ typeId: SCAV, owner: 0, ...cellCenter(36, 30) });
    play(sim, 1, at(sim.frame, cmd(sim.frame, 1, 'Gather', { ids: [s1], nodeId: excl! }), cmd(sim.frame, 0, 'Gather', { ids: [s0], nodeId: excl! })));
    play(sim, 400);
    // speler 0 haalt er scrap; de scavenger van speler 1 is omgeleid naar de vrije node
    expect(sim.getUnit(excl!)!.amount).toBeLessThan(500);
    expect(sim.getUnit(free!)!.amount).toBeLessThan(500);
    expect(sim.getUnit(s1)!.order).toBe(ORDER_GATHER);
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
      status: {
        playerId: 1,
        scrap: DATA.factions[0]!.startScrap,
        settlers: 6,
        pop: 6,
        popCap: 6,
        beds: 6,
        hero: {
          heroId: 0,
          level: 1,
          xp: 0,
          xpNext: DATA.heroes[0]!.xpThresholds[0],
          special: DATA.heroes[0]!.special,
          perks: [],
          pendingPerks: 0,
          revivesLeft: 4,
          state: 'alive',
          reviveTicksLeft: 0,
          entityId: core.sim!.entityIds().find((id) => core.sim!.getUnit(id)!.kind === 'hero' && core.sim!.getUnit(id)!.owner === 1),
          abilityCooldownTicks: [0],
        },
        techs: [],
        queue: [],
      },
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
