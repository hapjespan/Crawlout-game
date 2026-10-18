import type { Replay } from '@crawlout/protocol';
import { createReplaySim } from './run.js';

// What the Raider mechanics did during a replay (sim 0.18.0): counted per tick from the public sim state, for the
// fixture tests (raiders-fixtures.test.ts). Floats are fine here.

export interface RaiderMechanics {
  /** Units caught from another player (a captive with slaveFrom a player), counted once each. */
  captures: number;
  /** Captives that became slaves after the transition. */
  transitions: number;
  /** Units freed (state freed seen), and escaped slaves (neutral wanderers). */
  freed: number;
  escaped: number;
  /** Arrivals of the tent safety net (the counter at the end). */
  netArrivals: number;
  /** Units that had a chem active, and in the crash, at some tick. */
  dosed: number;
  crashed: number;
  /** Ticks in which player 0 held a settlement claim point (tribute). */
  tributeTicks: number;
  /** Camp takeover (sim 0.22.0): camps player 0 holds as an outpost at the end, bandits that joined him, and yields. */
  takeovers: number;
  recruits: number;
  yields: number;
  frames: number;
}

/** Plays replay `r` to its last hash frame and counts the Raider mechanics (player 0 is the Raider). */
export function raiderMechanics(r: Replay): RaiderMechanics {
  const sim = createReplaySim(r);
  const last = r.hashes.length > 0 ? r.hashes[r.hashes.length - 1]!.frame : 0;
  const byFrame = new Map(r.bundles.map((b) => [b.frame, b]));
  const m: RaiderMechanics = {
    captures: 0,
    transitions: 0,
    freed: 0,
    escaped: 0,
    netArrivals: 0,
    dosed: 0,
    crashed: 0,
    tributeTicks: 0,
    takeovers: 0,
    recruits: 0,
    yields: 0,
    frames: last + 1,
  };
  const seen = new Set<string>();
  /** True the first time unit `id` shows `what`. */
  const mark = (id: number, what: string): boolean => {
    const key = `${id}:${what}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  };
  const settlement = sim.map.claimPoints.map((c) => c.kind === 1);
  for (let f = 0; f <= last; f++) {
    sim.applyBundle(byFrame.get(f) ?? { frame: f, commands: [] });
    sim.tick();
    const w = sim.world;
    for (let i = 0; i < w.highWater; i++) {
      if (w.alive[i] !== 1) continue;
      const id = w.idOf(i);
      const st = w.slaveState[i]!;
      if (st === 1 && w.slaveFrom[i]! < 2 && w.slaveFrom[i] !== w.owner[i] && mark(id, 'captive'))
        m.captures++;
      if (st === 2 && w.slaveFrom[i]! < 2 && mark(id, 'transition')) m.transitions++;
      if (st === 3 && mark(id, 'freed')) m.freed++;
      if (w.owner[i] === 255 && (w.mask[i]! & 16) !== 0 && mark(id, 'escaped')) m.escaped++;
      if (w.chemPhase[i] === 1 && mark(id, 'dosed')) m.dosed++;
      if (w.chemPhase[i] === 2 && mark(id, 'crash')) m.crashed++;
      if (w.owner[i] === 255 && w.creepCamp[i] !== 0) mark(id, 'bandit');
      if (w.owner[i] === 0 && seen.has(`${id}:bandit`) && mark(id, 'recruit')) m.recruits++;
    }
    let held = false;
    sim.claimPoints.forEach((pt, k) => {
      if (settlement[k] === true && w.owner[pt] === 0) held = true;
    });
    if (held) m.tributeTicks++;
  }
  m.netArrivals = sim.ps.netArrivals[0]!;
  (sim.map.creepCamps ?? []).forEach((_, k) => {
    // CAMP_TAKEN (4) by player 0 (clearedBy = player + 1)
    if (sim.creeps.state[k] === 4 && sim.creeps.clearedBy[k] === 1) {
      m.takeovers++;
      m.yields += sim.creeps.yields[k]!;
    }
  });
  return m;
}
