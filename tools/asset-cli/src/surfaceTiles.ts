// The shared surface tiles: one file set per surface kind next to manifest.json, instead of a copy of the same tile
// inside every LOD GLB that uses it.
//
// Why. The generated maps of surfaceTex.ts tile: a kind has exactly one base, one normal and one metallic-roughness
// map, the same bytes everywhere. Embedding them put 7.2 MB of duplicate image into 136 GLBs (33 buildings, 26 props,
// 9 rigid units) for 11 kinds of actual content. Render dedupes them again at load anyway: the texture layer table
// keys on the material name and keeps one layer per name, so the copies never reach the GPU - they are purely bytes
// over the wire.
//
// How. assemble() (buildings.part1.ts) marks a flat material with glTF `extras.surface = <kind>` and hangs no texture
// on it; render looks the kind up in the manifest `surfaces` block, fetches the tile once and attaches it before the
// material reaches the layer table. See docs/fase-0/28-contract-gedeelde-oppervlaktetegels.md.
//
// One size for every LOD. The embedded tiles were 256 at LOD0 and 128 at LOD1, but the layer table keeps the largest
// image per material name, so the 128 copy never became a layer: it only shifted the uv rescale of LOD1
// (texelDensity.ts) and made its panels read at 64 cm instead of the metre they were authored as. A single 256 tile
// drops that inconsistency along with the bytes.
import sharp from 'sharp';
import { SURFACE_KINDS, type SurfaceKind, type SurfaceTiles } from './manifest.js';
import { surfaceMaps } from './surfaceTex.js';
import { UV_METERS_PER_TILE } from './uvmap.js';

/** Directory inside dist that holds the tiles; `writeDist` creates it from the output paths. */
export const SURFACE_TILE_DIR = 'surfaces';

/**
 * Texel edge of every shared tile. 256 over the 2 m tile of uvmap.ts is 128 texels/m, inside render's DENSITY_BAND
 * (100..180), so uvScaleForDensity leaves the uv alone and a panel stays the metre it was authored as.
 */
export const SURFACE_TILE_SIZE = 256;

/** The three maps of a kind, in the order render needs them. */
export const SURFACE_TILE_SLOTS = ['base', 'normal', 'mr'] as const;

export type SurfaceTileSlot = (typeof SURFACE_TILE_SLOTS)[number];

/** Path of one tile file relative to the dist dir (and so to manifest.json). */
export function surfaceTilePath(kind: SurfaceKind, slot: SurfaceTileSlot): string {
  return `${SURFACE_TILE_DIR}/${kind}.${slot}.jpg`;
}

export interface BuiltSurfaceTiles {
  /** Path relative to dist to the file bytes, ready for the build's `outputs` map. */
  outputs: Map<string, Uint8Array>;
  /** The manifest block. */
  surfaces: SurfaceTiles;
}

/**
 * Generates the shared tiles for every surface kind. JPEG at sharp's default quality, which is exactly what
 * `textureCompress({ targetFormat: 'jpeg' })` in finishBuildingLod produced for the embedded copies, so a tile keeps
 * the size and the look it had. None of the three maps carries alpha, so JPEG loses nothing a GLB kept.
 *
 * Every kind is written, not only the ones a build happens to use: the set is then a fixed artifact that does not
 * change when a variant is added, and all eleven together are a fraction of one building GLB.
 */
export async function buildSurfaceTiles(size = SURFACE_TILE_SIZE): Promise<BuiltSurfaceTiles> {
  const outputs = new Map<string, Uint8Array>();
  const tiles: SurfaceTiles['tiles'] = [];
  for (const kind of [...SURFACE_KINDS].sort()) {
    const maps = surfaceMaps(kind, size);
    const paths = {} as Record<SurfaceTileSlot, string>;
    for (const slot of SURFACE_TILE_SLOTS) {
      const path = surfaceTilePath(kind, slot);
      outputs.set(path, new Uint8Array(await sharp(Buffer.from(maps[slot])).jpeg().toBuffer()));
      paths[slot] = path;
    }
    tiles.push({ kind, ...paths });
  }
  return { outputs, surfaces: { size, metersPerTile: UV_METERS_PER_TILE, tiles } };
}
