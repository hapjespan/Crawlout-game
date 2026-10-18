// Shared parts of the playtest bots (playtest.ts, playtest2.ts): the Bot (logging, reading the game, human-speed input,
// camera) and the building placement through the real B menu. Not a script; importing it starts nothing.

export {
  SHOTS,
  MINUTES,
  ALL_FINDINGS,
  wait,
  BUILDING_MIN,
  BUILDING_MAX,
  SCRAP_NODE,
  CLAIM_POINT,
  ANIM_BUILD,
  TICK_HZ,
  DUTCH,
  ENTS,
  rectOf,
  textOf,
  LAYOUT_AUDIT,
} from './playtest-core.part1.js';
export type { Severity, Finding, Pt, Box, Ent, PerfSample } from './playtest-core.part1.js';
export { Bot } from './playtest-core.part2.js';
export { placeBuilding, untilBuilt } from './playtest-core.part3.js';
