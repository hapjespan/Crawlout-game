import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PerspectiveCamera } from 'three/webgpu';
import {
  DEFAULT_MIN_DISTANCE,
  maxDistanceFor,
  RtsCameraController,
  type RtsCameraOptions,
} from './rtsCamera.js';

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
  function hold(
    code: string,
    opts: RtsCameraOptions = {},
  ): { dx: number; dz: number; dyaw: number } {
    const cam = new RtsCameraController(new PerspectiveCamera(), fakeDom(), {
      edgeMargin: 0,
      ...opts,
    });
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
    for (const code of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft'])
      expect(moved(hold(code))).toBeGreaterThan(0.1);
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

describe('RtsCameraController edge scroll', () => {
  let root: EventTarget;
  beforeEach(() => {
    vi.stubGlobal('window', new EventTarget());
    root = new EventTarget();
    vi.stubGlobal('document', { documentElement: root });
  });
  afterEach(() => vi.unstubAllGlobals());

  const move = (x: number, y: number): void =>
    void window.dispatchEvent(
      Object.assign(new Event('pointermove'), { clientX: x, clientY: y, movementX: 0 }),
    );

  function panAfter(steps: () => void): number {
    const cam = new RtsCameraController(new PerspectiveCamera(), fakeDom());
    const x = cam.target.x;
    const z = cam.target.z;
    steps();
    cam.update(0.1);
    cam.dispose();
    return Math.hypot(cam.target.x - x, cam.target.z - z);
  }

  it('scrolls when the pointer is in the edge strip anywhere in the window, not only over the canvas', () => {
    expect(panAfter(() => move(400, 300))).toBe(0);
    expect(panAfter(() => move(799, 300))).toBeGreaterThan(0.1);
    expect(panAfter(() => move(400, 2))).toBeGreaterThan(0.1);
  });

  it('keeps scrolling after the pointer leaves the window across an edge', () => {
    expect(
      panAfter(() => {
        move(2, 300);
        root.dispatchEvent(new Event('pointerleave'));
      }),
    ).toBeGreaterThan(0.1);
  });

  it('stops when the pointer leaves the window from the middle', () => {
    expect(
      panAfter(() => {
        move(400, 300);
        root.dispatchEvent(new Event('pointerleave'));
      }),
    ).toBe(0);
  });
});

describe('RtsCameraController on a large map', () => {
  beforeEach(() => vi.stubGlobal('window', new EventTarget()));
  afterEach(() => vi.unstubAllGlobals());

  const map = (side: number) => ({ minX: 0, maxX: side, minZ: 0, maxZ: side });
  const wheel = (dom: HTMLElement, deltaY: number): void =>
    void dom.dispatchEvent(
      Object.assign(new Event('wheel'), { deltaY, deltaMode: 0, preventDefault() {} }),
    );

  it('zooms out far enough to see a 384 m map, and keeps 140 m on the small map', () => {
    expect(maxDistanceFor(map(128))).toBe(140);
    expect(maxDistanceFor(map(384))).toBe(384);
    const dom = fakeDom();
    const cam = new RtsCameraController(new PerspectiveCamera(), dom, { edgeMargin: 0 });
    cam.bounds = map(384);
    for (let k = 0; k < 60; k++) wheel(dom, 100);
    for (let k = 0; k < 60; k++) cam.update(0.1);
    expect(cam.distance).toBeCloseTo(384, 0);
    expect(cam.pitchDegrees()).toBeCloseTo(74, 1);
    // An explicit maxDistance wins over the map.
    const fixed = new RtsCameraController(new PerspectiveCamera(), fakeDom(), { maxDistance: 90 });
    fixed.bounds = map(384);
    expect(fixed.maxDistance).toBe(90);
    cam.dispose();
    fixed.dispose();
  });

  it('keeps the pitch at gameplay zoom whatever the map size', () => {
    const small = new RtsCameraController(new PerspectiveCamera(), fakeDom());
    const large = new RtsCameraController(new PerspectiveCamera(), fakeDom());
    small.bounds = map(128);
    large.bounds = map(384);
    expect(large.pitchDegrees()).toBeCloseTo(small.pitchDegrees(), 6);
    large.zoomTo(140, true);
    expect(large.pitchDegrees()).toBeCloseTo(68, 6);
    small.dispose();
    large.dispose();
  });

  it('pans faster when zoomed out, and stays on the map', () => {
    const cam = new RtsCameraController(new PerspectiveCamera(), fakeDom(), { edgeMargin: 0 });
    cam.bounds = map(384);
    cam.focus(192, 192);
    const panned = (): number => {
      const x = cam.target.x;
      const z = cam.target.z;
      window.dispatchEvent(Object.assign(new Event('keydown'), { code: 'KeyD' }));
      cam.update(0.1);
      window.dispatchEvent(Object.assign(new Event('keyup'), { code: 'KeyD' }));
      return Math.hypot(cam.target.x - x, cam.target.z - z);
    };
    const near = panned();
    cam.zoomTo(cam.maxDistance, true);
    const far = panned();
    expect(far).toBeGreaterThan(near * 4);
    for (let k = 0; k < 100; k++) panned();
    expect(cam.target.x).toBeGreaterThanOrEqual(0);
    expect(cam.target.x).toBeLessThanOrEqual(384);
    expect(cam.target.z).toBeGreaterThanOrEqual(0);
    expect(cam.target.z).toBeLessThanOrEqual(384);
    cam.dispose();
  });
});

describe('RtsCameraController closest zoom', () => {
  beforeEach(() => vi.stubGlobal('window', new EventTarget()));
  afterEach(() => vi.unstubAllGlobals());

  it('stops at the default minimum, so a unit and its surroundings stay in view', () => {
    expect(DEFAULT_MIN_DISTANCE).toBeGreaterThanOrEqual(22);
    expect(DEFAULT_MIN_DISTANCE).toBeLessThanOrEqual(28);
    const cam = new RtsCameraController(new PerspectiveCamera(), fakeDom());
    cam.zoomTo(1, true);
    expect(cam.distance).toBe(DEFAULT_MIN_DISTANCE);
    cam.dispose();
  });

  it('keeps the pitch curve where it was: 50 degrees anchors at 10 m, not at the new minimum', () => {
    const cam = new RtsCameraController(new PerspectiveCamera(), fakeDom());
    cam.zoomTo(42, true);
    expect(cam.pitchDegrees()).toBeCloseTo(50 + 18 * ((42 - 10) / (140 - 10)), 6);
    cam.zoomTo(1, true);
    expect(cam.pitchDegrees()).toBeGreaterThan(50);
    expect(cam.pitchDegrees()).toBeLessThan(54);
    cam.dispose();
  });
});
