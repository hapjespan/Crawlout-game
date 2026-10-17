import type { WeightedAsset } from '../scatter.js';
import { generateMap, type GenIo, type GeneratedMap, type MapSpec } from './builder.js';

const wa = (
  asset: string,
  weight: number,
  depth: Pick<WeightedAsset, 'minDepth' | 'maxDepth'> = {},
): WeightedAsset => ({
  asset,
  weight,
  ...depth,
});
const GRASS = [
  wa('grass_patch_01', 3),
  wa('grass_patch_02', 3),
  wa('grass_patch_03', 3),
  wa('plant_01', 1),
];
const SMALL_ROCKS = [
  wa('rock_set2_01', 2),
  wa('rock_set2_02', 3),
  wa('rock_set2_03', 3),
  wa('rock_set2_04', 3),
];
const MID_ROCKS = [
  wa('rock_set2_05', 1),
  wa('rock_set2_06', 1),
  wa('rock_set2_07', 1),
  wa('rock_set2_08', 1),
];
const CLIFFS = [wa('rock_set2_09', 2), wa('rock_set2_10', 1), wa('rock_set2_11', 1)];
const BARE_TREES = [wa('tree_bare_01', 1), wa('tree_bare_02', 1), wa('tree_bare_03', 1)];
const LOOSE_TREES = [
  wa('tree_oak_01', 2),
  wa('tree_oak_02', 2),
  wa('tree_pine_03', 2),
  wa('tree_pine_01', 2),
];
const WOOD_WALLS = [
  wa('wall_wood_01', 2),
  wa('wall_wood_02', 1),
  wa('wall_wood_03', 2),
  wa('wall_wood_04', 1),
];
const CHESTS = [wa('chest_01', 2), wa('chest_02', 1), wa('chest_03', 1)];
const DEBRIS = [
  wa('debris_pallet_01', 1),
  wa('debris_pallet_02', 1),
  wa('debris_table_01', 1),
  wa('debris_chair_01', 2),
  wa('debris_crate_01', 2),
  wa('debris_barrel_01', 1),
];

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
//   - Spawns in de hoektegels rechtsboven (speler 0) en linksonder (speler 1), elk op een vlak bouwvlak van 30 m straal.
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
  // Bouwvlak rond de spawn (echte-schaalronde, data 0.14.0): straal 30 m vlak plus 8 m overgang, zodat het hoofdgebouw
  // (20 x 20 m), een stuk of tien woningen (13 x 20 m), een werkplaats, een lab en turrets erop en in het open dal
  // eromheen passen (maps.test.ts pakt dat na). Was 7 m voor een hoofdgebouw van 5 x 5.
  pads: [{ x: 300, y: 76, radius: 30, blend: 8 }],
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
    { x: 226, y: 67, amount: 2500 }, // settlement 1 (boven), 9,2 m van het claimpunt (was 4 m)
    { x: 232, y: 54, amount: 1500 }, // settlement 1, tweede node
    { x: 320, y: 181, amount: 2500 }, // settlement 2 (rechts), 9,2 m van het claimpunt (was 4 m)
    { x: 334, y: 200, amount: 1500 }, // settlement 2, tweede node
    { x: 160, y: 74, amount: 2000 }, // vooruitgeschoven, aan de eigen oever bij de noordelijke voorde
    { x: 252, y: 146, amount: 1500 }, // dal ten oosten van de tafelberg, op weg naar het midden
  ],
  // Besluit 9 (fase-0 sectie 14), claimronde (data 0.20.0): de 2500-node van elk settlement ligt 9,2 m van het claimpunt,
  // buiten de claimcirkel (claimRadiusM 6 m) zodat de claimpaal er altijd naast past (Martien: "leg de scrap er niet te
  // dicht bij"), en binnen exclusiveRadiusM (12 m): de node wordt exclusief zodra de claimpaal staat. Schuin naar de
  // basis toe; gemeten over 33 seeds: 17 tegen 16, 16 keer vernietiging en 17 keer dominantie, 26,2 tot 33,3 minuten.
  // Andere plekken (sim 0.16.0): recht naar het zuiden en noorden op 9 m 12 tegen 21 (de grens), 9,5 m oostelijk 15 tegen
  // 18 met een potje van 40,6 minuten, 9 m met de tweede node een cel opzij een gelijkspel na 45 minuten.
  claimPoints: [
    { x: 220, y: 60, kind: 'settlement' },
    { x: 318, y: 190, kind: 'settlement' },
  ],
  // Geen scrap binnen claimRadiusM (6 m) + 3 m van een claimpunt (claimronde, data 0.20.0).
  claimNodeMinM: 9,
  centerClaims: [{ x: 191, y: 191, kind: 'powerArmor' }],
  creepCamps: [
    { x: 176, y: 56, tier: 1 }, // bij de noordelijke voorde
    { x: 236, y: 132, tier: 2 }, // op de weg naar de landbrug (creep round, data 0.25.0: the high camp)
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
  // Decoratie, puur visueel (de sim leest ze niet). Echte schaal: de DJMaesen-props (propcatalog.ts). Eerst de kliffen,
  // dan de kits (kampen, ruines, claimpunten, voordes), dan het bos als raster, dan de quota per helft.
  props: {
    seed: 4242,
    edgeMargin: 3,
    comment:
      'Decoratieve props voor Rustbelt, gegenereerd door packages/map/src/scatter.ts (pnpm --filter @crawlout/map gen); niet met de hand bewerken. x en y in sim-eenheden (1 m = 256), yaw 0..65535, scalePct 80..130, assets op echte schaal (DJMaesen-props uit assets/dist). De sim leest dit bestand niet.',
    bands: { valleyBelowM: 3, dryAboveM: 5 },
    forest: {
      cellM: 4,
      gapPct: 8,
      // Gemengd bos: stukken eiken, stukken dennen, hoge bomen diep in het bos en lage aan de rand.
      oak: [
        wa('tree_oak_01', 4, { maxDepth: 8 }),
        wa('tree_oak_02', 4),
        wa('tree_oak_03', 3, { minDepth: 5 }),
      ],
      pine: [
        wa('tree_pine_03', 4, { maxDepth: 8 }),
        wa('tree_pine_01', 4),
        wa('tree_pine_02', 3, { minDepth: 5 }),
      ],
      bare: [wa('tree_bare_01', 1), wa('tree_bare_02', 1), wa('tree_bare_03', 1)],
      pinePct: [15, 85],
      barePct: { base: 4, edge: 22, dry: 20, edgeCells: 3 },
      ringM: 6,
      ringPct: 38,
      understory: { assets: [wa('plant_01', 1)], pct: 10 },
      scalePct: [85, 120],
    },
    kits: {
      camp: {
        parts: [
          {
            assets: [
              wa('debris_pallet_01', 1),
              wa('debris_pallet_02', 1),
              wa('debris_table_01', 1),
              wa('debris_chair_01', 2),
              wa('debris_crate_01', 2),
              wa('debris_barrel_01', 1),
            ],
            count: [4, 6],
            ringM: [4.5, 7],
            clumpM: 2.2,
          },
          {
            assets: [wa('chest_01', 2), wa('chest_02', 1), wa('chest_03', 1)],
            count: [2, 3],
            ringM: [4, 6.5],
            clumpM: 1.4,
          },
          {
            assets: [wa('barrel_01', 2), wa('debris_barrel_01', 1)],
            count: [1, 2],
            ringM: [4, 7],
            clumpM: 1,
          },
          { assets: [wa('crate_01', 1)], count: [1, 2], ringM: [4, 7], clumpM: 1.5 },
          // Vervallen omheining: houten wanden langs een ring, met gaten.
          { assets: WOOD_WALLS, count: [6, 9], ringM: [8.5, 10.5], tangent: true },
          // De wachttoren: één per kamp.
          { assets: [wa('watchtower_01', 1)], count: [1, 1], ringM: [10, 14] },
        ],
      },
      ruin: {
        parts: [
          { assets: DEBRIS, count: [2, 4], ringM: [1.2, 3.5], clumpM: 1.6 },
          {
            assets: [wa('crate_01', 2), wa('debris_crate_01', 2), wa('barrel_01', 1)],
            count: [1, 2],
            ringM: [1.2, 3.5],
            clumpM: 1.2,
          },
          { assets: CHESTS, count: [0, 1], ringM: [1.5, 3.5], clumpM: 1 },
          { assets: WOOD_WALLS, count: [1, 3], ringM: [2.5, 4.5], tangent: true },
        ],
      },
      claim: {
        parts: [
          {
            assets: [...CHESTS, wa('crate_01', 2), wa('barrel_01', 1), wa('debris_barrel_01', 1)],
            count: [3, 5],
            ringM: [4.5, 7],
            clumpM: 2,
          },
          { assets: DEBRIS, count: [1, 2], ringM: [4.5, 7], clumpM: 1.5 },
        ],
      },
      ford: {
        parts: [
          { assets: [...DEBRIS, wa('crate_01', 1)], count: [2, 4], ringM: [5, 8], clumpM: 2 },
          { assets: [wa('watchtower_01', 1)], count: [1, 1], ringM: [7, 11] },
        ],
      },
    },
    quotas: [
      // Kliffen langs de randen van het onbegaanbare terrein (dikke stroken), nooit op een pad.
      { assets: CLIFFS, perHalf: 30, on: 'cliff', scalePct: [92, 108] },
      // Rotsen: groot op ruines en klifwanden, klein en middelgroot langs de randen en verspreid in het open.
      { assets: MID_ROCKS, perHalf: 40, on: 'blocked' },
      { assets: SMALL_ROCKS, perHalf: 100, on: 'edge', clump: { min: 1, max: 3, radiusM: 2.5 } },
      { assets: MID_ROCKS, perHalf: 40, on: 'edge' },
      { assets: SMALL_ROCKS, perHalf: 70, on: 'open', clump: { min: 1, max: 3, radiusM: 2 } },
      { assets: MID_ROCKS, perHalf: 20, on: 'open' },
      // Losse bomen en bosjes in het open; kale bomen vooral op het droge plateau.
      {
        assets: LOOSE_TREES,
        perHalf: 45,
        on: 'open',
        clump: { min: 1, max: 3, radiusM: 4 },
        scalePct: [85, 120],
      },
      {
        assets: BARE_TREES,
        perHalf: 60,
        on: 'dry',
        clump: { min: 1, max: 3, radiusM: 4 },
        scalePct: [85, 120],
      },
      // Gras in plukken: breed over het open terrein, dichter in de dalen en langs de rivier.
      {
        assets: GRASS,
        perHalf: 900,
        on: 'open',
        clump: { min: 3, max: 6, radiusM: 3 },
        scalePct: [80, 130],
      },
      {
        assets: GRASS,
        perHalf: 850,
        on: 'valley',
        clump: { min: 5, max: 9, radiusM: 3 },
        scalePct: [80, 130],
      },
      {
        assets: GRASS,
        perHalf: 800,
        on: 'shore',
        clump: { min: 6, max: 12, radiusM: 2.5 },
        scalePct: [80, 130],
      },
      {
        assets: [wa('plant_01', 1)],
        perHalf: 50,
        on: 'open',
        clump: { min: 1, max: 3, radiusM: 2 },
      },
      {
        assets: [wa('plant_01', 1)],
        perHalf: 70,
        on: 'shore',
        clump: { min: 1, max: 3, radiusM: 2 },
      },
    ],
  },
};

export function generateRustbelt(io: GenIo): GeneratedMap {
  return generateMap(RUSTBELT_SPEC, io);
}
