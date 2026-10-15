import { describe, expect, it } from 'vitest';
import { EVENT_TYPE } from '@crawlout/protocol';
import type { CommandEnvelope } from '@crawlout/protocol';
import { createSim } from '../src/index.js';
import type { Sim } from '../src/index.js';
import { cellCenter, createOpenMap, testPlayers } from '../src/testing.js';
import { BUILDER, DATA, REAL_CONFIG, SCAV, cmd } from './helpers.js';

// Gebouwen op echte schaal (data 0.14.0): de footprints uit data/buildings.json zoals ze zijn (een hoofdgebouw van
// 21 x 21, een woning van 13 x 19). De andere sim-tests draaien op compacte footprints (helpers.ts); deze tests laten
// zien dat de sim een grote footprint net zo behandelt: de startopstelling, een bouwer die de rand haalt en eenheden
// die eromheen lopen.

const typeOf = (key: string): number => {
  const b = DATA.buildings.find((x) => x.key === key)!;
  return REAL_CONFIG.buildingTypes.find((t) => t.buildingId === b.id)!.typeId;
};
const WONING = typeOf('woning');
const HQ = typeOf('hoofdgebouw');
const fpOf = (typeId: number): { w: number; h: number } => {
  const t = REAL_CONFIG.buildingTypes.find((b) => b.typeId === typeId)!;
  return { w: t.footprintW, h: t.footprintH };
};

/** Een open map van 128 x 128 met de spawns ver genoeg van de rand voor een hoofdgebouw van 21 x 21. */
function bigSim(seed = 1): Sim {
  const map = { ...createOpenMap(), spawns: [cellCenter(24, 24), cellCenter(103, 103)] };
  return createSim({ seed, players: testPlayers(2), map, config: REAL_CONFIG });
}

/** De footprint (cellen) van gebouw `id` uit zijn midden en zijn type. */
function rectOf(sim: Sim, id: number): { x0: number; y0: number; x1: number; y1: number } {
  const u = sim.getUnit(id)!;
  const { w, h } = fpOf(u.typeId);
  const x0 = (u.x - w * 128) >> 8;
  const y0 = (u.y - h * 128) >> 8;
  return { x0, y0, x1: x0 + w, y1: y0 + h };
}

function run(sim: Sim, frames: number, cmds: Map<number, CommandEnvelope[]>, each?: () => void) {
  const events: { type: number; a: number }[] = [];
  for (let n = 0; n < frames; n++) {
    const f = sim.frame;
    sim.applyBundle({ frame: f, commands: cmds.get(f) ?? [] });
    sim.tick();
    for (let k = 0; k < sim.events.count; k++)
      events.push({ type: sim.events.type[k]!, a: sim.events.a[k]! });
    each?.();
  }
  return events;
}

const ownUnit = (sim: Sim, typeId: number, owner = 0): number =>
  sim
    .entityIds()
    .find((id) => sim.getUnit(id)!.typeId === typeId && sim.getUnit(id)!.owner === owner)!;

describe('gebouwen op echte schaal (grote footprints)', () => {
  it('de data heeft de echte maten: een woning van 13 x 19 en een hoofdgebouw van 21 x 21, oneven voor de spiegel', () => {
    expect(fpOf(WONING)).toEqual({ w: 13, h: 19 });
    expect(fpOf(HQ)).toEqual({ w: 21, h: 21 });
    // een oneven footprint ligt met zijn middelste cel op de spawn: puntsymmetrisch op een map van even breedte
    for (const t of REAL_CONFIG.buildingTypes) {
      expect(t.footprintW % 2, `${t.buildingId}`).toBe(1);
      expect(t.footprintH % 2, `${t.buildingId}`).toBe(1);
    }
  });

  it('het hoofdgebouw staat met zijn midden op de spawn en zijn cellen zijn dicht', () => {
    const sim = bigSim();
    const hq = ownUnit(sim, HQ);
    const r = rectOf(sim, hq);
    expect(r).toEqual({ x0: 14, y0: 14, x1: 35, y1: 35 });
    // geen unit in het gebouw; net erbuiten wel
    const inside = cellCenter(24, 30);
    expect(sim.spawnUnit({ typeId: SCAV, owner: 0, x: inside.x, y: inside.y })).toBe(0);
    const outside = cellCenter(24, 36);
    expect(sim.spawnUnit({ typeId: SCAV, owner: 0, x: outside.x, y: outside.y })).not.toBe(0);
  });

  it('een bouwer zet een woning van 13 x 19: hij loopt naar de rand, bouwt binnen interactRange en maakt hem af', () => {
    const sim = bigSim(2);
    const builder = ownUnit(sim, BUILDER);
    const site = cellCenter(60, 30);
    const wt = REAL_CONFIG.buildingTypes.find((b) => b.typeId === WONING)!;
    const cmds = new Map([
      [0, [cmd(0, 0, 'Build', { ids: [builder], typeId: WONING, x: site.x, y: site.y })]],
    ]);
    let placed = 0;
    let nearest = Infinity;
    const events = run(sim, wt.buildTicks + 1200, cmds, () => {
      for (let k = 0; k < sim.events.count; k++)
        if (sim.events.type[k] === EVENT_TYPE.buildingPlaced) placed = sim.events.a[k]!;
      if (placed === 0) return;
      const u = sim.getUnit(builder)!;
      const r = rectOf(sim, placed);
      // afstand (eenheden) van de bouwer tot de rand van de footprint, zolang de plaats in aanbouw is
      if (sim.getUnit(placed)!.buildState === 1) {
        const dx = Math.max(r.x0 * 256 - u.x, 0, u.x - r.x1 * 256);
        const dy = Math.max(r.y0 * 256 - u.y, 0, u.y - r.y1 * 256);
        nearest = Math.min(nearest, Math.hypot(dx, dy));
      }
      // nooit in de footprint
      const cx = u.x >> 8;
      const cy = u.y >> 8;
      expect(cx >= r.x0 && cx < r.x1 && cy >= r.y0 && cy < r.y1).toBe(false);
    });
    expect(placed).not.toBe(0);
    // de bouwer stond tijdens het bouwen aan de rand, binnen interactRange
    expect(nearest).toBeLessThanOrEqual(REAL_CONFIG.interactRange);
    expect(rectOf(sim, placed)).toEqual({ x0: 54, y0: 21, x1: 67, y1: 40 });
    expect(events.some((e) => e.type === EVENT_TYPE.buildingDone && e.a === placed)).toBe(true);
    expect(sim.getUnit(placed)!.buildState).toBe(2);
    expect(sim.playerStatus(0).beds).toBeGreaterThanOrEqual(wt.beds);
  });

  it('een eenheid loopt om een woning van 13 x 19 heen naar de overkant en staat nooit in het gebouw', () => {
    const sim = bigSim(3);
    const builder = ownUnit(sim, BUILDER);
    const site = cellCenter(64, 64);
    const wt = REAL_CONFIG.buildingTypes.find((b) => b.typeId === WONING)!;
    let events = run(
      sim,
      wt.buildTicks + 1200,
      new Map([
        [0, [cmd(0, 0, 'Build', { ids: [builder], typeId: WONING, x: site.x, y: site.y })]],
      ]),
    );
    const house = events.find((e) => e.type === EVENT_TYPE.buildingPlaced)!.a;
    expect(sim.getUnit(house)!.buildState).toBe(2);
    const r = rectOf(sim, house);
    // een plunderaar links van het huis, halverwege de lange kant; het doel recht tegenover aan de rechterkant
    const from = cellCenter(r.x0 - 3, (r.y0 + r.y1) >> 1);
    const to = cellCenter(r.x1 + 3, (r.y0 + r.y1) >> 1);
    const walker = sim.spawnUnit({ typeId: SCAV, owner: 0, x: from.x, y: from.y });
    expect(walker).not.toBe(0);
    const f0 = sim.frame;
    let inside = 0;
    events = run(
      sim,
      600,
      new Map([[f0, [cmd(f0, 0, 'Move', { ids: [walker], x: to.x, y: to.y })]]]),
      () => {
        const u = sim.getUnit(walker)!;
        const cx = u.x >> 8;
        const cy = u.y >> 8;
        if (cx >= r.x0 && cx < r.x1 && cy >= r.y0 && cy < r.y1) inside++;
      },
    );
    expect(inside).toBe(0);
    const end = sim.getUnit(walker)!;
    expect(Math.hypot(end.x - to.x, end.y - to.y)).toBeLessThan(256);
    expect(end.moving).toBe(false);
  });
});
