// Sky and fog (sky-and-clouds guide): a gradient sky as the scene background and an exponential fog of the very same
// horizon colour on every material (scene.fogNode, applied in each node material's output, before tone mapping like
// the background), so the far terrain and the map edge dissolve into the sky without a seam.
// The fog has two terms, the larger wins: distance from the camera, scaled with the zoom (lightRig.ts FOG), and
// distance outside the map bounds (EDGE_FOG), which turns the edge of the map and the skirt beyond it into haze.
import { Vector4, type Node } from 'three/webgpu';
import {
  cameraPosition,
  clamp,
  exp,
  fog,
  length,
  max,
  min,
  mix,
  normalWorldGeometry,
  positionWorld,
  smoothstep,
  uniform,
  vec2,
  vec3,
} from 'three/tsl';
import { EDGE_FOG, FOG, FOG_COLOR, SKY_HORIZON, SKY_ZENITH } from './lightRig.js';

export interface Atmosphere {
  /** For scene.fogNode. */
  readonly fogNode: Node;
  /** For scene.backgroundNode. */
  readonly backgroundNode: Node;
  /** Per frame: the RTS camera's distance to its target. */
  update(cameraDistance: number): void;
  /** The map's bounds (meters), where the edge fog starts; null turns the edge fog off. */
  setBounds(bounds: { minX: number; maxX: number; minZ: number; maxZ: number } | null): void;
}

export function createAtmosphere(): Atmosphere {
  const fogColor = vec3(...FOG_COLOR);
  const start = uniform(60);
  const invRange = uniform(1 / 120);
  // Bounds as center xz and half size xz; a huge half size switches the edge fog off.
  const rect = uniform(new Vector4(0, 0, 1e6, 1e6));

  const wp = positionWorld;
  const d = length(wp.sub(cameraPosition));
  const distanceTerm = exp(max(d.sub(start), 0).mul(invRange).negate())
    .oneMinus()
    .mul(FOG.max);
  const q = vec2(wp.x, wp.z).sub(rect.xy).abs().sub(rect.zw);
  const outside = length(max(q, vec2(0, 0))).add(min(max(q.x, q.y), 0));
  const edgeTerm = smoothstep(EDGE_FOG.start, EDGE_FOG.end, outside);
  const factor = clamp(max(distanceTerm, edgeTerm), 0, 1);
  const fogNode = fog(fogColor, factor);

  // Background: the view direction's height. At and below the horizon the fog colour, above it a soft blend to the
  // zenith (most of the gradient sits in the first 30 degrees, where the eye expects the haze).
  const up = normalWorldGeometry.y;
  const t = smoothstep(0.0, 0.55, up);
  const backgroundNode = mix(
    vec3(...SKY_HORIZON),
    vec3(...SKY_ZENITH),
    t.mul(t.oneMinus().mul(0.4).add(0.6)),
  );

  return {
    fogNode,
    backgroundNode,
    update(cameraDistance) {
      const c = Math.max(1, cameraDistance);
      start.value = c * FOG.start;
      invRange.value = 1 / Math.max(1, c * FOG.range);
    },
    setBounds(bounds) {
      if (!bounds) {
        rect.value.set(0, 0, 1e6, 1e6);
        return;
      }
      rect.value.set(
        (bounds.minX + bounds.maxX) / 2,
        (bounds.minZ + bounds.maxZ) / 2,
        (bounds.maxX - bounds.minX) / 2,
        (bounds.maxZ - bounds.minZ) / 2,
      );
    },
  };
}
