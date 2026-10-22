// Which props the layer has to draw for the sun's shadow. A prop outside the view casts into it only on the side the
// shadow falls to: a tree 13 m tall under the 40 degree sun throws its shadow 15 m away from the sun, so only a prop
// that far on the sun's side of the view matters. Growing every chunk box by that length on all sides (the first
// version, SHADOW_CULL_MARGIN) put a ring of off-screen forest into both passes: a view with 60 trees on screen drew 965.
// Sweeping the box along the shadow keeps just the band that can shade the view, and the chunk is tested as it is.
import { Box3 } from 'three/webgpu';

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** Extra room all round (m): the penumbra, a prop's lean in the wind, and ground that rises along the shadow. */
export const SHADOW_SWEEP_SLACK = 2;

/**
 * `out` = the box plus everything its shadow can touch: the box swept along the horizontal shadow offset of its own
 * height (height over the sun's elevation tangent, away from the sun), plus SHADOW_SWEEP_SLACK on every side.
 * `sunDir` is the unit vector towards the sun.
 */
export function sweepAlongShadow(box: Box3, sunDir: Vec3Like, out: Box3): Box3 {
  out.copy(box);
  if (box.isEmpty()) return out;
  // A sun on the horizon would throw an endless shadow; clamp the elevation sine so the offset stays finite.
  const sinEl = Math.max(0.17, sunDir.y);
  const length = (box.max.y - box.min.y) / sinEl;
  const dx = -sunDir.x * length;
  const dz = -sunDir.z * length;
  if (dx > 0) out.max.x += dx;
  else out.min.x += dx;
  if (dz > 0) out.max.z += dz;
  else out.min.z += dz;
  return out.expandByScalar(SHADOW_SWEEP_SLACK);
}
