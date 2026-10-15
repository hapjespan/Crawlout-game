import { generateMap, type GeneratedMap, type MapSpec } from './builder.js';

// Kleine testmap (64 x 64) voor sim- en maptests: twee spawns, een ruine en een klifstuk, 2 scrap-nodes, 1 claim.
// 64 sinds de echte-schaalronde (data 0.14.0): het hoofdgebouw van 20 x 20 m past niet op 32 x 32.
export const TESTMAP_SPEC: MapSpec = {
  id: 'testmap',
  w: 64,
  h: 64,
  seed: 7,
  comment:
    'Testmap 64x64 voor unit-tests. Gegenereerd door packages/map/src/gen/testmap.ts; niet met de hand bewerken. dominance (1 punt, 1 minuut) is een startwaarde voor tests, geen balans.',
  dominance: { pointsRequired: 1, minutes: 1 },
  border: 1,
  flats: [],
  groundAmplitude: 100,
  ruinHeight: 640,
  cliffHeight: 1280,
  ruins: [{ x0: 30, y0: 14, x1: 32, y1: 16 }],
  cliffs: [{ x0: 10, y0: 30, x1: 11, y1: 40 }],
  spawns: [{ x: 14, y: 14 }],
  scrapNodes: [{ x: 28, y: 6, amount: 1000 }],
  claimPoints: [],
  centerClaims: [{ x: 32, y: 32, kind: 'scrap' }],
  creepCamps: [{ x: 20, y: 48, tier: 1 }],
};

export function generateTestmap(): GeneratedMap {
  return generateMap(TESTMAP_SPEC);
}
