import {
  typeByKey,
  testInit,
  DATA,
  SCAV,
  cmd,
  BUILDER,
  CONFIG,
  envOf,
  emptySim,
  MILITIA,
} from './helpers.js';
import { describe, it, expect } from 'vitest';
import { createSim, deserialize, ORDER_CRAFT } from '../src/index.js';
import { createTestMap, testPlayers, cellCenter } from '../src/testing.js';
import { SCRAP_NODE_TYPE_ID, CLAIM_POINT_TYPE_ID, unitTypeId, heroTypeId } from '@crawlout/data';
import {
  OWNER_NEUTRAL,
  EVENT_TYPE,
  readSnapshotHeader,
  snapshotLayout,
  ENTITY_FLAG,
} from '@crawlout/protocol';
import { WERKPLAATS, WONING, at, kindOf, milType, play, scavType } from './gameplay.helpers.js';

const HQ = typeByKey('hoofdgebouw');

describe('startopstelling', () => {
  it('zet nodes, claimpunten, per speler hoofdgebouw en startunits in vaste id-volgorde, plus startScrap', () => {
    const sim = createSim(testInit(5));
    const map = createTestMap();
    const views = sim.entityIds().map((id) => sim.getUnit(id)!);
    const nodes = map.scrapNodes.length;
    const claims = map.claimPoints.length;
    expect(
      views
        .slice(0, nodes)
        .every((v) => v.typeId === SCRAP_NODE_TYPE_ID && v.owner === OWNER_NEUTRAL),
    ).toBe(true);
    expect(
      views
        .slice(nodes, nodes + claims)
        .every((v) => v.typeId === CLAIM_POINT_TYPE_ID && v.owner === OWNER_NEUTRAL),
    ).toBe(true);
    const faction = DATA.factions[0]!;
    const settlers = faction.startUnits.reduce((n, u) => n + u.count, 0);
    const perPlayer = 2 + settlers; // hoofdgebouw, startunits, held
    for (let p = 0; p < 2; p++) {
      const block = views.slice(
        nodes + claims + p * perPlayer,
        nodes + claims + (p + 1) * perPlayer,
      );
      expect(block[0]).toMatchObject({ kind: 'building', typeId: HQ, owner: p, buildState: 2 });
      const spawn = map.spawns[p]!;
      expect(block[0]!.x >> 8).toBe(spawn.x >> 8);
      const want = faction.startUnits.flatMap((u) =>
        Array.from({ length: u.count }, () => unitTypeId(u.loadoutId)),
      );
      expect(block.slice(1, 1 + settlers).map((v) => v.typeId)).toEqual(want);
      expect(block.slice(1, 1 + settlers).every((v) => v.kind === 'unit' && v.owner === p)).toBe(
        true,
      );
      expect(block[1 + settlers]).toMatchObject({
        kind: 'hero',
        typeId: heroTypeId(DATA.heroes[0]!.id),
        owner: p,
      });
      expect(sim.playerStatus(p)).toMatchObject({
        scrap: faction.startScrap,
        settlers,
        beds: 6,
        popCap: 6,
      });
    }
    // deterministisch: zelfde invoer, zelfde hash; andere spelers, andere hash
    expect(createSim(testInit(5)).hash()).toBe(sim.hash());
    expect(createSim(testInit(5, map, testPlayers(2, true))).hash()).not.toBe(sim.hash());
  });

  it('weigert een map zonder genoeg spawns', () => {
    expect(() =>
      createSim(testInit(1, { ...createTestMap(), spawns: [cellCenter(8, 8)] })),
    ).toThrow(/spawns/);
  });
});

describe('economie', () => {
  it('scavengers verzamelen per rit gatherAmount en leveren af bij het hoofdgebouw', () => {
    const map = createTestMap();
    // een node naast het hoofdgebouw
    const g = scavType.gatherAmount;
    const s2 = createSim(
      testInit(1, { ...map, scrapNodes: [{ ...cellCenter(14, 8), amount: 2 * g + (g >> 1) }] }),
    );
    const n = kindOf(s2, 'scrapNode')[0]!;
    const scavs = s2.entityIds().filter((id) => {
      const u = s2.getUnit(id)!;
      return u.kind === 'unit' && u.owner === 0 && u.typeId === SCAV;
    });
    const before = s2.playerStatus(0).scrap;
    const ev = play(
      s2,
      6 * scavType.gatherTicks,
      at(0, cmd(0, 0, 'Gather', { ids: scavs.slice(0, 2), nodeId: n })),
    );
    // twee ritten van gatherAmount en een rest van de helft, daarna is de node op
    expect(s2.playerStatus(0).scrap).toBe(before + 2 * g + (g >> 1));
    expect(s2.getUnit(n)).toBeNull();
    expect(ev.filter((e) => e.type === EVENT_TYPE.resourceDepleted)).toEqual([
      { type: EVENT_TYPE.resourceDepleted, a: n, b: 0 },
    ]);
    // zonder nodes in de map zijn de scavengers klaar
    const left = scavs.slice(0, 2).map((id) => s2.getUnit(id)!.order);
    expect(left).toEqual([0, 0]);
  });

  it('een rit duurt gatherTicks en zet de unit op anim gather', () => {
    const sim = createSim(
      testInit(1, { ...createTestMap(), scrapNodes: [{ ...cellCenter(13, 8), amount: 500 }] }),
    );
    const n = kindOf(sim, 'scrapNode')[0]!;
    const scav = sim
      .entityIds()
      .find((id) => sim.getUnit(id)!.typeId === SCAV && sim.getUnit(id)!.owner === 0)!;
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
    expect(new Uint8Array(buf, L.entity.hpPct, h.entityCount)[k]).toBe(
      Math.trunc(((500 - scavType.gatherAmount) * 100) / 500),
    );
    expect(new Uint8Array(buf, L.entity.owner, h.entityCount)[k]).toBe(OWNER_NEUTRAL);
  });

  it('Build: scrap betalen, bouwplaats blokkeert cellen, bouwer maakt hem af, bedden verhogen de pop-cap', () => {
    const sim = createSim(testInit(2));
    const builder = sim
      .entityIds()
      .find((id) => sim.getUnit(id)!.typeId === BUILDER && sim.getUnit(id)!.owner === 0)!;
    const wt = CONFIG.buildingTypes.find((b) => b.typeId === WONING)!;
    const before = sim.playerStatus(0);
    const p = cellCenter(16, 14);
    const ev = play(
      sim,
      1,
      at(0, cmd(0, 0, 'Build', { ids: [builder], typeId: WONING, x: p.x, y: p.y })),
    );
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
    const scav = sim
      .entityIds()
      .find((id) => sim.getUnit(id)!.typeId === SCAV && sim.getUnit(id)!.owner === 0)!;
    const builder = sim
      .entityIds()
      .find((id) => sim.getUnit(id)!.typeId === BUILDER && sim.getUnit(id)!.owner === 0)!;
    const p = cellCenter(16, 14);
    const h0 = sim.hash();
    const s = sim.serialize();
    play(
      sim,
      1,
      at(
        0,
        cmd(0, 0, 'Build', { ids: [scav], typeId: WONING, x: p.x, y: p.y }), // geen bouwer
        cmd(0, 0, 'Build', { ids: [builder], typeId: HQ, x: p.x, y: p.y }), // hoofdgebouw
        cmd(0, 0, 'Build', { ids: [builder], typeId: WONING, ...cellCenter(32, 5) }), // muur
        cmd(0, 1, 'Build', { ids: [builder], typeId: WONING, x: p.x, y: p.y }), // niet van speler 1
      ),
    );
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
    const builder = sim
      .entityIds()
      .find((id) => sim.getUnit(id)!.typeId === BUILDER && sim.getUnit(id)!.owner === 0)!;
    const before = sim.playerStatus(0).scrap;
    const p = cellCenter(16, 14);
    const ev = play(
      sim,
      1,
      at(0, cmd(0, 0, 'Build', { ids: [builder], typeId: WONING, x: p.x, y: p.y })),
    );
    const site = ev.find((e) => e.type === EVENT_TYPE.buildingPlaced)!.a;
    play(sim, 1, at(1, cmd(1, 0, 'Cancel', { ids: [site] })));
    expect(sim.getUnit(site)).toBeNull();
    expect(sim.playerStatus(0).scrap).toBe(before);
    expect(sim.spawnUnit({ typeId: SCAV, owner: 0, ...p })).not.toBe(0); // cel weer begaanbaar
  });

  it('Cancel geeft cancelRefundPermille van de prijs terug (bouwplaats en betaalde omscholing)', () => {
    const half = { ...testInit(2), config: { ...CONFIG, cancelRefundPermille: 500 } };
    const sim = createSim(half);
    const builder = sim
      .entityIds()
      .find((id) => sim.getUnit(id)!.typeId === BUILDER && sim.getUnit(id)!.owner === 0)!;
    const before = sim.playerStatus(0).scrap;
    const p = cellCenter(16, 14);
    const ev = play(
      sim,
      1,
      at(0, cmd(0, 0, 'Build', { ids: [builder], typeId: WONING, x: p.x, y: p.y })),
    );
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
    // vangnet: zonder werkplaats en zonder bouwer is de eerste nieuwe bewoner een bouwer, daarna plunderaars
    const spawn = ev.find((e) => e.type === EVENT_TYPE.spawn)!;
    expect(spawn.b).toBe(BUILDER);
    const next = play(sim, per).find((e) => e.type === EVENT_TYPE.spawn)!;
    expect(next.b).toBe(SCAV);
    // vol: geen groei meer
    play(sim, per * 8);
    expect(sim.playerStatus(0)).toMatchObject({ settlers: 6, pop: 6, popCap: 6 });
  });

  it('vangnet: met een werkplaats of een bouwer is de nieuwe bewoner een plunderaar', () => {
    const per = Math.ceil(CONFIG.ticksPerMinute / CONFIG.factions[0]!.housingGrowthPerMin);
    const withWorkshop = emptySim(3);
    withWorkshop.spawnBuilding(HQ, 0, 6, 6);
    withWorkshop.spawnBuilding(WERKPLAATS, 0, 20, 6);
    expect(play(withWorkshop, per).find((e) => e.type === EVENT_TYPE.spawn)!.b).toBe(SCAV);
    const withBuilder = emptySim(3);
    withBuilder.spawnBuilding(HQ, 0, 6, 6);
    withBuilder.spawnUnit({ typeId: BUILDER, owner: 0, ...cellCenter(20, 20) });
    expect(play(withBuilder, per).find((e) => e.type === EVENT_TYPE.spawn)!.b).toBe(SCAV);
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
    expect(sim.getUnit(s)).toMatchObject({
      order: 0,
      role: milType.role,
      loadoutId: milType.loadoutId,
    });
    // zonder werkplaats wacht een unit (en betaalt niets)
    const t = sim.spawnUnit({ typeId: SCAV, owner: 1, ...cellCenter(40, 40) });
    play(sim, 50, at(sim.frame, cmd(sim.frame, 1, 'SetRole', { ids: [t], role: 'builder' })));
    expect(sim.getUnit(t)).toMatchObject({ typeId: SCAV, order: ORDER_CRAFT });
    // Craft met een loadout met prereqTech (patrol) kan nog niet
    play(
      sim,
      1,
      at(
        sim.frame,
        cmd(sim.frame, 0, 'Craft', {
          ids: [s],
          loadoutId: DATA.loadouts.find((l) => l.key === 'patrol')!.id,
        }),
      ),
    );
    expect(sim.getUnit(s)!.order).toBe(0);
  });
});
