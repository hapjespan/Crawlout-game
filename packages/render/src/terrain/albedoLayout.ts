// Where on the source albedo (terrain.json of the asset-cli: a top view of Rock Terrain 4, aligned with its
// heightfield) each world point of the map lies. A map is built from that one heightfield (packages/map
// gen/terrain.ts): in tiles of the source size, each tile the source in one of eight orientations, the middle tile
// point-mirrored (the kept half turned 180 degrees over the other with a blended seam), and neighbouring tiles
// blended over a few cells across their border (each continued mirrored past its edge). The layout describes exactly
// that, so the terrain material can sample the albedo as the real color of the ground the heights came from, with
// the same mirroring and seams, and no repeat that does not match the relief.
//
// Coordinates: world x and z in meters, the tile grid starts at (originX, originZ). Within a tile (u, v) runs 0..1
// along x and z. The source uv (su, sv) also runs 0..1 along the source's x and z (row 0 of the albedo is the
// smallest z, as in the heightfield). Orientation o (packages/map sourceCell): bit 2 swaps u and v, then bit 0
// flips the first coordinate and bit 1 the second: 0 (u, v), 1 (1-u, v), 2 (u, 1-v), 3 (1-u, 1-v), 4 (v, u),
// 5 (1-v, u), 6 (v, 1-u), 7 (1-v, 1-u).
//
// albedoUv is the CPU form of the shader (terrainMaterial.ts): the same weights, for tests and for checking a layout.

export type AlbedoSeam = 'horizontal' | 'vertical' | 'diagonal' | 'antidiagonal';

/** Seam kinds as the shader's index (TerrainSpec.seam.kind of packages/map). */
export const ALBEDO_SEAMS: readonly AlbedoSeam[] = [
  'horizontal',
  'vertical',
  'diagonal',
  'antidiagonal',
];

export interface TerrainAlbedoTile {
  /** Orientation of the source in this tile, 0..7 (packages/map sourceCell). */
  orientation: number;
  /**
   * Point mirror (the map's centre tile, packages/map symmetrize): the oriented source on the kept side of the seam
   * (the smaller v, u, u + v or the larger u - v), the same turned 180 degrees on the other side, blended over
   * halfWidth meters on either side of the seam through the tile's middle.
   */
  pointMirror?: { seam: AlbedoSeam; halfWidth: number };
}

export interface TerrainAlbedoLayout {
  /** Edge of one tile in meters: the source heightfield's extent (128 for Rock Terrain 4 at 1 m per cell). */
  tileSize: number;
  /** World position of the tile grid's corner, meters. Default 0, 0. */
  originX?: number;
  originZ?: number;
  cols: number;
  rows: number;
  /** cols * rows tiles, row by row (a row runs along x, rows along z). */
  tiles: readonly TerrainAlbedoTile[];
  /** Neighbouring tiles blend over this many meters on either side of their border (packages/map
   * TileSpec.blendHalfWidthCells at 1 m per cell). 0 or absent: hard borders. */
  blendHalfWidth?: number;
}

/** Most tiles a layout may have (a uniform array in the shader): a 5 x 5 map. */
export const MAX_ALBEDO_TILES = 25;

export class AlbedoLayoutError extends Error {
  override name = 'AlbedoLayoutError';
}

/** Throws AlbedoLayoutError when the layout cannot be drawn. */
export function validateAlbedoLayout(layout: TerrainAlbedoLayout): void {
  const { cols, rows, tiles, tileSize } = layout;
  if (!(tileSize > 0)) throw new AlbedoLayoutError(`tileSize ${tileSize} must be positive`);
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || rows < 1)
    throw new AlbedoLayoutError(`cols ${cols} and rows ${rows} must be positive integers`);
  if (cols * rows > MAX_ALBEDO_TILES)
    throw new AlbedoLayoutError(`${cols} x ${rows} tiles, at most ${MAX_ALBEDO_TILES}`);
  if (tiles.length !== cols * rows)
    throw new AlbedoLayoutError(`${tiles.length} tiles for a ${cols} x ${rows} grid`);
  const blend = layout.blendHalfWidth ?? 0;
  if (!(blend >= 0) || blend > tileSize / 2)
    throw new AlbedoLayoutError(`blendHalfWidth ${blend} must be 0..${tileSize / 2}`);
  tiles.forEach((t, i) => {
    if (!Number.isInteger(t.orientation) || t.orientation < 0 || t.orientation > 7)
      throw new AlbedoLayoutError(`tile ${i}: orientation ${t.orientation} is not 0..7`);
    const m = t.pointMirror;
    if (m && (!ALBEDO_SEAMS.includes(m.seam) || !(m.halfWidth > 0) || m.halfWidth > tileSize / 2))
      throw new AlbedoLayoutError(`tile ${i}: point mirror ${JSON.stringify(m)} is not valid`);
  });
}

/**
 * The layout without a map that says otherwise: the source tiled over the bounds, every other tile mirrored so each
 * border meets itself (no visible seam), starting at the bounds' corner.
 */
export function mirroredAlbedoLayout(
  bounds: { minX: number; minZ: number; maxX: number; maxZ: number },
  tileSize: number,
): TerrainAlbedoLayout {
  const cols = Math.max(1, Math.min(5, Math.ceil((bounds.maxX - bounds.minX) / tileSize - 1e-6)));
  const rows = Math.max(1, Math.min(5, Math.ceil((bounds.maxZ - bounds.minZ) / tileSize - 1e-6)));
  const tiles: TerrainAlbedoTile[] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) tiles.push({ orientation: (c & 1) | ((r & 1) << 1) });
  return { tileSize, originX: bounds.minX, originZ: bounds.minZ, cols, rows, tiles };
}

/** Orientation o applied to tile coordinates (u, v): the source uv. */
export function orientUv(o: number, u: number, v: number): [number, number] {
  let a = o & 4 ? v : u;
  let b = o & 4 ? u : v;
  if (o & 1) a = 1 - a;
  if (o & 2) b = 1 - b;
  return [a, b];
}

/** Mirrored continuation past a tile edge (packages/map composeTiles ext): 0..1 stays, -0.1 reads 0.1, 1.1 reads 0.9. */
export function foldUnit(t: number): number {
  const m = (((t + 1) % 2) + 2) % 2;
  return Math.abs(m - 1);
}

export function smoothstep01(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

/** Signed distance (meters, positive on the kept side) to a point-mirror seam through the tile's middle. */
export function seamDistance(seam: AlbedoSeam, u: number, v: number, tileSize: number): number {
  switch (seam) {
    case 'horizontal':
      return (0.5 - v) * tileSize;
    case 'vertical':
      return (0.5 - u) * tileSize;
    case 'diagonal':
      return ((1 - u - v) * tileSize) / 2;
    default:
      return ((u - v) * tileSize) / 2;
  }
}

/** One sample of the source: uv and weight. */
export interface AlbedoTap {
  u: number;
  v: number;
  w: number;
}

function tileTaps(
  tile: TerrainAlbedoTile,
  u: number,
  v: number,
  tileSize: number,
  weight: number,
  out: AlbedoTap[],
): void {
  const fu = foldUnit(u);
  const fv = foldUnit(v);
  const m = tile.pointMirror;
  // packages/map: weight of the kept side is smoothstep((d2 + 2W) / 4W), d2 twice the cell distance to the seam.
  const keep = m
    ? smoothstep01((seamDistance(m.seam, fu, fv, tileSize) + m.halfWidth) / (2 * m.halfWidth))
    : 1;
  if (keep > 0) {
    const [a, b] = orientUv(tile.orientation, fu, fv);
    out.push({ u: a, v: b, w: weight * keep });
  }
  if (keep < 1) {
    const [a, b] = orientUv(tile.orientation, 1 - fu, 1 - fv);
    out.push({ u: a, v: b, w: weight * (1 - keep) });
  }
}

/**
 * The source samples at world (x, z) with their weights (summing to 1): one in the middle of a tile, up to four tiles
 * near a tile corner, twice that on a point-mirror seam.
 */
export function albedoUv(layout: TerrainAlbedoLayout, x: number, z: number): AlbedoTap[] {
  const T = layout.tileSize;
  const gx = (x - (layout.originX ?? 0)) / T;
  const gz = (z - (layout.originZ ?? 0)) / T;
  const tx = Math.min(layout.cols - 1, Math.max(0, Math.floor(gx)));
  const tz = Math.min(layout.rows - 1, Math.max(0, Math.floor(gz)));
  const lu = gx - tx;
  const lv = gz - tz;
  const W = layout.blendHalfWidth ?? 0;
  // Neighbour across the nearer border and its weight (packages/map composeTiles: smoothstep over +-W).
  const side = (l: number, t: number, n: number): [number, number] => {
    const s = l < 0.5 ? -1 : 1;
    if (W <= 0 || t + s < 0 || t + s >= n) return [s, 0];
    const d = (0.5 - Math.abs(l - 0.5)) * T; // meters to the border
    return [s, smoothstep01((W - d) / (2 * W))];
  };
  const [sx, wx] = side(lu, tx, layout.cols);
  const [sz, wz] = side(lv, tz, layout.rows);
  const taps: AlbedoTap[] = [];
  const add = (dx: number, dz: number, w: number): void => {
    if (w <= 0) return;
    const tile = layout.tiles[(tz + dz) * layout.cols + tx + dx]!;
    tileTaps(tile, lu - dx, lv - dz, T, w, taps);
  };
  add(0, 0, (1 - wx) * (1 - wz));
  add(sx, 0, wx * (1 - wz));
  add(0, sz, (1 - wx) * wz);
  add(sx, sz, wx * wz);
  return taps;
}
