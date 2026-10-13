// Dev-only entry (@crawlout/render/dev): fake snapshots for demos and tests. Not part of the game build.
export { FakeSnapshotSource, FAKE_UNIT_TYPE_ID, type FakeSnapshotOptions } from './fakeSnapshots.js';
export { allocSnapshot, encodeSnapshot, type EntityRecord, type EventRecord } from './snapshotWriter.js';
export { createGridTerrain } from '../terrain/heightField.js';
