import { describe, expect, it } from 'vitest';
import type { CommandEnvelope } from '@crawlout/protocol';
import { ROLES } from '@crawlout/data';
import { createSim } from '../src/index.js';
import type { Sim } from '../src/index.js';
import { cellCenter, createOpenMap } from '../src/testing.js';
import { DATA, REAL_CONFIG, bundle, cmd } from './helpers.js';

// Playtest H1 (sim 0.21.0): a group Move to a point against or inside a building footprint left units in the walk
// animation without moving, for good. A point inside a footprint gave every unit offset 0, so they walked at the point,
// reached the edge of the footprint and stood there "walking". Now any Move target resolves to the nearest reachable
// free point (formation.ts, formationSlots step 0 and 1), formation slots never land inside a footprint, and a unit that
// reaches the edge of its target rectangle with its goal inside it has arrived (movement.ts). Real footprints (an
// HQ of 21 x 21, a Raider camp of 17 x 17) on an open map, like large-footprint.test.ts.

const RAIDERS = DATA.factions.findIndex((f) => f.key === 'raiders');
const typeOf = (key: string): number => {
  const l = DATA.loadouts.find((x) => x.key === key);
  if (l !== undefined) return REAL_CONFIG.unitTypes.find((u) => u.loadoutId === l.id)!.typeId;
  const b = DATA.buildings.find((x) => x.key === key)!;
  return REAL_CONFIG.buildingTypes.find((t) => t.buildingId === b.id)!.typeId;
};
const MILITIE = typeOf('militie');
const SLAAF_BOUWER = typeOf('slaaf_bouwer');

function bigSim(factionId: number): Sim {
  const map = { ...createOpenMap(), spawns: [cellCenter(40, 40), cellCenter(87, 87)] };
  const config = { ...REAL_CONFIG, placement: { ...REAL_CONFIG.placement, buildRange: 0 } };
  return createSim({
    seed: 1,
    players: [
      { factionId, ai: false },
      { factionId: 0, ai: false },
    ],
    map,
    config,
  });
}

function play(sim: Sim, frames: number, script: Map<number, CommandEnvelope[]> = new Map()) {
  for (let n = 0; n < frames; n++) {
    const f = sim.frame;
    sim.applyBundle(bundle(f, script.get(f) ?? []));
    sim.tick();
  }
}
const now = (sim: Sim, type: CommandEnvelope['type'], payload: unknown): void =>
  play(sim, 1, new Map([[sim.frame, [cmd(sim.frame, 0, type, payload)]]]));

/** The footprint (cells, [x0, x1) x [y0, y1)) of the own building of type `typeId`. */
function footprint(sim: Sim, typeId: number): { x0: number; y0: number; x1: number; y1: number } {
  const id = sim.entityIds().find((e) => {
    const u = sim.getUnit(e)!;
    return u.kind === 'building' && u.typeId === typeId && u.owner === 0;
  })!;
  const i = sim.world.resolve(id);
  const w = sim.world;
  return { x0: w.fx[i]!, y0: w.fy[i]!, x1: w.fx[i]! + w.fw[i]!, y1: w.fy[i]! + w.fh[i]! };
}
const inside = (r: { x0: number; y0: number; x1: number; y1: number }, x: number, y: number) =>
  x >> 8 >= r.x0 && x >> 8 < r.x1 && y >> 8 >= r.y0 && y >> 8 < r.y1;
/** Chebyshev distance in metres from a point to the footprint (0 inside). */
const toEdge = (r: { x0: number; y0: number; x1: number; y1: number }, x: number, y: number) => {
  const cx = x / 256;
  const cy = y / 256;
  return Math.max(r.x0 - cx, cx - r.x1, r.y0 - cy, cy - r.y1, 0);
};

/**
 * Runs `frames` ticks and returns the units that are in the walk animation (moving) without having moved more than
 * half a metre over the last 20 seconds: the playtest bot's "loopt-animatie maar staat stil".
 */
function walkingOnTheSpot(sim: Sim, ids: readonly number[], frames: number): number[] {
  play(sim, frames - 400);
  const at = ids.map((id) => [sim.getUnit(id)!.x, sim.getUnit(id)!.y] as const);
  play(sim, 400);
  return ids.filter((id, k) => {
    const u = sim.getUnit(id)!;
    return u.moving && Math.hypot(u.x - at[k]![0], u.y - at[k]![1]) < 128;
  });
}

describe('H1: a Move against or inside a building footprint resolves and the units go idle', () => {
  it('Dwellers: hero and 6 militia ordered into the south edge of the HQ stand idle in front of it', () => {
    const sim = bigSim(0);
    const hq = footprint(sim, typeOf('hoofdgebouw'));
    const hero = sim
      .entityIds()
      .find((e) => sim.getUnit(e)!.kind === 'hero' && sim.getUnit(e)!.owner === 0)!;
    const militia: number[] = [];
    for (let k = 0; k < 6; k++) {
      const c = cellCenter(22 + (k % 3) * 2, 64 + Math.floor(k / 3) * 2);
      const id = sim.spawnUnit({ typeId: MILITIE, owner: 0, ...c });
      expect(id).not.toBe(0);
      militia.push(id);
    }
    const ids = [hero, ...militia];
    // the playtest's click: half a metre inside the south edge of the HQ, a little off its middle column
    const tx = ((hq.x0 + hq.x1) << 7) - 128;
    const ty = (hq.y1 << 8) - 128;
    expect(inside(hq, tx, ty)).toBe(true);
    now(sim, 'Move', { ids, x: tx, y: ty });
    // every slot (the goal each unit walks to) is walkable and outside the footprint
    for (const id of ids) {
      const i = sim.world.resolve(id);
      const gx = sim.world.goalX[i]!;
      const gy = sim.world.goalY[i]!;
      expect(inside(hq, gx, gy), `slot of ${id}`).toBe(false);
      expect(sim.terrain.walk[(gy >> 8) * sim.map.w + (gx >> 8)], `slot of ${id}`).toBe(1);
    }
    expect(walkingOnTheSpot(sim, ids, 1600)).toEqual([]);
    for (const id of ids) {
      const u = sim.getUnit(id)!;
      expect(u.moving, `unit ${id}`).toBe(false);
      expect(u.order, `unit ${id}`).toBe(0); // the Move is done: idle
      expect(inside(hq, u.x, u.y)).toBe(false);
      // in front of the south edge, where the click was, not round the back of the building
      expect(u.y >> 8, `unit ${id}`).toBeGreaterThanOrEqual(hq.y1);
      expect(toEdge(hq, u.x, u.y), `unit ${id}`).toBeLessThan(6);
    }
  });

  it('Raiders: a slave builder ordered into its own camp stands idle at the edge nearest to the click', () => {
    const sim = bigSim(RAIDERS);
    const camp = footprint(sim, typeOf('raiderkamp'));
    const builder = sim
      .entityIds()
      .find((e) => sim.getUnit(e)!.typeId === SLAAF_BOUWER && sim.getUnit(e)!.owner === 0)!;
    expect(builder).toBeDefined();
    // first round to the far side of the camp, then into the footprint near the opposite corner (the playtest's
    // (294, 82) inside the camp at (300, 76): 6 m west and 6 m south of its middle)
    const far = cellCenter(camp.x1 + 3, camp.y0 - 3);
    now(sim, 'Move', { ids: [builder], x: far.x, y: far.y });
    play(sim, 600);
    const mid = { x: (camp.x0 + camp.x1) << 7, y: (camp.y0 + camp.y1) << 7 };
    const tx = mid.x - 6 * 256;
    const ty = mid.y + 6 * 256;
    expect(inside(camp, tx, ty)).toBe(true);
    now(sim, 'Move', { ids: [builder], x: tx, y: ty });
    expect(walkingOnTheSpot(sim, [builder], 1600)).toEqual([]);
    const u = sim.getUnit(builder)!;
    expect(u.moving).toBe(false);
    expect(u.order).toBe(0);
    expect(ROLES[u.role]).toBe('builder');
    expect(inside(camp, u.x, u.y)).toBe(false);
    expect(toEdge(camp, u.x, u.y)).toBeLessThan(3);
    // the point is near the south-west of the camp: the builder ends up there
    expect(u.x).toBeLessThan(mid.x);
    expect(u.y).toBeGreaterThan(mid.y);
  });

  it('an AttackMove onto an enemy building still walks at it (no formation beside it)', () => {
    const sim = bigSim(0);
    const enemyHq = sim.entityIds().find((e) => {
      const u = sim.getUnit(e)!;
      return u.kind === 'building' && u.owner === 1;
    })!;
    const e = sim.getUnit(enemyHq)!;
    const ids: number[] = [];
    for (let k = 0; k < 3; k++) {
      const id = sim.spawnUnit({ typeId: MILITIE, owner: 0, ...cellCenter(60 + k, 60) });
      ids.push(id);
    }
    now(sim, 'AttackMove', { ids, x: e.x, y: e.y });
    for (const id of ids) {
      const i = sim.world.resolve(id);
      expect(sim.world.goalX[i]).toBe(e.x);
      expect(sim.world.goalY[i]).toBe(e.y);
    }
  });

  it('two runs give the same hashes per tick', () => {
    const run = (): number[] => {
      const sim = bigSim(0);
      const ids = [0, 1, 2, 3].map((k) =>
        sim.spawnUnit({ typeId: MILITIE, owner: 0, ...cellCenter(20 + k, 66) }),
      );
      const hq = footprint(sim, typeOf('hoofdgebouw'));
      const out: number[] = [];
      const script = new Map([
        [1, [cmd(1, 0, 'Move', { ids, x: (hq.x0 + 3) << 8, y: (hq.y1 - 1) << 8 })]],
      ]);
      for (let f = 0; f < 500; f++) {
        sim.applyBundle(bundle(f, script.get(f) ?? []));
        out.push(sim.tick());
      }
      return out;
    };
    expect(run()).toEqual(run());
  });
});
