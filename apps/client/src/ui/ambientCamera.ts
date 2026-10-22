// The scene behind the splash and the menu: the camera drifts slowly over the map (a wide, slow loop around the
// middle, a slow turn), so the game is already there when the menu opens. Moves the renderer's camera target only; no
// sim, no snapshots. `prefers-reduced-motion` holds the camera still.
import type { CrawloutRenderer } from '@crawlout/render';

export interface AmbientCamera {
  stop(): void;
}

/** One lap of the drift, seconds: slow enough to read as haze over a landscape, not a fly-through. */
const LAP_S = 140;
/** Furthest the loop strays from the map centre, as a fraction of the map's shorter side. */
const SWING = 0.17;
const DISTANCE_M = 74;
const TURN_RAD_PER_S = 0.018;

/** The camera target and heading at `t` seconds, in meters; pure so the path can be tested. */
export function driftAt(
  t: number,
  size: { w: number; h: number },
): { x: number; z: number; yaw: number } {
  const lap = (t / LAP_S) * Math.PI * 2;
  const swing = Math.min(size.w, size.h) * SWING;
  return {
    x: size.w / 2 + Math.cos(lap) * swing,
    // a figure of eight: the second axis runs at twice the speed, so the loop never retraces itself
    z: size.h / 2 + Math.sin(lap * 2) * swing * 0.6,
    yaw: Math.PI * 0.25 + t * TURN_RAD_PER_S,
  };
}

export function startAmbientCamera(
  renderer: CrawloutRenderer,
  size: { w: number; h: number },
  options: { still?: boolean } = {},
): AmbientCamera {
  const cam = renderer.cameraControls;
  cam.zoomTo(DISTANCE_M, true);
  const apply = (t: number): void => {
    const d = driftAt(t, size);
    cam.focus(d.x, d.z);
    cam.yaw = d.yaw;
  };
  apply(0);
  if (options.still) return { stop: () => undefined };
  const t0 = performance.now();
  let frame = 0;
  const tick = (): void => {
    apply((performance.now() - t0) / 1000);
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return { stop: () => cancelAnimationFrame(frame) };
}
