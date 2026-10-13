// Publiek API van @crawlout/sim. Testhulpen staan in '@crawlout/sim/testing', de worker-entry in '@crawlout/sim/worker'.
export { TICK_HZ, TICK_MS, UNITS_PER_METER, MAX_ENTITIES } from '@crawlout/protocol';
export * from './math/int.js';
export { SIN_TABLE, TRIG_ONE, TRIG_BITS, sinA, cosA, atan2A } from './math/trig.js';
export { isqrt } from './math/sqrt.js';
export { FNV_OFFSET, FNV_PRIME, fnv1a } from './math/fnv.js';
export { Rng } from './rng.js';
export type { SimConfig, SimEnv, SimInit, SimMap, SimUnitType } from './config.js';
export { MAX_RADIUS, MAX_SPEED, envHash, validateEnv } from './config.js';
export { NO_ENTITY, NO_FIELD, indexOf, genOf, makeId } from './ecs/world.js';
export { MAX_FLOW_FIELDS } from './flowfield.js';
export { ANIM_IDLE, ANIM_WALK } from './systems/movement.js';
export { STATE_FORMAT_VERSION } from './state.js';
export type { SpawnUnitSpec, UnitView } from './sim.js';
export { Sim, createSim, deserialize } from './sim.js';
export type { SimWorkerCore, SimWorkerInbound, SimWorkerOutbound, SimWorkerPort } from './worker.js';
export { createSimWorkerCore } from './worker.js';
