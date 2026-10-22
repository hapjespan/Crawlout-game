import type { SimMap, SimPlayer } from './config.js';
import { idiv, imod } from './math/int.js';

// Testhulpen: programmatische testmaps in sim-eenheden. GEEN spelregels: de config komt in tests uit de echte data
// (simConfigFromGameData), de maps voor replays uit data/maps via packages/map. Dominantie en voorraden hier zijn
// alleen testgetallen voor deze kunstmaps.

const cc = (cx: number, cy: number): { x: number; y: number } => ({
  x: (cx << 8) + 128,
  y: (cy << 8) + 128,
});

/** Positie in eenheden van het midden van cel (cx, cy). */
export const cellCenter = cc;

function features(
  w: number,
  h: number,
): Pick<SimMap, 'spawns' | 'scrapNodes' | 'claimPoints' | 'dominance'> {
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
    for (let x = 0; x < w; x++)
      passable[y * w + x] = x === 0 || y === 0 || x === w - 1 || y === h - 1 ? 0 : 1;
  }
  return { w, h, passable, ...features(w, h) };
}

/** Rijen (y van de bovenste rij) van de drie oversteken over de rivier op de XL-testmap; elke oversteek is 4 rijen breed. */
export const XL_CROSSINGS: readonly number[] = [64, 192, 320];
/** Breedte van een oversteek in rijen. */
export const XL_CROSSING_ROWS = 4;
/** Halve breedte van de rivier: cellen met |x - xlRiverX(y)| <= XL_RIVER_HALF zijn water. */
export const XL_RIVER_HALF = 2;
/** Dikte van de dichte bosrand langs de mapgrens, in cellen. */
export const XL_FOREST_RIM = 14;

/** Midden van de meanderende rivier op rij y (driehoeksgolf, amplitude 24 cellen, periode 128 rijen). */
export function xlRiverX(w: number, y: number): number {
  const t = imod(y, 128);
  const tri = t < 64 ? t : 128 - t; // 0..64
  return (w >> 1) + idiv(tri * 3, 4) - 24;
}

/** Deterministische integer-hash (geen toeval in de sim). */
function hash3(a: number, b: number, c: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x27d4eb2f) ^ Math.imul(c + 0x165667b1, 0x9e3779b1);
  h ^= h >>> 13;
  h = Math.imul(h, 0x85ebca6b);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * XL-testmap van w bij h cellen (standaard 384 bij 384, de maat van de grote map): een rand van muur, een dichte
 * bosrand van XL_FOREST_RIM cellen (ongeveer 80 procent bomen, met toevallige gaten), een meanderende rivier van noord
 * naar zuid (5 cellen breed) met drie oversteken van 4 rijen (XL_CROSSINGS), 48 bosjes (ronde clusters van 3 tot 7
 * cellen straal) en 90 verspreide blokken van 2 tot 9 cellen. Rond de spawns, de oversteken, de scrap-nodes en de
 * claimpunten blijft het vrij. Spawns linksboven en rechtsonder: elke route tussen de kanten moet over een oversteek.
 */
export function createXlTestMap(w = 384, h = 384): SimMap {
  const passable = new Uint8Array(w * h).fill(1);
  const feat = xlFeatures(w, h);
  const clear: { x: number; y: number; r: number }[] = [];
  for (const s of feat.spawns) clear.push({ x: s.x >> 8, y: s.y >> 8, r: 12 });
  for (const n of feat.scrapNodes) clear.push({ x: n.x >> 8, y: n.y >> 8, r: 5 });
  for (const c of feat.claimPoints) clear.push({ x: c.x >> 8, y: c.y >> 8, r: 8 });
  for (const y0 of XL_CROSSINGS) {
    const cy = y0 + (XL_CROSSING_ROWS >> 1);
    const cx = xlRiverX(w, cy);
    clear.push({ x: cx - 6, y: cy, r: 7 }, { x: cx + 6, y: cy, r: 7 });
  }
  const isClear = (x: number, y: number): boolean => {
    for (const c of clear) {
      const dx = x - c.x;
      const dy = y - c.y;
      if (dx * dx + dy * dy <= c.r * c.r) return true;
    }
    return false;
  };
  const block = (x: number, y: number): void => {
    if (x < 0 || y < 0 || x >= w || y >= h || isClear(x, y)) return;
    passable[y * w + x] = 0;
  };
  // bosrand
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const edge = Math.min(x, y, w - 1 - x, h - 1 - y);
      if (edge === 0) passable[y * w + x] = 0;
      else if (edge < XL_FOREST_RIM && (hash3(x, y, 1) & 1023) < 820) block(x, y);
    }
  }
  // bosjes
  for (let k = 0; k < 48; k++) {
    const cx = 24 + imod(hash3(k, 0, 2), w - 48);
    const cy = 24 + imod(hash3(k, 1, 2), h - 48);
    const r = 3 + imod(hash3(k, 2, 2), 5);
    for (let y = cy - r; y <= cy + r; y++)
      for (let x = cx - r; x <= cx + r; x++) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy <= r * r && (hash3(x, y, 3) & 1023) < 900) block(x, y);
      }
  }
  // verspreide blokken
  for (let k = 0; k < 90; k++) {
    const bx = 20 + imod(hash3(k, 0, 4), w - 40);
    const by = 20 + imod(hash3(k, 1, 4), h - 40);
    const bw = 2 + imod(hash3(k, 2, 4), 8);
    const bh = 2 + imod(hash3(k, 3, 4), 8);
    for (let y = by; y < by + bh; y++) for (let x = bx; x < bx + bw; x++) block(x, y);
  }
  // rivier met drie oversteken (gaat overal doorheen, ook door de vrije zones; de oversteken blijven open)
  for (let y = 1; y < h - 1; y++) {
    let bridge = false;
    for (const y0 of XL_CROSSINGS) if (y >= y0 && y < y0 + XL_CROSSING_ROWS) bridge = true;
    const cx = xlRiverX(w, y);
    for (let x = cx - XL_RIVER_HALF; x <= cx + XL_RIVER_HALF; x++)
      passable[y * w + x] = bridge ? 1 : 0;
  }
  return { w, h, passable, ...feat };
}

function xlFeatures(
  w: number,
  h: number,
): Pick<SimMap, 'spawns' | 'scrapNodes' | 'claimPoints' | 'dominance'> {
  return {
    spawns: [cc(40, 40), cc(w - 41, h - 41)],
    scrapNodes: [
      { ...cc(52, 34), amount: 2500 },
      { ...cc(w - 53, h - 35), amount: 2500 },
      // over de rivier: verre nodes voor lange routes
      { ...cc(w - 60, 60), amount: 2500 },
      { ...cc(59, h - 61), amount: 2500 },
    ],
    claimPoints: [
      { ...cc(w >> 1, (h >> 1) + 24), kind: 1 },
      { ...cc(96, h - 96), kind: 1 },
      { ...cc(w - 97, 95), kind: 1 },
    ],
    dominance: { pointsRequired: 2, ticks: 9600 },
  };
}

/** n spelers van factie 0. */
export function testPlayers(n = 2, ai = false): SimPlayer[] {
  return Array.from({ length: n }, () => ({ factionId: 0, ai }));
}
