import { generateMap, type GenIo, type GeneratedMap, type MapSpec } from './builder.js';

// Rustbelt: 128 x 128 m, 2 spelers. Puntsymmetrisch (180 graden): spawn A boven, B onder.
// Alleen de A-helft staat hier; de builder spiegelt alles. Eén claimpunt ligt in het midden, de rest in spiegelparen.
//
// Terrein: Rock Terrain 4 (Lassi Kaukonen, CC-BY-4.0), afgeleid hoogteveld in assets/dist/terrain (asset-cli).
// De bron is niet puntsymmetrisch; de generator maakt hem eerlijk zo:
//   - orientation 5: de bron 90 graden gedraaid, zodat het plateau (18 tot 26 m in de bron) als een tafelberg dwars
//     door het midden van de map ligt, met laagland boven en onder (de bases) en de klif van de bron als noord- en zuidwand;
//   - de noordelijke helft (y < 64) blijft, de zuidelijke helft is de 180 graden gedraaide kopie ervan;
//   - de naad ligt op de lijn y = 63,5 en wordt over 8 cellen aan weerszijden gemengd (smoothstep op het gemiddelde
//     van de twee helften), dus de tafelberg loopt zonder breuk door het midden.
// Hoogteschaal: het bronreliëf is 26 m, de camera en de gameplay willen enkele meters. De curve hieronder schaalt
// stuksgewijs: laagland (bron 0 tot 6 m) met 0,17, de klifwand (6 tot 16 m) met 0,40 en het plateau (boven 16 m) met
// 0,18. Resultaat: laagland op ongeveer 0,5 tot 1 m, plateau op ongeveer 5 tot 6,5 m, en een klifwand van ongeveer
// 4 tot 5 m die steiler is dan een lineaire factor zou geven (die zou kliffen tot een helling afvlakken).
export const RUSTBELT_SPEC: MapSpec = {
  id: 'rustbelt',
  w: 128,
  h: 128,
  seed: 1977,
  comment:
    'Slice-map Rustbelt op Rock Terrain 4. Gegenereerd door packages/map/src/gen/rustbelt.ts uit assets/dist/terrain (pnpm --filter @crawlout/map gen); niet met de hand bewerken. Puntsymmetrisch (180 graden) voor eerlijk spel. dominance: 2 van de 3 claimpunten gedurende 8 minuten (besluit Martien, advies architect fase-0 sectie 17; was 3 en daarna 12 minuten).',
  dominance: { pointsRequired: 2, minutes: 8 },
  border: 2,
  terrain: {
    source: 'terrain/rock_terrain_4.height.json',
    orientation: 5,
    seam: { kind: 'horizontal', halfWidthCells: 8 },
    smoothPasses: 1,
    heightCurve: [
      { fromM: 0, gain: 0.17 }, // laagland
      { fromM: 6, gain: 0.4 }, // klifwand
      { fromM: 16, gain: 0.18 }, // plateau
    ],
    maxSlopePermille: 625, // tan 32 graden: steiler is klif
    minCliffCells: 6,
    minPocketCells: 12,
  },
  pads: [{ x: 30, y: 22, radius: 7, blend: 8 }],
  ruinHeight: 640, // 2,5 m boven het terrein
  cliffHeight: 1280, // 5 m boven het terrein
  // Ruines (A-helft; de builder spiegelt): laag, onbegaanbaar, als dekking en om looplijnen te vormen. Nooit op de
  // routes zelf (de tests eisen verbondenheid en twee onafhankelijke routes).
  ruins: [
    // Dekking rond het middenpunt op de tafelberg: twee L-vormen die elkaar (gespiegeld) afwisselen.
    { x0: 50, y0: 55, x1: 57, y1: 56 },
    { x0: 50, y0: 55, x1: 51, y1: 60 },
    { x0: 72, y0: 50, x1: 75, y1: 53 },
    // Verwoeste nederzetting bij het settlement in het noordelijke laagland.
    { x0: 74, y0: 12, x1: 79, y1: 14 },
    { x0: 76, y0: 12, x1: 77, y1: 18 },
    { x0: 94, y0: 20, x1: 98, y1: 23 },
    // Brokstuk op het oostelijke voorland van het terras: dekking naast de oprit.
    { x0: 54, y0: 24, x1: 57, y1: 27 },
  ],
  cliffs: [],
  spawns: [{ x: 30, y: 22 }],
  scrapNodes: [
    { x: 46, y: 14, amount: 1500 }, // natuurlijke expansie, onder de oprit van het terras
    { x: 8, y: 36, amount: 1500 }, // westelijke strook
    { x: 86, y: 28, amount: 2500 }, // contested, bij het settlement
  ],
  // Besluit 9: 4 m van de 2500-node, binnen claimRadiusM (6 m): de node wordt exclusief zodra de claimpaal staat.
  claimPoints: [{ x: 86, y: 24, kind: 'settlement' }],
  centerClaims: [{ x: 64, y: 64, kind: 'powerArmor' }],
  // Op de route basis -> midden: bij de oprit van het terras naar de tafelberg.
  creepCamps: [{ x: 40, y: 46, tier: 1 }],
  // Decoratie, puur visueel (de sim leest ze niet). Aantallen per helft; de B-helft wordt gespiegeld (totaal 200).
  props: {
    seed: 4242,
    edgeMargin: 3, // geen bomen en rotsen op de map-rand: ze komen op de kliffen en ruines
    comment:
      'Decoratieve props voor Rustbelt, gegenereerd door packages/map/src/props.ts (pnpm --filter @crawlout/map gen); niet met de hand bewerken. x en y in sim-eenheden (1 m = 256), yaw 0..65535, scalePct 80..130. De sim leest dit bestand niet.',
    quotas: [
      { asset: 'treehigh001', perHalf: 8 },
      { asset: 'treemed001', perHalf: 12 },
      { asset: 'treelow001', perHalf: 12 },
      { asset: 'rock001', perHalf: 8 },
      { asset: 'rock002', perHalf: 8 },
      { asset: 'rock003', perHalf: 8 },
      { asset: 'bush001', perHalf: 5 },
      { asset: 'bush002', perHalf: 5 },
      { asset: 'grass001', perHalf: 24 },
      { asset: 'reed001', perHalf: 10 },
    ],
  },
};

export function generateRustbelt(io: GenIo): GeneratedMap {
  return generateMap(RUSTBELT_SPEC, io);
}
