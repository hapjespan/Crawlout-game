// Split from rigidUnits.test.ts to stay under the 5,000-token file limit.
import { SYNTHETIC_ROBOT_TYPE_IDS, syntheticRobots } from '../dev/syntheticRobots.js';
import { type InterpolatedFrame, createInterpolatedFrame } from '../snapshot/interpolate.js';
import { ANIM } from '@crawlout/protocol';
import type { DecalStyle, DecalLayer } from '../decals/decalLayer.js';
import {
  PerspectiveCamera,
  Scene,
  Vector3,
  type Mesh,
  type InstancedBufferAttribute,
} from 'three/webgpu';
import { RigidUnitLayer } from './rigidUnitLayer.js';

export const GUARD_TYPE = SYNTHETIC_ROBOT_TYPE_IDS.guard;

export const DRONE_TYPE = SYNTHETIC_ROBOT_TYPE_IDS.drone;

export const SENTINEL_TYPE = SYNTHETIC_ROBOT_TYPE_IDS.sentinel;

export interface Placed {
  id: number;
  typeId: number;
  x: number;
  z: number;
  owner?: number;
  anim?: number;
  animT?: number;
  yaw?: number;
  flags?: number;
}

export function frameOf(units: Placed[]): InterpolatedFrame {
  const frame = createInterpolatedFrame(64);
  frame.count = units.length;
  units.forEach((u, i) => {
    frame.id[i] = u.id;
    frame.typeId[i] = u.typeId;
    frame.x[i] = u.x;
    frame.z[i] = u.z;
    frame.y[i] = 0;
    frame.owner[i] = u.owner ?? 0;
    frame.anim[i] = u.anim ?? ANIM.idle;
    frame.animT[i] = u.animT ?? 0;
    frame.yaw[i] = u.yaw ?? 0;
    frame.flags[i] = u.flags ?? 0;
  });
  return frame;
}

interface Blob {
  x: number;
  z: number;
  half: number;
  style: DecalStyle;
}

export function recorder(): { decals: DecalLayer; blobs: Blob[] } {
  const blobs: Blob[] = [];
  const decals = {
    push(x: number, z: number, half: number, _half: number, style: DecalStyle) {
      blobs.push({ x, z, half, style });
    },
  } as unknown as DecalLayer;
  return { decals, blobs };
}

/** An RTS camera 12 m up and 12 m south, looking at the origin: everything around the origin is LOD 0. */
export function camera(
  position: [number, number, number] = [0, 12, 12],
  target: [number, number, number] = [0, 0, 0],
): PerspectiveCamera {
  const c = new PerspectiveCamera(45, 16 / 9, 0.5, 2000);
  c.position.set(...position);
  c.lookAt(...target);
  c.updateMatrixWorld();
  return c;
}

export function robotLayer(scene = new Scene(), capacity = 32) {
  const layer = new RigidUnitLayer(scene, { capacity, lightDir: new Vector3(-0.4, 0.8, 0.3) });
  const robots = syntheticRobots();
  for (const r of robots) layer.assign([r.typeId], layer.addAsset(r.source));
  return { layer, scene, robots };
}

export const meshes = (scene: Scene): Mesh[] => {
  const out: Mesh[] = [];
  scene.traverse((o) => {
    if ((o as Mesh).isMesh) out.push(o as Mesh);
  });
  return out;
};

const attr = (mesh: Mesh, name: string): InstancedBufferAttribute =>
  mesh.geometry.getAttribute(name) as InstancedBufferAttribute;

export const row = (mesh: Mesh, name: string, k: number): number[] => {
  const a = attr(mesh, name);
  return [a.getX(k), a.getY(k), a.getZ(k), a.getW(k)];
};

export const byName = (scene: Scene, name: string): Mesh => scene.getObjectByName(name) as Mesh;
