// Albedo layout of a map for renderer.setTerrain(terrain, { albedoLayout }): how packages/map composed the map from
// the source heightfield (TerrainSpec: orientation, point-mirrored middle with its seam, k x k tiles with blended
// borders), so the renderer samples the albedo of terrain.json as the real color of every point. The map's generator
// spec is the source of truth; nothing here is a game rule (render only).
import { RUSTBELT_SPEC, TESTMAP_SPEC, type TerrainSpec } from '@crawlout/map';
import type { TerrainAlbedoLayout, TerrainAlbedoTile } from '@crawlout/render';

/** Orientation after an extra 180-degree turn (packages/map rotate180). */
const rotate180 = (o: number): number => o ^ 3;

/** Layout of a map generated with `terrain` from an n x n source heightfield (1 m per cell). */
export function albedoLayoutFromSpec(terrain: TerrainSpec, n: number): TerrainAlbedoLayout {
  const centre: TerrainAlbedoTile = {
    orientation: terrain.orientation,
    pointMirror: { seam: terrain.seam.kind, halfWidth: terrain.seam.halfWidthCells },
  };
  const tiles = terrain.tiles;
  if (!tiles) return { tileSize: n, cols: 1, rows: 1, tiles: [centre] };
  const k = tiles.k;
  const grid: (TerrainAlbedoTile | null)[] = new Array<TerrainAlbedoTile | null>(k * k).fill(null);
  grid[(k >> 1) * k + (k >> 1)] = centre;
  for (const t of tiles.outer) {
    grid[t.ty * k + t.tx] = { orientation: t.orientation };
    grid[(k - 1 - t.ty) * k + (k - 1 - t.tx)] = { orientation: rotate180(t.orientation) };
  }
  if (grid.some((t) => t === null))
    throw new Error('albedo layout: not every tile of the map spec has an orientation');
  return {
    tileSize: n,
    cols: k,
    rows: k,
    tiles: grid as TerrainAlbedoTile[],
    blendHalfWidth: tiles.blendHalfWidthCells,
  };
}

const SPECS: Readonly<Record<string, { terrain?: TerrainSpec; w: number }>> = {
  rustbelt: RUSTBELT_SPEC,
  testmap: TESTMAP_SPEC,
};

/** Layout for a shipped map, or null when it is not built from the source heightfield (testmap) or unknown. */
export function albedoLayoutForMap(mapId: string): TerrainAlbedoLayout | null {
  const spec = SPECS[mapId];
  const terrain = spec?.terrain;
  if (!spec || !terrain) return null;
  const k = terrain.tiles?.k ?? 1;
  return albedoLayoutFromSpec(terrain, spec.w / k);
}

/** Point mirror of the render demo's 128 m map (rockTerrain.ts: orientation 5, horizontal seam over 8 m). */
const DEMO_CENTRE: TerrainAlbedoTile = {
  orientation: 5,
  pointMirror: { seam: 'horizontal', halfWidth: 8 },
};

/** The render demo's Rock Terrain 4 map (rockTerrainHeights): one tile. */
export function rockDemoAlbedoLayout(n = 128): TerrainAlbedoLayout {
  return { tileSize: n, cols: 1, rows: 1, tiles: [DEMO_CENTRE] };
}

/**
 * The render demo's XL map (xlWorld.ts): the demo tile three times in x and z, mirrored in x on odd columns and in z
 * on odd rows. Mirroring the point-symmetric tile in x or in z is the same as orientation 7 (5 flipped), both is the
 * tile itself; the borders meet themselves, so no blend.
 */
export function xlDemoAlbedoLayout(n = 128, k = 3): TerrainAlbedoLayout {
  const tiles: TerrainAlbedoTile[] = [];
  for (let r = 0; r < k; r++)
    for (let c = 0; c < k; c++)
      tiles.push({ ...DEMO_CENTRE, orientation: (c + r) % 2 === 1 ? 7 : 5 });
  return { tileSize: n, cols: k, rows: k, tiles };
}
