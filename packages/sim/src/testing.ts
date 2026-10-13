import type { SimMap, SimPlayer } from './config.js';

// Testhulpen: programmatische testmaps in sim-eenheden. GEEN spelregels: de config komt in tests uit de echte data
// (simConfigFromGameData), de maps voor replays uit data/maps via packages/map. Dominantie en voorraden hier zijn
// alleen testgetallen voor deze kunstmaps.

const cc = (cx: number, cy: number): { x: number; y: number } => ({ x: (cx << 8) + 128, y: (cy << 8) + 128 });

/** Positie in eenheden van het midden van cel (cx, cy). */
export const cellCenter = cc;

function features(w: number, h: number): Pick<SimMap, 'spawns' | 'scrapNodes' | 'claimPoints' | 'dominance'> {
  return {
    spawns: [cc(8, 8), cc(w - 9, h - 9)],
    scrapNodes: [
      { ...cc(16, 6), amount: 500 },
      { ...cc(w - 17, h - 7), amount: 500 },
    ],
    claimPoints: [{ ...cc(w >> 1, h >> 1), kind: 1 }],
    dominance: { pointsRequired: 1, ticks: 600 },
  };
}

/**
 * Testarena van w bij h cellen: een rand van muur, een verticale muur door het midden met een opening van
 * 4 cellen in het midden, en een blok van 4 bij 4 cellen in het rechterdeel. Spawns linksboven en rechtsonder.
 */
export function createTestMap(w = 64, h = 64): SimMap {
  const passable = new Uint8Array(w * h);
  const midX = w >> 1;
  const gapY0 = (h >> 1) - 2;
  const blockX0 = midX + (w >> 2) - 2;
  const blockY0 = (h >> 2) - 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const border = x === 0 || y === 0 || x === w - 1 || y === h - 1;
      const wall = x === midX && (y < gapY0 || y >= gapY0 + 4);
      const block = x >= blockX0 && x < blockX0 + 4 && y >= blockY0 && y < blockY0 + 4;
      passable[y * w + x] = border || wall || block ? 0 : 1;
    }
  }
  return { w, h, passable, ...features(w, h), claimPoints: [{ ...cc(midX - 4, h >> 1), kind: 1 }] };
}

/** Een open map zonder muren (alleen de rand), voor benchmark en eenvoudige tests. */
export function createOpenMap(w = 128, h = 128): SimMap {
  const passable = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) passable[y * w + x] = x === 0 || y === 0 || x === w - 1 || y === h - 1 ? 0 : 1;
  }
  return { w, h, passable, ...features(w, h) };
}

/** n spelers van factie 0. */
export function testPlayers(n = 2, ai = false): SimPlayer[] {
  return Array.from({ length: n }, () => ({ factionId: 0, ai }));
}
