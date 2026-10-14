import { generateMap, type GeneratedMap, type MapSpec } from './builder.js';

// Rustbelt: 128 x 128 m, 2 spelers. Puntsymmetrisch (180 graden): spawn A linksboven, B rechtsonder.
// Alleen de A-helft staat hier; de builder spiegelt alles. Eén claimpunt ligt in het midden, de rest in spiegelparen.
export const RUSTBELT_SPEC: MapSpec = {
  id: 'rustbelt',
  w: 128,
  h: 128,
  seed: 1977,
  comment:
    'Slice-map Rustbelt. Gegenereerd door packages/map/src/gen/rustbelt.ts (pnpm --filter @crawlout/map gen); niet met de hand bewerken. Puntsymmetrisch voor eerlijk spel. dominance: 2 van de 3 claimpunten gedurende 12 minuten (balans speltest 14 oktober; was 3 minuten, waarmee AI tegen AI op ongeveer 11 minuten won, terwijl het Spelfundament potjes van 25 tot 35 minuten wil).',
  dominance: { pointsRequired: 2, minutes: 12 },
  border: 2,
  flats: [{ x: 20, y: 20, radius: 9 }],
  groundAmplitude: 200, // ruis tot ca. 0,8 m
  ruinHeight: 640, // 2,5 m
  cliffHeight: 1280, // 5 m
  ruins: [
    { x0: 50, y0: 16, x1: 58, y1: 22 },
    { x0: 28, y0: 52, x1: 36, y1: 58 },
    { x0: 56, y0: 36, x1: 62, y1: 42 },
    { x0: 14, y0: 68, x1: 20, y1: 78 },
    { x0: 70, y0: 20, x1: 74, y1: 26 },
  ],
  cliffs: [
    { x0: 44, y0: 28, x1: 47, y1: 50 }, // wand met doorgangen boven (y<28) en onder (y>50)
    { x0: 68, y0: 52, x1: 90, y1: 55 }, // lange richel richting het midden
    { x0: 4, y0: 44, x1: 14, y1: 47 }, // flankrichel
  ],
  spawns: [{ x: 20, y: 20 }],
  scrapNodes: [
    { x: 28, y: 14, amount: 1500 }, // natuurlijke expansie bij de basis
    { x: 12, y: 30, amount: 1500 },
    { x: 40, y: 38, amount: 2500 }, // contested, richting het midden
  ],
  // Besluit 9: 4 m van de 2500-node (40,38), binnen claimRadiusM (6 m): de node wordt exclusief zodra de claimpaal staat.
  claimPoints: [{ x: 40, y: 34, kind: 'settlement' }],
  centerClaims: [{ x: 64, y: 64, kind: 'powerArmor' }],
  // Op de route basis -> midden, om de kliffenwand (x 44..47) heen, tussen het contested punt en het midden.
  creepCamps: [{ x: 52, y: 56, tier: 1 }],
};

export function generateRustbelt(): GeneratedMap {
  return generateMap(RUSTBELT_SPEC);
}
