// Generates assets/src/sites.json, a split config written as the fragments in assets/src/sites/ (see src/splitJson.ts and
// scripts/splitConfig.ts): the eight placeholder buildings of winroute C, "Bouwproject" (an old ruined strip mall
// with four restorable parts). Every part has a ruin (`site_<part>_ruin`, rust colours, no team colour) and a restored
// state (`site_<part>_restored`, clean, with the team band) on the same footprint and about the same silhouette. The shapes
// live in scripts/sites/*.ts (a small part builder, so a canopy or a wall is a few lines instead of hundreds of JSON parts);
// the build itself (`pnpm assets`) only reads the JSON, like raiders.json. Run: `pnpm --filter @crawlout/asset-cli sites`.
import { fileURLToPath } from 'node:url';
import type { Part } from './sites/builder.js';
import { garage } from './sites/garage.js';
import { gasStation } from './sites/gasStation.js';
import { supermarket } from './sites/supermarket.js';
import { waterTower } from './sites/waterTower.js';
import { writeSplitConfig } from './splitConfig.js';

export const SITES_VERSION = 1 as const;

/** Flat materials: the names follow the surface kinds of the render look recipe (see README, Robots). */
export const FLAT_MATERIALS: Record<string, { color: string; note: string }> = {
  concrete: { color: '#bdb6a4', note: 'restored walls, cream concrete (render: concrete)' },
  concrete_ruin: { color: '#8b8275', note: 'weathered, cracked concrete of the ruins' },
  concrete_dark: { color: '#5f5a52', note: 'rubble, soot and old plinths' },
  rust_metal: { color: '#7a4b34', note: 'rusty plate and sheet; name contains rust' },
  rust_dark: { color: '#55372b', note: 'dark rust: broken frames, bent beams' },
  rust_roof: { color: '#6f4636', note: 'rusty roof sheet' },
  metal: { color: '#8a867c', note: 'repaired steel: legs, panels, frames (painted metal)' },
  metal_light: { color: '#b0ab9c', note: 'clean light plate: tank, canopy, roller doors' },
  metal_dark: { color: '#56534c', note: 'dark steel: braces, window frames, roofs of kiosks' },
  metal_hazard: { color: '#b89a2e', note: 'hazard yellow collars and stripes' },
  metal_blue: { color: '#5f8296', note: 'garage wall sheet, faded blue' },
  metal_red: { color: '#9a4034', note: 'pump housings, faded red' },
  roof_tar: { color: '#4a4540', note: 'flat roof of tar paper (render: roofing)' },
  rubber: { color: '#2e2d2b', note: 'bumpers, hoses, tyres' },
  lens_glass: { color: '#417077', note: 'shop-front glass and windows' },
  lens_amber: { color: '#e0a23a', note: 'lamps and pump displays' },
  opening: { color: '#12110f', note: 'dark openings: doors, broken windows, holes' },
  team_trim: {
    color: '#e7e7e7',
    note: 'mask for the owner colour; render recognises the name (contains team)',
  },
};

interface SiteVariant {
  footprint: { w: number; h: number };
  lod0Triangles: number;
  heightM: [number, number];
  teamless?: true;
  note: string;
  parts: Part[];
}

function variant(
  ruin: boolean,
  footprint: { w: number; h: number },
  heightM: [number, number],
  note: string,
  parts: Part[],
): SiteVariant {
  return {
    footprint,
    lod0Triangles: 2400,
    heightM,
    ...(ruin ? { teamless: true as const } : {}),
    note,
    parts,
  };
}

export function buildSites(): Record<string, unknown> {
  const buildings: Record<string, SiteVariant> = {
    site_garage_ruin: variant(
      true,
      { w: 13, h: 11 },
      [5.5, 7.5],
      'Garage, ruine: werkplaats van 9,3 x 11 m met zadeldak, middenstuk van het dak weg, doorgebroken achterhoek, een gescheurde rolpoort en een lege poortopening, kantoortje met ingestort dak, autowrak op het erf, puin. Roest, geen teamkleur',
      garage(true),
    ),
    site_garage_restored: variant(
      false,
      { w: 13, h: 11 },
      [5.5, 7.5],
      'Garage, hersteld: werkplaats van 9,3 x 11 m, wanden 5,2 m, zadeldak tot 6,2 m, twee rolpoorten van 3,4 x 3,5 m met teamstreep en teambord in de gevel, kantoortje (deur 1,0 x 2,2 m) met teamband, auto op het erf, banden en vaten',
      garage(false),
    ),
    site_gas_station_ruin: variant(
      true,
      { w: 15, h: 11 },
      [5, 7],
      'Tankstation, ruine: luifel van 14,6 x 10 m op vier pilaren van 5 m; de linkerkant ligt schuin op een afgebroken pilaar, het midden hangt door, de rechterhoek is afgescheurd; pompen scheef of omgevallen, kiosk met half dak en gescheurde muren, puin. Roest, geen teamkleur',
      gasStation(true),
    ),
    site_gas_station_restored: variant(
      false,
      { w: 15, h: 11 },
      [5, 7],
      'Tankstation, hersteld: luifel van 14,6 x 10 m op vier pilaren van 5 m met teamfascia rondom, twee pompeilanden met elk twee pompen, lampen onder de luifel, kleine kiosk (deur 1,0 x 2,2 m) met teamband onder het +x-uiteinde',
      gasStation(false),
    ),
    site_supermarket_ruin: variant(
      true,
      { w: 25, h: 15 },
      [5.5, 8],
      'Supermarkt, ruine: grote doos van 5 m met parapet, een ingestorte achterhoek, bijna geen glas meer in de winkelpui, twee dakpanelen weg of naar binnen gevallen, doorhangende luifel, verbogen reclameframe, puin; laadperron achter. Roest, geen teamkleur',
      supermarket(true),
    ),
    site_supermarket_restored: variant(
      false,
      { w: 25, h: 15 },
      [5.5, 8],
      'Supermarkt, hersteld: schone doos van 5 m met parapet, glazen winkelpui van 19 m met dubbele deur 2,8 x 2,4 m, luifel met teamfascia, reclameframe met teampaneel op de dakrand, airco en lichtkoepels op het platte dak, laadperron met rolpoort achter',
      supermarket(false),
    ),
    site_water_tower_ruin: variant(
      true,
      { w: 7, h: 7 },
      [16, 20],
      'Watertoren, ruine: vier vakwerkpoten met kruisverbanden en een broze ladder; de tank is ingedeukt en staat 7 graden scheef, een diagonaal hangt los. Roest, geen teamkleur',
      waterTower(true),
    ),
    site_water_tower_restored: variant(
      false,
      { w: 7, h: 7 },
      [16, 20],
      'Watertoren, hersteld: schone vakwerkpoten met gele voetkragen, rechte tank met teamband, ladder, rondgang en baken',
      waterTower(false),
    ),
  };
  return {
    version: SITES_VERSION,
    note: 'Procedural placeholders, own work (no external model, texture or pack; nothing to attribute). Generated by tools/asset-cli/scripts/gen-sites.ts: change the script and run `pnpm --filter @crawlout/asset-cli sites`, not this file. Martien may later deliver real GLBs under the same ids.',
    flatMaterials: FLAT_MATERIALS,
    units: {},
    buildings: Object.fromEntries(Object.entries(buildings).sort(([a], [b]) => a.localeCompare(b))),
    attachments: {},
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = fileURLToPath(new URL('../../../assets/src/sites', import.meta.url));
  const names = writeSplitConfig(out, buildSites());
  console.log(`geschreven: ${out} (${names.length} fragmenten)`);
}
