// UnitLayer feeds the render-owned animation phase (animVariation.ts) with the frame clock: a unit's pose must keep
// moving over minutes of clock time and with sparse snapshots (regression: animations froze after a few seconds).
import { ANIM } from '@crawlout/protocol';
import { describe, expect, it } from 'vitest';
import {
  PerspectiveCamera,
  Scene,
  Vector3,
  type InstancedBufferAttribute,
  type Mesh,
} from 'three/webgpu';
import type { DecalLayer } from '../decals/decalLayer.js';
import { createInterpolatedFrame, type InterpolatedFrame } from '../snapshot/interpolate.js';
import { UnitLayer } from './unitLayer.js';

const ID = 3 << 20;
const FRAME_MS = 1000 / 60;
const DECALS = { push() {} } as unknown as DecalLayer;

function camera(): PerspectiveCamera {
  const c = new PerspectiveCamera(45, 16 / 9, 0.5, 2000);
  c.position.set(0, 400, 400); // high up: a walker covers 100 m in 30 s and stays in view
  c.lookAt(0, 0, 0);
  c.updateMatrixWorld();
  return c;
}

function oneUnit(x: number, anim: number, animT: number): InterpolatedFrame {
  const frame = createInterpolatedFrame(8);
  frame.count = 1;
  frame.id[0] = ID;
  frame.typeId[0] = 1;
  frame.x[0] = x;
  frame.anim[0] = anim;
  frame.animT[0] = animT;
  return frame;
}

/** Clip and progress that the first drawn instance got (iAnim.x, iAnim.y). */
function drawn(scene: Scene): { clip: number; t: number } {
  let out = { clip: -1, t: -1 };
  scene.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh || mesh.count === 0) return;
    const a = mesh.geometry.getAttribute('iAnim') as InstancedBufferAttribute;
    out = { clip: a.getX(0), t: a.getY(0) };
  });
  return out;
}

function newLayer(scene = new Scene()): UnitLayer {
  return new UnitLayer(scene, { capacity: 4, lightDir: new Vector3(0, 1, 0) });
}

/** Runs `secs` of 60 fps frames at clock `startMs`; returns cycles completed and the longest pose standstill (s). */
function run(
  anim: number,
  secs: number,
  startMs: number,
  frameOf: (ms: number) => InterpolatedFrame,
): { cycles: number; stillS: number } {
  const scene = new Scene();
  const layer = newLayer(scene);
  const cam = camera();
  let prev = -1;
  let cycles = 0;
  let still = 0;
  let stillS = 0;
  for (let ms = 0; ms < secs * 1000; ms += FRAME_MS) {
    layer.update(frameOf(ms), cam, DECALS, startMs + ms);
    const d = drawn(scene);
    expect(d.clip).toBe(anim);
    if (prev >= 0) {
      cycles += (d.t - prev + 1) % 1;
      still = d.t === prev ? still + FRAME_MS / 1000 : 0;
      stillS = Math.max(stillS, still);
    }
    prev = d.t;
  }
  layer.dispose();
  return { cycles, stillS };
}

describe('UnitLayer animation time', () => {
  it('keeps a gatherer moving at the pace of the gather clip while the sim reports job progress', () => {
    const gatherS = newLayer().anims.clips[ANIM.gather]!.duration;
    const secs = 40;
    const r = run(ANIM.gather, secs, 0, (ms) => oneUnit(0, ANIM.gather, (ms / 1000 / 13) % 1));
    expect(r.cycles).toBeGreaterThan((secs / gatherS) * 0.85);
    expect(r.stillS).toBeLessThan(0.1);
  });

  it('keeps idle moving after two hours on the clock', () => {
    const r = run(ANIM.idle, 20, 2 * 3600 * 1000, () => oneUnit(0, ANIM.idle, 0));
    expect(r.cycles).toBeGreaterThan(5);
    expect(r.stillS).toBeLessThan(0.1);
  });

  it('keeps a walker moving when the positions only change per 20 Hz snapshot', () => {
    const r = run(ANIM.walk, 30, 5000, (ms) =>
      oneUnit(Math.floor(ms / 50) * 50 * 0.0034, ANIM.walk, 0),
    );
    expect(r.cycles).toBeGreaterThan(((30 * 3.4) / 2.4) * 0.8);
    expect(r.stillS).toBeLessThan(0.1);
  });
});
