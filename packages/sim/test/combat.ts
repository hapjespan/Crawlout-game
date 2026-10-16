import type { CommandEnvelope } from '@crawlout/protocol';
import { createSim } from '../src/index.js';
import type { Sim, SimConfig } from '../src/index.js';
import { cellCenter, createOpenMap, testPlayers } from '../src/testing.js';
import { CONFIG, bundle, cmd, typeByKey } from './helpers.js';

// Combat harness (balance ronde 16 oktober, feedback Martien): one robot side against N humans on open flat ground in
// an otherwise empty world (no buildings, no hero, so no auras and no crits). Both sides get an AttackMove to the
// other side's start at frame 0, as two armies that meet; the fight runs until one side has no fighters left or the
// time runs out. The robot side gets one technicus per robotsPerTechnician robots far behind its start (out of aggro
// range of everything), as a player with robots has in a real game, so the robots fight at full rate. The outcome
// depends only on data (hp, armour, damage matrix, damage, cooldown, range, speed): there is no rng in this fight.

/** Map of 128 by 128 cells of 1 m: open ground with only the border wall. */
const MAP_CELLS = 128;
const MID = MAP_CELLS >> 1;
/** Hard stop: a fight that is not over after this many ticks is a draw. */
const MAX_TICKS = 20 * 180;
const TECH_BEHIND_M = 36;

export interface Layout {
  /** Distance between the two group centres in metres (above the sentinel range, so it meets an approaching army). */
  readonly distanceM: number;
  /** Lateral offset of the robot group in metres. */
  readonly lateralM: number;
  /** Humans in one rank across the line of fire, or in a block two deep. */
  readonly formation: 'line' | 'block';
  /** Owner of the robot side: 0 (robot on the left) or 1 (robot on the right; the mirror). */
  readonly robotPlayer: 0 | 1;
}

export interface DuelSpec {
  readonly robot: string;
  readonly robots?: number;
  readonly human: string;
  readonly humans: number;
  readonly layout: Layout;
  readonly config?: SimConfig;
}

export interface DuelResult {
  readonly winner: 'robot' | 'humans' | 'draw';
  readonly robotsLeft: number;
  readonly humansLeft: number;
  /** Remaining hp of the robot side as a fraction of its start hp. */
  readonly robotHpFrac: number;
  /** Remaining hp of the humans as a fraction of their start hp. */
  readonly humanHpFrac: number;
  /** Robot side minus human side (remaining hp fractions): above 0 the robots won, below 0 the humans. */
  readonly margin: number;
  readonly seconds: number;
}

/** The layouts of a sweep: three distances, two lateral offsets, two formations and both sides of the map. */
export const LAYOUTS: readonly Layout[] = (() => {
  const out: Layout[] = [];
  for (const robotPlayer of [0, 1] as const)
    for (const distanceM of [36, 42, 48])
      for (const lateralM of [0, 3])
        for (const formation of ['line', 'block'] as const)
          out.push({ distanceM, lateralM, formation, robotPlayer });
  return out;
})();

const cellOf = (m: number): number => Math.round(m);

export function duel(spec: DuelSpec): DuelResult {
  const config = spec.config ?? CONFIG;
  const { layout } = spec;
  const robotType = typeByKey(spec.robot);
  const humanType = typeByKey(spec.human);
  const techType = typeByKey('technicus');
  const sim: Sim = createSim(
    { seed: 1, players: testPlayers(2), map: createOpenMap(MAP_CELLS, MAP_CELLS), config },
    { start: false },
  );
  const humanPlayer = layout.robotPlayer === 0 ? 1 : 0;
  // the robot side faces +x from the left or -x from the right; the humans stand opposite
  const dir = layout.robotPlayer === 0 ? 1 : -1;
  const rx = MID - (dir * layout.distanceM) / 2;
  const hx = MID + (dir * layout.distanceM) / 2;
  const ry = MID + layout.lateralM;

  const nRobots = spec.robots ?? 1;
  const robots: number[] = [];
  for (let k = 0; k < nRobots; k++) {
    const id = sim.spawnUnit({
      typeId: robotType,
      owner: layout.robotPlayer,
      ...cellCenter(cellOf(rx), cellOf(ry + 2 * k - (nRobots - 1))),
    });
    if (id === 0) throw new Error('robot spawn failed');
    robots.push(id);
  }
  const perTech = config.factions[0]!.robotRules?.robotsPerTechnician ?? 0;
  const techs = perTech > 0 ? Math.ceil(nRobots / perTech) : 0;
  for (let k = 0; k < techs; k++) {
    const id = sim.spawnUnit({
      typeId: techType,
      owner: layout.robotPlayer,
      ...cellCenter(cellOf(rx - dir * TECH_BEHIND_M), cellOf(ry + k)),
    });
    if (id === 0) throw new Error('technicus spawn failed');
  }
  const humans: number[] = [];
  const rows = layout.formation === 'line' ? 1 : 2;
  const cols = Math.ceil(spec.humans / rows);
  for (let k = 0; k < spec.humans; k++) {
    const col = k % cols;
    const row = Math.floor(k / cols);
    const id = sim.spawnUnit({
      typeId: humanType,
      owner: humanPlayer,
      ...cellCenter(cellOf(hx + dir * row), cellOf(MID + col - Math.floor(cols / 2))),
    });
    if (id === 0) throw new Error('human spawn failed');
    humans.push(id);
  }

  const robotStart = cellCenter(cellOf(rx), cellOf(ry));
  const humanStart = cellCenter(cellOf(hx), MID);
  const first: CommandEnvelope[] = [
    cmd(0, layout.robotPlayer, 'AttackMove', { ids: robots, ...humanStart }),
    cmd(0, humanPlayer, 'AttackMove', { ids: humans, ...robotStart }),
  ];

  const startHp = (ids: number[]): number => ids.reduce((s, id) => s + sim.getUnit(id)!.maxHp, 0);
  const hpLeft = (ids: number[]): { alive: number; hp: number } => {
    let alive = 0;
    let hp = 0;
    for (const id of ids) {
      const u = sim.getUnit(id);
      if (u === null || u.kind !== 'unit' || u.hp <= 0) continue;
      alive++;
      hp += u.hp;
    }
    return { alive, hp };
  };
  const robotHp0 = startHp(robots);
  const humanHp0 = startHp(humans);

  let ticks = 0;
  let r = hpLeft(robots);
  let h = hpLeft(humans);
  while (ticks < MAX_TICKS && r.alive > 0 && h.alive > 0) {
    sim.applyBundle(bundle(sim.frame, ticks === 0 ? first : []));
    sim.tick();
    ticks++;
    r = hpLeft(robots);
    h = hpLeft(humans);
  }
  const winner =
    r.alive > 0 && h.alive === 0 ? 'robot' : h.alive > 0 && r.alive === 0 ? 'humans' : 'draw';
  const robotHpFrac = r.hp / robotHp0;
  const humanHpFrac = h.hp / humanHp0;
  return {
    winner,
    robotsLeft: r.alive,
    humansLeft: h.alive,
    robotHpFrac,
    humanHpFrac,
    margin: robotHpFrac - humanHpFrac,
    seconds: ticks / 20,
  };
}

export interface SweepResult {
  readonly humans: number;
  readonly runs: number;
  readonly robotWins: number;
  readonly humanWins: number;
  readonly draws: number;
  /** Mean of the margins (robot side minus humans, remaining hp fractions). */
  readonly meanMargin: number;
  readonly meanSeconds: number;
  readonly meanHumansLeft: number;
  readonly meanRobotHpFrac: number;
  /** Robot wins as a fraction of all runs, a draw counted as half. */
  readonly robotShare: number;
}

/** One robot side against N humans over all LAYOUTS (both mirror sides). */
export function sweep(
  robot: string,
  human: string,
  humans: number,
  opts: { robots?: number; config?: SimConfig } = {},
): SweepResult {
  const res = LAYOUTS.map((layout) => duel({ robot, human, humans, layout, ...opts }));
  const n = res.length;
  const sum = (f: (r: DuelResult) => number): number => res.reduce((s, r) => s + f(r), 0);
  const robotWins = res.filter((r) => r.winner === 'robot').length;
  const humanWins = res.filter((r) => r.winner === 'humans').length;
  const draws = n - robotWins - humanWins;
  return {
    humans,
    runs: n,
    robotWins,
    humanWins,
    draws,
    meanMargin: sum((r) => r.margin) / n,
    meanSeconds: sum((r) => r.seconds) / n,
    meanHumansLeft: sum((r) => r.humansLeft) / n,
    meanRobotHpFrac: sum((r) => r.robotHpFrac) / n,
    robotShare: (robotWins + draws / 2) / n,
  };
}

/** A sweep as one table row, for the report and for test failures. */
export function formatSweep(label: string, s: SweepResult): string {
  const f = (x: number, d = 2): string => x.toFixed(d);
  return (
    `${label.padEnd(34)} N=${s.humans}  robot ${String(s.robotWins).padStart(2)} / humans ` +
    `${String(s.humanWins).padStart(2)} / draw ${s.draws}  margin ${f(s.meanMargin).padStart(5)}  ` +
    `robot hp ${f(s.meanRobotHpFrac)}  humans left ${f(s.meanHumansLeft, 1)}  ${f(s.meanSeconds, 1)} s`
  );
}
