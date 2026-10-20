// Publiek API van @crawlout/sim. Testhulpen staan in '@crawlout/sim/testing', de worker-entry in '@crawlout/sim/worker'.
export { TICK_HZ, TICK_MS, UNITS_PER_METER, MAX_ENTITIES } from '@crawlout/protocol';
export * from './math/int.js';
export { SIN_TABLE, TRIG_ONE, TRIG_BITS, sinA, cosA, atan2A } from './math/trig.js';
export { isqrt } from './math/sqrt.js';
export { FNV_OFFSET, FNV_PRIME, fnv1a } from './math/fnv.js';
export { Rng } from './rng.js';
export type {
  SimAiScript,
  SimBuildingType,
  SimClaimPoint,
  SimConfig,
  SimEnv,
  SimFaction,
  SimFormationTuning,
  SimInit,
  SimMap,
  SimPlayer,
  SimPoint,
  SimAbility,
  SimAuraEffect,
  SimCage,
  SimCapture,
  SimChem,
  SimPlunder,
  SimRaidPlan,
  SimSlaveRules,
  SimTribute,
  SimUnitAura,
  SimEffect,
  SimHero,
  SimPerk,
  SimRepair,
  SimScrapNode,
  SimSiege,
  SimTraining,
  SimTurretNetwork,
  SimSpecialTuning,
  SimTech,
  SimUnitType,
  SimSurvival,
  SimSurvivalMap,
  SimSurvivalWave,
} from './config.js';
export {
  AURA_SIDE_ALLY,
  AURA_SIDE_ENEMY,
  AURA_TARGET_ALL,
  AURA_TARGET_TURRETS,
  AURA_TARGET_UNITS,
  EFFECT_TARGET_ALL,
  EFFECT_TARGET_HERO,
  EFFECT_TARGET_TYPE,
  MAX_ABILITIES,
  MAX_PERKS,
  MAX_TECHS,
  TECH_WORDS,
  SAFETY_NET_BEACON,
  SAFETY_NET_TENTS,
} from './config.js';
export { HERO_ALIVE, HERO_DEAD, HERO_EMPTY, HERO_NONE, HERO_REVIVING } from './effects.js';
export { anyTech, grantTech, hasTech } from './techBits.js';
export { MAX_RADIUS, MAX_SPEED, envHash, validateEnv } from './config.js';
export type { ClaimKind, SimMapSource } from './fromData.js';
export {
  CLAIM_KINDS,
  EFFECT_STATS,
  PROVIDES_CHEMLAB,
  PROVIDES_CLAIM,
  PROVIDES_DEPOT,
  PROVIDES_HQ,
  PROVIDES_KOOI,
  PROVIDES_TENT,
  PROVIDES_WORKSHOP,
  simConfigFromGameData,
  simMapFromGrid,
  simPlayersFromLobby,
} from './fromData.js';
export {
  NO_ENTITY,
  NO_FIELD,
  ORDER_ATTACK,
  ORDER_ATTACK_MOVE,
  ORDER_BUILD,
  ORDER_CRAFT,
  ORDER_GATHER,
  ORDER_MOVE,
  ORDER_NONE,
  JOB_NONE,
  JOB_PRODUCE,
  JOB_TRAIN,
  CHEM_ACTIVE,
  CHEM_COOL,
  CHEM_CRASH,
  CHEM_NONE,
  SLAVE_CAPTIVE,
  SLAVE_FREED,
  SLAVE_NONE,
  SLAVE_SLAVE,
  indexOf,
  genOf,
  makeId,
} from './ecs/world.js';
export { MAX_FLOW_FIELDS } from './flowfield.js';
export type { PathTuning } from './flowfield.js';
export { STATE_FORMAT_VERSION } from './state.js';
export type { SimCommand } from './systems/commands.js';
export type {
  CreateSimOptions,
  EntityKind,
  SimWinner,
  SpawnUnitSpec,
  UnitView,
  WinReason,
} from './sim.js';
export { Sim, TICK_STAGES, createSim, deserialize } from './sim.js';
export { FOG_EXPLORED, FOG_UNEXPLORED, FOG_VISIBLE, Vision } from './vision.js';
export { PlayerView } from './view.js';
export {
  AS_CLAIM,
  AS_DEPOT,
  PLACEMENT_REASONS,
  PLACE_BLOCKED,
  PLACE_CROWDED,
  PLACE_DEPOT,
  PLACE_FEATURE,
  PLACE_HQ_RANGE,
  PLACE_ZONE,
  PLACE_OK,
  PLACE_TERRAIN,
  PLACE_TERRITORY,
  POINT_CLAIM,
  POINT_NODE,
  RECT_CLAIM,
  RECT_DEPOT,
  placementReason,
} from './systems/placement.js';
export type { PlacementInput, PlacementReason } from './systems/placement.js';
export type { TickProbe } from './sim.js';
export type {
  SimWorkerCore,
  SimWorkerInbound,
  SimWorkerOutbound,
  SimWorkerPort,
} from './worker.js';
export { CATCH_UP_BACKLOG, createSimWorkerCore } from './worker.js';
// survival co-op (sim 0.27.0)
export { RANK_BOSS, RANK_MINIBOSS, RANK_NORMAL } from './config.js';
export {
  HORDE_WINNER,
  hqOf,
  survivalOf,
  threatScore,
  waveAlive,
  waveUnits,
  weakestPlayer,
} from './systems/survival.js';
export type { SurvivalStatus } from './systems/survival.js';
