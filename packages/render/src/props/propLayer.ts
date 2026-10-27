// Decorative props (trees, rocks, bushes, grass) from the map's props file: static, not in the sim, not pickable.
// One instanced draw per prop asset per distinct LOD geometry (identical LODs share one draw), with frustum culling
// per chunk of CHUNK_SIZE meters: the layer only rewrites the instance buffers when the set of visible chunks, their
// LOD or their density changes, so a still camera costs no uploads. Height comes from the terrain at each prop
// (relayout() after setTerrain). With the sun shadow on (option `shadow`), trees and structures cast it, and rocks,
// crates, chests and barrels too at high quality (propCategory.ts castsShadow); ground cover never does. Props also
// get a soft blob decal near the camera (LOD 0 and 1 chunks, at most maxBlobs, nearest chunks first): the full blob
// without the real shadow, a faint contact darkening with it. Chunks are culled with a margin when shadows are on, so
// a tree just outside the view still casts into it.
// Scale (thousands of trees on a 384 m map): beyond thinDistance a chunk draws only part of its props, falling off
// with distance, and over all chunks at most maxVisible props are drawn (the far ones give way first). Which props a
// chunk keeps is fixed per prop (a hash, the chunk's props sorted on it), so props never shuffle while the camera
// moves; a thinned chunk draws its kept props a little larger, so a forest still reads as a forest from far away.
// Thinning is per category (propThinning.ts): ground cover (grass, plants, debris) starts thinning at half the distance
// and goes first when the budget is short, then rocks and containers, trees and structures last. Foliage (trees with
// leaves, grass, plants) varies its tint and brightness per instance by +-8 percent (propVariation.ts) and, with the
// wind on, sways (propWind.ts, the material); iTint.w of an instance is its wind phase. Assets with alpha-tested
// leaf cards or blades (`mask`) get the mask variant of the material: one draw per asset per LOD stays one draw.

export { PROP_CHUNK_SIZE, SHADOW_MIN_SIZE, SHADOW_CULL_MARGIN } from './propLayer.part1.js';
export type {
  RenderProp,
  PropVisual,
  PropMaterialSpec,
  PropLayerOptions,
} from './propLayer.part1.js';
export { PropLayer } from './propLayer.part2.js';
