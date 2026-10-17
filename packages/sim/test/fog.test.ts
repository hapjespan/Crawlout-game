import { describe, expect, it } from 'vitest';
import {
  ENTITY_FLAG,
  FOG,
  fogAt,
  readSnapshotHeader,
  snapshotLayout,
  writeSnapshotHeader,
} from '@crawlout/protocol';
import { PlayerView, createSim, deserialize } from '../src/index.js';
import type { Sim } from '../src/index.js';
import { cellCenter, createOpenMap } from '../src/testing.js';
import {
  CONFIG,
  DATA,
  MILITIA,
  SCAV,
  bundle,
  cmd,
  emptySim,
  envOf,
  testInit,
  typeByKey,
} from './helpers.js';

// Fog of war (sim 0.17.0, data 0.22.0, protocol 0.11.0): vision grid, explored and visible, snapshot per player,
// ghosts of enemy buildings, the gameplay rules (a target must be visible) and determinism.

const M = 256;
const CELL = CONFIG.visionCell;
const SCAV_SIGHT = CONFIG.unitTypes.find((u) => u.typeId === SCAV)!.sight;

const open = (seed = 1): Sim => emptySim(seed, createOpenMap(128, 128));

function step(sim: Sim, n = 1, commands: ReturnType<typeof cmd>[] = []): void {
  for (let k = 0; k < n; k++) {
    sim.applyBundle(bundle(sim.frame, k === 0 ? commands : []));
    sim.tick();
  }
}

/** Ids and flags of a snapshot. */
function rows(buf: ArrayBuffer): { id: number; flags: number; hpPct: number }[] {
  const h = readSnapshotHeader(buf);
  const l = snapshotLayout(h.entityCount, h.eventCount);
  const id = new Uint32Array(buf, l.entity.id, h.entityCount);
  const flags = new Uint8Array(buf, l.entity.flags, h.entityCount);
  const hp = new Uint8Array(buf, l.entity.hpPct, h.entityCount);
  return [...id].map((v, k) => ({ id: v, flags: flags[k]!, hpPct: hp[k]! }));
}

describe('fog of war: vision', () => {
  it('data: the sight radii resolve from the records and the sim.json defaults', () => {
    expect(CELL).toBe(2 * M);
    expect(SCAV_SIGHT).toBe(14 * M);
    expect(CONFIG.unitTypes.find((u) => u.typeId === typeByKey('sentinel'))!.sight).toBe(32 * M);
    expect(CONFIG.heroes[0]!.sight).toBe(16 * M);
    const b = (key: string) => CONFIG.buildingTypes.find((t) => t.typeId === typeByKey(key))!;
    expect(b('hoofdgebouw').sight).toBe(12 * M);
    expect(b('woning').sight).toBe(10 * M);
    expect(b('claimpaal').sight).toBe(8 * M);
    // a turret without its own sightM: rangeM + turretSightExtraM
    expect(b('turret').sight).toBe(b('turret').range + 2 * M);
    expect(DATA.sim.vision.cellU).toBe(CELL);
  });

  it('a unit sees its sight radius and no further; its owner only', () => {
    const sim = open();
    const at = cellCenter(64, 64);
    sim.spawnUnit({ typeId: SCAV, owner: 0, ...at });
    const v = sim.vision;
    expect(v.visibleAt(0, at.x, at.y)).toBe(true);
    expect(v.visibleAt(0, at.x + 12 * M, at.y)).toBe(true);
    expect(v.visibleAt(0, at.x, at.y - 12 * M)).toBe(true);
    expect(v.visibleAt(0, at.x + 18 * M, at.y)).toBe(false);
    expect(v.visibleAt(0, at.x + 13 * M, at.y + 13 * M)).toBe(false); // 18,4 m diagonally
    expect(v.visibleAt(1, at.x, at.y)).toBe(false);
    // no vision cell beyond sight + one cell is visible, every cell within sight - one cell is
    for (let cy = 0; cy < v.gh; cy++)
      for (let cx = 0; cx < v.gw; cx++) {
        const dx = (cx * CELL + CELL / 2 - at.x) / M;
        const dy = (cy * CELL + CELL / 2 - at.y) / M;
        const d = Math.hypot(dx, dy);
        const seen = v.visibleCell(0, cy * v.gw + cx);
        if (d <= SCAV_SIGHT / M - CELL / M) expect(seen).toBe(true);
        if (d > SCAV_SIGHT / M + CELL / M) expect(seen).toBe(false);
      }
  });

  it('explored persists, visible decays when the unit leaves or dies', () => {
    const sim = open();
    const at = cellCenter(30, 64);
    const id = sim.spawnUnit({ typeId: SCAV, owner: 0, ...at });
    const v = sim.vision;
    const c = v.cellOf(at.x, at.y);
    expect(v.fogAt(0, c)).toBe(2);
    const goal = cellCenter(100, 64);
    step(sim, 400, [cmd(sim.frame, 0, 'Move', { ids: [id], ...goal })]);
    expect(sim.getUnit(id)!.x).toBeGreaterThan(at.x + 40 * M);
    expect(v.fogAt(0, c)).toBe(1); // explored, not visible
    expect(v.fogAt(0, v.cellOf(goal.x, goal.y))).toBe(2);
    expect(v.fogAt(0, v.cellOf(at.x, at.y + 40 * M))).toBe(0); // never seen
    sim.destroyEntity(id);
    expect(v.fogAt(0, v.cellOf(goal.x, goal.y))).toBe(1);
    // no disc left anywhere
    expect(v.count.every((n) => n === 0)).toBe(true);
  });

  it('a building sees beyond its footprint; World.visTo and World.spotted per entity', () => {
    const sim = open();
    const hq = sim.spawnBuilding(typeByKey('hoofdgebouw'), 0, 60, 60); // compact 5 x 5
    const enemy = sim.spawnUnit({ typeId: SCAV, owner: 1, ...cellCenter(62, 76) }); // 11,5 m below the footprint
    const far = sim.spawnUnit({ typeId: SCAV, owner: 1, ...cellCenter(62, 90) });
    const w = sim.world;
    const i = (id: number): number => w.resolve(id);
    expect(w.visTo[i(hq)]).toBe(0b11); // its owner, and the scavenger of player 1 sees the house
    expect(w.visTo[i(enemy)]).toBe(0b11);
    expect(w.visTo[i(far)]).toBe(0b10);
    expect(w.spotted[i(far)]).toBe(0b10);
    sim.destroyEntity(enemy);
    expect(w.visTo[i(hq)]).toBe(0b01);
    expect(w.spotted[i(hq)]).toBe(0b11); // seen once stays spotted
  });
});

describe('fog of war: gameplay', () => {
  it('Attack on a hidden enemy is refused; once seen it is accepted', () => {
    const sim = open();
    const own = sim.spawnUnit({ typeId: MILITIA, owner: 0, ...cellCenter(20, 64) });
    const enemy = sim.spawnUnit({ typeId: SCAV, owner: 1, ...cellCenter(60, 64) });
    step(sim, 1, [cmd(sim.frame, 0, 'Attack', { ids: [own], target: enemy })]);
    expect(sim.getUnit(own)!.order).toBe(0);
    expect(sim.getUnit(own)!.target).toBe(0);
    // a scout of player 0 next to the enemy: shared vision
    sim.spawnUnit({ typeId: SCAV, owner: 0, ...cellCenter(58, 64) });
    step(sim, 1, [cmd(sim.frame, 0, 'Attack', { ids: [own], target: enemy })]);
    expect(sim.getUnit(own)!.target).toBe(enemy);
    expect(sim.getUnit(own)!.moving).toBe(true);
  });

  it('auto-aggro only on visible enemies: a unit that sees less than its aggro range ignores what it cannot see', () => {
    // a militia with 2 m sight (aggroRange 10 m): an enemy 6 m away is out of sight, so no target
    const config = {
      ...CONFIG,
      unitTypes: CONFIG.unitTypes.map((u) => (u.typeId === MILITIA ? { ...u, sight: 2 * M } : u)),
    };
    const sim = createSim({ ...testInit(3, createOpenMap(128, 128)), config }, { start: false });
    const own = sim.spawnUnit({ typeId: MILITIA, owner: 0, ...cellCenter(40, 64) });
    const enemy = sim.spawnUnit({ typeId: SCAV, owner: 1, ...cellCenter(46, 64) });
    const full = sim.getUnit(enemy)!.maxHp;
    step(sim, 5);
    expect(sim.getUnit(own)!.target).toBe(0);
    expect(sim.getUnit(enemy)!.hp).toBe(full);
    // a scavenger of player 0 that sees him: the militia acquires him (shared vision)
    sim.spawnUnit({ typeId: SCAV, owner: 0, ...cellCenter(48, 66) });
    step(sim, 40);
    expect(sim.getUnit(own)!.target).toBe(enemy);
    expect(sim.getUnit(enemy)?.hp ?? 0).toBeLessThan(full);
  });

  it('a target that walks out of sight is lost: the Attack order ends', () => {
    const config = {
      ...CONFIG,
      unitTypes: CONFIG.unitTypes.map((u) => (u.typeId === MILITIA ? { ...u, speed: 1 } : u)),
    };
    const sim = createSim({ ...testInit(4, createOpenMap(128, 128)), config }, { start: false });
    const own = sim.spawnUnit({ typeId: MILITIA, owner: 0, ...cellCenter(40, 64) });
    const enemy = sim.spawnUnit({ typeId: SCAV, owner: 1, ...cellCenter(50, 64) });
    step(sim, 1, [
      cmd(sim.frame, 0, 'Attack', { ids: [own], target: enemy }),
      cmd(sim.frame, 1, 'Move', { ids: [enemy], ...cellCenter(120, 64) }),
    ]);
    expect(sim.getUnit(own)!.target).toBe(enemy);
    step(sim, 200);
    expect(sim.vision.visibleAt(0, sim.getUnit(enemy)!.x, sim.getUnit(enemy)!.y)).toBe(false);
    expect(sim.getUnit(own)!.order).toBe(0);
    expect(sim.getUnit(own)!.target).toBe(0);
  });
});

describe('fog of war: the snapshot of one player', () => {
  it('an enemy unit in the fog is left out for that player only; map features always stay', () => {
    const sim = createSim(testInit(5, createOpenMap(128, 128)));
    const hidden = sim.spawnUnit({ typeId: SCAV, owner: 1, ...cellCenter(64, 40) });
    step(sim, 1);
    const all = rows(sim.writeSnapshot()).map((r) => r.id);
    const p0 = new PlayerView(0);
    const p1 = new PlayerView(1);
    const ids0 = rows(p0.write(sim)).map((r) => r.id);
    const ids1 = rows(p1.write(sim)).map((r) => r.id);
    expect(all).toContain(hidden);
    expect(ids0).not.toContain(hidden);
    expect(ids1).toContain(hidden);
    for (const id of sim.entityIds()) {
      const u = sim.getUnit(id)!;
      if (u.kind === 'scrapNode' || u.kind === 'claimPoint') {
        expect(ids0).toContain(id);
        expect(ids1).toContain(id);
      }
      if (u.owner === 0) expect(ids0).toContain(id);
    }
    // ascending ids, and the header hash is the hash of the whole state
    expect(ids0).toEqual([...ids0].sort((a, b) => a - b));
    expect(readSnapshotHeader(p0.write(sim)).hash).toBe(sim.hash());
    // a scout of player 0 walks up: now he is in
    const scout = sim.spawnUnit({ typeId: SCAV, owner: 0, ...cellCenter(64, 52) });
    expect(sim.getUnit(scout)).not.toBeNull();
    step(sim, 1);
    expect(rows(p0.write(sim)).map((r) => r.id)).toContain(hidden);
  });

  it('events in the fog are left out: the death of an enemy unit far away is not shown to player 0', () => {
    const sim = open(6);
    const p0 = new PlayerView(0);
    const p1 = new PlayerView(1);
    sim.spawnUnit({ typeId: SCAV, owner: 0, ...cellCenter(10, 10) });
    const far = sim.spawnUnit({ typeId: SCAV, owner: 1, ...cellCenter(100, 100) });
    const near = sim.spawnUnit({ typeId: SCAV, owner: 1, ...cellCenter(14, 10) });
    step(sim, 1);
    p0.observe(sim);
    p1.observe(sim);
    const w = sim.world;
    w.hp[w.resolve(far)] = 0;
    w.hp[w.resolve(near)] = 0;
    step(sim, 1);
    const events = (buf: ArrayBuffer): number[] => {
      const h = readSnapshotHeader(buf);
      const l = snapshotLayout(h.entityCount, h.eventCount);
      return [...new Uint32Array(buf, l.event.a, h.eventCount)];
    };
    expect(events(sim.writeSnapshot()).sort()).toEqual([far, near].sort());
    expect(events(p0.write(sim))).toEqual([near]); // in sight of his scavenger
    expect(events(p1.write(sim)).sort()).toEqual([far, near].sort()); // his own units
  });

  it('ghosts: an enemy building seen before stays as last seen, and goes once the spot is seen empty', () => {
    const sim = open(7);
    const house = sim.spawnBuilding(typeByKey('woning'), 1, 80, 60);
    const view = new PlayerView(0);
    const scout = sim.spawnUnit({ typeId: SCAV, owner: 0, ...cellCenter(76, 61) });
    step(sim, 1);
    let r = rows(view.write(sim)).find((x) => x.id === house)!;
    expect(r.flags & ENTITY_FLAG.ghost).toBe(0);
    expect(r.hpPct).toBe(100);
    // the scout leaves; the house takes damage unseen: the ghost keeps 100 percent
    step(sim, 1, [cmd(sim.frame, 0, 'Move', { ids: [scout], ...cellCenter(20, 61) })]);
    step(sim, 300);
    const w = sim.world;
    const hi = w.resolve(house);
    w.hp[hi] = Math.trunc(w.maxHp[hi]! / 2);
    step(sim, 1);
    r = rows(view.write(sim)).find((x) => x.id === house)!;
    expect(r.flags).toBe(ENTITY_FLAG.ghost);
    expect(r.hpPct).toBe(100);
    // a view that never saw it has no ghost
    expect(rows(new PlayerView(0).write(sim)).map((x) => x.id)).not.toContain(house);
    // destroyed unseen: the ghost stays
    w.hp[hi] = 0;
    step(sim, 2);
    expect(sim.getUnit(house)).toBeNull();
    expect(rows(view.write(sim)).find((x) => x.id === house)?.flags).toBe(ENTITY_FLAG.ghost);
    // the scout comes back and sees the spot empty: the ghost goes
    step(sim, 1, [cmd(sim.frame, 0, 'Move', { ids: [scout], ...cellCenter(76, 61) })]);
    step(sim, 400);
    expect(rows(view.write(sim)).map((x) => x.id)).not.toContain(house);
  });

  it('after a load the ghosts come back from World.spotted', () => {
    const init = testInit(8, createOpenMap(128, 128));
    const sim = createSim(init, { start: false });
    const house = sim.spawnBuilding(typeByKey('woning'), 1, 80, 60);
    const scout = sim.spawnUnit({ typeId: SCAV, owner: 0, ...cellCenter(76, 61) });
    step(sim, 1, [cmd(sim.frame, 0, 'Move', { ids: [scout], ...cellCenter(20, 61) })]);
    step(sim, 300);
    const copy = deserialize(sim.serialize(), envOf(init));
    const view = new PlayerView(0);
    view.seed(copy);
    expect(rows(view.write(copy)).find((x) => x.id === house)?.flags).toBe(ENTITY_FLAG.ghost);
    const other = new PlayerView(1);
    other.seed(copy);
    expect(rows(other.write(copy)).find((x) => x.id === house)?.flags).toBe(0); // his own house
  });

  it('the fog mask: explored and visible bitsets on the vision grid', () => {
    const sim = open(9);
    const at = cellCenter(64, 64);
    const id = sim.spawnUnit({ typeId: SCAV, owner: 0, ...at });
    step(sim, 1, [cmd(sim.frame, 0, 'Move', { ids: [id], ...cellCenter(100, 64) })]);
    step(sim, 300);
    const mask = sim.fogMask(0);
    expect(mask.cellsW).toBe(64);
    expect(mask.cellsH).toBe(64);
    expect(mask.cellUnits).toBe(CELL);
    const cx = (x: number): number => Math.floor(x / CELL);
    expect(fogAt(mask, cx(at.x), cx(at.y))).toBe(FOG.explored);
    const u = sim.getUnit(id)!;
    expect(fogAt(mask, cx(u.x), cx(u.y))).toBe(FOG.visible);
    expect(fogAt(mask, 0, 0)).toBe(FOG.unexplored);
    expect(fogAt(sim.fogMask(1), cx(u.x), cx(u.y))).toBe(FOG.unexplored);
    // visible implies explored
    for (let k = 0; k < mask.visible.length; k++)
      expect(mask.visible[k]! & ~mask.explored[k]!).toBe(0);
  });
});

describe('fog of war: determinism', () => {
  it('explored is state: serialize/deserialize gives the same hash and the same continuation', () => {
    const init = testInit(10, createOpenMap(128, 128));
    const sim = createSim(init);
    const ids = sim
      .entityIds()
      .filter((id) => sim.getUnit(id)!.owner === 0 && sim.getUnit(id)!.kind === 'unit');
    step(sim, 1, [cmd(sim.frame, 0, 'Move', { ids, ...cellCenter(64, 64) })]);
    step(sim, 200);
    const copy = deserialize(sim.serialize(), envOf(init));
    expect(copy.hash()).toBe(sim.hash());
    expect(copy.vision.explored).toEqual(sim.vision.explored);
    expect(copy.vision.count).toEqual(sim.vision.count);
    expect([...copy.world.visTo]).toEqual([...sim.world.visTo]);
    for (let n = 0; n < 300; n++) {
      sim.applyBundle(bundle(sim.frame));
      copy.applyBundle(bundle(copy.frame));
      expect(copy.tick()).toBe(sim.tick());
    }
    // one explored bit more or less is another state: other bytes, and another hash from then on
    sim.vision.explored[0] = sim.vision.explored[0]! ^ 1;
    expect(new Uint8Array(sim.serialize())).not.toEqual(new Uint8Array(copy.serialize()));
    sim.applyBundle(bundle(sim.frame));
    copy.applyBundle(bundle(copy.frame));
    expect(sim.tick()).not.toBe(copy.tick());
  });

  it('a snapshot header writer stays the protocol one (layout unchanged)', () => {
    const buf = new ArrayBuffer(snapshotLayout(0, 0).totalBytes);
    writeSnapshotHeader(buf, { tick: 1, hash: 2, entityCount: 0, eventCount: 0 });
    expect(readSnapshotHeader(buf)).toEqual({ tick: 1, hash: 2, entityCount: 0, eventCount: 0 });
  });
});
