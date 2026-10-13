// Render demo without a sim: fake snapshots at 20 Hz into the renderer, plus selection and move orders
// that the fake source mirrors the way the sim would. Open /render-demo.html on the vite dev server.
import { MAX_ENTITIES, TICK_MS } from '@crawlout/protocol';
import { createRenderer } from '@crawlout/render';
import { createGridTerrain, FakeSnapshotSource } from '@crawlout/render/dev';

const WORLD = 128;

function wastelandHeight(x: number, z: number): number {
  return (
    1.4 * Math.sin(x * 0.05) * Math.cos(z * 0.043) +
    0.6 * Math.sin(x * 0.13 + 1.7) * Math.sin(z * 0.11 + 0.4) +
    0.25 * Math.sin((x + z) * 0.31)
  );
}

function wastelandColor(x: number, z: number, y: number): readonly [number, number, number] {
  const n = 0.5 + 0.5 * Math.sin(x * 0.21 + Math.sin(z * 0.17) * 2.1) * Math.cos(z * 0.19 - x * 0.07);
  const low = Math.max(0, Math.min(1, (y + 2) / 4));
  const r = 0.46 + 0.16 * n + 0.08 * low;
  const g = 0.4 + 0.12 * n + 0.06 * low;
  const b = 0.3 + 0.06 * n;
  return [r, g, b];
}

function showError(message: string): void {
  const el = document.getElementById('error');
  if (!el) return;
  el.textContent = message;
  el.style.display = 'grid';
}

async function main(): Promise<void> {
  const canvas = document.getElementById('view') as HTMLCanvasElement | null;
  const marquee = document.getElementById('marquee') as HTMLDivElement | null;
  if (!canvas || !marquee) return;
  const params = new URLSearchParams(location.search);
  const count = Math.max(1, Math.min(MAX_ENTITIES, Number(params.get('n')) || 200));

  const renderer = await createRenderer({ canvas, forceWebGL: params.has('webgl') });
  const backendEl = document.getElementById('backend');
  if (backendEl) backendEl.textContent = renderer.backend === 'webgpu' ? 'WebGPU' : 'WebGL2-fallback';
  renderer.setTerrain(createGridTerrain(WORLD, WORLD, 1, wastelandHeight, wastelandColor));

  const source = new FakeSnapshotSource({ count, players: 4, worldSize: WORLD });
  renderer.pushSnapshot(source.next());
  const pump = window.setInterval(() => renderer.pushSnapshot(source.next()), TICK_MS);

  // Selection: click picks one unit, drag draws a marquee. Shift adds to the selection.
  let selection = new Set<number>();
  let drag: { x: number; y: number; moved: boolean } | null = null;
  const local = (e: PointerEvent | MouseEvent) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    canvas.setPointerCapture(e.pointerId);
    drag = { ...local(e), moved: false };
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const p = local(e);
    if (!drag.moved && Math.hypot(p.x - drag.x, p.y - drag.y) < 4) return;
    drag.moved = true;
    marquee.style.display = 'block';
    marquee.style.left = `${Math.min(p.x, drag.x)}px`;
    marquee.style.top = `${Math.min(p.y, drag.y)}px`;
    marquee.style.width = `${Math.abs(p.x - drag.x)}px`;
    marquee.style.height = `${Math.abs(p.y - drag.y)}px`;
  });
  canvas.addEventListener('pointerup', (e) => {
    if (e.button !== 0 || !drag) return;
    const p = local(e);
    let ids: number[];
    if (drag.moved) {
      ids = renderer.boxSelect({ x0: drag.x, y0: drag.y, x1: p.x, y1: p.y });
    } else {
      const hit = renderer.pickAt(p.x, p.y).entityId;
      ids = hit === null ? [] : [hit];
    }
    selection = e.shiftKey ? new Set([...selection, ...ids]) : new Set(ids);
    source.setSelected(selection);
    marquee.style.display = 'none';
    drag = null;
  });
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const ground = renderer.pickAt(local(e).x, local(e).y).ground;
    if (ground && selection.size > 0) source.moveTo(selection, ground.x, ground.y);
  });

  window.addEventListener('beforeunload', () => {
    window.clearInterval(pump);
    renderer.dispose();
  });
  // Handy in the console: window.crawloutRender.stats()
  (window as unknown as { crawloutRender: typeof renderer }).crawloutRender = renderer;
}

main().catch((err: unknown) => {
  console.error(err);
  showError(`Renderer kon niet starten: ${err instanceof Error ? err.message : String(err)}`);
});
