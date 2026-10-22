// Survival co-op (sim 0.27.0): the public surface of survival.part1.ts and survival.part2.ts.
export {
  SurvivalState,
  survivalOf,
  hqOf,
  threatScore,
  weakestPlayer,
  waveUnits,
  spawnWaves,
} from './survival.part1.js';
export {
  HORDE_WINNER,
  WIN_SURVIVED,
  WIN_OVERRUN,
  survivalSystem,
  survivalDeath,
  survivalOutcome,
  survivalZoneReason,
  waveAlive,
  survivalStatusOf,
} from './survival.part2.js';
export type { SurvivalStatus } from './survival.part2.js';
