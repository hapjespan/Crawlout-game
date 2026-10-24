// Dev-only entry (@crawlout/render/dev): fake snapshots for demos and tests. Not part of the game build.
export {
  FakeSnapshotSource,
  FAKE_UNIT_TYPE_ID,
  FAKE_NEUTRAL_OWNER,
  type FakeSnapshotOptions,
  type FakeStructure,
} from './fakeSnapshots.js';
export {
  allocSnapshot,
  encodeSnapshot,
  type EntityRecord,
  type EventRecord,
} from './snapshotWriter.js';
export { createGridTerrain } from '../terrain/heightField.js';
export {
  foliageProps,
  foliagePropSource,
  foliageSources,
  type FoliageCounts,
  type FoliageWorld,
} from './foliageAssets.js';
export {
  closeup,
  type CloseupOptions,
  type CloseupPoint,
  type CloseupView,
} from './closeup.js';
export {
  syntheticRobots,
  SYNTHETIC_ROBOT_TYPE_IDS,
  type SyntheticRobot,
} from './syntheticRobots.js';
