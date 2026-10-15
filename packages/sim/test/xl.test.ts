import { describe, expect, it } from 'vitest';
import { FNV_OFFSET, fnv1a } from '../src/math/fnv.js';
import { deserialize } from '../src/index.js';
import type { Sim, SimInit } from '../src/index.js';
import {
  XL_CROSSINGS,
  XL_CROSSING_ROWS,
  XL_RIVER_HALF,
  cellCenter,
  createXlTestMap,
  testPlayers,
  xlRiverX,
} from '../src/testing.js';
import { CONFIG, bundle, cmd, emptySim, runFrames, spawnBlock, testInit } from './helpers.js';

// De sim op de grote map (sim-xl): 384 bij 384 cellen met rivier, oversteken en bos. Determinisme met de
// hiërarchische padvinding, de oversteek vinden, en herzien als een gebouw de oversteek dichtzet.

const XL = createXlTestMap();
const W = XL.w;
const xlInit = (): SimInit => testInit(5, XL, testPlayers(2));
const cellOf = (sim: Sim, id: number): { x: number; y: number } => {
  const u = sim.getUnit(id)!;
  return { x: u.x >> 8, y: u.y >> 8 };
};
const inRiver = (x: number, y: number): boolean => Math.abs(x - xlRiverX(W, y)) <= XL_RIVER_HALF;
const atCrossing = (y: number, k: number): boolean =>
  y >= XL_CROSSINGS[k]! && y < XL_CROSSINGS[k]! + XL_CROSSING_ROWS;

/** Twee groepen die van hoek tot hoek over de rivier lopen, en halverwege een tweede bevel. */
function setup(): { sim: Sim; script: Map<number, ReturnType<typeof cmd>[]> } {
  const sim = emptySim(5, XL, testPlayers(2));
  const a = spawnBlock(sim, 0, 36, 36, 20);
  const b = spawnBlock(sim, 1, W - 44, W - 44, 20);
  const ta = cellCenter(W - 50, W - 60);
  const tb = cellCenter(50, 60);
  const mid = cellCenter(150, 300);
  const script = new Map<number, ReturnType<typeof cmd>[]>();
  script.set(1, [cmd(1, 0, 'Move', { ids: a, x: ta.x, y: ta.y })]);
  script.set(2, [cmd(2, 1, 'Move', { ids: b, x: tb.x, y: tb.y })]);
  script.set(90, [cmd(90, 0, 'Move', { ids: a.slice(0, 7), x: mid.x, y: mid.y })]);
  return { sim, script };
}

describe('sim op de XL-testmap (384 x 384)', () => {
  it('twee runs geven dezelfde hashes per tick', () => {
    const r1 = setup();
    const r2 = setup();
    expect(runFrames(r1.sim, 240, r1.script)).toEqual(runFrames(r2.sim, 240, r2.script));
  });

  it('serialize/deserialize midden in een hiërarchische opbouw loopt identiek verder, ook met een kleine cache', () => {
    const { sim, script } = setup();
    const tiny = { ...xlInit(), config: { ...CONFIG, pathCacheCells: 1 } };
    for (const stop of [2, 3, 40, 91, 160]) {
      if (sim.frame < stop) runFrames(sim, stop - sim.frame, script);
      const buf = sim.serialize();
      expect(fnv1a(FNV_OFFSET, new Uint8Array(buf))).toBe(sim.hash());
      const copy = deserialize(buf, xlInit());
      const small = deserialize(buf, tiny);
      expect(copy.hash()).toBe(sim.hash());
      expect(small.hash()).toBe(sim.hash());
      const fork = (): Sim => deserialize(buf, xlInit());
      const want = runFrames(fork(), 50, script);
      expect(runFrames(copy, 50, script)).toEqual(want);
      expect(runFrames(small, 50, script)).toEqual(want);
    }
  });

  it('een unit vindt de oversteek en komt aan, nooit door water of bos', () => {
    const sim = emptySim(5, XL, testPlayers(2));
    const [id] = spawnBlock(sim, 0, 150, 120, 1);
    const t = cellCenter(240, 120);
    sim.applyBundle(bundle(0, [cmd(0, 0, 'Move', { ids: [id!], x: t.x, y: t.y })]));
    sim.tick();
    let crossedAt = -1;
    for (let f = 1; f < 6000 && sim.getUnit(id!)!.moving; f++) {
      sim.applyBundle(bundle(f));
      sim.tick();
      const c = cellOf(sim, id!);
      expect(sim.terrain.walk[c.y * W + c.x]).toBe(1);
      if (inRiver(c.x, c.y)) crossedAt = c.y;
    }
    const u = sim.getUnit(id!)!;
    expect(u.moving).toBe(false);
    expect(Math.abs(u.x - t.x) + Math.abs(u.y - t.y)).toBeLessThan(512);
    // van rij 120 naar rij 120: de oversteek op rij 64 is de kortste (192 ligt verder)
    expect(atCrossing(crossedAt, 0)).toBe(true);
  });

  it('een nieuw gebouw zet de oversteek dicht: het pad wordt herzien via een andere oversteek', () => {
    const sim = emptySim(5, XL, testPlayers(2));
    const [id] = spawnBlock(sim, 0, 150, 70, 1);
    const t = cellCenter(240, 70);
    sim.applyBundle(bundle(0, [cmd(0, 0, 'Move', { ids: [id!], x: t.x, y: t.y })]));
    sim.tick();
    const beacon = CONFIG.buildingTypes.find((b) => b.footprintW === 1 && b.footprintH === 1)!;
    const y0 = XL_CROSSINGS[0]!;
    let crossedAt = -1;
    let blocked = false;
    for (let f = 1; f < 9000 && sim.getUnit(id!)!.moving; f++) {
      if (f === 40) {
        // de unit loopt naar de oversteek op rij 64; zet die nu helemaal dicht met bakens op het water
        for (let y = y0; y < y0 + XL_CROSSING_ROWS; y++) {
          const cx = xlRiverX(W, y);
          for (let x = cx - XL_RIVER_HALF; x <= cx + XL_RIVER_HALF; x++)
            expect(sim.spawnBuilding(beacon.typeId, 1, x, y, true)).not.toBe(0);
        }
        blocked = true;
        expect(cellOf(sim, id!).x).toBeLessThan(xlRiverX(W, 70) - XL_RIVER_HALF);
      }
      sim.applyBundle(bundle(f));
      sim.tick();
      const c = cellOf(sim, id!);
      expect(sim.terrain.walk[c.y * W + c.x]).toBe(1);
      if (blocked && inRiver(c.x, c.y)) crossedAt = c.y;
    }
    const u = sim.getUnit(id!)!;
    expect(u.moving).toBe(false);
    expect(Math.abs(u.x - t.x) + Math.abs(u.y - t.y)).toBeLessThan(512);
    expect(atCrossing(crossedAt, 1)).toBe(true);
  });
});
