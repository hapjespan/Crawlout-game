import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PerspectiveCamera } from 'three/webgpu';
import { RtsCameraController, type RtsCameraOptions } from './rtsCamera.js';

// Node has EventTarget but no DOM: a window and a canvas stand-in are enough for the keyboard path.
function fakeDom(): HTMLElement {
  return Object.assign(new EventTarget(), {
    clientWidth: 800,
    clientHeight: 600,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
  }) as unknown as HTMLElement;
}

function key(type: 'keydown' | 'keyup', code: string): Event {
  return Object.assign(new Event(type), { code });
}

describe('RtsCameraController keys', () => {
  beforeEach(() => vi.stubGlobal('window', new EventTarget()));
  afterEach(() => vi.unstubAllGlobals());

  /** How far the target moves (x, z) and turns while `code` is held for 0.1 s. */
  function hold(code: string, opts: RtsCameraOptions = {}): { dx: number; dz: number; dyaw: number } {
    const cam = new RtsCameraController(new PerspectiveCamera(), fakeDom(), { edgeMargin: 0, ...opts });
    const x = cam.target.x;
    const z = cam.target.z;
    const yaw = cam.yaw;
    window.dispatchEvent(key('keydown', code));
    cam.update(0.1);
    window.dispatchEvent(key('keyup', code));
    cam.dispose();
    return { dx: cam.target.x - x, dz: cam.target.z - z, dyaw: cam.yaw - yaw };
  }
  const moved = (r: { dx: number; dz: number }): number => Math.hypot(r.dx, r.dz);

  it('pans with WASD and the arrows by default', () => {
    for (const code of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft']) expect(moved(hold(code))).toBeGreaterThan(0.1);
    expect(moved(hold('KeyX'))).toBe(0);
  });

  it('drops A and S when the HUD takes them, keeping W, D, the arrows and Q/E', () => {
    const opts: RtsCameraOptions = { panKeys: { KeyA: null, KeyS: null } };
    expect(moved(hold('KeyA', opts))).toBe(0);
    expect(moved(hold('KeyS', opts))).toBe(0);
    expect(moved(hold('KeyW', opts))).toBeGreaterThan(0.1);
    expect(moved(hold('KeyD', opts))).toBeGreaterThan(0.1);
    expect(moved(hold('ArrowLeft', opts))).toBeGreaterThan(0.1);
    expect(moved(hold('ArrowDown', opts))).toBeGreaterThan(0.1);
    expect(hold('KeyQ', opts).dyaw).toBeGreaterThan(0);
    expect(hold('KeyE', opts).dyaw).toBeLessThan(0);
  });

  it('can add a key: J pans the same way as ArrowDown', () => {
    const remapped = hold('KeyJ', { panKeys: { KeyJ: [0, -1] } });
    const arrow = hold('ArrowDown');
    expect(remapped.dx).toBeCloseTo(arrow.dx);
    expect(remapped.dz).toBeCloseTo(arrow.dz);
  });
});
