// Split from build.ts to stay under the 5,000-token file limit; build.ts re-exports the public surface.
// Holds: PRESERVED_DIST_ENTRIES, BuildOptions, AssetReport, AssetDetails, BuildResult, listGlbs, +1 more.
import type { ConformInfo } from './conform.js';
import type { BuildingDetails } from './buildings.js';
import type { RobotDetails } from './robots.js';
import type { PackPropDetails } from './packs.js';
import type { DeliveredDetails } from './delivered.js';
import type { AssetManifest } from './manifest.js';
import type { MaterialMap } from './inspect.js';
import { readdirSync } from 'node:fs';
import { join, basename } from 'node:path';

/** Entries in the dist dir written by other asset commands; the asset build leaves them alone. */
export const PRESERVED_DIST_ENTRIES = new Set(['terrain']);

export interface BuildOptions {
  srcDir: string;
  distDir: string;
  /**
   * Pad naar een KTX2-encoder. Standaard (`undefined`) geen KTX2: de render-buis leest alleen ongecomprimeerde
   * textures, zie ktx2.ts. `null` vraagt om de melding dat er wel een encoder op PATH staat; een string forceert hem.
   */
  toktx?: string | null;
  /** Pad naar de clipmap; standaard `<srcDir>/clipmap.json`. Een ontbrekend bestand betekent: geen koppelingen. */
  clipmapPath?: string;
  /** Pad naar de rigmap; standaard `<srcDir>/rigmap.json`. Een ontbrekend bestand betekent: geen conform-stap. */
  rigmapPath?: string;
  /**
   * Alleen GLB's met een entry in de rigmap verwerken (lokale buis: assets/local bevat ook andere lokale bronnen,
   * bijvoorbeeld voor terrein); de rest wordt overgeslagen met een melding.
   */
  onlyConfigured?: boolean;
  /** Pad naar de gebouwenconfig; standaard `<srcDir>/buildings/variants.json`. Ontbreekt hij, dan zijn er geen gebouwen. */
  variantsPath?: string;
  /** Pad naar de robots-config; standaard `<srcDir>/robots.json`. Ontbreekt hij, dan zijn er geen robots. */
  robotsPath?: string;
  /** Pad naar de Raider-config (zelfde formaat als robots.json); standaard `<srcDir>/raiders.json`. Optioneel. */
  raidersPath?: string;
  /** Path to the Dweller gear config (same format, attachments only); default `<srcDir>/dwellers-gear.json`. Optional. */
  dwellersGearPath?: string;
  /** Path to the site buildings config (same format, buildings only: ruin and restored pairs); default `<srcDir>/sites.json`. Optional. */
  sitesPath?: string;
  /** Path to the survival enemies config (same format, rigid units without a team); default `<srcDir>/survival.json`. Optional. */
  survivalPath?: string;
  /** Path to the Garde config (same format: the Garde bodies, weapons, Vertibird and buildings); default `<srcDir>/garde.json`. Optional. */
  gardePath?: string;
  /**
   * Config of the delivered models (src/delivered.ts, `assets/local/delivered.json`), only used when given or when
   * `<srcDir>/delivered.json` exists; its `file` paths are relative to `srcDir`.
   */
  deliveredPath?: string;
  /** Pad naar de prop-packs-config; standaard `<srcDir>/packs.json`. Ontbreekt hij, dan zijn er geen pack-props. */
  packsPath?: string;
  /** Map met de pack-GLB's; standaard `<srcDir>/packs`, vanuit een worktree ook die van de hoofdcheckout. */
  packsDir?: string | null;
}

export interface AssetReport {
  id: string;
  source: string;
  errors: string[];
  warnings: string[];
  /** Wat de buis aan de bron veranderd heeft en wat eruit kwam; komt in validation-report.json. */
  details?: AssetDetails | BuildingDetails | RobotDetails | PackPropDetails | DeliveredDetails;
}

export interface AssetDetails {
  kind: 'character' | 'prop';
  sourceTriangles: number;
  lodTriangles: number[];
  /** Beeldbytes per LOD na de textuurstap (BUDGETS.characterTextureSizes), en de maat die per LOD gold. */
  lodTextureBytes?: number[];
  lodTextureSizes?: number[];
  sourceBones: number;
  bones: number;
  prunedBones: string[];
  channelsDropped: number;
  clipsKept: Record<string, string>;
  clipsDropped: string[];
  extraUvSetsRemoved: number;
  scale: number | null;
  /** Alleen bij lokale bronnen met extractie, fit, retarget, atlas of teammasker (rigmap-entry). */
  meshesRemoved?: string[];
  fit?: ConformInfo['fit'];
  retarget?: ConformInfo['retarget'];
  atlas?: ConformInfo['atlas'];
  teamMask?: ConformInfo['teamMask'];
  teamTrim?: ConformInfo['teamTrim'];
  /** Primitives die geen normalen hadden en gladde normalen kregen. */
  normalsComputed?: number;
  /** Auto-rigged from a static mesh (src/autorig.ts). */
  autoRig?: ConformInfo['autoRig'];
  /** PBR-kaarten naast de diffuse die in de LOD's zitten (manifest `maps`). */
  maps?: MaterialMap[];
}

export interface BuildResult {
  ok: boolean;
  reports: AssetReport[];
  /** Waarschuwingen op buisniveau, bijvoorbeeld ontbrekende KTX2-tooling. */
  notices: string[];
  manifest: AssetManifest | null;
}

export function listGlbs(dir: string): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const found: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...listGlbs(full));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.glb')) found.push(full);
  }
  return found.sort();
}

export function toId(file: string): string {
  return basename(file)
    .replace(/\.glb$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}
