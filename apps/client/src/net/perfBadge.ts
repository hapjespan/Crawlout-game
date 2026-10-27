// Compact frame stats in one line, top right next to the surrender button. Plain DOM outside the HUD, like the
// network status; it replaces the renderer's three-line overlay (the renderer is created with stats: false).
import type { FrameStats } from '@crawlout/render';

export interface PerfBadge {
  dispose(): void;
}

const REFRESH_MS = 500;
// Longest frame interval the brief allows, ms: above it the badge turns amber.
const WORST_FRAME_MS = 20;

/** One line of stats: "60 fps · 3.1 ms · max 17 ms · 220 dc". Exported for tests. */
export function perfText(s: FrameStats): string {
  return `${s.fps.toFixed(0)} fps · ${s.cpuMs.toFixed(1)} ms · max ${s.worstFrameMs.toFixed(0)} ms · ${s.drawCalls} dc`;
}

export function createPerfBadge(el: HTMLElement, stats: () => FrameStats): PerfBadge {
  const refresh = (): void => {
    const s = stats();
    el.textContent = perfText(s);
    el.setAttribute('aria-label', `Prestatiemeter, ${s.backend}`);
    el.style.color = s.worstFrameMs > WORST_FRAME_MS ? '#ffb38a' : '#cfe8cf';
  };
  refresh();
  const timer = window.setInterval(refresh, REFRESH_MS);
  return { dispose: () => window.clearInterval(timer) };
}
