import { generateMap, type GenIo, type GeneratedMap, type MapSpec } from './builder.js';

// Rustbelt XL: 384 x 384 m (3 x 3 tegels van 128 m), 2 spelers. Puntsymmetrisch (180 graden) om (192, 192).
// Alleen de A-helft staat hier; de builder spiegelt alles. Eén claimpunt ligt in het midden, de rest in spiegelparen.
//
// Terrein: Rock Terrain 4 (Lassi Kaukonen, CC-BY-4.0), afgeleid hoogteveld in assets/dist/terrain (asset-cli).
//   - Middentegel: de tafelberg van de 128-m-Rustbelt, op dezelfde manier gemaakt (orientation 5: de bron 90 graden
//     gedraaid, noordhelft gehouden, zuidhelft de 180 graden gedraaide kopie, naad over 8 cellen gemengd).
//   - Acht buitentegels uit hetzelfde veld, elk in een eigen oriëntatie (A-helft hieronder, de tegel tegenover het
//     midden 180 graden gedraaid); over de tegelgrenzen 8 cellen aan weerszijden gemengd (16 cellen), zodat het één
//     landschap is: plateaus van ongeveer 6 m met laaglanddalen ertussen. Hoogtecurve en hellingdrempel zoals de
//     128-m-map; alles 0,5 m opgetild (baseOffsetCm) zodat het wateroppervlak op hoogte 0 eronder ligt.
//   - Spawns in de hoektegels rechtsboven (speler 0) en linksonder (speler 1), elk op een vlak bouwvlak.
//   - Rivier: van de noordrand door het dal tussen de tegels linksboven en boven, door een kloof onder de tafelberg
//     door en via het zuidelijke dal naar de zuidrand. 6 tot 10 m breed, onbegaanbaar, wateroppervlak op 0 m met de
//     bedding eronder. Drie oversteken: een voorde in het noordelijke dal, de gespiegelde voorde in het zuiden, en een
//     landbrug van 8 m over de kloof in het midden (bij het powerArmor-punt).
//   - Bos: een dichte bosrand van 12 tot 20 m rond de hele map en bosjes met een onbegaanbare kern.
// Routes tussen de bases: noord (over de noordelijke voorde), midden (over de landbrug) en zuid (zuidelijke voorde).

export const RUSTBELT_SPEC: MapSpec = {
  id: 'rustbelt',
  w: 384,
  h: 384,
  seed: 1977,
  comment:
    'Slice-map Rustbelt (384 x 384 m, 3 x 3 tegels van 128 m) op Rock Terrain 4. Gegenereerd door packages/map/src/gen/rustbelt.ts uit assets/dist/terrain (pnpm --filter @crawlout/map gen); niet met de hand bewerken. Puntsymmetrisch (180 graden) voor eerlijk spel. Rivier met drie oversteken (twee voordes en een landbrug in het midden); watermasker in maps/rustbelt.water.json, het wateroppervlak ligt op hoogte 0. dominance: 3 van de 5 claimpunten gedurende 8 minuten (was 2 van 3; 3 van 5 vraagt naast de eigen twee settlements het midden of een punt van de tegenstander).',
  dominance: { pointsRequired: 3, minutes: 8 },
  border: 1,
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
    baseOffsetCm: 50,
    tiles: {
      k: 3,
      blendHalfWidthCells: 8,
      outer: [
        { tx: 0, ty: 0, orientation: 0 }, // linksboven: plateau links, laagland rechts (het rivierdal)
        { tx: 1, ty: 0, orientation: 1 }, // boven: gespiegeld, laagland links (de andere kant van het dal)
        { tx: 2, ty: 0, orientation: 2 }, // rechtsboven (spawn speler 0): plateau linksonder
        { tx: 0, ty: 1, orientation: 4 }, // links: getransponeerd
      ],
    },
  },
  pads: [{ x: 300, y: 76, radius: 7, blend: 8 }],
  spawns: [{ x: 300, y: 76 }],
  ruinHeight: 640, // 2,5 m boven het terrein
  cliffHeight: 1280,
  // Ruines (A-helft): laag, onbegaanbaar, als dekking en om looplijnen te vormen. Nooit op de routes zelf.
  ruins: [
    // Verwoeste nederzetting bij settlement 1 (boven).
    { x0: 208, y0: 46, x1: 213, y1: 48 },
    { x0: 228, y0: 70, x1: 230, y1: 75 },
    // Verwoeste nederzetting bij settlement 2 (rechts).
    { x0: 304, y0: 176, x1: 309, y1: 178 },
    { x0: 330, y0: 186, x1: 332, y1: 192 },
    // Dekking op de tafelberg bij de oprit naar de landbrug.
    { x0: 214, y0: 170, x1: 219, y1: 171 },
    { x0: 236, y0: 196, x1: 237, y1: 201 },
    // Brokstukken langs de noordroute en bij het voorde-dal.
    { x0: 170, y0: 30, x1: 173, y1: 33 },
    { x0: 250, y0: 118, x1: 253, y1: 120 },
  ],
  cliffs: [],
  scrapNodes: [
    { x: 286, y: 92, amount: 1500 }, // basis
    { x: 318, y: 94, amount: 1500 }, // basis
    { x: 262, y: 42, amount: 1500 }, // natuurlijke expansie
    { x: 220, y: 64, amount: 2500 }, // settlement 1 (boven), 4 m van het claimpunt
    { x: 232, y: 54, amount: 1500 }, // settlement 1, tweede node
    { x: 318, y: 186, amount: 2500 }, // settlement 2 (rechts), 4 m van het claimpunt
    { x: 334, y: 200, amount: 1500 }, // settlement 2, tweede node
    { x: 160, y: 74, amount: 2000 }, // vooruitgeschoven, aan de eigen oever bij de noordelijke voorde
    { x: 252, y: 146, amount: 1500 }, // dal ten oosten van de tafelberg, op weg naar het midden
  ],
  // Besluit 9: 4 m van de 2500-node, binnen claimRadiusM (6 m): de node wordt exclusief zodra de claimpaal staat.
  claimPoints: [
    { x: 220, y: 60, kind: 'settlement' },
    { x: 318, y: 190, kind: 'settlement' },
  ],
  centerClaims: [{ x: 191, y: 191, kind: 'powerArmor' }],
  creepCamps: [
    { x: 176, y: 56, tier: 1 }, // bij de noordelijke voorde
    { x: 236, y: 132, tier: 1 }, // op de weg naar de landbrug
    { x: 274, y: 140, tier: 1 }, // tussen de basis en settlement 2
  ],
  river: {
    points: [
      { x: 120, y: -12, r: 4 },
      { x: 128, y: 18, r: 4.5 },
      { x: 112, y: 42, r: 5 },
      { x: 134, y: 62, r: 4 },
      { x: 152, y: 90, r: 4.5 },
      { x: 128, y: 112, r: 4 },
      { x: 140, y: 138, r: 3.5 },
      { x: 164, y: 150, r: 4 },
      { x: 176, y: 174, r: 4 },
    ],
    centreR: 4,
    smoothRounds: 4,
    crossings: [
      { x: 130, y: 56, kind: 'ford', halfLengthM: 3.5 },
      { x: 192, y: 192, kind: 'bridge', halfLengthM: 4 },
    ],
    bedEdgeCm: 30,
    bedMaxCm: 90,
    fordDepthCm: 15,
    bankBaseCm: 10,
    beachSlopeCmPerM: 25,
    beachLengthM: 4,
    wallSlopeCmPerM: 120,
    bankReachM: 10,
  },
  forest: {
    seed: 77,
    minDepthM: 12,
    maxDepthM: 20,
    groves: [
      { x: 60, y: 60, radius: 11 },
      { x: 186, y: 100, radius: 7 },
      { x: 250, y: 92, radius: 5 },
      { x: 348, y: 140, radius: 9 },
      { x: 280, y: 224, radius: 6 },
      { x: 90, y: 160, radius: 7 },
    ],
  },
  keepMainComponent: true,
  // Decoratie, puur visueel (de sim leest ze niet). Bos als raster, daarna quota per helft.
  props: {
    seed: 4242,
    edgeMargin: 3,
    comment:
      'Decoratieve props voor Rustbelt, gegenereerd door packages/map/src/props.ts (pnpm --filter @crawlout/map gen); niet met de hand bewerken. x en y in sim-eenheden (1 m = 256), yaw 0..65535, scalePct 80..130. De sim leest dit bestand niet.',
    forest: {
      cellM: 3,
      gapPct: 6,
      dense: [
        { asset: 'treehigh001', weight: 40 },
        { asset: 'treemed001', weight: 34 },
        { asset: 'treelow001', weight: 16 },
        { asset: 'bush001', weight: 5 },
        { asset: 'bush002', weight: 5 },
      ],
      ringM: 4,
      ringPct: 35,
      ring: [
        { asset: 'treelow001', weight: 30 },
        { asset: 'treemed001', weight: 25 },
        { asset: 'bush001', weight: 25 },
        { asset: 'bush002', weight: 20 },
      ],
    },
    quotas: [
      { asset: 'treehigh001', perHalf: 50, on: 'open' },
      { asset: 'treemed001', perHalf: 70, on: 'open' },
      { asset: 'treelow001', perHalf: 60, on: 'open' },
      { asset: 'rock001', perHalf: 40 },
      { asset: 'rock002', perHalf: 40 },
      { asset: 'rock003', perHalf: 40 },
      { asset: 'bush001', perHalf: 80 },
      { asset: 'bush002', perHalf: 80 },
      { asset: 'grass001', perHalf: 150 },
      { asset: 'reed001', perHalf: 120 },
    ],
  },
};

export function generateRustbelt(io: GenIo): GeneratedMap {
  return generateMap(RUSTBELT_SPEC, io);
}
