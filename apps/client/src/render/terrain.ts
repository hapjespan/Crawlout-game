/// <reference types="vite/client" />
// Terrain textures for the renderer: terrain.json of the asset-cli (assets/dist/terrain, crawlout-terrain/1) with the
// albedo next to it. Vite hashes the files in a build, so the paths in terrain.json resolve through this map, the same
// way the asset manifest does (game/assets.ts). Pass the result as createRenderer({ terrainTextures }).
import type { TerrainTextureOptions } from '@crawlout/render';

const TERRAIN_DIR = '../../../../assets/dist/terrain/';
const terrainFiles = import.meta.glob('../../../../assets/dist/terrain/*.{json,jpg,png}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

/** Detail texture and tints from assets/dist/terrain/terrain.json, or undefined when it is not there. */
export function terrainTextures(): TerrainTextureOptions | undefined {
  const manifestUrl = terrainFiles[`${TERRAIN_DIR}terrain.json`];
  if (!manifestUrl) return undefined;
  return { manifestUrl, resolveUrl: (path) => terrainFiles[TERRAIN_DIR + path] ?? path };
}
