import { UNITS_PER_METER } from '@crawlout/protocol';

// De props die de scatter-generator mag plaatsen: de 40 DJMaesen-props (CC-BY-4.0) uit assets/dist, op echte schaal
// ten opzichte van een poppetje van 1,8 m. Per prop de categorie van het manifest, de hoogte (m) en de straal van de
// voet (m, de ruimte die hij op de grond inneemt; voor een boom alleen de stam, de kruin mag overlappen). De waarden
// komen uit de bounds van het manifest; packages/map/test/props.test.ts vergelijkt ze (categorie exact, hoogte binnen
// 5 procent). De oude Gobkit-props (treehigh001, rock001 en dergelijke) staan er niet in: ze botsen in stijl en
// staan in hun eigen eenheden (8,5 m bomen, 3,8 m gras), dus de generator plaatst ze niet meer.

export type PropCategory =
  | 'tree-leafy'
  | 'tree-bare'
  | 'grass'
  | 'plant'
  | 'rock'
  | 'crate'
  | 'chest'
  | 'barrel'
  | 'structure'
  | 'debris';

export interface PropInfo {
  category: PropCategory;
  /** Hoogte in meters (manifest-bounds, schaal 100 procent). */
  heightM: number;
  /** Straal van de voet in meters: de grond die hij inneemt (stam, niet kruin). */
  radiusM: number;
}

const info = (category: PropCategory, heightM: number, radiusM: number): PropInfo => ({
  category,
  heightM,
  radiusM,
});

const ENTRIES: readonly (readonly [string, PropInfo])[] = [
  // Bomen met blad (eiken en dennen); de straal is de stam.
  ['tree_oak_01', info('tree-leafy', 7, 0.45)],
  ['tree_oak_02', info('tree-leafy', 10, 0.6)],
  ['tree_oak_03', info('tree-leafy', 13, 0.8)],
  ['tree_pine_01', info('tree-leafy', 9.39, 0.4)],
  ['tree_pine_02', info('tree-leafy', 12.93, 0.5)],
  ['tree_pine_03', info('tree-leafy', 6.5, 0.3)],
  // Kale bomen.
  ['tree_bare_01', info('tree-bare', 9.27, 0.4)],
  ['tree_bare_02', info('tree-bare', 7.34, 0.5)],
  ['tree_bare_03', info('tree-bare', 7.33, 0.4)],
  // Gras en planten.
  ['grass_patch_01', info('grass', 0.6, 0.4)],
  ['grass_patch_02', info('grass', 0.6, 0.35)],
  ['grass_patch_03', info('grass', 0.6, 0.45)],
  ['plant_01', info('plant', 1.2, 0.4)],
  // Rotsen: de kleine (01 tot 04), de middelgrote (05 tot 08) en de kliffen (09 tot 11, 8 tot 10 m hoog).
  ['rock_set2_01', info('rock', 0.91, 0.7)],
  ['rock_set2_02', info('rock', 0.63, 0.2)],
  ['rock_set2_03', info('rock', 0.76, 0.33)],
  ['rock_set2_04', info('rock', 0.73, 0.28)],
  ['rock_set2_05', info('rock', 1.74, 1.2)],
  ['rock_set2_06', info('rock', 2.01, 1.4)],
  ['rock_set2_07', info('rock', 2.22, 1.5)],
  ['rock_set2_08', info('rock', 2.52, 1.7)],
  ['rock_set2_09', info('rock', 10.08, 3)],
  ['rock_set2_10', info('rock', 7.75, 6.5)],
  ['rock_set2_11', info('rock', 7.7, 7)],
  // Kratten, kisten, vaten en puin.
  ['crate_01', info('crate', 0.9, 0.45)],
  ['chest_01', info('chest', 0.55, 0.4)],
  ['chest_02', info('chest', 0.3, 0.35)],
  ['chest_03', info('chest', 0.3, 0.35)],
  ['barrel_01', info('barrel', 0.9, 0.35)],
  ['debris_barrel_01', info('debris', 0.8, 0.35)],
  ['debris_crate_01', info('debris', 0.9, 0.6)],
  ['debris_chair_01', info('debris', 0.9, 0.3)],
  ['debris_table_01', info('debris', 0.75, 0.7)],
  ['debris_pallet_01', info('debris', 0.17, 0.6)],
  ['debris_pallet_02', info('debris', 0.32, 0.6)],
  // Houten wanden (3 m hoog, 2,2 tot 4,9 m lang) en de wachttoren (8 m).
  ['wall_wood_01', info('structure', 3, 1)],
  ['wall_wood_02', info('structure', 3, 2.2)],
  ['wall_wood_03', info('structure', 3, 1)],
  ['wall_wood_04', info('structure', 3, 1.9)],
  ['watchtower_01', info('structure', 8, 1.3)],
];

export const PROP_INFO: Readonly<Record<string, PropInfo>> = Object.fromEntries(ENTRIES);

/** De ids van de catalogus, in een vaste volgorde. */
export const PROP_ASSETS: readonly string[] = ENTRIES.map((e) => e[0]);

/** Straal van de voet in sim-eenheden. */
export function propRadiusU(asset: string): number {
  const p = PROP_INFO[asset];
  if (p === undefined) throw new Error(`scatterProps: onbekend prop-asset ${asset}`);
  return Math.round(p.radiusM * UNITS_PER_METER);
}
