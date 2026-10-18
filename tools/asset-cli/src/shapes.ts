// Hard-surface shapes for the robot and building generator, next to box, cylinder and cone in geometry.ts: a chamfered
// box, an extruded polygon (prism), a toothed tank track, a corrugated sheet, a swept tube (cables, pipes) and a sphere.
// All of them are flat shaded (hard edges, one normal per face) except the round ones (tube, sphere), and wound
// counter-clockwise seen from outside like glTF wants. No shape numbers live here: every size comes from robots.json.

export {
  makeBoxOpen,
  makeCylinderClean,
  makeCone,
  makeBevelBox,
  triangulate,
  makePrism,
  makeTrack,
} from './shapes.part1.js';
export type { Vec2, PrismAxis, PrismCaps, PrismOptions, TrackOptions } from './shapes.part1.js';
export { makeCorrugated, makeTube, makeSphere } from './shapes.part2.js';
