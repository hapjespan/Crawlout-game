import { generateMap, type GeneratedMap, type MapSpec } from './builder.js';

// Kleine testmap (32 x 32) voor sim- en maptests: twee spawns, een ruine en een klifstuk, 2 scrap-nodes, 1 claim.
export const TESTMAP_SPEC: MapSpec = {
  id: 'testmap',
  w: 32,
  h: 32,
  seed: 7,
  comment:
    'Testmap 32x32 voor unit-tests. Gegenereerd door packages/map/src/gen/testmap.ts; niet met de hand bewerken. dominance (1 punt, 1 minuut) is een startwaarde voor tests, geen balans.',
  dominance: { pointsRequired: 1, minutes: 1 },
  border: 1,
  flats: [],
  groundAmplitude: 100,
  ruinHeight: 640,
  cliffHeight: 1280,
  ruins: [{ x0: 12, y0: 6, x1: 14, y1: 8 }],
  cliffs: [{ x0: 8, y0: 12, x1: 9, y1: 20 }],
  spawns: [{ x: 5, y: 5 }],
  scrapNodes: [{ x: 8, y: 4, amount: 1000 }],
  claimPoints: [],
  centerClaims: [{ x: 16, y: 16, kind: 'scrap' }],
  creepCamps: [{ x: 10, y: 24, tier: 1 }],
};

export function generateTestmap(): GeneratedMap {
  return generateMap(TESTMAP_SPEC);
}
