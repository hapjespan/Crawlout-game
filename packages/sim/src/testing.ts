import type { SimConfig, SimInit, SimMap } from './config.js';

// Testhulpen voor sprint 1: een programmatische testmap en een testconfig in sim-eenheden.
// Dit zijn GEEN spelregels: de echte waarden komen via de data-loader (adapter volgt bij de integratie).

/**
 * Testarena van w bij h cellen: een rand van muur, een verticale muur door het midden met een opening van
 * 4 cellen in het midden, en een blok van 4 bij 4 cellen in het rechterdeel. Deterministisch.
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
  return { w, h, passable };
}

/** Een open map zonder muren (alleen de rand), voor benchmark en eenvoudige tests. */
export function createOpenMap(w = 128, h = 128): SimMap {
  const passable = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) passable[y * w + x] = x === 0 || y === 0 || x === w - 1 || y === h - 1 ? 0 : 1;
  }
  return { w, h, passable };
}

/** Testconfig (startwaarde, geen balans): bewoner 60 hp, ongeveer 3,2 m/s, straal 0,375 m. */
export const TEST_SIM_CONFIG: SimConfig = {
  dataVersion: 'test-sprint1',
  unitTypes: [{ typeId: 1, maxHp: 60, speed: 41, radius: 96, armorType: 0, bodyType: 0, loadoutId: 0, role: 0 }],
  arriveRadius: 64,
  separationPermille: 500,
  flowFieldBudget: 2048,
  walkAnimStep: 2048,
};

export const TEST_UNIT_TYPE = 1;

export function testInit(seed = 1, map: SimMap = createTestMap(), playerCount = 2): SimInit {
  return { seed, playerCount, map, config: TEST_SIM_CONFIG };
}

/** Positie in eenheden van het midden van cel (cx, cy). */
export const cellCenter = (cx: number, cy: number): { x: number; y: number } => ({ x: (cx << 8) + 128, y: (cy << 8) + 128 });
