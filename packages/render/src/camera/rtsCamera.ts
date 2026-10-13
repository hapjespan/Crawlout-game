// RTS camera: orbits a ground target. Pan with WASD/arrows and screen-edge scroll, zoom with the wheel,
// rotate with Q/E or by dragging with the middle mouse button.
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
  maxDistance?: number;
  /** Pixels from the canvas edge where edge scroll starts. 0 disables edge scroll. */
  edgeMargin?: number;
  /** Listen to keyboard on window. Disable when the HUD owns the keys. */
  keyboard?: boolean;
}

const PAN_KEYS: Record<string, readonly [number, number]> = {
  KeyW: [0, 1],
  ArrowUp: [0, 1],
  KeyS: [0, -1],
  ArrowDown: [0, -1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};

export class RtsCameraController {
  /** Ground point the camera looks at, meters. */
  readonly target = { x: 64, y: 0, z: 64 };
  /** Heading in radians; 0 looks towards world -Z. */
  yaw = Math.PI * 0.25;
  distance = 42;
  bounds: RtsCameraBounds | null = null;

  private targetDistance = this.distance;
  private readonly minDistance: number;
  private readonly maxDistance: number;
  private readonly edgeMargin: number;
  private readonly keys = new Set<string>();
  private pointer: { x: number; y: number } | null = null;
  private rotating = false;
  private readonly heightAt: (x: number, z: number) => number;
  private readonly cleanup: (() => void)[] = [];

  constructor(
    readonly camera: PerspectiveCamera,
    private readonly dom: HTMLElement,
    opts: RtsCameraOptions = {},
  ) {
    this.minDistance = opts.minDistance ?? 10;
    this.maxDistance = opts.maxDistance ?? 140;
    this.edgeMargin = opts.edgeMargin ?? 14;
    this.heightAt = opts.heightAt ?? (() => 0);
    this.listen(dom, 'wheel', this.onWheel, { passive: false });
    this.listen(dom, 'pointermove', this.onPointerMove);
    this.listen(dom, 'pointerleave', this.onPointerLeave);
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
    this.targetDistance = MathUtils.clamp(this.targetDistance * Math.pow(1.12, steps), this.minDistance, this.maxDistance);
  }

  private onPointerMove(e: PointerEvent): void {
    const r = this.dom.getBoundingClientRect();
    this.pointer = { x: e.clientX - r.left, y: e.clientY - r.top };
    if (this.rotating) this.yaw -= e.movementX * 0.006;
  }

  private onPointerLeave(): void {
    this.pointer = null;
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
    if (e.code in PAN_KEYS || e.code === 'KeyQ' || e.code === 'KeyE') this.keys.add(e.code);
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
      const d = PAN_KEYS[k];
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
    // Steeper when zoomed out, flatter when close: 50 to 68 degrees above the horizon.
    const t = (this.distance - this.minDistance) / (this.maxDistance - this.minDistance);
    const pitch = MathUtils.degToRad(50 + 18 * MathUtils.clamp(t, 0, 1));
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

  dispose(): void {
    for (const fn of this.cleanup) fn();
    this.cleanup.length = 0;
    this.keys.clear();
  }
}
