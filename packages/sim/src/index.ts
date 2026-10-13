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
  SimInit,
  SimMap,
  SimPlayer,
  SimPoint,
  SimScrapNode,
  SimUnitType,
} from './config.js';
export { MAX_RADIUS, MAX_SPEED, envHash, validateEnv } from './config.js';
export type { ClaimKind, SimMapSource } from './fromData.js';
export { CLAIM_KINDS, PROVIDES_CLAIM, PROVIDES_HQ, PROVIDES_WORKSHOP, simConfigFromGameData, simMapFromGrid, simPlayersFromLobby } from './fromData.js';
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
  indexOf,
  genOf,
  makeId,
} from './ecs/world.js';
export { MAX_FLOW_FIELDS } from './flowfield.js';
export { STATE_FORMAT_VERSION } from './state.js';
export type { SimCommand } from './systems/commands.js';
export type { CreateSimOptions, EntityKind, SimWinner, SpawnUnitSpec, UnitView, WinReason } from './sim.js';
export { Sim, createSim, deserialize } from './sim.js';
export type { SimWorkerCore, SimWorkerInbound, SimWorkerOutbound, SimWorkerPort } from './worker.js';
export { createSimWorkerCore } from './worker.js';
