// @crawlout/render: three.js WebGPURenderer (WebGL2 fallback). Reads snapshots only, via @crawlout/protocol.
export { createRenderer, type CreateRendererOptions, type CrawloutRenderer, type PickResult, type RenderBackend } from './renderer.js';
export { parseSnapshot, SnapshotParseError, type SnapshotView, type SnapshotEntities, type SnapshotEvents } from './snapshot/parse.js';
export {
  SnapshotInterpolator,
  createInterpolatedFrame,
  interpolateInto,
  lerpAngle,
  lerpAnimT,
  type InterpolatedFrame,
} from './snapshot/interpolate.js';
export { TerrainHeightField, createGridTerrain, type TerrainGeometry } from './terrain/heightField.js';
export { selectInRect, pickEntity, type ScreenRect, type BoxSelectOptions } from './picking/selection.js';
export { RtsCameraController, type RtsCameraOptions, type RtsCameraBounds } from './camera/rtsCamera.js';
export { type FrameStats } from './perf/perfOverlay.js';
export { CLIP, CLIPS, BONES, type ClipName } from './units/rig.js';
export { TEAM_COLORS } from './units/unitLayer.js';
