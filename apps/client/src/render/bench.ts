// Scripted camera runs for measuring the renderer in the browser (render demo: window.crawloutBench()). Each phase
// drives the RTS camera for a few seconds and records every frame: the interval between frames (rAF timestamps), and
// the draw calls and triangles of the frame (renderer.stats(), plus the terrain and props per layer). Measure on mains
// power: on battery Chrome holds rAF at 30 Hz. For the cost of a frame rather than the display's refresh, start Chrome
// with --disable-frame-rate-limit --disable-gpu-vsync.
import type { CrawloutRenderer, FrameTimings, TriangleBreakdown } from '@crawlout/render';

/** A frame interval over the budget, with the JavaScript phases of the render loops around it (where the time went). */
export interface Hitch {
  /** Seconds into the phase. */
  atS: number;
  intervalMs: number;
  /** Camera focus (meters) when it happened. */
  focus: [number, number];
  /** Timings of the two loops before the interval ended (the one that ran in the interval is the older); phases in ms, zeros left out. */
  loops: {
    frame: number;
    totalMs: number;
    phases: Record<string, number>;
    counters: Record<string, number>;
  }[];
}

/** Intervals above this are reported as hitches (the brief allows no frame above 20 ms). */
export const HITCH_MS = 20;

const compact = (t: FrameTimings): Hitch['loops'][number] => ({
  frame: t.frame,
  totalMs: Math.round(t.totalMs * 10) / 10,
  phases: Object.fromEntries(
    Object.entries(t.phases)
      .filter(([, v]) => v >= 0.05)
      .map(([k, v]) => [k, Math.round(v * 10) / 10]),
  ),
  counters: { ...t.counters },
});

export interface BenchPhase {
  name: string;
  frames: number;
  fps: number;
  medianMs: number;
  p99Ms: number;
  worstMs: number;
  drawCallsMedian: number;
  drawCallsMax: number;
  trianglesMedian: number;
  trianglesMax: number;
  terrainTrianglesMax: number;
  terrainDrawsMax: number;
  propsVisibleMax: number;
  /** Rigid units (robots) drawn at most in one frame, and the draw calls the rigid layer took. */
  rigidVisibleMax: number;
  rigidDrawsMax: number;
  /** Intervals above HITCH_MS, at most 12 (the slowest), each with the loop phases around it. */
  hitches: Hitch[];
  /** Triangles per layer (main pass and shadow pass) in the frame of the phase with the most triangles. */
  layers: TriangleBreakdown;
}

export interface BenchResult {
  backend: string;
  devicePixelRatio: number;
  canvas: { w: number; h: number };
  mapSize: number;
  propsTotal: number;
  phases: BenchPhase[];
}

const quantile = (sorted: readonly number[], q: number): number =>
  sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;

function frame(): Promise<number> {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

/** Runs `seconds` of camera motion; `step(u)` sets the camera for progress u in 0..1. */
async function phase(
  renderer: CrawloutRenderer,
  name: string,
  seconds: number,
  step: (u: number) => void,
): Promise<BenchPhase> {
  const intervals: number[] = [];
  const draws: number[] = [];
  const tris: number[] = [];
  let terrainTris = 0;
  let terrainDraws = 0;
  let props = 0;
  let rigidVisible = 0;
  let rigidDraws = 0;
  const hitches: Hitch[] = [];
  let layers: TriangleBreakdown = { main: {}, shadow: {} };
  let layersTris = -1;
  const recent: FrameTimings[] = [];
  const c = renderer.cameraControls;
  let last = await frame();
  const start = last;
  for (;;) {
    const now = await frame();
    const u = (now - start) / (seconds * 1000);
    if (u >= 1) break;
    const seen = renderer.frameTimings();
    if (recent[recent.length - 1]?.frame !== seen.frame)
      recent.push({ ...seen, phases: { ...seen.phases }, counters: { ...seen.counters } });
    if (recent.length > 3) recent.shift();
    if (now - last > HITCH_MS)
      hitches.push({
        atS: Math.round(((now - start) / 1000) * 100) / 100,
        intervalMs: Math.round((now - last) * 10) / 10,
        focus: [Math.round(c.target.x * 10) / 10, Math.round(c.target.z * 10) / 10],
        loops: recent.slice(-2).map(compact),
      });
    intervals.push(now - last);
    last = now;
    const s = renderer.stats();
    const l = renderer.layerStats();
    draws.push(s.drawCalls);
    tris.push(s.triangles);
    if (s.triangles > layersTris) {
      layersTris = s.triangles;
      layers = renderer.triangleBreakdown();
    }
    terrainTris = Math.max(terrainTris, l.terrainTriangles);
    terrainDraws = Math.max(terrainDraws, l.terrainDraws);
    props = Math.max(props, l.propsVisible);
    rigidVisible = Math.max(rigidVisible, l.rigidVisible);
    rigidDraws = Math.max(rigidDraws, l.rigidDraws);
    step(u);
  }
  const sorted = [...intervals].sort((a, b) => a - b);
  const sd = [...draws].sort((a, b) => a - b);
  const st = [...tris].sort((a, b) => a - b);
  const r1 = (v: number): number => Math.round(v * 10) / 10;
  return {
    name,
    frames: intervals.length,
    fps: r1((intervals.length * 1000) / Math.max(1, last - start)),
    medianMs: r1(quantile(sorted, 0.5)),
    p99Ms: r1(quantile(sorted, 0.99)),
    worstMs: r1(sorted[sorted.length - 1] ?? 0),
    drawCallsMedian: quantile(sd, 0.5),
    drawCallsMax: sd[sd.length - 1] ?? 0,
    trianglesMedian: quantile(st, 0.5),
    trianglesMax: st[st.length - 1] ?? 0,
    terrainTrianglesMax: terrainTris,
    terrainDrawsMax: terrainDraws,
    propsVisibleMax: props,
    rigidVisibleMax: rigidVisible,
    rigidDrawsMax: rigidDraws,
    hitches: hitches.sort((a, b) => b.intervalMs - a.intervalMs).slice(0, 12),
    layers,
  };
}

/**
 * Lets the scene settle before measuring: runs frames until the warm draw (render's one-time pipeline warm-up) has not
 * fired for `quietMs`, at most `maxMs`, so its one expensive frame is not counted in a camera phase.
 */
async function settle(renderer: CrawloutRenderer, quietMs = 1500, maxMs = 30_000): Promise<void> {
  const begin = await frame();
  let lastDraws = -1;
  let lastChange = begin;
  for (;;) {
    const now = await frame();
    const draws = renderer.frameTimings().counters.warmDraws ?? 0;
    if (draws !== lastDraws) {
      lastDraws = draws;
      lastChange = now;
    }
    if (now - lastChange >= quietMs || now - begin >= maxMs) return;
  }
}

/** Follows a polyline of ground points (meters) at even speed over u in 0..1. */
function along(points: readonly (readonly [number, number])[]): (u: number) => [number, number] {
  const lengths = points
    .slice(1)
    .map((p, k) => Math.hypot(p[0] - points[k]![0], p[1] - points[k]![1]));
  const total = lengths.reduce((a, b) => a + b, 0);
  return (u) => {
    let d = u * total;
    for (let k = 0; k < lengths.length; k++) {
      if (d <= lengths[k]! || k === lengths.length - 1) {
        const t = Math.min(1, d / lengths[k]!);
        const a = points[k]!;
        const b = points[k + 1]!;
        return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      }
      d -= lengths[k]!;
    }
    return [points[0]![0], points[0]![1]];
  };
}

/**
 * The standard run over a square map of `size` meters: a turn at gameplay zoom over the middle, a serpentine pan over
 * the whole map at gameplay zoom, a pan at mid zoom, and a turn in the overview at the furthest zoom.
 */
export async function runBench(
  renderer: CrawloutRenderer,
  size: number,
  opts: { seconds?: number } = {},
): Promise<BenchResult> {
  const c = renderer.cameraControls;
  const sec = opts.seconds ?? 6;
  const mid = size / 2;
  const m = Math.min(40, size * 0.1);
  const phases: BenchPhase[] = [];
  const gameplay = 42;
  const turn = async (name: string): Promise<void> => {
    c.yaw = Math.PI * 0.25;
    phases.push(
      await phase(renderer, name, sec, (u) => {
        c.yaw = Math.PI * 0.25 + u * Math.PI * 2;
      }),
    );
  };

  c.focus(mid, mid);
  c.zoomTo(gameplay, true);
  await settle(renderer);
  await phase(renderer, 'warm-up', 2, (u) => {
    c.yaw = Math.PI * 0.25 + u * Math.PI * 2;
  });
  await turn('turn at 42 m');

  const serpentine = along([
    [m, m],
    [size - m, m],
    [size - m, mid],
    [m, mid],
    [m, size - m],
    [size - m, size - m],
  ]);
  c.yaw = Math.PI * 0.25;
  phases.push(
    await phase(renderer, 'pan over the map at 42 m', sec * 2, (u) => {
      const [x, z] = serpentine(u);
      c.focus(x, z);
    }),
  );
  c.zoomTo(140, true);
  const diagonal = along([
    [m, m],
    [size - m, size - m],
  ]);
  phases.push(
    await phase(renderer, 'pan diagonally at 140 m', sec, (u) => {
      const [x, z] = diagonal(u);
      c.focus(x, z);
    }),
  );
  c.focus(mid, mid);
  c.zoomTo(c.maxDistance, true);
  await turn(`overview turn at ${Math.round(c.maxDistance)} m`);
  c.zoomTo(gameplay, true);
  c.focus(mid, mid);
  return finish(renderer, size, phases);
}

function finish(renderer: CrawloutRenderer, size: number, phases: BenchPhase[]): BenchResult {
  const s = renderer.stats();
  const canvas = document.querySelector('canvas');
  return {
    backend: s.backend,
    devicePixelRatio: window.devicePixelRatio,
    canvas: { w: canvas?.width ?? 0, h: canvas?.height ?? 0 },
    mapSize: size,
    propsTotal: renderer.layerStats().propsTotal,
    phases,
  };
}

/**
 * The run for the game (index.html, window.crawlout.bench): a turn at the player's base at gameplay zoom, a pan from the
 * base to the middle of the map, a turn at 140 m and a turn in the overview. `base` is the player's spawn in meters.
 */
export async function runBaseBench(
  renderer: CrawloutRenderer,
  size: number,
  base: readonly [number, number],
  opts: { seconds?: number } = {},
): Promise<BenchResult> {
  const c = renderer.cameraControls;
  const sec = opts.seconds ?? 4;
  const [bx, bz] = base;
  const mid = size / 2;
  const phases: BenchPhase[] = [];
  const turn = async (name: string): Promise<void> => {
    c.yaw = Math.PI * 0.25;
    phases.push(
      await phase(renderer, name, sec, (u) => {
        c.yaw = Math.PI * 0.25 + u * Math.PI * 2;
      }),
    );
  };
  c.focus(bx, bz);
  c.zoomTo(42, true);
  await settle(renderer);
  await phase(renderer, 'warm-up', 2, (u) => {
    c.yaw = Math.PI * 0.25 + u * Math.PI * 2;
  });
  await turn('turn at base, 42 m');
  c.yaw = Math.PI * 0.25;
  phases.push(
    await phase(renderer, 'pan base to middle, 42 m', sec, (u) => {
      c.focus(bx + (mid - bx) * u, bz + (mid - bz) * u);
    }),
  );
  c.zoomTo(140, true);
  await turn('turn at middle, 140 m');
  c.zoomTo(c.maxDistance, true);
  await turn(`overview turn at ${Math.round(c.maxDistance)} m`);
  c.zoomTo(42, true);
  c.focus(bx, bz);
  return finish(renderer, size, phases);
}
