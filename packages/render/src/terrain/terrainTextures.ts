// Where the terrain material's detail texture and tints come from: the asset-cli's terrain manifest
// (assets/dist/terrain/terrain.json, crawlout-terrain/1, schema in @crawlout/asset-cli/heightfield), or explicit
// values from the client. The albedo path in terrain.json is relative to terrain.json; the client maps it to a URL
// (Vite hashes asset files) with resolveUrl, like the asset manifest. Loading never throws: a failure is a status and
// the terrain keeps its tints.
import { terrainManifestSchema } from '@crawlout/asset-cli/heightfield';
import type { Texture } from 'three/webgpu';
import { DEFAULT_GROUND_TINT, DEFAULT_ROCK_TINT } from './terrainMaterial.js';

export interface TerrainTextureOptions {
  /** URL of terrain.json (crawlout-terrain/1): albedo, rockTint and groundTint come from it. */
  manifestUrl?: string;
  /** Maps a path from terrain.json (relative to it) to a URL; default: next to terrain.json. */
  resolveUrl?: (path: string) => string;
  /** Albedo URL over the manifest's; null: no texture, tints only. */
  albedoUrl?: string | null;
  /** sRGB hex (#rrggbb) over the manifest's. */
  rockTint?: string;
  groundTint?: string;
}

export interface TerrainTextureStatus {
  /** 'failed' when anything could not be read; the rest (tints, texture) is applied all the same. */
  state: 'ready' | 'failed';
  /** URL of the detail texture in use, or null. */
  albedo: string | null;
  rockTint: string;
  groundTint: string;
  /** Edge (m) of the ground the albedo covers: the heightfield's w * metersPerCell from terrain.json. */
  tileSize?: number;
  /** Attribution of the source (CC-BY) from terrain.json. */
  attribution?: string;
  reason?: string;
}

export interface TerrainTextureIO {
  fetchText(url: string): Promise<string>;
  loadTexture(url: string): Promise<Texture>;
}

const HEX = /^#[0-9a-f]{6}$/i;

function resolveNextTo(manifestUrl: string, path: string): string {
  const base = typeof location !== 'undefined' ? location.href : 'file:///';
  return new URL(path, new URL(manifestUrl, base)).href;
}

/** Reads terrain.json (when given) and loads the albedo. Resolves with the texture (or null) and a status. */
export async function loadTerrainTextures(
  opts: TerrainTextureOptions,
  io: TerrainTextureIO,
): Promise<{ texture: Texture | null; status: TerrainTextureStatus }> {
  const status: TerrainTextureStatus = {
    state: 'ready',
    albedo: null,
    rockTint: DEFAULT_ROCK_TINT,
    groundTint: DEFAULT_GROUND_TINT,
  };
  const reasons: string[] = [];
  let albedoUrl: string | null = null;
  if (opts.manifestUrl) {
    try {
      const parsed = terrainManifestSchema.safeParse(
        JSON.parse(await io.fetchText(opts.manifestUrl)),
      );
      if (!parsed.success)
        throw new Error(
          parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
        );
      const m = parsed.data;
      status.rockTint = m.rockTint;
      status.groundTint = m.groundTint;
      status.attribution = m.attribution;
      status.tileSize = m.heightfield.w * m.heightfield.metersPerCell;
      albedoUrl = opts.resolveUrl
        ? opts.resolveUrl(m.albedo.path)
        : resolveNextTo(opts.manifestUrl, m.albedo.path);
    } catch (err) {
      reasons.push(`terrain.json: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (opts.albedoUrl !== undefined) albedoUrl = opts.albedoUrl;
  for (const key of ['rockTint', 'groundTint'] as const) {
    const v = opts[key];
    if (v === undefined) continue;
    if (HEX.test(v)) status[key] = v.toLowerCase();
    else reasons.push(`${key} "${v}" is not #rrggbb`);
  }
  let texture: Texture | null = null;
  if (albedoUrl) {
    try {
      texture = await io.loadTexture(albedoUrl);
      status.albedo = albedoUrl;
    } catch (err) {
      reasons.push(`albedo ${albedoUrl}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (reasons.length > 0) {
    // Whatever did load is used; the status says what did not.
    status.state = 'failed';
    status.reason = reasons.join('; ');
  }
  return { texture, status };
}
