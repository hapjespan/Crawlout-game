// Stats overlay in every build: fps, CPU ms per frame, worst frame interval, draw calls, triangles, backend.
// Replaces Stats.js so draw calls from the node renderer show up next to fps.

export interface FrameStats {
  fps: number;
  /** Average CPU time of update plus render submit, ms. */
  cpuMs: number;
  /** Longest interval between two frames in the last window, ms. The brief allows no frame above 20 ms. */
  worstFrameMs: number;
  drawCalls: number;
  triangles: number;
  backend: string;
}

export class PerfMeter {
  readonly stats: FrameStats;
  private frames = 0;
  private cpuSum = 0;
  private worst = 0;
  private windowStart = -1;
  private lastFrame = -1;

  constructor(
    backend: string,
    private readonly windowMs = 500,
  ) {
    this.stats = { fps: 0, cpuMs: 0, worstFrameMs: 0, drawCalls: 0, triangles: 0, backend };
  }

  /** Records one frame. Returns true when a new window of stats is ready. */
  frame(now: number, cpuMs: number, drawCalls: number, triangles: number): boolean {
    if (this.windowStart < 0) this.windowStart = now;
    if (this.lastFrame >= 0) this.worst = Math.max(this.worst, now - this.lastFrame);
    this.lastFrame = now;
    this.frames++;
    this.cpuSum += cpuMs;
    this.stats.drawCalls = drawCalls;
    this.stats.triangles = triangles;
    const elapsed = now - this.windowStart;
    if (elapsed < this.windowMs) return false;
    this.stats.fps = (this.frames * 1000) / elapsed;
    this.stats.cpuMs = this.cpuSum / this.frames;
    this.stats.worstFrameMs = this.worst;
    this.frames = 0;
    this.cpuSum = 0;
    this.worst = 0;
    this.windowStart = now;
    return true;
  }
}

export class PerfOverlay {
  readonly el: HTMLDivElement;

  constructor(parent: HTMLElement) {
    const el = document.createElement('div');
    el.setAttribute('aria-label', 'Prestatiemeter');
    el.style.cssText =
      'position:absolute;top:8px;left:8px;z-index:10;pointer-events:none;padding:6px 8px;border-radius:4px;' +
      'background:rgba(10,10,12,.72);color:#cfe8cf;font:12px/1.35 ui-monospace,Menlo,Consolas,monospace;white-space:pre';
    parent.appendChild(el);
    this.el = el;
  }

  show(s: FrameStats): void {
    const tris = s.triangles >= 1000 ? `${(s.triangles / 1000).toFixed(1)}k` : String(s.triangles);
    this.el.textContent =
      `${s.fps.toFixed(0).padStart(3)} fps  ${s.backend}\n` +
      `cpu ${s.cpuMs.toFixed(2)} ms  max ${s.worstFrameMs.toFixed(1)} ms\n` +
      `draw ${s.drawCalls}  tris ${tris}`;
    this.el.style.color = s.worstFrameMs > 20 ? '#ffb38a' : '#cfe8cf';
  }

  dispose(): void {
    this.el.remove();
  }
}
