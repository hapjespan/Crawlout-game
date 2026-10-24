// LOD on screen size: an object switches to a lighter LOD when its height on screen, in device pixels, drops under a
// threshold, instead of at a fixed camera distance. The same 1.8 m unit then keeps its full mesh longer on a 4K screen
// or a Retina display (more pixels) and drops it sooner in a small window at DPR 1, and a 6 m HQ keeps its detail
// further out than a unit. Projected height = size * pxPerMeter / distance, with pxPerMeter the drawing buffer height
// (CSS height times the pixel ratio) over 2 tan(fov / 2).
//
// The thresholds were first picked on a Retina view (900 CSS px at DPR 2, a 1800 px buffer) with a triangle budget
// in mind. A DPR 1 window halves every projected height, so the same unit at the same distance sat one LOD lower
// there: at the default zoom of 42 m a unit was already on LOD 1 and at the furthest zoom on LOD 2, which is what a
// hand-made character's silhouette and its texture detail are lost to. The bands are now 2.4 times lower, which is
// exactly that factor, so a DPR 1 display gets what the Retina one got and the Retina one keeps LOD 0 across the
// whole zoom range. The frame has the headroom; the models do not have a second chance to make an impression.
//
// Thresholds per layer (device px). Equivalent distances at 1600 x 900 CSS, DPR 2, fov 45 (pxPerMeter 2173):
//   units, 1.8 m:                   LOD 0 to 130 m, LOD 1 to 301 m
//   building assets, the housing (3.8 m bounding diameter): LOD 0 to 141 m, LOD 1 to 330 m; the HQ (9.2 m) to 342 and 799 m
//   props, a 5 m tree:              LOD 0 to 217 m, LOD 1 to 522 m
// Halve those on a DPR 1 display: a unit then holds LOD 0 to 65 m, past the default zoom of 42 m.
import type { Camera } from 'three/webgpu';

export interface ScreenLodThresholds {
  /** Below this projected height (device px) LOD 1. */
  lod1: number;
  /** Below this LOD 2. */
  lod2: number;
}

export const UNIT_LOD_PX: ScreenLodThresholds = { lod1: 30, lod2: 13 };
export const BUILDING_LOD_PX: ScreenLodThresholds = { lod1: 58, lod2: 25 };
export const PROP_LOD_PX: ScreenLodThresholds = { lod1: 50, lod2: 21 };
/** Trees: three times the triangles of any other prop at LOD 0 and two draws in the frame (view and shadow), so they drop sooner. */
export const TREE_LOD_PX: ScreenLodThresholds = { lod1: 117, lod2: 42 };

/** Drawing buffer height assumed until the renderer reports one (900 CSS px at DPR 2). */
export const DEFAULT_VIEWPORT_PX = 1800;

export class ScreenLod {
  /** Projected pixels of one meter at one meter distance. */
  pxPerMeter = DEFAULT_VIEWPORT_PX / (2 * Math.tan((45 * Math.PI) / 360));
  private viewportPx = DEFAULT_VIEWPORT_PX;

  /** Drawing buffer height in device pixels (canvas.height). */
  setViewport(heightPx: number): void {
    if (heightPx > 0) this.viewportPx = heightPx;
  }

  /** Reads the camera's vertical field of view; call once per frame before the layers update. */
  update(camera: Camera): void {
    const fov = (camera as { fov?: number }).fov ?? 45;
    this.pxPerMeter = this.viewportPx / (2 * Math.tan((fov * Math.PI) / 360));
  }

  /** Projected height in device pixels of an object `size` meters tall at `distance` meters. */
  pixels(size: number, distance: number): number {
    return (size * this.pxPerMeter) / Math.max(distance, 1e-3);
  }

  /** LOD 0, 1 or 2 for an object `size` meters at `distance` meters. */
  lod(size: number, distance: number, t: ScreenLodThresholds): 0 | 1 | 2 {
    const px = this.pixels(size, distance);
    return px >= t.lod1 ? 0 : px >= t.lod2 ? 1 : 2;
  }
}
