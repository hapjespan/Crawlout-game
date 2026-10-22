// LOD on screen size: an object switches to a lighter LOD when its height on screen, in device pixels, drops under a
// threshold, instead of at a fixed camera distance. The same 1.8 m unit then keeps its full mesh longer on a 4K screen
// or a Retina display (more pixels) and drops it sooner in a small window at DPR 1, and a 6 m HQ keeps its detail
// further out than a unit. Projected height = size * pxPerMeter / distance, with pxPerMeter the drawing buffer height
// (CSS height times the pixel ratio) over 2 tan(fov / 2).
//
// Thresholds per layer (device px). Equivalent distances at 1600 x 900 CSS, DPR 2, fov 45 (pxPerMeter 2173):
//   units, 1.8 m:                   LOD 0 to 54 m, LOD 1 to 130 m (was 30 and 70 m at any resolution)
//   building assets, the housing (3.8 m bounding diameter): LOD 0 to 59 m, LOD 1 to 137 m; the HQ (9.2 m) to 143 and 333 m
//   props, a 5 m tree:              LOD 0 to 91 m, LOD 1 to 217 m
import type { Camera } from 'three/webgpu';

export interface ScreenLodThresholds {
  /** Below this projected height (device px) LOD 1. */
  lod1: number;
  /** Below this LOD 2. */
  lod2: number;
}

export const UNIT_LOD_PX: ScreenLodThresholds = { lod1: 72, lod2: 30 };
export const BUILDING_LOD_PX: ScreenLodThresholds = { lod1: 140, lod2: 60 };
export const PROP_LOD_PX: ScreenLodThresholds = { lod1: 120, lod2: 50 };
/** Trees: three times the triangles of any other prop at LOD 0 and two draws in the frame (view and shadow), so they drop sooner. */
export const TREE_LOD_PX: ScreenLodThresholds = { lod1: 280, lod2: 100 };

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
