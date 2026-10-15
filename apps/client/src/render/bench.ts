// Scripted camera runs for measuring the renderer in the browser (render demo: window.crawloutBench()). Each phase
// drives the RTS camera for a few seconds and records every frame: the interval between frames (rAF timestamps), and
// the draw calls and triangles of the frame (renderer.stats(), plus the terrain and props per layer). Measure on mains
// power: on battery Chrome holds rAF at 30 Hz. For the cost of a frame rather than the display's refresh, start Chrome
// with --disable-frame-rate-limit --disable-gpu-vsync.
import type { CrawloutRenderer } from '@crawlout/render';

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
  let last = await frame();
  const start = last;
  for (;;) {
    const now = await frame();
    const u = (now - start) / (seconds * 1000);
    if (u >= 1) break;
    intervals.push(now - last);
    last = now;
    const s = renderer.stats();
    const l = renderer.layerStats();
    draws.push(s.drawCalls);
    tris.push(s.triangles);
    terrainTris = Math.max(terrainTris, l.terrainTriangles);
    terrainDraws = Math.max(terrainDraws, l.terrainDraws);
    props = Math.max(props, l.propsVisible);
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
  };
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
