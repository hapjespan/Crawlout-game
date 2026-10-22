// Per-phase CPU time of the render loop, for finding the frame that hitches. The PerfMeter says how long a frame was; this
// says where the JavaScript of the frame went (terrain walk, platforms, units, props, shadow fit, submit), so the bench can
// print, next to a frame over budget, the phase it fell in. Cheap enough to stay on: one performance.now() per phase.

/** The phases of one render-loop frame, in the order the loop runs them. */
export const FRAME_PHASES = [
  'camera',
  'terrain',
  'interpolate',
  'platforms',
  'heights',
  'entities',
  'props',
  'effects',
  'shadowFit',
  'warmDraw',
  'submit',
] as const;

export type FramePhase = (typeof FRAME_PHASES)[number];

export interface FrameTimings {
  /** Counter of the loop run these timings belong to (the n-th frame since start). */
  frame: number;
  /** JavaScript time of the whole frame, ms. */
  totalMs: number;
  /** Milliseconds per phase. */
  phases: Record<FramePhase, number>;
  /** Free-form counters of the frame (chunk builds, relayouts, ...). */
  counters: Record<string, number>;
}

const emptyPhases = (): Record<FramePhase, number> =>
  Object.fromEntries(FRAME_PHASES.map((p) => [p, 0])) as Record<FramePhase, number>;

/**
 * Collects the time between `begin` and the following `mark` calls into named phases. `end` closes the frame and makes it
 * the one `last` returns. `slowest` keeps the frame with the most JavaScript time since the last `takeSlowest`.
 */
export class FrameProfiler {
  private frameNo = 0;
  private start = 0;
  private cursor = 0;
  private current: FrameTimings = { frame: 0, totalMs: 0, phases: emptyPhases(), counters: {} };
  private done: FrameTimings = { frame: 0, totalMs: 0, phases: emptyPhases(), counters: {} };
  private worst: FrameTimings | null = null;

  constructor(private readonly clock: () => number = () => performance.now()) {}

  begin(): void {
    this.frameNo++;
    this.start = this.cursor = this.clock();
    this.current = { frame: this.frameNo, totalMs: 0, phases: emptyPhases(), counters: {} };
  }

  /** Attributes the time since the previous mark (or begin) to `phase`. */
  mark(phase: FramePhase): void {
    const now = this.clock();
    this.current.phases[phase] += now - this.cursor;
    this.cursor = now;
  }

  /** Sets a counter of the running frame (e.g. leaf chunks built). */
  count(name: string, value: number): void {
    this.current.counters[name] = value;
  }

  end(): void {
    this.current.totalMs = this.clock() - this.start;
    this.done = this.current;
    if (!this.worst || this.current.totalMs > this.worst.totalMs) this.worst = this.current;
  }

  /** The last finished frame. */
  get last(): FrameTimings {
    return this.done;
  }

  /** The slowest frame since the previous call (null when no frame finished), then forgets it. */
  takeSlowest(): FrameTimings | null {
    const w = this.worst;
    this.worst = null;
    return w;
  }
}
