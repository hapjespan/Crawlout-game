import { describe, expect, it } from 'vitest';
import {
  buildFogPixels,
  buildStaticPixels,
  drawMinimap,
  minimapBuildCount,
  minimapCellColor,
} from './minimap.js';
import type { MinimapData } from './types.js';

const base = (over: Partial<MinimapData> = {}): MinimapData => ({
  w: 4,
  h: 1,
  passable: new Uint8Array([1, 1, 0, 0]),
  blips: [],
  claims: [],
  ...over,
});
const px = (d: Uint8ClampedArray, i: number): number[] => Array.from(d.slice(i * 4, i * 4 + 3));

describe('minimap statische laag', () => {
  it('zonder water en terrein: passable of muur, zoals voorheen', () => {
    const d = buildStaticPixels(base());
    expect(px(d, 0)).toEqual([74, 80, 86]);
    expect(px(d, 2)).toEqual([30, 33, 36]);
  });

  it('water is blauw, ondiep lichtblauw, ook op onbegaanbare cellen', () => {
    const m = base({ water: new Uint8Array([0, 1, 2, 1]) });
    const d = buildStaticPixels(m);
    expect(px(d, 0)).toEqual([74, 80, 86]);
    expect(px(d, 1)).toEqual([38, 110, 200]);
    expect(px(d, 2)).toEqual([128, 196, 238]);
    expect(px(d, 3)).toEqual([38, 110, 200]);
    const [r, , b] = minimapCellColor(m, 1);
    expect(b!).toBeGreaterThan(r!);
    expect(minimapCellColor(m, 2)[2]!).toBeGreaterThan(minimapCellColor(m, 1)[2]!);
  });

  it('met terrain: bos groen, klif donkergrijs; water wint van terrein', () => {
    const m = base({ terrain: new Uint8Array([0, 1, 2, 1]), water: new Uint8Array([0, 0, 0, 1]) });
    expect(px(buildStaticPixels(m), 0)).toEqual([74, 80, 86]);
    expect(px(buildStaticPixels(m), 1)).toEqual([46, 112, 58]);
    expect(px(buildStaticPixels(m), 2)).toEqual([78, 78, 84]);
    expect(px(buildStaticPixels(m), 3)).toEqual([38, 110, 200]);
  });

  it('fog-overlay: alleen onzichtbare cellen krijgen alpha', () => {
    const d = buildFogPixels(base(), new Uint8Array([1, 0, 1, 0]));
    expect([d[3], d[7], d[11], d[15]]).toEqual([0, 140, 0, 140]);
  });
});

describe('minimap cache', () => {
  const fakeCanvas = (): { canvas: HTMLCanvasElement; draws: number } => {
    const state = { canvas: null as unknown as HTMLCanvasElement, draws: 0 };
    const ctx = {
      drawImage: () => void state.draws++,
      putImageData: () => undefined,
      fillRect: () => undefined,
      strokeRect: () => undefined,
    };
    const offscreen = (): HTMLCanvasElement =>
      ({ width: 0, height: 0, getContext: () => ctx }) as unknown as HTMLCanvasElement;
    state.canvas = {
      width: 160,
      height: 160,
      getContext: () => ctx,
      ownerDocument: { createElement: offscreen },
    } as unknown as HTMLCanvasElement;
    return state;
  };
  if (typeof ImageData === 'undefined') {
    (globalThis as { ImageData?: unknown }).ImageData = class {
      constructor(
        public data: Uint8ClampedArray,
        public width: number,
        public height: number,
      ) {}
    };
  }

  it('bouwt de statische laag een keer en hergebruikt hem per refresh', () => {
    const t = fakeCanvas();
    const m = base({ water: new Uint8Array(4), visible: new Uint8Array(4) });
    const b0 = minimapBuildCount.base;
    const f0 = minimapBuildCount.fog;
    for (let i = 0; i < 5; i++)
      drawMinimap(t.canvas, { ...m, blips: [{ x: i, y: 0, owner: 0, kind: 'unit' }] }, 0);
    expect(minimapBuildCount.base - b0).toBe(1);
    expect(minimapBuildCount.fog - f0).toBe(1);
    expect(t.draws).toBe(10);
  });

  it('bouwt opnieuw bij een nieuwe array', () => {
    const t = fakeCanvas();
    const m = base();
    drawMinimap(t.canvas, m, 0);
    const b0 = minimapBuildCount.base;
    drawMinimap(t.canvas, { ...m, water: new Uint8Array(4) }, 0);
    expect(minimapBuildCount.base - b0).toBe(1);
  });

  it('384x384 met water en terrein: refresh uit cache ruim onder 2 ms', () => {
    const n = 384 * 384;
    const m: MinimapData = {
      w: 384,
      h: 384,
      passable: new Uint8Array(n).fill(1),
      water: new Uint8Array(n).fill(1),
      terrain: new Uint8Array(n).fill(2),
      visible: new Uint8Array(n).fill(1),
      blips: Array.from({ length: 200 }, (_, i) => ({
        x: i * 300,
        y: i * 300,
        owner: i % 2,
        kind: 'unit' as const,
      })),
      claims: [],
    };
    const t = fakeCanvas();
    drawMinimap(t.canvas, m, 0);
    for (let i = 0; i < 20; i++) drawMinimap(t.canvas, m, 0); // opwarmen
    const runs: number[] = [];
    for (let r = 0; r < 7; r++) {
      const t0 = performance.now();
      for (let i = 0; i < 100; i++) drawMinimap(t.canvas, m, 0);
      runs.push((performance.now() - t0) / 100);
    }
    runs.sort((a, b) => a - b);
    expect(runs[3] ?? Infinity).toBeLessThan(2);
  });
});
