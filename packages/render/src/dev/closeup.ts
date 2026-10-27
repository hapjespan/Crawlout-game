// Close-up harness for judging asset quality: parks the RTS camera on one point at a fixed distance, heading and eye
// height, so the same model can be shot before and after a renderer change and the two frames compare pixel for
// pixel. Not part of the game; the render-demo puts it on window as `crawloutCloseup`.
//
//   crawloutCloseup({ index: 6, distance: 4.5, pitchDeg: 18 })
//
// `distance` is the orbit distance in meters and ignores the camera's own zoom minimum (26 m). The LOD bands read a
// unit's projected height, so 4.5 m is LOD 0 on any display and the demo's default 42 m is what the player sees.
// Parking also stops the controller from drifting its target back to the ground, which otherwise pulls every shot
// down to the unit's feet.
import type { RtsCameraController } from '../camera/rtsCamera.js';

export interface CloseupPoint {
  x: number;
  /** Ground height; without it the camera's current target height. */
  y?: number;
  z: number;
}

export interface CloseupOptions {
  /** World point to stand on; without it the controller's current target. */
  at?: CloseupPoint;
  /** Orbit distance in meters. Default 6: a 1.8 m unit fills the frame. */
  distance?: number;
  /** Camera heading in radians. Default 0.6, a three-quarter view of a unit facing +Z. */
  yaw?: number;
  /** Height above the ground the camera looks at. Default 0.9, the chest of a 1.8 m unit. */
  eye?: number;
  /** Pitch in degrees above the horizon. Default 18: a portrait, not the RTS top-down. */
  pitchDeg?: number;
}

/** What `closeup` applied, for the caller to log next to the screenshot. */
export interface CloseupView {
  x: number;
  y: number;
  z: number;
  yaw: number;
  distance: number;
  pitchDeg: number;
}

/** Parks `controls` on `at` and freezes it there; `controls.park(null)` undoes it. */
export function closeup(controls: RtsCameraController, opts: CloseupOptions = {}): CloseupView {
  const at = opts.at ?? { x: controls.target.x, y: controls.target.y, z: controls.target.z };
  const view: CloseupView = {
    x: at.x,
    y: (at.y ?? controls.groundAt(at.x, at.z)) + (opts.eye ?? 0.9),
    z: at.z,
    yaw: opts.yaw ?? 0.6,
    distance: opts.distance ?? 6,
    pitchDeg: opts.pitchDeg ?? 18,
  };
  controls.park(view);
  return view;
}
