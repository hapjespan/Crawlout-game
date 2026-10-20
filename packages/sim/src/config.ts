// De grens van de sim: alles in sim-eenheden (integers). De adapter in fromData.ts vult deze types uit GameData
// (packages/data) en MapGrid (packages/map); de sim leest nooit meters, seconden of JSON en importeert packages/map niet.

export * from './config.types.js';
export * from './config.faction.js';
export * from './config.env.js';
export * from './config.survival.js';
export {
  MAX_MAP_CELLS_SIDE,
  MAX_SPEED,
  MAX_RADIUS,
  MAX_FOOTPRINT,
  MAX_SIGHT,
  MAX_TECHS,
  TECH_WORDS,
  MAX_PERKS,
  MAX_ABILITIES,
  SPECIAL_COUNT,
  EFFECT_STAT_COUNT,
  MAX_TRAINED_POINTS,
  MAX_WORK_TICKS,
  MAX_CREEP_CAMPS,
  MAX_CREEPS_PER_CAMP,
  MAX_PROJECT_SITES,
  MAX_PROJECT_KINDS,
  MAX_SURVIVAL_WAVES,
} from './config.limits.js';
export { validateEnv } from './config.validate.js';
export { envHash } from './config.hash.js';
