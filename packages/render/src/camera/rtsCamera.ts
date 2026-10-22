// RTS camera: orbits a ground target. Pan with WASD/arrows and screen-edge scroll, zoom with the wheel,
// rotate with Q/E or by dragging with the middle mouse button. Pan speed grows with the zoom distance. Without an
// explicit maxDistance the zoom-out limit follows the map (bounds): 140 m, or the longer side when that is more, so a
// 384 m map fits on screen in the overview, also turned 45 degrees. The pitch runs from 50 to 68 degrees over 10..140 m as before (the closest zoom is 26 m, so it starts at about 52)
// and on to 74 degrees at the furthest zoom.
import { MathUtils, type PerspectiveCamera } from 'three/webgpu';

export interface RtsCameraBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface RtsCameraOptions {
  /** Ground height under the target, so the camera follows hills. */
  heightAt?: (x: number, z: number) => number;
  minDistance?: number;
  /** Furthest zoom, meters. Default: follows the bounds (see above). */
  maxDistance?: number;
  /** Pixels from the canvas edge where edge scroll starts. 0 disables edge scroll. */
  edgeMargin?: number;
  /** Listen to keyboard on window. Disable when the HUD owns the keys. */
  keyboard?: boolean;
  /**
   * Changes to the pan keys, by KeyboardEvent.code: a direction [right, forward] adds or remaps a key, null
   * removes it. Example for a HUD that uses A and S as hotkeys: `{ KeyA: null, KeyS: null }` keeps W, D, the
   * arrows and Q/E. Default: DEFAULT_PAN_KEYS unchanged.
   */
  panKeys?: Readonly<Record<string, PanDirection | null>>;
}

/** Pan direction of a key: [right, forward] on the ground, relative to the camera heading. */
export type PanDirection = readonly [number, number];

export const DEFAULT_PAN_KEYS: Readonly<Record<string, PanDirection>> = {
  KeyW: [0, 1],
  ArrowUp: [0, 1],
  KeyS: [0, -1],
  ArrowDown: [0, -1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};

/**
 * Default closest zoom, meters: a unit and its surroundings still fit in view. The 21 m compound of the headquarters
 * is no longer entered at the former 10 m; the house and its yard stay in frame.
 */
export const DEFAULT_MIN_DISTANCE = 26;
/** The pitch curve starts here (50 degrees), where the camera used to stop: the curve itself did not move with the new minimum. */
export const PITCH_CURVE_START = 10;

/** Default furthest zoom, and the zoom where the pitch curve of a small map ends. */
export const BASE_MAX_DISTANCE = 140;
/** Furthest zoom per meter of the longer map side, when that is more than the default. */
const MAX_DISTANCE_PER_SIDE = 1;

/** The furthest zoom for a map: BASE_MAX_DISTANCE, or its longer side when that is more. */
export function maxDistanceFor(bounds: RtsCameraBounds | null): number {
  if (!bounds) return BASE_MAX_DISTANCE;
  const side = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ);
  return Math.max(BASE_MAX_DISTANCE, side * MAX_DISTANCE_PER_SIDE);
}

export class RtsCameraController {
  /** Ground point the camera looks at, meters. */
  readonly target = { x: 64, y: 0, z: 64 };
  /** Heading in radians; 0 looks towards world -Z. */
  yaw = Math.PI * 0.25;
  distance = 42;

  private targetDistance = this.distance;
  private readonly minDistance: number;
  private maxZoom: number;
  private readonly autoMax: boolean;
  private area: RtsCameraBounds | null = null;
  private readonly edgeMargin: number;
  private readonly keys = new Set<string>();
  private readonly panKeys = new Map<string, PanDirection>();
  private pointer: { x: number; y: number } | null = null;
  private rotating = false;
  private readonly heightAt: (x: number, z: number) => number;
  private readonly cleanup: (() => void)[] = [];

  constructor(
    readonly camera: PerspectiveCamera,
    private readonly dom: HTMLElement,
    opts: RtsCameraOptions = {},
  ) {
    this.minDistance = opts.minDistance ?? DEFAULT_MIN_DISTANCE;
    this.autoMax = opts.maxDistance === undefined;
    this.maxZoom = opts.maxDistance ?? BASE_MAX_DISTANCE;
    this.edgeMargin = opts.edgeMargin ?? 16;
    this.heightAt = opts.heightAt ?? (() => 0);
    for (const [code, dir] of Object.entries(DEFAULT_PAN_KEYS)) this.panKeys.set(code, dir);
    for (const [code, dir] of Object.entries(opts.panKeys ?? {})) {
      if (dir) this.panKeys.set(code, dir);
      else this.panKeys.delete(code);
    }
    this.listen(dom, 'wheel', this.onWheel, { passive: false });
    // Edge scroll follows the pointer over the whole window (also over HUD panels at the edge), and keeps
    // scrolling when the pointer leaves the window across an edge, as in a desktop RTS.
    this.listen(window, 'pointermove', this.onPointerMove);
    const root = (globalThis as { document?: Document }).document?.documentElement;
    if (root) this.listen(root, 'pointerleave', this.onPointerLeave);
    this.listen(dom, 'pointerdown', this.onPointerDown);
    this.listen(window, 'pointerup', this.onPointerUp);
    this.listen(window, 'blur', this.onBlur);
    if (opts.keyboard ?? true) {
      this.listen(window, 'keydown', this.onKeyDown);
      this.listen(window, 'keyup', this.onKeyUp);
    }
    this.apply();
  }

  private listen<K extends keyof HTMLElementEventMap>(
    el: HTMLElement | Window,
    type: K,
    fn: (e: HTMLElementEventMap[K]) => void,
    opts?: AddEventListenerOptions,
  ): void {
    const h = fn.bind(this) as EventListener;
    el.addEventListener(type, h, opts);
    this.cleanup.push(() => el.removeEventListener(type, h, opts));
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const steps = e.deltaMode === 1 ? e.deltaY / 3 : e.deltaY / 100;
    this.targetDistance = MathUtils.clamp(
      this.targetDistance * Math.pow(1.12, steps),
      this.minDistance,
      this.maxZoom,
    );
  }

  /** The area the target stays in, meters; also sets the zoom-out limit unless maxDistance was given. */
  get bounds(): RtsCameraBounds | null {
    return this.area;
  }

  set bounds(b: RtsCameraBounds | null) {
    this.area = b ? { ...b } : null;
    if (this.autoMax) {
      this.maxZoom = maxDistanceFor(this.area);
      this.targetDistance = Math.min(this.targetDistance, this.maxZoom);
      this.distance = Math.min(this.distance, this.maxZoom);
    }
    this.clampTarget();
  }

  /** Furthest zoom, meters. */
  get maxDistance(): number {
    return this.maxZoom;
  }

  /** Zooms to a distance (clamped); `immediate` skips the easing. */
  zoomTo(distance: number, immediate = false): void {
    this.targetDistance = MathUtils.clamp(distance, this.minDistance, this.maxZoom);
    if (immediate) {
      this.distance = this.targetDistance;
      this.apply();
    }
  }

  private onPointerMove(e: PointerEvent): void {
    const r = this.dom.getBoundingClientRect();
    this.pointer = { x: e.clientX - r.left, y: e.clientY - r.top };
    if (this.rotating) this.yaw -= e.movementX * 0.006;
  }

  /** Pointer left the window: keep the last position if it was in the edge strip, so scrolling continues. */
  private onPointerLeave(): void {
    if (this.pointer && !this.inEdgeStrip(this.pointer)) this.pointer = null;
  }

  private inEdgeStrip(p: { x: number; y: number }): boolean {
    const m = this.edgeMargin;
    return p.x < m || p.y < m || p.x > this.dom.clientWidth - m || p.y > this.dom.clientHeight - m;
  }

  private onPointerDown(e: PointerEvent): void {
    if (e.button !== 1) return;
    e.preventDefault();
    this.rotating = true;
  }

  private onPointerUp(e: PointerEvent): void {
    if (e.button === 1) this.rotating = false;
  }

  private onBlur(): void {
    this.keys.clear();
    this.rotating = false;
    this.pointer = null;
  }

  private onKeyDown(e: KeyboardEvent): void {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (this.panKeys.has(e.code) || e.code === 'KeyQ' || e.code === 'KeyE') this.keys.add(e.code);
  }

  private onKeyUp(e: KeyboardEvent): void {
    this.keys.delete(e.code);
  }

  /** Centers the camera on a ground point in meters. */
  focus(x: number, z: number): void {
    this.target.x = x;
    this.target.z = z;
    this.clampTarget();
  }

  /** Advances the camera by dt seconds of input. */
  update(dt: number): void {
    dt = Math.min(dt, 0.1);
    let px = 0;
    let pz = 0;
    for (const k of this.keys) {
      const d = this.panKeys.get(k);
      if (d) {
        px += d[0];
        pz += d[1];
      }
    }
    if (this.pointer && this.edgeMargin > 0 && !this.rotating) {
      const w = this.dom.clientWidth;
      const h = this.dom.clientHeight;
      if (this.pointer.x < this.edgeMargin) px -= 1;
      else if (this.pointer.x > w - this.edgeMargin) px += 1;
      if (this.pointer.y < this.edgeMargin) pz += 1;
      else if (this.pointer.y > h - this.edgeMargin) pz -= 1;
    }
    let rot = 0;
    if (this.keys.has('KeyQ')) rot += 1;
    if (this.keys.has('KeyE')) rot -= 1;
    this.yaw += rot * 1.6 * dt;

    if (px !== 0 || pz !== 0) {
      const len = Math.hypot(px, pz);
      const speed = (0.35 + this.distance * 0.022) * 30 * dt;
      px = (px / len) * speed;
      pz = (pz / len) * speed;
      // Forward on the ground is from the camera towards the target; right is perpendicular to it.
      const fx = -Math.sin(this.yaw);
      const fz = -Math.cos(this.yaw);
      const rx = Math.cos(this.yaw);
      const rz = -Math.sin(this.yaw);
      this.target.x += rx * px + fx * pz;
      this.target.z += rz * px + fz * pz;
      this.clampTarget();
    }

    this.distance += (this.targetDistance - this.distance) * (1 - Math.exp(-dt * 12));
    const ground = this.heightAt(this.target.x, this.target.z);
    this.target.y += (ground - this.target.y) * (1 - Math.exp(-dt * 8));
    this.apply();
  }

  private clampTarget(): void {
    const b = this.bounds;
    if (!b) return;
    this.target.x = MathUtils.clamp(this.target.x, b.minX, b.maxX);
    this.target.z = MathUtils.clamp(this.target.z, b.minZ, b.maxZ);
  }

  private apply(): void {
    const pitch = MathUtils.degToRad(this.pitchDegrees());
    const h = this.distance * Math.cos(pitch);
    const c = this.camera;
    c.position.set(
      this.target.x + Math.sin(this.yaw) * h,
      this.target.y + this.distance * Math.sin(pitch),
      this.target.z + Math.cos(this.yaw) * h,
    );
    c.lookAt(this.target.x, this.target.y, this.target.z);
    c.updateMatrixWorld();
  }

  /**
   * Degrees above the horizon: 50 to 68 from 10 m (the curve's start) to 140 m (or the furthest zoom if that is closer), then
   * on to 74 at the furthest zoom of a large map, so the overview looks down on it.
   */
  pitchDegrees(): number {
    const ref = Math.min(BASE_MAX_DISTANCE, this.maxZoom);
    const start = Math.min(PITCH_CURVE_START, this.minDistance);
    const t = (this.distance - start) / Math.max(1e-6, ref - start);
    if (this.distance <= ref || this.maxZoom <= ref) return 50 + 18 * MathUtils.clamp(t, 0, 1);
    const u = (this.distance - ref) / (this.maxZoom - ref);
    return 68 + 6 * MathUtils.clamp(u, 0, 1);
  }

  dispose(): void {
    for (const fn of this.cleanup) fn();
    this.cleanup.length = 0;
    this.keys.clear();
  }
}
