export {
  EFFECT_STATS,
  statIndex,
  TARGET_ALL,
  TARGET_HERO,
  CLAIM_KINDS,
  PROVIDES_HQ,
  PROVIDES_WORKSHOP,
  PROVIDES_CLAIM,
  PROVIDES_TURRET,
  PROVIDES_BEACON,
  PROVIDES_TENT,
  PROVIDES_KOOI,
  PROVIDES_DEPOT,
  PROVIDES_CHEMLAB,
  BODY_ROBOT,
  BODY_HUMAN,
  BODY_VEHICLE,
} from './fromData.part1.js';
export type { EffectStatName, ClaimKind } from './fromData.part1.js';
export { simConfigFromGameData } from './fromData.part2.js';
export { simDifficulty, simMapFromGrid, simPlayersFromLobby } from './fromData.part3.js';
export type { SimMapSource, SimMapOptions } from './fromData.part3.js';
