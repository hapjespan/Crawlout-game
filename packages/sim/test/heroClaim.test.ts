import { describe, expect, it } from 'vitest';
import { EVENT_TYPE, OWNER_NEUTRAL } from '@crawlout/protocol';
import type { CommandEnvelope } from '@crawlout/protocol';
import { createSim } from '../src/index.js';
import type { Sim } from '../src/index.js';
import { cellCenter, createOpenMap } from '../src/testing.js';
import { CONFIG, SCAV, bundle, cmd, testInit, typeByKey } from './helpers.js';

// Martien, 16 October: "de hero held mag ook palen claimen door 3 minuten in de zone te blijven staan. dit is dan
// zonder tower en is over te nemen door vijandelijke units die dit punt aanvallen. ... hij gaat pas over als er geen
// faction van de andere partij in de circel aanwezig is en of vernietigd is." (data 0.20.0, systems/claims.ts)

const HERO_TICKS = 300;
const FLIP_TICKS = 120;
const CFG = { ...CONFIG, heroClaimTicks: HERO_TICKS, contestFlipTicks: FLIP_TICKS };

function play(
  sim: Sim,
  frames: number,
  cmds: CommandEnvelope[] = [],
): { type: number; b: number }[] {
  const out: { type: number; b: number }[] = [];
  for (let n = 0; n < frames; n++) {
    sim.applyBundle(bundle(sim.frame, n === 0 ? cmds : []));
    sim.tick();
    for (let k = 0; k < sim.events.count; k++)
      out.push({ type: sim.events.type[k]!, b: sim.events.b[k]! });
  }
  return out;
}
const one = (sim: Sim, kind: string, owner?: number): number =>
  sim
    .entityIds()
    .find(
      (id) =>
        sim.getUnit(id)!.kind === kind && (owner === undefined || sim.getUnit(id)!.owner === owner),
    )!;
const status = (sim: Sim) => sim.playerStatus(0).claimPoints![0]!;

function setup(): { sim: Sim; pt: number; hero: number; x: number; y: number } {
  const sim = createSim({ ...testInit(31, createOpenMap(64, 64)), config: CFG });
  const pt = one(sim, 'claimPoint');
  const hero = one(sim, 'hero', 0);
  const v = sim.getUnit(pt)!;
  return { sim, pt, hero, x: v.x, y: v.y };
}

/** Walks the hero onto the point and lets him stand there until he holds it. */
function heroClaims(t: ReturnType<typeof setup>): void {
  const f = t.sim.frame;
  play(t.sim, 400, [cmd(f, 0, 'Move', { ids: [t.hero], x: t.x + 256, y: t.y })]);
  play(t.sim, HERO_TICKS + 10);
}

describe('the hero claims a point without a post (data 0.20.0)', () => {
  it('standing in the circle for heroClaimS claims a free point: a beacon, no building, counts as owned', () => {
    const t = setup();
    expect(t.sim.getUnit(t.pt)!.owner).toBe(OWNER_NEUTRAL);
    const f = t.sim.frame;
    play(t.sim, 400, [cmd(f, 0, 'Move', { ids: [t.hero], x: t.x + 256, y: t.y })]);
    const mid = status(t.sim);
    expect(mid).toMatchObject({ owner: OWNER_NEUTRAL, activity: 'hero', by: 0, beacon: false });
    expect(mid.progressPermille).toBeGreaterThan(0);
    const ev = play(t.sim, HERO_TICKS);
    expect(t.sim.getUnit(t.pt)!.owner).toBe(0);
    expect(ev.filter((e) => e.type === EVENT_TYPE.claimTaken)).toEqual([
      { type: EVENT_TYPE.claimTaken, b: 0 },
    ]);
    expect(status(t.sim)).toMatchObject({ owner: 0, beacon: true, activity: 'none' });
    expect(t.sim.playerStatus(0).dominance.pointsHeld).toBe(1);
    expect(
      t.sim.entityIds().filter((id) => t.sim.getUnit(id)!.typeId === typeByKey('claimpaal')),
    ).toEqual([]);
  });

  it('leaving the circle starts the count over; an enemy unit in the circle stops it', () => {
    const t = setup();
    const f = t.sim.frame;
    play(t.sim, 400, [cmd(f, 0, 'Move', { ids: [t.hero], x: t.x + 256, y: t.y })]);
    const enemy = t.sim.spawnUnit({ typeId: SCAV, owner: 1, x: t.x - 512, y: t.y });
    const before = status(t.sim).progressPermille;
    play(t.sim, 3); // (within a few ticks: the hero would shoot the scavenger)
    expect(status(t.sim)).toMatchObject({ frozen: true, progressPermille: before });
    // the enemy walks off; the hero walks off and back: the count starts at zero
    const g = t.sim.frame;
    play(t.sim, 300, [
      cmd(g, 1, 'Move', { ids: [enemy], x: t.x - 20 * 256, y: t.y }),
      cmd(g, 0, 'Move', { ids: [t.hero], x: t.x + 20 * 256, y: t.y }),
    ]);
    expect(status(t.sim)).toMatchObject({ activity: 'none', progressPermille: 0 });
    expect(t.sim.getUnit(t.pt)!.owner).toBe(OWNER_NEUTRAL);
  });
});

describe('a beacon can be taken over (data 0.20.0)', () => {
  it('frozen while units of both sides stand in the circle; goes over once only the attacker is left', () => {
    const t = setup();
    heroClaims(t);
    expect(t.sim.getUnit(t.pt)!.owner).toBe(0);
    // the hero leaves, a scavenger of the holder stays, an enemy scavenger walks in
    const own = t.sim.spawnUnit({
      typeId: SCAV,
      owner: 0,
      ...cellCenter((t.x >> 8) - 2, t.y >> 8),
    });
    const enemy = t.sim.spawnUnit({
      typeId: SCAV,
      owner: 1,
      ...cellCenter((t.x >> 8) + 2, t.y >> 8),
    });
    const f = t.sim.frame;
    play(t.sim, 3 * FLIP_TICKS, [cmd(f, 0, 'Move', { ids: [t.hero], x: t.x + 20 * 256, y: t.y })]);
    expect(t.sim.getUnit(t.pt)!.owner).toBe(0);
    expect(status(t.sim)).toMatchObject({ frozen: true, beacon: true });
    // the holder's unit leaves (or dies): the attacker takes it over in contestFlipS
    const g = t.sim.frame;
    play(t.sim, 120, [cmd(g, 0, 'Move', { ids: [own], x: t.x - 20 * 256, y: t.y })]);
    expect(status(t.sim)).toMatchObject({ owner: 0, activity: 'contest', by: 1, frozen: false });
    const ev = play(t.sim, FLIP_TICKS);
    expect(t.sim.getUnit(t.pt)!.owner).toBe(1);
    expect(status(t.sim)).toMatchObject({ owner: 1, beacon: true });
    expect(ev.filter((e) => e.type === EVENT_TYPE.claimTaken).map((e) => e.b)).toEqual([1]);
    void enemy;
  });

  it('a finished claim post beats a beacon; the holder building his own post makes it a post claim', () => {
    const t = setup();
    heroClaims(t);
    const paal = typeByKey('claimpaal');
    t.sim.spawnBuilding(paal, 1, (t.x >> 8) + 2, t.y >> 8);
    play(t.sim, 2);
    expect(t.sim.getUnit(t.pt)!.owner).toBe(1);
    expect(status(t.sim).beacon).toBe(false);
  });
});
