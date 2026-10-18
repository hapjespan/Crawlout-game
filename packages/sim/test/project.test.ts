import { describe, expect, it } from 'vitest';
import { OWNER_NEUTRAL, readSnapshotHeader, snapshotLayout } from '@crawlout/protocol';
import { FNV_OFFSET, fnv1a } from '../src/math/fnv.js';
import { createSim, deserialize } from '../src/index.js';
import type { Sim, SimInit, SimMap } from '../src/index.js';
import { takeCensus, Census } from '../src/systems/census.js';
import { PlayerView } from '../src/view.js';
import { cellCenter, createOpenMap, testPlayers } from '../src/testing.js';
import { BUILDER, CONFIG, DATA, MILITIA, bundle, cmd, envOf, runFrames } from './helpers.js';

// Win route C, the Bouwproject (sim 0.25.0, data 0.31.0): ruins on the map, restoring with Build, the effects of a
// restored part, the countdown with its sabotage pause, falling back to a ruin, Cancel, fog and serialization.

const KIND = (key: string): number => DATA.project.parts.findIndex((p) => p.key === key);
const SUPER = KIND('site_supermarket');
const GAS = KIND('site_gas_station');
const GARAGE = KIND('site_garage');
const TOWER = KIND('site_water_tower');
const typeOf = (kind: number, ruin: boolean): number =>
  ruin ? CONFIG.project!.parts[kind]!.ruinTypeId : CONFIG.project!.parts[kind]!.restoredTypeId;
const bt = (typeId: number) => CONFIG.buildingTypes.find((b) => b.typeId === typeId)!;

/** Four parts in the open, one of each kind, and a second supermarket further away. */
function projectMap(): SimMap {
  const m = createOpenMap(128, 128);
  const site = (kind: number, x: number, y: number) => ({ ...cellCenter(x, y), kind });
  return {
    ...m,
    projectSites: [
      site(SUPER, 40, 30),
      site(GAS, 40, 52),
      site(GARAGE, 76, 30),
      site(TOWER, 76, 52),
      site(SUPER, 90, 96),
    ],
  };
}

const SHORT = { ...CONFIG, project: { ...CONFIG.project!, countdownTicks: 200, pauseTicks: 40 } };
const init = (seed = 3, config = SHORT): SimInit => ({
  seed,
  players: testPlayers(2),
  map: projectMap(),
  config,
});

function parts(sim: Sim): number[] {
  return sim.projectParts.map((i) => sim.world.idOf(i));
}

/** Builders of player p next to a part, and the Build that restores it. */
function restore(sim: Sim, p: number, partId: number, n = 6): ReturnType<typeof cmd> {
  const u = sim.getUnit(partId)!;
  const t = bt(u.typeId);
  const ids: number[] = [];
  const cx = (u.x >> 8) - (t.footprintW >> 1) - 2;
  const cy = (u.y >> 8) - (t.footprintH >> 1);
  for (let k = 0; k < n; k++) {
    const c = cellCenter(cx, cy + k);
    ids.push(sim.spawnUnit({ typeId: BUILDER, owner: p, x: c.x, y: c.y }));
  }
  return cmd(sim.frame, p, 'Build', { ids, typeId: u.typeId, x: u.x, y: u.y });
}

function step(sim: Sim, frames: number, cmds: ReturnType<typeof cmd>[] = []): void {
  const script = new Map([[sim.frame, cmds]]);
  runFrames(sim, frames, script);
}

describe('Bouwproject (winroute C)', () => {
  it('zet de ruines neer in map-volgorde, neutraal en van het ruinetype; Skirmish heeft er geen', () => {
    const sim = createSim(init());
    expect(sim.projectParts).toHaveLength(5);
    const kinds = [SUPER, GAS, GARAGE, TOWER, SUPER];
    parts(sim).forEach((id, k) => {
      const u = sim.getUnit(id)!;
      expect(u.kind).toBe('building');
      expect(u.owner).toBe(OWNER_NEUTRAL);
      expect(u.typeId).toBe(typeOf(kinds[k]!, true));
      expect(u.hp).toBe(u.maxHp);
    });
    expect(sim.playerStatus(0).project!.parts.map((p) => p.state)).toEqual(Array(5).fill('ruin'));
    const plain = createSim({ ...init(), map: createOpenMap(128, 128) });
    expect(plain.projectParts).toHaveLength(0);
    expect(plain.playerStatus(0).project).toBeNull();
  });

  it('Build op een ruine herstelt hem: kosten meteen, daarna bouwwerk; hersteld geeft bedden en effecten', () => {
    const sim = createSim(init());
    sim.setScrap(0, 5000);
    const [superId, gasId] = parts(sim);
    const census = new Census();
    takeCensus(sim, census);
    const beds0 = census.beds[0]!;
    const cost = bt(typeOf(SUPER, false)).scrapCost;
    step(sim, 1, [restore(sim, 0, superId!)]);
    expect(sim.ps.scrap[0]).toBe(5000 - cost);
    let u = sim.getUnit(superId!)!;
    expect(u.owner).toBe(0);
    expect(u.typeId).toBe(typeOf(SUPER, false));
    expect(u.buildState).toBe(1);
    expect(sim.playerStatus(1).project!.parts[0]!.state).toBe('restoring');
    // a second Build on the same part by the other player is refused (it is not a ruin)
    sim.setScrap(1, 5000);
    step(sim, 1, [restore(sim, 1, superId!, 2)]);
    expect(sim.ps.scrap[1]).toBe(5000);
    step(sim, bt(typeOf(SUPER, false)).buildTicks);
    u = sim.getUnit(superId!)!;
    expect(u.buildState).toBe(2);
    expect(u.hp).toBe(u.maxHp);
    takeCensus(sim, census);
    expect(census.beds[0]).toBe(beds0 + bt(typeOf(SUPER, false)).beds);
    // the gas station: robots and vehicles faster (effects like a researched tech)
    step(sim, 1, [restore(sim, 0, gasId!)]);
    step(sim, bt(typeOf(GAS, false)).buildTicks);
    expect(sim.getUnit(gasId!)!.buildState).toBe(2);
    const robot = CONFIG.unitTypes.find((t) => t.bodyType === 1 && t.factionId === 0)!;
    const c = cellCenter(20, 100);
    const r = sim.spawnUnit({ typeId: robot.typeId, owner: 0, x: c.x, y: c.y });
    const speedOf = (id: number): number => sim.world.speed[sim.world.resolve(id)]!;
    expect(speedOf(r)).toBe(Math.trunc((robot.speed * 1150) / 1000));
    const r1 = sim.spawnUnit({ typeId: robot.typeId, owner: 1, x: c.x + 512, y: c.y });
    expect(speedOf(r1)).toBe(robot.speed);
  });

  it('wie van elke soort een hersteld deel houdt, wint na de countdown; een treffer pauzeert, verlies zet terug', () => {
    const sim = createSim(init());
    sim.setScrap(0, 20000);
    const ids = parts(sim);
    step(
      sim,
      1,
      ids.slice(0, 4).map((id) => restore(sim, 0, id)),
    );
    let guard = 0;
    while (sim.playerStatus(0).project!.players[0]!.kindsHeld < 4 && guard++ < 3000) step(sim, 10);
    const st = sim.playerStatus(1).project!;
    expect(st.players.find((p) => p.playerId === 0)!.kindsHeld).toBe(4);
    expect(st.players.find((p) => p.playerId === 1)!.kindsHeld).toBe(0);
    step(sim, 50);
    const held = sim.ps.projTicks[0]!;
    expect(held).toBeGreaterThan(40);
    // sabotage: damage on the water tower pauses the countdown for pauseTicks
    const tower = sim.world.resolve(ids[3]!);
    sim.world.hp[tower] = sim.world.hp[tower]! - 50;
    step(sim, 2);
    expect(sim.playerStatus(0).project!.players[0]!.paused).toBe(true);
    expect(sim.playerStatus(0).project!.parts[3]!.underAttack).toBe(true);
    const paused = sim.ps.projTicks[0]!;
    step(sim, 20);
    expect(sim.ps.projTicks[0]).toBe(paused);
    step(sim, 40);
    expect(sim.ps.projTicks[0]).toBeGreaterThan(paused);
    // destroyed: the tower falls back to a ruin, the countdown goes to 0
    sim.world.hp[tower] = 0;
    step(sim, 1);
    const t = sim.getUnit(ids[3]!)!;
    expect(t.owner).toBe(OWNER_NEUTRAL);
    expect(t.typeId).toBe(typeOf(TOWER, true));
    expect(t.hp).toBe(t.maxHp);
    expect(sim.ps.projTicks[0]).toBe(0);
    expect(sim.winner()).toBeNull();
    // restore it again and let the countdown run out
    step(sim, 1, [restore(sim, 0, ids[3]!)]);
    for (let k = 0; k < 200 && sim.winner() === null; k++) step(sim, 10);
    expect(sim.winner()).toMatchObject({ playerId: 0, reason: 'project' });
  });

  it('Cancel op een eigen herstel geeft de ruine terug met teruggave; slavenregels en bouwers volgen', () => {
    const sim = createSim(init());
    sim.setScrap(0, 1000);
    const [superId] = parts(sim);
    step(sim, 1, [restore(sim, 0, superId!)]);
    step(sim, 30);
    const before = sim.ps.scrap[0]!;
    step(sim, 1, [cmd(sim.frame, 0, 'Cancel', { ids: [superId!] })]);
    const u = sim.getUnit(superId!)!;
    expect(u.owner).toBe(OWNER_NEUTRAL);
    expect(u.typeId).toBe(typeOf(SUPER, true));
    const cost = bt(typeOf(SUPER, false)).scrapCost;
    expect(sim.ps.scrap[0]).toBe(before + Math.trunc((cost * CONFIG.cancelRefundPermille) / 1000));
  });

  it('een ruine is geen doelwit; een deel in herstel wel, en op 0 hp is het weer een ruine', () => {
    const sim = createSim(init());
    sim.setScrap(0, 1000);
    const [superId] = parts(sim);
    const u = sim.getUnit(superId!)!;
    const c = cellCenter((u.x >> 8) + 14, u.y >> 8);
    const m = sim.spawnUnit({ typeId: MILITIA, owner: 1, x: c.x, y: c.y });
    step(sim, 1, [cmd(sim.frame, 1, 'Attack', { ids: [m], targetId: superId! })]);
    step(sim, 60);
    expect(sim.getUnit(superId!)!.hp).toBe(u.maxHp);
    step(sim, 1, [restore(sim, 0, superId!, 1)]);
    step(sim, 1, [cmd(sim.frame, 1, 'Attack', { ids: [m], targetId: superId! })]);
    let lost = false;
    for (let k = 0; k < 600 && !lost; k++) {
      step(sim, 1);
      lost = sim.getUnit(superId!)!.owner === OWNER_NEUTRAL;
    }
    expect(lost).toBe(true);
    expect(sim.getUnit(superId!)!.typeId).toBe(typeOf(SUPER, true));
  });

  it('de delen staan altijd in de snapshot van elke speler (kaartkennis), zonder ghost', () => {
    const sim = createSim(init());
    const view = new PlayerView(1);
    const buf = view.write(sim);
    const h = readSnapshotHeader(buf);
    const ids = new Uint32Array(
      buf,
      snapshotLayout(h.entityCount, h.eventCount).entity.id,
      h.entityCount,
    );
    for (const id of parts(sim)) expect([...ids]).toContain(id);
  });

  it('serialize en deserialize midden in een herstel lopen identiek verder', () => {
    const a = createSim(init());
    a.setScrap(0, 5000);
    const ids = parts(a);
    const script = new Map([[0, [restore(a, 0, ids[0]!), restore(a, 0, ids[3]!)]]]);
    runFrames(a, 300, script);
    a.world.hp[a.world.resolve(ids[3]!)] = 5;
    runFrames(a, 5);
    const buf = a.serialize();
    expect(fnv1a(FNV_OFFSET, new Uint8Array(buf))).toBe(a.hash());
    const b = deserialize(buf, envOf(init()));
    expect(b.projectParts).toEqual(a.projectParts);
    expect(b.hash()).toBe(a.hash());
    const from = a.frame;
    for (let f = from; f < from + 400; f++) {
      a.applyBundle(bundle(f));
      b.applyBundle(bundle(f));
      expect(b.tick()).toBe(a.tick());
    }
  });
});
